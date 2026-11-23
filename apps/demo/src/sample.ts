/** Sample schedules: a two-tower residential project with real logic, and a 5,000-activity stress schedule. */
import { compileCalendars, defaultTenantCalendar, parseLocal, type CalendarInput, type Minutes } from '@northmatter/calendar';
import { evenKeys, type ActivityRecord, type LinkRecord, type ScheduleDoc } from '@northmatter/schedule-commands';
import type { LinkType } from '@northmatter/schedule-engine';

const TZ = 'Asia/Kolkata';
const at = (s: string) => parseLocal(TZ, s);
const D = 480;

const HOLIDAYS = [
  ['2026-12-25', 'Christmas'], ['2027-01-26', 'Republic Day'], ['2027-03-04', 'Holi'], ['2027-04-14', 'Ambedkar Jayanti'],
  ['2027-08-15', 'Independence Day'], ['2027-10-02', 'Gandhi Jayanti'], ['2027-10-29', 'Diwali'], ['2027-10-30', 'Diwali'],
].map(([d, r]) => ({ from: d!, to: d!, intervals: [] as [number, number][], reason: r! }));

export function calendars(): CalendarInput[] {
  const site = defaultTenantCalendar('site', HOLIDAYS);
  site.name = 'Site (Mon–Sat, 8 h)';
  const fiveDay: CalendarInput = { id: 'office', name: 'Office (Mon–Fri)', baseId: 'site', timeZone: TZ, hoursPerDay: 480, week: { 6: [] } };
  return [site, fiveDay];
}

interface Template { key: string; name: string; short: string; days: number }
export const FLOOR_TEMPLATES: Template[] = [
  { key: 'COL', name: 'Columns & shear walls', short: 'Columns', days: 3 },
  { key: 'SLAB', name: 'Slab shuttering, rebar & pour', short: 'Slab', days: 5 },
  { key: 'BLK', name: 'Blockwork', short: 'Blockwork', days: 6 },
  { key: 'MEP', name: 'MEP first fix', short: 'MEP', days: 4 },
  { key: 'PLS', name: 'Internal plaster', short: 'Plaster', days: 6 },
  { key: 'FLR', name: 'Flooring & tiling', short: 'Flooring', days: 5 },
  { key: 'FIN', name: 'Paint & finishes', short: 'Finishes', days: 6 },
];

let uid = 0;
const id = (p: string) => `${p}-${(++uid).toString(36).padStart(4, '0')}`;

export interface ProjectOptions { name?: string; id?: string; start?: Minutes; towers?: number; deadlines?: boolean }

