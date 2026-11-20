import { describe, expect, it } from 'vitest';
import { defaultTenantCalendar, formatLocal, parseLocal } from '@nm/calendar';
import { calculate } from '@nm/schedule-engine';
import { toScheduleInput, type ActivityRecord, type ScheduleDoc } from '@nm/schedule-commands';
import { buildPhoneList, clampWeeks, weekStart, zoomWindow, type PhoneItem } from '../src/phoneModel.js';

const TZ = 'Asia/Kolkata';
const at = (s: string) => parseLocal(TZ, s);
const D = 480;
const act = (id: string, sortKey: string, extra: Partial<ActivityRecord> = {}): ActivityRecord =>
  ({ id, stableKey: id, code: id, name: `Name ${id}`, sortKey, type: 'task', duration: 2 * D, constraint: 'ASAP', ...extra });

// Data date Wed 2 Dec 2026. Tower T1: substructure (done), floor 1 (in progress), floor 2 (future); T2 one task.
const doc: ScheduleDoc = {
  id: 'v', name: 'p', kind: 'draft', version: 1, projectStart: at('2026-11-23T09:00'), dataDate: at('2026-12-02T09:00'),
  defaultCalendarId: 'std', calendars: [defaultTenantCalendar('std')], settings: {},
  towers: { T1: 'Tower 1', T2: 'Tower 2' }, floors: { F1: 'Floor 1', F2: 'Floor 2' },
  activities: [
    act('T', 'a', { type: 'summary', duration: 0, name: 'Tower 1', towerId: 'T1' }),
    act('SUB', 'a', { type: 'summary', duration: 0, name: 'Substructure', parentId: 'T', towerId: 'T1' }),
    act('EXC', 'a', { parentId: 'SUB', towerId: 'T1', actualStart: at('2026-11-23T09:00'), actualFinish: at('2026-11-24T18:00') }),
    act('F1', 'b', { type: 'summary', duration: 0, name: 'Floor 1', parentId: 'T', towerId: 'T1' }),
    act('COL1', 'a', { parentId: 'F1', towerId: 'T1', floorId: 'F1', duration: 4 * D, actualStart: at('2026-11-30T09:00') }),
    act('SLAB1', 'b', { parentId: 'F1', towerId: 'T1', floorId: 'F1', duration: 3 * D, name: 'Slab pour' }),
    act('F2', 'c', { type: 'summary', duration: 0, name: 'Floor 2', parentId: 'T', towerId: 'T1' }),
    act('COL2', 'a', { parentId: 'F2', towerId: 'T1', floorId: 'F2', duration: 30 * D }),
    act('HO', 'd', { parentId: 'T', type: 'finish_milestone', duration: 0, towerId: 'T1' }),
    act('LOE', 'e', { type: 'level_of_effort', duration: 0 }),
    act('T2A', 'f', { towerId: 'T2', duration: 2 * D }),
  ],
  links: [
    { id: 'l1', from: 'EXC', to: 'COL1', type: 'FS', lag: 0 },
    { id: 'l2', from: 'COL1', to: 'SLAB1', type: 'FS', lag: 0 },
    { id: 'l3', from: 'SLAB1', to: 'COL2', type: 'FS', lag: 0 },
    { id: 'l4', from: 'COL2', to: 'HO', type: 'FS', lag: 0 },
  ],
};
const res = calculate(toScheduleInput(doc));
const shape = (items: PhoneItem[]) => items.map((i) => (i.kind === 'header' ? `# ${i.label} (${i.count})` : i.activity.id));

