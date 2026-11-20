/**
 * Phone view model (spec: "View and mobile modes"): a simplified list-plus-bars of one tower or the
 * look-ahead window. Pure; the component in Phone.tsx renders it. Rules: DECISIONS.md D-031.
 */
import { dayStartInstant, instantToDay, instantToLocal, weekdayOfDay, type Minutes } from '@nm/calendar';
import type { ActivityRecord, ScheduleDoc } from '@nm/schedule-commands';
import type { ActivityResult, ScheduleResult } from '@nm/schedule-engine';

export type PhoneScope =
  | { kind: 'lookahead'; weeks: number }
  | { kind: 'tower'; towerId: string }
  | { kind: 'all' };

export type PhoneItem =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'activity'; key: string; activity: ActivityRecord; result: ActivityResult };

export interface PhoneList {
  items: PhoneItem[];
  /** Time span the bars are drawn against before any zoom. */
  window: { from: Minutes; to: Minutes };
  /** Look-ahead only: the period that decides which activities are listed (data date + N weeks). */
  range?: { from: Minutes; to: Minutes };
  /** Activities shown (headers excluded). */
  count: number;
}

export interface PhoneOptions {
  hideComplete?: boolean;
  text?: string;
  /** Labels for group headers (translated by the caller). */
  labels?: { inProgress: string; thisWeek: string; nextWeek: string; weekOf: (date: string) => string; project: string };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 1440;
export const LOOKAHEAD_WEEKS = [2, 3, 4, 6] as const;

/** "7 Dec" on the schedule's clock. */
export function shortDate(tz: string, t: Minutes): string {
  const p = instantToLocal(tz, t);
  return `${p.day} ${MONTHS[p.month - 1]}`;
}

/** Monday 00:00 (local) of the week containing t. */
export function weekStart(tz: string, t: Minutes): Minutes {
  const day = instantToDay(tz, t);
  const wd = weekdayOfDay(day); // 0 = Sunday
  return dayStartInstant(tz, day - ((wd + 6) % 7));
}

const shown = (a: ActivityRecord) => a.type === 'task' || a.type === 'start_milestone' || a.type === 'finish_milestone';

/** Clamp the look-ahead to the spec's 2–6 weeks (as the look-ahead board, D-024). */
export const clampWeeks = (w: number) => Math.min(6, Math.max(2, Math.round(w)));

export function buildPhoneList(doc: ScheduleDoc, results: ScheduleResult | undefined, scope: PhoneScope, opts: PhoneOptions = {}): PhoneList {
  const tz = doc.calendars.find((c) => c.id === doc.defaultCalendarId)?.timeZone ?? 'Asia/Kolkata';
  const L = opts.labels ?? { inProgress: 'In progress', thisWeek: 'This week', nextWeek: 'Next week', weekOf: (d: string) => `Week of ${d}`, project: 'Project' };
  const byId = new Map(doc.activities.map((a) => [a.id, a]));

  // Tree order, so tower and whole-project lists read like the WBS.
  const kids = new Map<string, ActivityRecord[]>();
  for (const a of doc.activities) { const k = a.parentId && byId.has(a.parentId) ? a.parentId : ''; kids.set(k, [...(kids.get(k) ?? []), a]); }
  for (const g of kids.values()) g.sort((x, y) => (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : x.id < y.id ? -1 : 1));
  const order: ActivityRecord[] = [];
  const walk = (pid: string) => { for (const a of kids.get(pid) ?? []) { order.push(a); walk(a.id); } };
  walk('');
  const rank = new Map(order.map((a, i) => [a.id, i]));

  const q = opts.text?.trim().toLowerCase();
  const pick = (a: ActivityRecord): ActivityResult | undefined => {
    const r = results?.activities[a.id];
    if (!r || !shown(a)) return undefined;
    if (q && !a.name.toLowerCase().includes(q) && !a.code.toLowerCase().includes(q)) return undefined;
    return r;
  };

  const items: PhoneItem[] = [];
  let count = 0;
  const push = (key: string, label: string, list: { a: ActivityRecord; r: ActivityResult }[]) => {
    if (!list.length) return;
    items.push({ kind: 'header', key: `h:${key}`, label, count: list.length });
    for (const { a, r } of list) items.push({ kind: 'activity', key: a.id, activity: a, result: r });
    count += list.length;
  };

  let window: { from: Minutes; to: Minutes };
  let range: { from: Minutes; to: Minutes } | undefined;
  if (scope.kind === 'lookahead') {
    const weeks = clampWeeks(scope.weeks);
    const from = dayStartInstant(tz, instantToDay(tz, doc.dataDate));
    const to = from + weeks * 7 * DAY;
    range = { from, to };
    const chosen: { a: ActivityRecord; r: ActivityResult }[] = [];
    for (const a of order) {
      const r = pick(a);
      // Not finished, and starting before the window ends (in-progress work is always included).
      if (!r || r.status === 'complete' || r.es >= to) continue;
      chosen.push({ a, r });
    }
    chosen.sort((x, y) => x.r.es - y.r.es || (rank.get(x.a.id)! - rank.get(y.a.id)!));
    // Draw from up to a week before the data date so work already under way shows its whole bar.
    const earliest = chosen.reduce((m, c) => Math.min(m, c.r.es), from);
    window = { from: Math.max(from - 7 * DAY, dayStartInstant(tz, instantToDay(tz, earliest))), to };
    const thisWeek = weekStart(tz, doc.dataDate);
    const groups = new Map<string, { label: string; list: typeof chosen }>();
    for (const c of chosen) {
      let key: string, label: string;
      if (c.r.status === 'in_progress' || c.r.es < doc.dataDate) { key = 'progress'; label = L.inProgress; }
      else {
        const ws = weekStart(tz, c.r.es);
        key = `w${ws}`;
        label = ws <= thisWeek ? L.thisWeek : ws - thisWeek <= 7 * DAY + 60 ? L.nextWeek : L.weekOf(shortDate(tz, ws));
      }
      const g = groups.get(key) ?? { label, list: [] };
      g.list.push(c);
      groups.set(key, g);
    }
    for (const [key, g] of groups) push(key, g.label, g.list);
  } else {
    let lo = Infinity, hi = -Infinity;
    let curKey: string | null = null;
    let cur: { a: ActivityRecord; r: ActivityResult }[] = [];
    let curLabel = '';
    const flush = () => { if (curKey !== null) push(`${curKey}:${items.length}`, curLabel, cur); cur = []; };
    for (const a of order) {
      if (scope.kind === 'tower' && a.towerId !== scope.towerId) continue;
      const r = pick(a);
      if (!r) continue;
      if (opts.hideComplete && r.status === 'complete') continue;
      lo = Math.min(lo, r.es); hi = Math.max(hi, r.ef);
      const parent = a.parentId ? byId.get(a.parentId) : undefined;
      const key = parent?.id ?? '';
      if (key !== curKey) {
        flush();
        curKey = key;
        const tower = scope.kind === 'all' && a.towerId ? doc.towers?.[a.towerId] : undefined;
        const pname = parent?.name ?? L.project;
        curLabel = tower && !pname.includes(tower) ? `${tower} · ${pname}` : pname;
      }
      cur.push({ a, r });
    }
    flush();
    if (!Number.isFinite(lo)) { lo = doc.dataDate; hi = doc.dataDate + 28 * DAY; }
    const pad = Math.max(DAY, Math.round((hi - lo) * 0.03));
    window = { from: lo - pad, to: hi + pad };
  }
  return { items, window, count, ...(range ? { range } : {}) };
}

/** Zoom a time window around an anchor; span clamped to 3 days … 3 years. */
export function zoomWindow(w: { from: Minutes; to: Minutes }, factor: number, anchor: Minutes): { from: Minutes; to: Minutes } {
  const span = w.to - w.from;
  const next = Math.min(3 * 365 * DAY, Math.max(3 * DAY, span * factor));
  const ratio = span > 0 ? (anchor - w.from) / span : 0.5;
  const from = Math.round(anchor - ratio * next);
  return { from, to: Math.round(from + next) };
}
