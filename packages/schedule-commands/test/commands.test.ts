import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { defaultTenantCalendar, parseLocal } from '@northmatter/calendar';
import { calculate } from '@northmatter/schedule-engine';
import {
  applyCommands,
  childrenOf,
  cmd,
  CommandError,
  evenKeys,
  formatDuration,
  formatPredecessor,
  keyBetween,
  keysAfter,
  lookupId,
  parseDuration,
  parsePredecessors,
  toScheduleInput,
  type ActivityRecord,
  type Command,
  type ScheduleDoc,
} from '../src/index.js';

const t0 = parseLocal('Asia/Kolkata', '2026-11-23T09:00');
const act = (id: string, sortKey: string, extra: Partial<ActivityRecord> = {}): ActivityRecord => ({
  id, stableKey: id, code: id, name: id, sortKey, type: 'task', duration: 480, constraint: 'ASAP', ...extra,
});
const doc = (): ScheduleDoc => ({
  id: 'v1', name: 'Test', kind: 'draft', version: 1, projectStart: t0, dataDate: t0, defaultCalendarId: 'std',
  calendars: [defaultTenantCalendar('std')],
  activities: [act('A', 'a'), act('B', 'b'), act('C', 'c')],
  links: [{ id: 'l1', from: 'A', to: 'B', type: 'FS', lag: 0 }],
  settings: {},
});

const strip = (d: ScheduleDoc) => ({ ...d, version: 0, activities: [...d.activities].sort((a, b) => (a.id < b.id ? -1 : 1)), links: [...d.links].sort((a, b) => (a.id < b.id ? -1 : 1)) });

function roundTrip(cmds: Command[], start?: ScheduleDoc) {
  const d0 = start ?? doc();
  const { doc: d1, inverse } = applyCommands(d0, cmds);
  const { doc: d2 } = applyCommands(d1, inverse);
  expect(strip(d2)).toEqual(strip(d0));
  return d1;
}

describe('commands and their inverses', () => {
  it('add / update / delete activity', () => {
    roundTrip([cmd({ kind: 'addActivity', activity: act('D', 'd') })]);
    roundTrip([cmd({ kind: 'updateActivity', activityId: 'A', patch: { name: 'Renamed', duration: 960, notes: 'x' } })]);
    const d = roundTrip([cmd({ kind: 'deleteActivity', activityId: 'A' })]);
    expect(d.links).toHaveLength(0); // deleting removes links
  });
  it('indent turns the row above into a summary; outdent reverses it', () => {
    const d = roundTrip([cmd({ kind: 'deleteLink', linkId: 'l1' }), cmd({ kind: 'indent', activityId: 'B' })]);
    expect(d.activities.find((a) => a.id === 'A')!.type).toBe('summary');
    expect(d.activities.find((a) => a.id === 'B')!.parentId).toBe('A');
    const { doc: d2 } = applyCommands(d, [cmd({ kind: 'outdent', activityId: 'B' })]);
    expect(d2.activities.find((a) => a.id === 'A')!.type).toBe('task');
    expect(childrenOf(d2, null).map((a) => a.id)).toEqual(['A', 'B', 'C']);
    expect(d2.activities.find((a) => a.id === 'A')!.autoSummary).toBeUndefined();
  });
  it('outdent keeps a summary the user created explicitly', () => {
    const d = roundTrip([
      cmd({ kind: 'deleteLink', linkId: 'l1' }),
      cmd({ kind: 'updateActivity', activityId: 'A', patch: { type: 'summary' } }),
      cmd({ kind: 'indent', activityId: 'B' }),
    ]);
    expect(d.activities.find((a) => a.id === 'B')!.parentId).toBe('A');
    const d2 = roundTrip([cmd({ kind: 'outdent', activityId: 'B' })], d);
    expect(d2.activities.find((a) => a.id === 'A')!.type).toBe('summary');
    expect(d2.activities.find((a) => a.id === 'B')!.parentId).toBeUndefined();
  });
  it('updateLookups adds, renames and removes towers, floors and trades, and undoes exactly', () => {
    const d = roundTrip([cmd({ kind: 'updateLookups', patch: {
      towers: { TA: 'Tower A', TB: 'Tower B' }, floors: { F1: 'Floor 1', F2: 'Floor 2' }, floorOrder: ['F1', 'F2'],
      templates: [{ id: 'SLAB', name: 'Slab', short: 'Slab' }],
    } })]);
    expect(d.towers).toEqual({ TA: 'Tower A', TB: 'Tower B' });
    expect(d.floorOrder).toEqual(['F1', 'F2']);
    // Activities can now point at them; unknown ids are refused.
    const { doc: d2 } = applyCommands(d, [cmd({ kind: 'updateActivity', activityId: 'A', patch: { towerId: 'TA', floorId: 'F2', activityTemplateId: 'SLAB' } })]);
    expect(() => applyCommands(d, [cmd({ kind: 'updateActivity', activityId: 'A', patch: { towerId: 'NOPE' } })])).toThrow(/Tower NOPE does not exist/);
    expect(() => applyCommands(d, [cmd({ kind: 'updateActivity', activityId: 'A', patch: { activityTemplateId: 'NOPE' } })])).toThrow(/UNKNOWN_TRADE|Trade NOPE/);
    // In-use entries cannot be removed; unused ones can; renames keep ids.
    expect(() => applyCommands(d2, [cmd({ kind: 'updateLookups', patch: { towers: { TA: null } } })])).toThrow(/used by 1 activity/);
    expect(() => applyCommands(d2, [cmd({ kind: 'updateLookups', patch: { templates: [] } })])).toThrow(/Trade Slab is used/);
    const { doc: d3, inverse } = applyCommands(d2, [cmd({ kind: 'updateLookups', patch: { towers: { TA: 'Kaveri A', TB: null } } })]);
    expect(d3.towers).toEqual({ TA: 'Kaveri A' });
    expect(applyCommands(d3, inverse).doc.towers).toEqual({ TA: 'Tower A', TB: 'Tower B' });
    // Names must be non-empty and unique (ignoring case).
    expect(() => applyCommands(d, [cmd({ kind: 'updateLookups', patch: { floors: { F3: 'floor 1' } } })])).toThrow(/DUPLICATE_NAME|Two floors/);
    expect(() => applyCommands(d, [cmd({ kind: 'updateLookups', patch: { towers: { TC: '  ' } } })])).toThrow(/cannot be empty/);
  });
  it('lookupId makes readable unique ids', () => {
    expect(lookupId('T', 'Tower A', [])).toBe('T-TOWER-A');
    expect(lookupId('T', 'tower a', ['T-TOWER-A', 'T-TOWER-A-2'])).toBe('T-TOWER-A-3');
    expect(lookupId('F', 'टावर', [])).toBe('F-X');
  });
  it('indent is refused when the new parent has links', () => {
    expect(() => applyCommands(doc(), [cmd({ kind: 'indent', activityId: 'B' })])).toThrow(CommandError);
  });
  it('links: add, update, delete; refuses cycles and summaries', () => {
    roundTrip([cmd({ kind: 'addLink', link: { id: 'l2', from: 'B', to: 'C', type: 'SS', lag: 60 } })]);
    roundTrip([cmd({ kind: 'updateLink', linkId: 'l1', patch: { type: 'FF', lag: -60 } })]);
    roundTrip([cmd({ kind: 'deleteLink', linkId: 'l1' })]);
    expect(() => applyCommands(doc(), [cmd({ kind: 'addLink', link: { id: 'x', from: 'B', to: 'A', type: 'FS', lag: 0 } })])).toThrow(/loop/);
  });
  it('constraints, calendars and progress', () => {
    roundTrip([cmd({ kind: 'setConstraint', activityId: 'A', constraint: 'SNET', constraintDate: t0 + 1440 })]);
    roundTrip([cmd({ kind: 'setCalendar', activityId: 'A', calendarId: 'std' })]);
    roundTrip([cmd({ kind: 'setProgress', activityId: 'A', progress: { actualStart: t0, percentComplete: 5000 } })]);
    expect(() => applyCommands(doc(), [cmd({ kind: 'setConstraint', activityId: 'A', constraint: 'MSO' })])).toThrow(CommandError);
  });
  it('a batch is all or nothing', () => {
    const d0 = doc();
    expect(() => applyCommands(d0, [cmd({ kind: 'deleteLink', linkId: 'l1' }), cmd({ kind: 'deleteLink', linkId: 'nope' })])).toThrow(CommandError);
    expect(d0.links).toHaveLength(1);
  });
  it('the resulting document feeds the engine', () => {
    const { doc: d } = applyCommands(doc(), [cmd({ kind: 'addLink', link: { id: 'l2', from: 'B', to: 'C', type: 'FS', lag: 0 } })]);
    const res = calculate(toScheduleInput(d));
    expect(res.ok).toBe(true);
    expect(res.activities.C!.es).toBeGreaterThan(res.activities.B!.es);
  });
});

