import { describe, expect, it } from 'vitest';
import { defaultTenantCalendar, parseLocal } from '@nm/calendar';
import { calculate } from '@nm/schedule-engine';
import { makeBaseline, toScheduleInput, type ActivityRecord, type LinkRecord, type ScheduleDoc } from '@nm/schedule-commands';
import { buildLob, buildLookahead, buildTowerGrid, cellState, floorsOf } from '../src/model.js';

const TZ = 'Asia/Kolkata';
const at = (s: string) => parseLocal(TZ, s);
const D = 480;
const TEMPLATES = [{ id: 'SLAB', name: 'Slab' }, { id: 'BLK', name: 'Blockwork' }];

/** One tower, `n` floors, slab floor-to-floor, blockwork after slab (+ lag). */
function tower(n: number, blkDays = 2, blkLag = 0): ScheduleDoc {
  const acts: ActivityRecord[] = [];
  const links: LinkRecord[] = [];
  for (let f = 1; f <= n; f++) {
    const fid = `F${String(f).padStart(2, '0')}`;
    for (const t of TEMPLATES) {
      acts.push({ id: `${fid}-${t.id}`, stableKey: `${fid}-${t.id}`, code: `${fid}-${t.id}`, name: t.name, sortKey: `${fid}${t.id}`, type: 'task',
        duration: (t.id === 'SLAB' ? 5 : blkDays) * D, constraint: 'ASAP', towerId: 'T1', floorId: fid, activityTemplateId: t.id });
    }
    links.push({ id: `l-${fid}`, from: `${fid}-SLAB`, to: `${fid}-BLK`, type: 'FS', lag: blkLag });
    if (f > 1) {
      const prev = `F${String(f - 1).padStart(2, '0')}`;
      links.push({ id: `s-${fid}`, from: `${prev}-SLAB`, to: `${fid}-SLAB`, type: 'FS', lag: 0 });
      links.push({ id: `b-${fid}`, from: `${prev}-BLK`, to: `${fid}-BLK`, type: 'FS', lag: 0 });
    }
  }
  const floors = Object.fromEntries(Array.from({ length: n }, (_, i) => [`F${String(i + 1).padStart(2, '0')}`, `Floor ${i + 1}`]));
  return { id: 'v', name: 'T', kind: 'draft', version: 1, projectStart: at('2026-11-23T09:00'), dataDate: at('2026-11-23T09:00'), defaultCalendarId: 'std',
    calendars: [defaultTenantCalendar('std')], activities: acts, links, settings: {}, towers: { T1: 'Tower 1' }, floors, templates: TEMPLATES };
}

describe('cell state', () => {
  const doc = tower(2);
  const res = calculate(toScheduleInput(doc));
  const a = doc.activities[0]!;
  const r = res.activities[a.id];
  it('certified beats reported beats late beats in progress', () => {
    expect(cellState(a, r, { certified: { [a.stableKey]: { date: 1 } }, reported: { [a.stableKey]: { date: 1 } } })).toBe('certified');
    expect(cellState(a, r, { reported: { [a.stableKey]: { date: 1 } } })).toBe('reported');
    expect(cellState(a, r, {}, r!.ef - 1)).toBe('late');
    expect(cellState({ ...a, actualStart: 0 }, r, {})).toBe('in_progress');
    expect(cellState(a, r, {})).toBe('not_started');
    expect(cellState({ ...a, actualStart: 0, actualFinish: 1 }, r, {})).toBe('certified');
  });
});

describe('tower × floor grid', () => {
  it('top floor first, templates in construction order, one cell per activity', () => {
    const doc = tower(5);
    const g = buildTowerGrid(doc, calculate(toScheduleInput(doc)), {}, 'T1');
    expect(g.floors.map((f) => f.name)).toEqual(['Floor 5', 'Floor 4', 'Floor 3', 'Floor 2', 'Floor 1']);
    expect(g.templates.map((t) => t.id)).toEqual(['SLAB', 'BLK']);
    expect(g.cells.size).toBe(10);
    expect(g.counts.not_started).toBe(10);
  });
  it('floors sort naturally (Floor 10 after Floor 9)', () => {
    expect(floorsOf(tower(11), 'T1').map((f) => f.id).slice(-3)).toEqual(['F09', 'F10', 'F11']);
  });
  it('builds a 40-floor × 30-template model quickly', () => {
    const acts: ActivityRecord[] = [];
    const templates = Array.from({ length: 30 }, (_, i) => ({ id: `T${i}`, name: `Trade ${i}` }));
    for (let f = 0; f < 40; f++) for (const t of templates) {
      acts.push({ id: `${f}-${t.id}`, stableKey: `${f}-${t.id}`, code: `${f}-${t.id}`, name: t.name, sortKey: 'a', type: 'task', duration: D, constraint: 'ASAP', towerId: 'X', floorId: `F${f}`, activityTemplateId: t.id });
    }
    const doc: ScheduleDoc = { ...tower(1), activities: acts, links: [], templates, floors: undefined };
    const res = calculate(toScheduleInput(doc));
    const t0 = performance.now();
    const g = buildTowerGrid(doc, res, {}, 'X');
    expect(performance.now() - t0).toBeLessThan(100);
    expect(g.cells.size).toBe(1200);
  });
});

