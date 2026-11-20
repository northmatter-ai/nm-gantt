/** Flatten the WBS tree into visible rows, applying collapse state, filters and grouping. */
import type { ActivityRecord, ScheduleDoc } from '@northmatter-ai/schedule-commands';
import type { ActivityResult, ScheduleResult } from '@northmatter-ai/schedule-engine';
import type { FilterSpec, GroupBy } from './types.js';

export interface Row {
  key: string;
  kind: 'activity' | 'group';
  depth: number;
  wbs: string;
  hasChildren: boolean;
  activity?: ActivityRecord;
  result?: ActivityResult;
  label?: string;
}

export interface Tree {
  byId: Map<string, ActivityRecord>;
  children: Map<string | null, ActivityRecord[]>;
  wbs: Map<string, string>;
  /** Activity ids in tree order. */
  order: string[];
}

export function buildTree(doc: ScheduleDoc): Tree {
  const byId = new Map(doc.activities.map((a) => [a.id, a]));
  const children = new Map<string | null, ActivityRecord[]>();
  for (const a of doc.activities) {
    const k = a.parentId && byId.has(a.parentId) ? a.parentId : null;
    const list = children.get(k);
    if (list) list.push(a); else children.set(k, [a]);
  }
  for (const list of children.values()) list.sort((x, y) => (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : x.id < y.id ? -1 : 1));
  const wbs = new Map<string, string>();
  const order: string[] = [];
  const walk = (pid: string | null, prefix: string) => {
    (children.get(pid) ?? []).forEach((a, i) => {
      const w = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      wbs.set(a.id, w);
      order.push(a.id);
      walk(a.id, w);
    });
  };
  walk(null, '');
  return { byId, children, wbs, order };
}

function matches(a: ActivityRecord, r: ActivityResult | undefined, f: FilterSpec | undefined): boolean {
  if (!f) return true;
  if (f.criticalOnly && !r?.isCritical) return false;
  if (f.longestPath && !r?.isLongestPath) return false;
  if (f.negativeFloat && !(r && r.totalFloat < 0)) return false;
  if (f.towerId && a.towerId !== f.towerId) return false;
  if (f.floorId && a.floorId !== f.floorId) return false;
  if (f.workFrontId && a.workFrontId !== f.workFrontId) return false;
  if (f.status?.length && !(r && f.status.includes(r.status))) return false;
  if (f.window && r && (r.ef < f.window.from || r.es > f.window.to)) return false;
  if (f.text) {
    const q = f.text.toLowerCase();
    if (!a.name.toLowerCase().includes(q) && !a.code.toLowerCase().includes(q)) return false;
  }
  return true;
}

const isFiltering = (f: FilterSpec | undefined) =>
  !!f && !!(f.criticalOnly || f.longestPath || f.negativeFloat || f.towerId || f.floorId || f.workFrontId || f.status?.length || f.text || f.window);

export function buildRows(
  doc: ScheduleDoc,
  tree: Tree,
  results: ScheduleResult | undefined,
  collapsed: Set<string>,
  filter: FilterSpec | undefined,
  groupBy: GroupBy,
): Row[] {
  const res = (id: string) => results?.activities[id];
  const filtering = isFiltering(filter);

  if (groupBy === 'tower' || groupBy === 'floor') {
    const names = (groupBy === 'tower' ? doc.towers : doc.floors) ?? {};
    const groups = new Map<string, ActivityRecord[]>();
    for (const id of tree.order) {
      const a = tree.byId.get(id)!;
      if (a.type === 'summary' || !matches(a, res(id), filter)) continue;
      const g = (groupBy === 'tower' ? a.towerId : a.floorId) ?? '';
      const list = groups.get(g);
      if (list) list.push(a); else groups.set(g, [a]);
    }
    const rows: Row[] = [];
    const keys = [...groups.keys()].sort((x, y) => (names[x] ?? x).localeCompare(names[y] ?? y, undefined, { numeric: true }));
    for (const g of keys) {
      const gk = `group:${g}`;
      rows.push({ key: gk, kind: 'group', depth: 0, wbs: '', hasChildren: true, label: g ? names[g] ?? g : '—' });
      if (collapsed.has(gk)) continue;
      for (const a of groups.get(g)!) rows.push({ key: a.id, kind: 'activity', depth: 1, wbs: tree.wbs.get(a.id)!, hasChildren: false, activity: a, result: res(a.id) });
    }
    return rows;
  }

  if (groupBy === 'none') {
    return tree.order
      .map((id) => tree.byId.get(id)!)
      .filter((a) => a.type !== 'summary' && matches(a, res(a.id), filter))
      .map((a) => ({ key: a.id, kind: 'activity' as const, depth: 0, wbs: tree.wbs.get(a.id)!, hasChildren: false, activity: a, result: res(a.id) }));
  }

  // WBS tree. When filtering, keep matching activities and their ancestors.
  let keep: Set<string> | null = null;
  if (filtering) {
    keep = new Set();
    for (const id of tree.order) {
      const a = tree.byId.get(id)!;
      if (a.type === 'summary' || !matches(a, res(id), filter)) continue;
      let cur: ActivityRecord | undefined = a;
      while (cur && !keep.has(cur.id)) { keep.add(cur.id); cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined; }
    }
  }
  const rows: Row[] = [];
  const walk = (pid: string | null, depth: number) => {
    for (const a of tree.children.get(pid) ?? []) {
      if (keep && !keep.has(a.id)) continue;
      const kids = tree.children.get(a.id);
      rows.push({ key: a.id, kind: 'activity', depth, wbs: tree.wbs.get(a.id)!, hasChildren: !!kids?.length, activity: a, result: res(a.id) });
      if (kids?.length && !collapsed.has(a.id)) walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** All predecessors (back) or successors (forward) of an activity, transitively. Driving links are listed first. */
export function trace(doc: ScheduleDoc, results: ScheduleResult | undefined, id: string, dir: 'back' | 'forward'): { ids: Set<string>; links: Set<string>; driving: Set<string> } {
  const ids = new Set<string>([id]);
  const links = new Set<string>();
  const driving = new Set<string>();
  const adj = new Map<string, typeof doc.links>();
  for (const l of doc.links) {
    const k = dir === 'back' ? l.to : l.from;
    const list = adj.get(k);
    if (list) list.push(l); else adj.set(k, [l]);
  }
  const stack = [id];
  while (stack.length) {
    const v = stack.pop()!;
    for (const l of adj.get(v) ?? []) {
      const next = dir === 'back' ? l.from : l.to;
      links.add(l.id);
      if (results?.activities[l.to]?.drivingLinkIds.includes(l.id)) driving.add(l.id);
      if (!ids.has(next)) { ids.add(next); stack.push(next); }
    }
  }
  return { ids, links, driving };
}