export function sampleSchedule(floorsPerTower = 12, opts: ProjectOptions = {}): ScheduleDoc {
  uid = 0;
  const projectStart = opts.start ?? at('2026-11-02T09:00');
  const towerNames = Array.from({ length: opts.towers ?? 2 }, (_, i) => `Tower ${String.fromCharCode(65 + i)}`);
  const withDeadlines = opts.deadlines ?? opts.start === undefined;
  const acts: ActivityRecord[] = [];
  const links: LinkRecord[] = [];
  const towers: Record<string, string> = {};
  const floors: Record<string, string> = {};
  const push = (a: Omit<ActivityRecord, 'stableKey' | 'sortKey'>) => { const r = { ...a, stableKey: a.id, sortKey: '' }; acts.push(r); return r; };
  const link = (from: ActivityRecord, to: ActivityRecord, type: LinkType = 'FS', lagDays = 0) =>
    links.push({ id: id('L'), from: from.id, to: to.id, type, lag: Math.round(lagDays * D) });

  const start = push({ id: id('A'), code: 'NTP', name: 'Notice to proceed', type: 'start_milestone', duration: 0, constraint: 'SNET', constraintDate: projectStart });
  const mob = push({ id: id('A'), code: 'MOB', name: 'Site mobilisation', type: 'task', duration: 6 * D, constraint: 'ASAP' });
  link(start, mob);
  const approvals = push({ id: id('A'), code: 'APPR', name: 'Structural drawings approval', type: 'task', duration: 10 * D, constraint: 'ASAP', calendarId: 'office' });
  link(start, approvals);
  const pm = push({ id: id('A'), code: 'PM', name: 'Project management (LOE)', type: 'level_of_effort', duration: 0, constraint: 'ASAP' });
  link(start, pm, 'SS');

  const handovers: ActivityRecord[] = [];
  for (const [ti, tname] of towerNames.entries()) {
    const tid = `T${ti + 1}`;
    towers[tid] = tname;
    const tSum = push({ id: id('S'), code: tid, name: tname, type: 'summary', duration: 0, constraint: 'ASAP' });
    const sub = push({ id: id('S'), code: `${tid}-SUB`, name: 'Substructure', type: 'summary', duration: 0, constraint: 'ASAP', parentId: tSum.id });
    const exc = push({ id: id('A'), code: `${tid}-EXC`, name: 'Excavation', type: 'task', duration: (8 + ti * 2) * D, constraint: 'ASAP', parentId: sub.id, towerId: tid });
    const pcc = push({ id: id('A'), code: `${tid}-PCC`, name: 'PCC & waterproofing', type: 'task', duration: 4 * D, constraint: 'ASAP', parentId: sub.id, towerId: tid });
    const raft = push({ id: id('A'), code: `${tid}-RAFT`, name: 'Raft foundation', type: 'task', duration: 8 * D, constraint: 'ASAP', parentId: sub.id, towerId: tid });
    link(mob, exc, 'FS', ti * 5);
    link(exc, pcc);
    link(pcc, raft);
    link(approvals, raft);

    const sup = push({ id: id('S'), code: `${tid}-SUP`, name: 'Superstructure', type: 'summary', duration: 0, constraint: 'ASAP', parentId: tSum.id });
    let prev: Record<string, ActivityRecord> | null = null;
    for (let f = 1; f <= floorsPerTower; f++) {
      const fid = `F${String(f).padStart(2, '0')}`;
      floors[fid] = `Floor ${f}`;
      const fSum = push({ id: id('S'), code: `${tid}-${fid}`, name: `Floor ${f}`, type: 'summary', duration: 0, constraint: 'ASAP', parentId: sup.id });
      const cur: Record<string, ActivityRecord> = {};
      for (const tpl of FLOOR_TEMPLATES) {
        cur[tpl.key] = push({
          id: id('A'), code: `${tid}-${fid}-${tpl.key}`, name: tpl.name, type: 'task', duration: tpl.days * D, constraint: 'ASAP',
          parentId: fSum.id, towerId: tid, floorId: fid, activityTemplateId: tpl.key,
        });
      }
      link(cur.COL!, cur.SLAB!);
      link(cur.SLAB!, cur.BLK!, 'FS', 7); // curing
      link(cur.BLK!, cur.MEP!, 'SS', 3);
      link(cur.MEP!, cur.PLS!, 'FS');
      link(cur.BLK!, cur.PLS!, 'FF', 2);
      link(cur.PLS!, cur.FLR!, 'FS', 1);
      link(cur.FLR!, cur.FIN!, 'SS', 2);
      if (prev) {
        link(prev.SLAB!, cur.COL!); // structure cycle floor to floor
        link(prev.BLK!, cur.BLK!); // finishing crews flow upwards
        link(prev.PLS!, cur.PLS!);
        link(prev.FLR!, cur.FLR!);
        link(prev.FIN!, cur.FIN!);
      } else {
        link(raft, cur.COL!);
      }
      prev = cur;
    }
    const ext = push({ id: id('A'), code: `${tid}-FAC`, name: 'Facade & external paint', type: 'task', duration: 25 * D, constraint: 'ASAP', parentId: tSum.id, towerId: tid });
    link(prev!.SLAB!, ext, 'FS', 5);
    const lift = push({ id: id('A'), code: `${tid}-LIFT`, name: 'Lift installation', type: 'task', duration: 30 * D, constraint: 'ASAP', parentId: tSum.id, towerId: tid });
    link(prev!.SLAB!, lift, 'FS', 10);
    const ho = push({ id: id('A'), code: `${tid}-HO`, name: `${tname} handover`, type: 'finish_milestone', duration: 0, constraint: 'ASAP', parentId: tSum.id, towerId: tid, ...(withDeadlines && ti < 2 ? { deadline: at(ti === 0 ? '2028-01-31T18:00' : '2028-03-31T18:00') } : {}) });
    link(prev!.FIN!, ho);
    link(ext, ho);
    link(lift, ho);
    handovers.push(ho);
  }
  const occ = push({ id: id('A'), code: 'OC', name: 'Occupancy certificate', type: 'finish_milestone', duration: 0, constraint: 'ASAP' });
  for (const h of handovers) link(h, occ);
  link(pm, occ, 'FF'); // level of effort: SS predecessor → FF successor

  // Order siblings as created.
  const groups = new Map<string, ActivityRecord[]>();
  for (const a of acts) { const k = a.parentId ?? ''; groups.set(k, [...(groups.get(k) ?? []), a]); }
  for (const list of groups.values()) { const keys = evenKeys(list.length); list.forEach((a, i) => { a.sortKey = keys[i]!; }); }

  return {
    id: opts.id ?? 'sample', name: opts.name ?? 'Residential towers A & B', kind: 'draft', version: 1,
    projectStart, dataDate: projectStart, defaultCalendarId: 'site', calendars: calendars(),
    activities: acts, links, settings: {}, towers, floors,
    templates: FLOOR_TEMPLATES.map((t) => ({ id: t.key, name: t.name, short: t.short })),
  };
}

