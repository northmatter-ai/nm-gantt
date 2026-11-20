/**
 * Pure data for the construction views (spec: "Construction views"). No React here, so it is
 * testable and the same derivations can run on the server for reports.
 */
import type { Minutes } from '@nm/calendar';
import type { ActivityResult, ScheduleResult } from '@nm/schedule-engine';
import type { ActivityRecord, BaselineView, ScheduleDoc } from '@nm/schedule-commands';

// ------------------------------------------------------------------ Site inputs

export type ReadinessKey = 'drawings' | 'material' | 'labour' | 'predecessor' | 'inspection';
export const READINESS_KEYS: ReadinessKey[] = ['drawings', 'material', 'labour', 'predecessor', 'inspection'];

export interface Readiness {
  status: 'ready' | 'not_ready' | 'na';
  /** Who has to act when not ready. */
  owner?: string;
  note?: string;
}

export interface Inspection { id: string; name: string; status: 'passed' | 'failed' | 'pending'; date?: Minutes }
export interface SitePhoto { url: string; caption?: string; date: Minutes }

/** What the Site app knows, keyed by activity stable key. */
export interface SiteData {
  /** Reported complete in a DPR, not yet certified. */
  reported?: Record<string, { date: Minutes; dprId?: string }>;
  /** Certified complete (only certified state counts). */
  certified?: Record<string, { date: Minutes; certId?: string }>;
  readiness?: Record<string, Partial<Record<ReadinessKey, Readiness>>>;
  contractorOf?: Record<string, string>;
  contractors?: Record<string, string>;
  /** This week's commitment per activity; `done` unknown until the week closes. */
  commitments?: Record<string, { committed: string; done?: boolean }>;
  inspections?: Record<string, Inspection[]>;
  photos?: Record<string, SitePhoto[]>;
}

export interface Template { id: string; name: string; short?: string }

const DAY = 1440;
const WEEK = 7 * DAY;
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// ------------------------------------------------------------------ cell state

export type CellState = 'not_started' | 'in_progress' | 'late' | 'reported' | 'certified';
export const CELL_STATES: CellState[] = ['not_started', 'in_progress', 'late', 'reported', 'certified'];

/**
 * Certified beats reported beats late beats in progress. Schedule actual finishes come from Site
 * certifications, so an actual finish counts as certified. Late = forecast finish after the
 * baseline finish (or, with no baseline, after its late finish).
 */
export function cellState(a: ActivityRecord, r: ActivityResult | undefined, site: SiteData, baselineEf?: Minutes): CellState {
  if (site.certified?.[a.stableKey] || a.actualFinish !== undefined) return 'certified';
  if (site.reported?.[a.stableKey]) return 'reported';
  if (r && (baselineEf !== undefined ? r.ef > baselineEf : r.totalFloat < 0)) return 'late';
  if (r?.status === 'in_progress' || a.actualStart !== undefined) return 'in_progress';
  return 'not_started';
}

// ------------------------------------------------------------------ floors and templates

export interface Floor { id: string; name: string }

/** Floors used by a tower, bottom to top. */
export function floorsOf(doc: ScheduleDoc, towerId?: string): Floor[] {
  const used = new Set(doc.activities.filter((a) => a.floorId && (!towerId || a.towerId === towerId)).map((a) => a.floorId!));
  const order = doc.floorOrder ?? [...used].sort((x, y) => natural(doc.floors?.[x] ?? x, doc.floors?.[y] ?? y));
  return order.filter((f) => used.has(f)).map((id) => ({ id, name: doc.floors?.[id] ?? id }));
}

/** Templates in construction order; falls back to template ids seen on activities. */
export function templatesOf(doc: ScheduleDoc): Template[] {
  if (doc.templates?.length) return doc.templates;
  const seen: string[] = [];
  for (const a of doc.activities) if (a.activityTemplateId && !seen.includes(a.activityTemplateId)) seen.push(a.activityTemplateId);
  return seen.map((id) => ({ id, name: id }));
}

export function towersOf(doc: ScheduleDoc): { id: string; name: string }[] {
  const used = [...new Set(doc.activities.map((a) => a.towerId).filter(Boolean) as string[])];
  return used.sort((x, y) => natural(doc.towers?.[x] ?? x, doc.towers?.[y] ?? y)).map((id) => ({ id, name: doc.towers?.[id] ?? id }));
}

/** Activity for (tower, floor, template) — the first by code if several. */
export function indexActivities(doc: ScheduleDoc): Map<string, ActivityRecord> {
  const m = new Map<string, ActivityRecord>();
  const sorted = [...doc.activities].sort((a, b) => natural(a.code, b.code));
  for (const a of sorted) {
    if (!a.towerId || !a.floorId || !a.activityTemplateId || a.type === 'summary') continue;
    const k = `${a.towerId}|${a.floorId}|${a.activityTemplateId}`;
    if (!m.has(k)) m.set(k, a);
  }
  return m;
}