describe('sort keys', () => {
  it('keyBetween is strictly between', () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { maxLength: 200 }), (moves) => {
      const keys = ['V'];
      for (const left of moves) {
        const i = Math.floor(keys.length / 2);
        const k = left ? keyBetween(i > 0 ? keys[i - 1]! : null, keys[i]!) : keyBetween(keys[i]!, keys[i + 1] ?? null);
        keys.splice(left ? i : i + 1, 0, k);
      }
      return keys.every((k, i) => i === 0 || keys[i - 1]! < k);
    }));
  });
  it('evenKeys and keysAfter are increasing and short', () => {
    const e = evenKeys(5000);
    expect(e.every((k, i) => i === 0 || e[i - 1]! < k)).toBe(true);
    expect(Math.max(...e.map((k) => k.length))).toBeLessThanOrEqual(3);
    const a = keysAfter(null, 50);
    expect(a.every((k, i) => i === 0 || a[i - 1]! < k)).toBe(true);
  });
});

describe('text forms', () => {
  it('durations', () => {
    expect(parseDuration('5d')).toBe(2400);
    expect(parseDuration('3w')).toBe(7200);
    expect(parseDuration('16h')).toBe(960);
    expect(parseDuration('2.5')).toBe(1200);
    expect(parseDuration('abc')).toBeNull();
    expect(formatDuration(2400)).toBe('5d');
    expect(formatDuration(240)).toBe('4h');
    expect(formatDuration(1200)).toBe('2.5d');
  });
  it('predecessors', () => {
    expect(parsePredecessors('12FS+2d; 15SS')).toEqual([{ ref: '12', type: 'FS', lag: 960 }, { ref: '15', type: 'SS', lag: 0 }]);
    expect(parsePredecessors('KAV-T1-F05 FF-1d')).toEqual([{ ref: 'KAV-T1-F05', type: 'FF', lag: -480 }]);
    expect(parsePredecessors('7')).toEqual([{ ref: '7', type: 'FS', lag: 0 }]);
    expect(formatPredecessor('12', 'FS', 960)).toBe('12FS+2d');
    expect(formatPredecessor('12', 'FS', 0)).toBe('12');
    expect(formatPredecessor('15', 'SS', 0)).toBe('15SS');
  });
});