/** Record progress up to a data date: everything finishing before it is complete; anything spanning it is in progress. */
export function withProgress(doc: ScheduleDoc, results: Record<string, { es: Minutes; ef: Minutes }>, dataDate: Minutes): ScheduleDoc {
  const cals = compileCalendars(doc.calendars);
  const activities = doc.activities.map((a) => {
    const r = results[a.id];
    if (!r || a.type === 'summary' || a.type === 'level_of_effort') return a;
    const cal = cals.get(a.calendarId ?? doc.defaultCalendarId)!;
    if (r.ef <= dataDate) {
      // Excavation overran by 30 %, so the schedule moves against its baseline.
      const overrun = a.code.endsWith('EXC') ? Math.round((a.duration * 0.3) / D) * D : 0;
      const finish = overrun ? Math.min(cal.prevWorkEnd(dataDate), cal.finishFrom(r.es, a.duration + overrun)) : r.ef;
      return { ...a, actualStart: r.es, actualFinish: finish, percentComplete: 10000 };
    }
    if (r.es < dataDate) {
      const remaining = Math.max(0, a.duration - cal.workBetween(r.es, dataDate));
      return { ...a, actualStart: r.es, remaining, percentComplete: Math.round(((a.duration - remaining) / Math.max(1, a.duration)) * 10000) };
    }
    return a;
  });
  return { ...doc, activities, dataDate };
}