// ------------------------------------------------------------------ tower × floor grid

export interface GridCell { activity: ActivityRecord; result?: ActivityResult; state: CellState }
export interface TowerGrid {
  towerId: string;
  towerName: string;
  /** Top floor first, as drawn. */
  floors: Floor[];
  templates: Template[];
  cells: Map<string, GridCell>; // `${floorId}|${templateId}`
  counts: Record<CellState, number>;
}

export function buildTowerGrid(doc: ScheduleDoc, results: ScheduleResult | undefined, site: SiteData, towerId: string, baseline?: BaselineView): TowerGrid {
  const index = indexActivities(doc);
  const floors = floorsOf(doc, towerId);
  const usedTemplates = new Set<string>();
  const cells = new Map<string, GridCell>();
  const counts = Object.fromEntries(CELL_STATES.map((s) => [s, 0])) as Record<CellState, number>;
  for (const f of floors) {
    for (const t of templatesOf(doc)) {
      const a = index.get(`${towerId}|${f.id}|${t.id}`);
      if (!a) continue;
      usedTemplates.add(t.id);
      const r = results?.activities[a.id];
      const state = cellState(a, r, site, baseline?.byStableKey[a.stableKey]?.ef);
      counts[state]++;
      cells.set(`${f.id}|${t.id}`, { activity: a, ...(r ? { result: r } : {}), state });
    }
  }
  return {
    towerId,
    towerName: doc.towers?.[towerId] ?? towerId,
    floors: [...floors].reverse(),
    templates: templatesOf(doc).filter((t) => usedTemplates.has(t.id)),
    cells,
    counts,
  };
}

// ------------------------------------------------------------------ line of balance

export interface LobPoint { t: Minutes; floor: number; activityId: string }
export interface LobLine {
  templateId: string;
  plan: LobPoint[];
  actual: LobPoint[];
  /** Floors per week; undefined with fewer than two points. */
  planRate?: number;
  actualRate?: number;
}
export interface LobClash { t: Minutes; floor: number; earlier: string; later: string }
export interface Lob { towerId: string; floors: Floor[]; lines: LobLine[]; clashes: LobClash[]; from: Minutes; to: Minutes }

function rate(points: LobPoint[]): number | undefined {
  if (points.length < 2) return undefined;
  const a = points[0]!, b = points[points.length - 1]!;
  const weeks = (b.t - a.t) / WEEK;
  return weeks > 0 ? (b.floor - a.floor) / weeks : undefined;
}

/**
 * Points = (finish of the template's activity on floor f, f) for each floor, bottom to top.
 * Plan comes from the live schedule or a baseline; actual from certified finishes.
 * A clash is where a following trade's finish line reaches or crosses the line of the trade
 * before it in construction order.
 */
export function buildLob(doc: ScheduleDoc, results: ScheduleResult | undefined, site: SiteData, towerId: string, planFrom?: BaselineView): Lob {
  const index = indexActivities(doc);
  const floors = floorsOf(doc, towerId);
  const lines: LobLine[] = [];
  let from = Infinity, to = -Infinity;
  for (const t of templatesOf(doc)) {
    const plan: LobPoint[] = [], actual: LobPoint[] = [];
    floors.forEach((f, i) => {
      const a = index.get(`${towerId}|${f.id}|${t.id}`);
      if (!a) return;
      const pf = planFrom ? planFrom.byStableKey[a.stableKey]?.ef : results?.activities[a.id]?.ef;
      if (pf !== undefined) plan.push({ t: pf, floor: i, activityId: a.id });
      const cf = site.certified?.[a.stableKey]?.date ?? a.actualFinish;
      if (cf !== undefined) actual.push({ t: cf, floor: i, activityId: a.id });
    });
    if (!plan.length && !actual.length) continue;
    for (const p of [...plan, ...actual]) { if (p.t < from) from = p.t; if (p.t > to) to = p.t; }
    const line: LobLine = { templateId: t.id, plan, actual };
    const pr = rate(plan), ar = rate(actual);
    if (pr !== undefined) line.planRate = pr;
    if (ar !== undefined) line.actualRate = ar;
    lines.push(line);
  }
  const clashes: LobClash[] = [];
  for (let k = 0; k + 1 < lines.length; k++) {
    const before = new Map(lines[k]!.plan.map((p) => [p.floor, p.t]));
    let wasClear = true;
    for (const p of lines[k + 1]!.plan) {
      const b = before.get(p.floor);
      if (b === undefined) continue;
      const clash = p.t <= b;
      if (clash && wasClear) clashes.push({ t: p.t, floor: p.floor, earlier: lines[k]!.templateId, later: lines[k + 1]!.templateId });
      wasClear = !clash;
    }
  }
  return { towerId, floors, lines, clashes, from: Number.isFinite(from) ? from : doc.projectStart, to: Number.isFinite(to) ? to : doc.projectStart };
}