describe('line of balance', () => {
  it('points per floor, rates in floors per week, plan from a baseline', () => {
    const doc = tower(6);
    const res = calculate(toScheduleInput(doc));
    const lob = buildLob(doc, res, {}, 'T1');
    const slab = lob.lines.find((l) => l.templateId === 'SLAB')!;
    expect(slab.plan).toHaveLength(6);
    expect(slab.plan.map((p) => p.floor)).toEqual([0, 1, 2, 3, 4, 5]);
    // 5 working days per floor on a 6-day week → 5 floors in 25 working days ≈ 29 calendar days → ~1.2 floors/week
    expect(slab.planRate).toBeGreaterThan(1.1);
    expect(slab.planRate).toBeLessThan(1.3);
    expect(lob.clashes).toEqual([]);
    const base = makeBaseline('b', 'B', doc, res);
    expect(buildLob(doc, res, {}, 'T1', base).lines[0]!.plan).toEqual(slab.plan);
  });
  it('actual points come from certified finishes', () => {
    const doc = tower(3);
    const lob = buildLob(doc, calculate(toScheduleInput(doc)), { certified: { 'F01-SLAB': { date: at('2026-11-30T18:00') }, 'F02-SLAB': { date: at('2026-12-07T18:00') } } }, 'T1');
    const slab = lob.lines.find((l) => l.templateId === 'SLAB')!;
    expect(slab.actual.map((p) => p.floor)).toEqual([0, 1]);
    expect(slab.actualRate).toBeCloseTo(1, 5);
  });
  it('flags a clash where a following trade reaches the trade before it', () => {
    const doc = tower(4);
    // Blockwork with a negative lag big enough to finish before the slab on the same floor.
    doc.links = doc.links.map((l) => (l.id.startsWith('l-') ? { ...l, type: 'SS' as const, lag: 0 } : l));
    const res = calculate(toScheduleInput(doc));
    const lob = buildLob(doc, res, {}, 'T1');
    expect(lob.clashes.length).toBeGreaterThan(0);
    expect(lob.clashes[0]).toMatchObject({ earlier: 'SLAB', later: 'BLK', floor: 0 });
  });
});

describe('look-ahead', () => {
  const doc = tower(6);
  const res = calculate(toScheduleInput(doc));
  const site = {
    contractorOf: Object.fromEntries(doc.activities.map((a) => [a.stableKey, a.activityTemplateId === 'SLAB' ? 'c1' : 'c2'])),
    contractors: { c1: 'Structure crew', c2: 'Masonry crew' },
    readiness: { 'F02-SLAB': { material: { status: 'not_ready' as const, owner: 'Stores' } } },
    commitments: { 'F01-SLAB': { committed: 'Pour F1', done: true }, 'F01-BLK': { committed: 'F1 blocks', done: false } },
  };
  it('lists activities starting in the window, grouped by tower and contractor', () => {
    const la = buildLookahead(doc, res, site, { from: doc.projectStart, weeks: 3 });
    const names = la.towers[0]!.contractors.map((c) => c.name);
    expect(names).toEqual(['Masonry crew', 'Structure crew']);
    const slabRows = la.towers[0]!.contractors[1]!.rows.map((r) => r.activity.id);
    expect(slabRows.slice(0, 3)).toEqual(['F01-SLAB', 'F02-SLAB', 'F03-SLAB']);
    expect(la.to - la.from).toBe(3 * 7 * 1440);
  });
  it('derives predecessor readiness and marks not-ready rows', () => {
    const la = buildLookahead(doc, res, site, { from: doc.projectStart, weeks: 3 });
    const rows = la.towers[0]!.contractors.flatMap((c) => c.rows);
    const f2 = rows.find((r) => r.activity.id === 'F02-SLAB')!;
    expect(f2.readiness.material).toEqual({ status: 'not_ready', owner: 'Stores' });
    expect(f2.readiness.predecessor.status).toBe('not_ready');
    expect(f2.readiness.predecessor.owner).toBe('Structure crew');
    expect(f2.ready).toBe(false);
    expect(rows.find((r) => r.activity.id === 'F01-SLAB')!.readiness.predecessor.status).toBe('ready');
  });
  it('PPC per contractor; window clamped to 2–6 weeks', () => {
    const la = buildLookahead(doc, res, site, { from: doc.projectStart, weeks: 9 });
    expect(la.to - la.from).toBe(6 * 7 * 1440);
    const [masonry, structure] = la.towers[0]!.contractors;
    expect(structure!.ppc).toEqual({ committed: 1, done: 1, pct: 100 });
    expect(masonry!.ppc).toEqual({ committed: 1, done: 0, pct: 0 });
  });
  it('excludes complete and certified work', () => {
    const d2 = { ...doc, activities: doc.activities.map((a) => (a.id === 'F01-SLAB' ? { ...a, actualStart: doc.projectStart, actualFinish: doc.projectStart + 600 } : a)) };
    const la = buildLookahead(d2, calculate(toScheduleInput({ ...d2, dataDate: doc.projectStart + 600 })), { certified: { 'F02-SLAB': { date: 0 } } }, { from: doc.projectStart, weeks: 3 });
    const ids = la.towers.flatMap((t) => t.contractors.flatMap((c) => c.rows.map((r) => r.activity.id)));
    expect(ids).not.toContain('F01-SLAB');
    expect(ids).not.toContain('F02-SLAB');
  });
});