/** A synthetic 5,000-activity, ~8,000-link schedule for the performance budgets. */
export function largeSchedule(n = 5000): ScheduleDoc {
  const projectStart = at('2026-11-02T09:00');
  const acts: ActivityRecord[] = [];
  const links: LinkRecord[] = [];
  const summaries = Math.ceil(n / 50);
  const sumKeys = evenKeys(summaries);
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const towers: Record<string, string> = { T1: 'Tower 1', T2: 'Tower 2', T3: 'Tower 3', T4: 'Tower 4' };
  for (let g = 0; g < summaries; g++) {
    const sid = `S${String(g).padStart(4, '0')}`;
    acts.push({ id: sid, stableKey: sid, code: `WP-${g + 1}`, name: `Work package ${g + 1}`, sortKey: sumKeys[g]!, type: 'summary', duration: 0, constraint: 'ASAP' });
    const childKeys = evenKeys(49);
    for (let i = 0; i < 49 && acts.length < n; i++) {
      const aid = `A${String(acts.length).padStart(5, '0')}`;
      acts.push({
        id: aid, stableKey: aid, code: `${g + 1}.${i + 1}`, name: `Activity ${g + 1}.${i + 1}`, sortKey: childKeys[i]!, parentId: sid,
        type: 'task', duration: (1 + Math.floor(rnd() * 8)) * D, constraint: 'ASAP', towerId: `T${(g % 4) + 1}`,
      });
    }
  }
  const tasks = acts.filter((a) => a.type === 'task');
  const seen = new Set<string>();
  for (let i = 1; i < tasks.length && links.length < 8000; i++) {
    const k = 1 + Math.floor(rnd() * 2);
    for (let j = 0; j < k; j++) {
      const from = Math.max(0, i - 1 - Math.floor(rnd() * 30));
      const key = `${from}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ id: `L${String(links.length).padStart(5, '0')}`, from: tasks[from]!.id, to: tasks[i]!.id, type: rnd() < 0.85 ? 'FS' : 'SS', lag: rnd() < 0.2 ? D : 0 });
    }
  }
  return {
    id: 'large', name: `Stress test (${acts.length.toLocaleString()} activities)`, kind: 'draft', version: 1,
    projectStart, dataDate: projectStart, defaultCalendarId: 'site', calendars: calendars(), activities: acts, links, settings: {}, towers,
  };
}

/** One tower, 40 floors × 30 trades (1,200 activities) — the tower × floor grid's performance case. */
export function stressTower(floorsN = 40, tradesN = 30): ScheduleDoc {
  const projectStart = at('2026-11-02T09:00');
  const templates = Array.from({ length: tradesN }, (_, i) => ({ id: `TR${String(i + 1).padStart(2, '0')}`, name: `Trade ${i + 1}`, short: `T${i + 1}` }));
  const acts: ActivityRecord[] = [];
  const links: LinkRecord[] = [];
  const floors: Record<string, string> = {};
  const fKeys = evenKeys(floorsN);
  for (let f = 1; f <= floorsN; f++) {
    const fid = `F${String(f).padStart(2, '0')}`;
    floors[fid] = `Floor ${f}`;
    const sid = `S-${fid}`;
    acts.push({ id: sid, stableKey: sid, code: fid, name: `Floor ${f}`, sortKey: fKeys[f - 1]!, type: 'summary', duration: 0, constraint: 'ASAP' });
    const keys = evenKeys(tradesN);
    templates.forEach((t, i) => {
      const aid = `${fid}-${t.id}`;
      acts.push({ id: aid, stableKey: aid, code: aid, name: t.name, sortKey: keys[i]!, parentId: sid, type: 'task', duration: (1 + (i % 3)) * D, constraint: 'ASAP', towerId: 'T1', floorId: fid, activityTemplateId: t.id });
      if (i > 0) links.push({ id: `L-${aid}`, from: `${fid}-${templates[i - 1]!.id}`, to: aid, type: 'SS', lag: D });
      if (f > 1) links.push({ id: `V-${aid}`, from: `F${String(f - 1).padStart(2, '0')}-${t.id}`, to: aid, type: 'FS', lag: 0 });
    });
  }
  return {
    id: 'stress-tower', name: `Stress tower (${floorsN} floors × ${tradesN} trades)`, kind: 'draft', version: 1,
    projectStart, dataDate: projectStart, defaultCalendarId: 'site', calendars: calendars(), activities: acts, links, settings: {},
    towers: { T1: 'Tower 1' }, floors, templates,
  };
}

/** An empty project: calendars and standard trades, no activities yet. */
export function blankProject(id: string, name: string, start: Minutes): ScheduleDoc {
  return {
    id, name, kind: 'draft', version: 1, projectStart: start, dataDate: start, defaultCalendarId: 'site', calendars: calendars(),
    activities: [], links: [], settings: {}, towers: {}, floors: {},
    templates: FLOOR_TEMPLATES.map((t) => ({ id: t.key, name: t.name, short: t.short })),
  };
}