// ------------------------------------------------------------------ look-ahead

export interface LookaheadRow {
  activity: ActivityRecord;
  result: ActivityResult;
  readiness: Record<ReadinessKey, Readiness>;
  ready: boolean;
  commitment?: { committed: string; done?: boolean };
}
export interface ContractorGroup {
  contractorId: string;
  name: string;
  rows: LookaheadRow[];
  /** Percent plan complete for the week: done / committed with a known outcome. */
  ppc: { committed: number; done: number; pct?: number };
}
export interface TowerGroup { towerId: string; name: string; contractors: ContractorGroup[] }
export interface Lookahead { from: Minutes; to: Minutes; towers: TowerGroup[]; total: number }

const UNASSIGNED = '__unassigned__';

export function buildLookahead(
  doc: ScheduleDoc,
  results: ScheduleResult | undefined,
  site: SiteData,
  opts: { from: Minutes; weeks: number; towerId?: string },
): Lookahead {
  const weeks = Math.min(6, Math.max(2, Math.round(opts.weeks)));
  const from = opts.from, to = from + weeks * WEEK;
  const byId = new Map(doc.activities.map((a) => [a.id, a]));
  const done = (a: ActivityRecord) => a.actualFinish !== undefined || !!site.certified?.[a.stableKey];
  const contractorName = (id: string | undefined) => (id ? site.contractors?.[id] ?? id : '—');

  const towers = new Map<string, Map<string, LookaheadRow[]>>();
  let total = 0;
  for (const a of doc.activities) {
    if (a.type !== 'task' || done(a)) continue;
    if (opts.towerId && a.towerId !== opts.towerId) continue;
    const r = results?.activities[a.id];
    if (!r) continue;
    const startsInWindow = r.es >= from && r.es < to;
    const inProgress = r.status === 'in_progress' && r.es < to;
    if (!startsInWindow && !inProgress) continue;

    const given = site.readiness?.[a.stableKey] ?? {};
    const readiness = {} as Record<ReadinessKey, Readiness>;
    for (const k of READINESS_KEYS) readiness[k] = given[k] ?? { status: 'na' };
    if (!given.predecessor) {
      const open = doc.links.filter((l) => l.to === a.id && (l.type === 'FS' || l.type === 'SS')).map((l) => byId.get(l.from)).filter((p): p is ActivityRecord => !!p && p.type !== 'summary' && !done(p));
      readiness.predecessor = open.length
        ? { status: 'not_ready', owner: contractorName(site.contractorOf?.[open[0]!.stableKey]), note: open.map((p) => p.code).join(', ') }
        : { status: 'ready' };
    }
    const row: LookaheadRow = {
      activity: a, result: r, readiness,
      ready: READINESS_KEYS.every((k) => readiness[k].status !== 'not_ready'),
      ...(site.commitments?.[a.stableKey] ? { commitment: site.commitments[a.stableKey]! } : {}),
    };
    const tk = a.towerId ?? '';
    const ck = site.contractorOf?.[a.stableKey] ?? UNASSIGNED;
    if (!towers.has(tk)) towers.set(tk, new Map());
    const cs = towers.get(tk)!;
    if (!cs.has(ck)) cs.set(ck, []);
    cs.get(ck)!.push(row);
    total++;
  }

  const out: TowerGroup[] = [...towers.entries()]
    .sort(([x], [y]) => natural(doc.towers?.[x] ?? x, doc.towers?.[y] ?? y))
    .map(([tid, cs]) => ({
      towerId: tid,
      name: tid ? doc.towers?.[tid] ?? tid : '—',
      contractors: [...cs.entries()]
        .sort(([x], [y]) => natural(contractorName(x === UNASSIGNED ? undefined : x), contractorName(y === UNASSIGNED ? undefined : y)))
        .map(([cid, rows]) => {
          rows.sort((p, q) => p.result.es - q.result.es || natural(p.activity.code, q.activity.code));
          const known = rows.filter((r) => r.commitment && r.commitment.done !== undefined);
          const doneN = known.filter((r) => r.commitment!.done).length;
          return {
            contractorId: cid,
            name: cid === UNASSIGNED ? '—' : contractorName(cid),
            rows,
            ppc: { committed: known.length, done: doneN, ...(known.length ? { pct: Math.round((doneN / known.length) * 100) } : {}) },
          };
        }),
    }));
  return { from, to, towers: out, total };
}
