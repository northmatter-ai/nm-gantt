/**
 * Shared import rule (spec, "Rules on import"): links to or from summaries are converted — a link into a
 * summary goes to each child with no predecessor inside that summary; a link out of a summary goes from each
 * child with no successor inside it. Every conversion is logged.
 */
import type { Minutes } from '@northmatter/calendar';
import type { LinkType } from '@northmatter/schedule-engine';
import type { ActivityRecord, LinkRecord } from '@northmatter/schedule-commands';

export interface PendingLink {
  from: ActivityRecord;
  to: ActivityRecord;
  type: LinkType;
  lag: Minutes;
  elapsed?: boolean;
  /** Lag as a percentage of the predecessor's duration (MSPDI only). */
  percent?: number;
}

export function resolveLinks(
  activities: ActivityRecord[],
  pending: PendingLink[],
  conversions: string[],
  makeId: (from: ActivityRecord, to: ActivityRecord, n: number) => string,
): LinkRecord[] {
  const children = new Map<string, ActivityRecord[]>();
  for (const a of activities) if (a.parentId) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
  const leavesOf = (a: ActivityRecord): ActivityRecord[] =>
    a.type === 'summary' ? (children.get(a.id) ?? []).flatMap(leavesOf) : [a];

  // Internal links among leaves decide which children are "first" and "last" inside a summary.
  const leafLinks = pending.filter((l) => l.from.type !== 'summary' && l.to.type !== 'summary');
  const hasPredInside = (a: ActivityRecord, inside: Set<string>) => leafLinks.some((l) => l.to.id === a.id && inside.has(l.from.id));
  const hasSuccInside = (a: ActivityRecord, inside: Set<string>) => leafLinks.some((l) => l.from.id === a.id && inside.has(l.to.id));

  const links: LinkRecord[] = [];
  const seenPairs = new Set<string>();
  let n = 0;
  for (const l of pending) {
    let froms = [l.from], tos = [l.to];
    if (l.from.type === 'summary') {
      const leaves = leavesOf(l.from);
      const inside = new Set(leaves.map((x) => x.id));
      froms = leaves.filter((x) => !hasSuccInside(x, inside));
      conversions.push(`Link out of summary ${l.from.code} → ${l.to.code} moved to ${froms.map((x) => x.code).join(', ') || 'nothing (empty summary)'}`);
    }
    if (l.to.type === 'summary') {
      const leaves = leavesOf(l.to);
      const inside = new Set(leaves.map((x) => x.id));
      tos = leaves.filter((x) => !hasPredInside(x, inside));
      conversions.push(`Link into summary ${l.from.code} → ${l.to.code} moved to ${tos.map((x) => x.code).join(', ') || 'nothing (empty summary)'}`);
    }
    for (const f of froms) for (const t of tos) {
      if (f.id === t.id) continue;
      const pair = `${f.id}>${t.id}`;
      if (seenPairs.has(pair)) { conversions.push(`Duplicate link ${f.code} → ${t.code} dropped`); continue; }
      seenPairs.add(pair);
      let lag = l.lag;
      if (l.percent !== undefined) {
        lag = Math.round((f.duration * l.percent) / 100);
        conversions.push(`${f.code} → ${t.code}: ${l.percent}% lag converted to ${lag} minutes of the predecessor's duration`);
      }
      links.push({ id: makeId(f, t, n++), from: f.id, to: t.id, type: l.type, lag, ...(l.elapsed ? { lagCalendar: 'elapsed' as const } : {}) });
    }
  }
  return links;
}
