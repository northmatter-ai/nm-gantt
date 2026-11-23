import { describe, expect, it } from 'vitest';
import { defaultTenantCalendar, formatLocal, parseLocal } from '@northmatter/calendar';
import { calculate } from '@northmatter/schedule-engine';
import { toScheduleInput, type ActivityRecord, type ScheduleDoc } from '@northmatter/schedule-commands';
import { buildRows, buildTree, trace } from '../src/rows.js';
import { routeLink } from '../src/links.js';
import { makeScale, snapDay, ticks } from '../src/timescale.js';

const TZ = 'Asia/Kolkata';
const t0 = parseLocal(TZ, '2026-11-23T09:00');
const act = (id: string, sortKey: string, extra: Partial<ActivityRecord> = {}): ActivityRecord =>
  ({ id, stableKey: id, code: id, name: `Name ${id}`, sortKey, type: 'task', duration: 480, constraint: 'ASAP', ...extra });
const doc: ScheduleDoc = {
  id: 'v', name: 't', kind: 'draft', version: 1, projectStart: t0, dataDate: t0, defaultCalendarId: 'std',
  calendars: [defaultTenantCalendar('std')], settings: {},
  activities: [
    act('S', 'a', { type: 'summary', duration: 0 }), act('A', 'a', { parentId: 'S', towerId: 'T1' }), act('B', 'b', { parentId: 'S', towerId: 'T2', duration: 960 }),
    act('C', 'b', { towerId: 'T1' }),
  ],
  links: [{ id: 'l1', from: 'A', to: 'B', type: 'FS', lag: 0 }, { id: 'l2', from: 'B', to: 'C', type: 'FS', lag: 0 }],
  towers: { T1: 'Tower 1', T2: 'Tower 2' },
};
const res = calculate(toScheduleInput(doc));
const tree = buildTree(doc);

describe('rows', () => {
  it('WBS numbering and tree order', () => {
    expect(tree.order).toEqual(['S', 'A', 'B', 'C']);
    expect(tree.wbs.get('B')).toBe('1.2');
    expect(tree.wbs.get('C')).toBe('2');
  });
  it('collapse hides children', () => {
    expect(buildRows(doc, tree, res, new Set(['S']), undefined, 'wbs').map((r) => r.key)).toEqual(['S', 'C']);
  });
  it('filters keep ancestors of matches', () => {
    expect(buildRows(doc, tree, res, new Set(), { text: 'Name B' }, 'wbs').map((r) => r.key)).toEqual(['S', 'B']);
    expect(buildRows(doc, tree, res, new Set(), { criticalOnly: true }, 'wbs').map((r) => r.key)).toEqual(['S', 'A', 'B', 'C']);
  });
  it('groups by tower', () => {
    const rows = buildRows(doc, tree, res, new Set(), undefined, 'tower');
    expect(rows.map((r) => r.kind === 'group' ? r.label : r.key)).toEqual(['Tower 1', 'A', 'C', 'Tower 2', 'B']);
  });
  it('trace walks predecessors transitively and marks driving links', () => {
    const tr = trace(doc, res, 'C', 'back');
    expect([...tr.ids].sort()).toEqual(['A', 'B', 'C']);
    expect(tr.driving.has('l1') && tr.driving.has('l2')).toBe(true);
  });
});

describe('link routing', () => {
  it('FS with room goes right, down, right', () => {
    expect(routeLink('FS', 100, 16, 140, 48, 32)).toBe('M100,16 L108,16 L108,48 L140,48');
  });
  it('FS without room zig-zags between rows', () => {
    expect(routeLink('FS', 100, 16, 90, 48, 32)).toBe('M100,16 L108,16 L108,32 L82,32 L82,48 L90,48');
  });
  it('SS leaves and enters from the left', () => {
    expect(routeLink('SS', 100, 16, 120, 48, 32)).toBe('M100,16 L92,16 L92,48 L120,48');
  });
  it('FF leaves and enters from the right', () => {
    expect(routeLink('FF', 100, 16, 80, 48, 32)).toBe('M100,16 L108,16 L108,48 L80,48');
  });
});

describe('time scale', () => {
  const s = makeScale(t0, t0 + 60 * 1440, 'day');
  it('maps instants to x and back', () => {
    expect(s.x(t0 + 1440)).toBe(48);
    expect(s.t(96)).toBe(t0 + 2880);
  });
  it('two-tier ticks only for the requested range', () => {
    const { top, bottom } = ticks(s, 'day', TZ, t0, t0 + 10 * 1440);
    expect(top[0]!.label).toBe('Nov 2026');
    expect(bottom.length).toBeGreaterThanOrEqual(10);
    expect(bottom.length).toBeLessThanOrEqual(12);
  });
  it('snaps to local midnight at day zoom and Monday at quarter zoom', () => {
    expect(formatLocal(TZ, snapDay(parseLocal(TZ, '2026-11-25T14:00'), 'day', TZ))).toBe('2026-11-26T00:00');
    expect(formatLocal(TZ, snapDay(parseLocal(TZ, '2026-11-25T14:00'), 'quarter', TZ))).toBe('2026-11-23T00:00');
  });
});