describe('phone view list', () => {
  it('tower scope: leaf tasks and milestones of that tower, grouped by WBS parent in tree order', () => {
    const l = buildPhoneList(doc, res, { kind: 'tower', towerId: 'T1' });
    expect(shape(l.items)).toEqual(['# Substructure (1)', 'EXC', '# Floor 1 (2)', 'COL1', 'SLAB1', '# Floor 2 (1)', 'COL2', '# Tower 1 (1)', 'HO']);
    expect(l.count).toBe(5);
    // Window spans every bar, padded.
    expect(l.window.from).toBeLessThan(res.activities.EXC!.es);
    expect(l.window.to).toBeGreaterThan(res.activities.HO!.ef);
  });

  it('can hide completed work and filter by text', () => {
    expect(shape(buildPhoneList(doc, res, { kind: 'tower', towerId: 'T1' }, { hideComplete: true }).items)[0]).toBe('# Floor 1 (2)');
    expect(shape(buildPhoneList(doc, res, { kind: 'all' }, { text: 'slab' }).items)).toEqual(['# Tower 1 · Floor 1 (1)', 'SLAB1']);
  });

  it('whole-project scope prefixes the tower name when the group name lacks it; skips summaries and level of effort', () => {
    const l = buildPhoneList(doc, res, { kind: 'all' });
    const heads = l.items.filter((i) => i.kind === 'header').map((i) => (i as { label: string }).label);
    expect(heads).toEqual(['Tower 1 · Substructure', 'Tower 1 · Floor 1', 'Tower 1 · Floor 2', 'Tower 1', 'Tower 2 · Project']);
    expect(l.items.some((i) => i.kind === 'activity' && i.activity.id === 'LOE')).toBe(false);
  });

  it('look-ahead: unfinished work starting before the window ends, in progress first, then by week of start', () => {
    const l = buildPhoneList(doc, res, { kind: 'lookahead', weeks: 2 });
    expect(formatLocal(TZ, l.range!.from)).toBe('2026-12-02T00:00');
    expect(formatLocal(TZ, l.range!.to)).toBe('2026-12-16T00:00');
    // Bars are drawn from the start of work already under way (COL1, 30 Nov), at most a week back.
    expect(formatLocal(TZ, l.window.from)).toBe('2026-11-30T00:00');
    // EXC is complete and HO falls after the window. T2A has no predecessors, so it starts at the data date;
    // SLAB1 follows COL1 (finishes Thu 3 Dec) on Fri 4 Dec; COL2 follows on Tue 8 Dec.
    expect(shape(l.items)).toEqual(['# In progress (1)', 'COL1', '# This week (2)', 'T2A', 'SLAB1', '# Next week (1)', 'COL2']);
    const three = buildPhoneList(doc, res, { kind: 'lookahead', weeks: 3 }, { text: 'col2' });
    expect(shape(three.items)).toEqual(['# Next week (1)', 'COL2']);
  });

  it('clamps the look-ahead to 2–6 weeks', () => {
    expect([clampWeeks(1), clampWeeks(3), clampWeeks(9)]).toEqual([2, 3, 6]);
    const l = buildPhoneList(doc, res, { kind: 'lookahead', weeks: 12 });
    expect((l.range!.to - l.range!.from) / 1440).toBe(42);
  });

  it('weeks start on Monday in the schedule time zone', () => {
    expect(formatLocal(TZ, weekStart(TZ, at('2026-12-02T09:00')))).toBe('2026-11-30T00:00');
    expect(formatLocal(TZ, weekStart(TZ, at('2026-12-06T23:00')))).toBe('2026-11-30T00:00');
    expect(formatLocal(TZ, weekStart(TZ, at('2026-12-07T00:30')))).toBe('2026-12-07T00:00');
  });
});

describe('phone pinch zoom', () => {
  const w = { from: 0, to: 30 * 1440 };
  it('keeps the time under the fingers fixed', () => {
    const anchor = 10 * 1440;
    const z = zoomWindow(w, 0.5, anchor);
    expect(z.to - z.from).toBe(15 * 1440);
    expect((anchor - z.from) / (z.to - z.from)).toBeCloseTo(1 / 3, 6);
  });
  it('clamps between 3 days and 3 years', () => {
    expect(zoomWindow(w, 0.001, 0).to - zoomWindow(w, 0.001, 0).from).toBe(3 * 1440);
    const big = zoomWindow(w, 1000, 0);
    expect(big.to - big.from).toBe(3 * 365 * 1440);
  });
});
