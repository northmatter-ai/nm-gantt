/**
 * Edit commands (spec: Server API → Commands). Every UI edit is one of these, so the same
 * list drives undo/redo, the audit log and the server. Applying a command returns the new
 * document and the inverse commands that undo it.
 */
import type { Minutes } from '@nm/calendar';
import type { ConstraintType } from '@nm/schedule-engine';
import type { ActivityRecord, LinkRecord, ScheduleDoc } from './model.js';
import { keyBetween } from './sortKey.js';

interface Base { id: string }

export type Command = Base & (
  | { kind: 'addActivity'; activity: ActivityRecord }
  | { kind: 'updateActivity'; activityId: string; patch: ActivityPatch }
  | { kind: 'deleteActivity'; activityId: string }
  | { kind: 'moveActivity'; activityId: string; parentId: string | null; sortKey: string }
  | { kind: 'indent'; activityId: string }
  | { kind: 'outdent'; activityId: string }
  | { kind: 'addLink'; link: LinkRecord }
  | { kind: 'updateLink'; linkId: string; patch: Partial<Omit<LinkRecord, 'id' | 'from' | 'to'>> }
  | { kind: 'deleteLink'; linkId: string }
  | { kind: 'setConstraint'; activityId: string; constraint: ConstraintType; constraintDate?: Minutes | null }
  | { kind: 'setCalendar'; activityId: string; calendarId: string | null }
  | { kind: 'setProgress'; activityId: string; progress: ProgressPatch }
);

/** Fields set to null are cleared. */
export type ActivityPatch = { [K in keyof Omit<ActivityRecord, 'id' | 'stableKey'>]?: ActivityRecord[K] | null };
export interface ProgressPatch {
  actualStart?: Minutes | null;
  actualFinish?: Minutes | null;
  remaining?: Minutes | null;
  percentComplete?: number | null;
}

export type CommandKind = Command['kind'];
type Without<C, K extends keyof C> = C extends unknown ? Omit<C, K> : never;
export type CommandBody = Without<Command, 'id'>;

export class CommandError extends Error {
  constructor(readonly code: string, message: string, readonly commandId?: string) {
    super(message);
    this.name = 'CommandError';
  }
}

let seq = 0;
/** Client-generated command id. */
export function newId(prefix = 'c'): string {
  seq = (seq + 1) % 1_000_000;
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rand}`;
}

export function cmd(body: CommandBody): Command {
  return { id: newId('cmd'), ...body } as Command;
}

// ---------- helpers ----------

export function childrenOf(doc: ScheduleDoc, parentId: string | null): ActivityRecord[] {
  return doc.activities
    .filter((a) => (a.parentId ?? null) === parentId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1));
}

export function descendantsOf(doc: ScheduleDoc, id: string): ActivityRecord[] {
  const out: ActivityRecord[] = [];
  const walk = (pid: string) => {
    for (const c of childrenOf(doc, pid)) { out.push(c); walk(c.id); }
  };
  walk(id);
  return out;
}

/** True if `to` is reachable from `from` along links (so adding to → from would close a cycle). */
export function reaches(doc: ScheduleDoc, from: string, to: string): boolean {
  const succ = new Map<string, string[]>();
  for (const l of doc.links) {
    const list = succ.get(l.from) ?? [];
    list.push(l.to);
    succ.set(l.from, list);
  }
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const v = stack.pop()!;
    if (v === to) return true;
    for (const w of succ.get(v) ?? []) if (!seen.has(w)) { seen.add(w); stack.push(w); }
  }
  return false;
}

/** Sort key placing an item directly after `afterId` among `parentId`'s children (null = first). */
export function keyAfter(doc: ScheduleDoc, parentId: string | null, afterId: string | null, excludeId?: string): string {
  const sibs = childrenOf(doc, parentId).filter((a) => a.id !== excludeId);
  if (afterId === null) return keyBetween(null, sibs[0]?.sortKey ?? null);
  const i = sibs.findIndex((a) => a.id === afterId);
  if (i < 0) return keyBetween(sibs[sibs.length - 1]?.sortKey ?? null, null);
  return keyBetween(sibs[i]!.sortKey, sibs[i + 1]?.sortKey ?? null);
}

const findActivity = (doc: ScheduleDoc, id: string, c: Command) => {
  const a = doc.activities.find((x) => x.id === id);
  if (!a) throw new CommandError('NOT_FOUND', `Activity ${id} does not exist`, c.id);
  return a;
};
const findLink = (doc: ScheduleDoc, id: string, c: Command) => {
  const l = doc.links.find((x) => x.id === id);
  if (!l) throw new CommandError('NOT_FOUND', `Link ${id} does not exist`, c.id);
  return l;
};

function patchRecord<T extends object>(rec: T, patch: Record<string, unknown>): { next: T; undo: Record<string, unknown> } {
  const next: Record<string, unknown> = { ...(rec as Record<string, unknown>) };
  const undo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    undo[k] = k in rec ? (rec as Record<string, unknown>)[k] : null;
    if (v === null || v === undefined) delete next[k];
    else next[k] = v;
  }
  return { next: next as T, undo };
}

const replaceActivity = (doc: ScheduleDoc, a: ActivityRecord): ScheduleDoc => ({
  ...doc,
  activities: doc.activities.map((x) => (x.id === a.id ? a : x)),
});

// ---------- apply ----------

export interface Applied { doc: ScheduleDoc; inverse: Command[] }

export function applyCommand(doc: ScheduleDoc, c: Command): Applied {
  const inv = (body: CommandBody): Command => ({ id: `${c.id}~inv${seq++}`, ...body } as Command);

  switch (c.kind) {
    case 'addActivity': {
      if (doc.activities.some((a) => a.id === c.activity.id)) throw new CommandError('DUPLICATE', `Activity ${c.activity.id} already exists`, c.id);
      if (c.activity.parentId !== undefined) {
        const p = findActivity(doc, c.activity.parentId, c);
        if (p.type !== 'summary') throw new CommandError('PARENT_NOT_SUMMARY', `${p.code} is not a summary`, c.id);
      }
      return { doc: { ...doc, activities: [...doc.activities, c.activity] }, inverse: [inv({ kind: 'deleteActivity', activityId: c.activity.id })] };
    }

    case 'updateActivity': {
      const a = findActivity(doc, c.activityId, c);
      if ('id' in c.patch || 'stableKey' in c.patch) throw new CommandError('READ_ONLY', 'id and stableKey cannot change', c.id);
      if (c.patch.type && c.patch.type !== a.type) {
        if (c.patch.type === 'summary' && doc.links.some((l) => l.from === a.id || l.to === a.id)) {
          throw new CommandError('HAS_LINKS', `${a.code} has links; remove them before making it a summary`, c.id);
        }
        if (a.type === 'summary' && doc.activities.some((x) => x.parentId === a.id)) {
          throw new CommandError('HAS_CHILDREN', `${a.code} has children and must stay a summary`, c.id);
        }
      }
      if (c.patch.duration !== undefined && c.patch.duration !== null && (!Number.isInteger(c.patch.duration) || c.patch.duration < 0)) {
        throw new CommandError('INVALID', 'Duration must be a non-negative whole number of minutes', c.id);
      }
      const { next, undo } = patchRecord(a, c.patch);
      return { doc: replaceActivity(doc, next), inverse: [inv({ kind: 'updateActivity', activityId: a.id, patch: undo as ActivityPatch })] };
    }

    case 'deleteActivity': {
      const a = findActivity(doc, c.activityId, c);
      const doomed = [a, ...descendantsOf(doc, a.id)];
      const ids = new Set(doomed.map((x) => x.id));
      const links = doc.links.filter((l) => ids.has(l.from) || ids.has(l.to));
      const inverse: Command[] = [
        ...doomed.map((x) => inv({ kind: 'addActivity', activity: x })), // parents first
        ...links.map((l) => inv({ kind: 'addLink', link: l })),
      ];
      return {
        doc: { ...doc, activities: doc.activities.filter((x) => !ids.has(x.id)), links: doc.links.filter((l) => !links.includes(l)) },
        inverse,
      };
    }

    case 'moveActivity': {
      const a = findActivity(doc, c.activityId, c);
      if (c.parentId !== null) {
        const p = findActivity(doc, c.parentId, c);
        if (p.type !== 'summary') throw new CommandError('PARENT_NOT_SUMMARY', `${p.code} is not a summary`, c.id);
        if (p.id === a.id || descendantsOf(doc, a.id).some((d) => d.id === p.id)) throw new CommandError('INVALID_MOVE', 'Cannot move an activity under itself', c.id);
      }
      const next: ActivityRecord = { ...a, sortKey: c.sortKey };
      if (c.parentId === null) delete next.parentId; else next.parentId = c.parentId;
      return {
        doc: replaceActivity(doc, next),
        inverse: [inv({ kind: 'moveActivity', activityId: a.id, parentId: a.parentId ?? null, sortKey: a.sortKey })],
      };
    }

    case 'indent': {
      const a = findActivity(doc, c.activityId, c);
      const sibs = childrenOf(doc, a.parentId ?? null);
      const i = sibs.findIndex((x) => x.id === a.id);
      const newParent = sibs[i - 1];
      if (!newParent) throw new CommandError('CANNOT_INDENT', `${a.code} has no row above it at the same level`, c.id);
      const steps: Command[] = [];
      let d = doc;
      if (newParent.type !== 'summary') {
        const r = applyCommand(d, inv({ kind: 'updateActivity', activityId: newParent.id, patch: { type: 'summary', autoSummary: true } }));
        d = r.doc; steps.push(...r.inverse);
      }
      const lastChild = childrenOf(d, newParent.id).at(-1);
      const r2 = applyCommand(d, inv({ kind: 'moveActivity', activityId: a.id, parentId: newParent.id, sortKey: keyBetween(lastChild?.sortKey ?? null, null) }));
      return { doc: r2.doc, inverse: [...r2.inverse, ...steps] };
    }

    case 'outdent': {
      const a = findActivity(doc, c.activityId, c);
      if (a.parentId === undefined) throw new CommandError('CANNOT_OUTDENT', `${a.code} is already at the top level`, c.id);
      const parent = findActivity(doc, a.parentId, c);
      const grand = parent.parentId ?? null;
      const r = applyCommand(doc, inv({ kind: 'moveActivity', activityId: a.id, parentId: grand, sortKey: keyAfter(doc, grand, parent.id, a.id) }));
      let d = r.doc;
      const inverse = [...r.inverse];
      // Only a summary that indent created reverts; one the user chose stays a summary (D-027).
      if (parent.autoSummary && childrenOf(d, parent.id).length === 0) {
        const r2 = applyCommand(d, inv({ kind: 'updateActivity', activityId: parent.id, patch: { type: 'task', autoSummary: null } }));
        d = r2.doc;
        inverse.unshift(...r2.inverse);
      }
      return { doc: d, inverse };
    }

    case 'addLink': {
      const l = c.link;
      if (doc.links.some((x) => x.id === l.id)) throw new CommandError('DUPLICATE', `Link ${l.id} already exists`, c.id);
      const from = findActivity(doc, l.from, c), to = findActivity(doc, l.to, c);
      if (from.id === to.id) throw new CommandError('SELF_LINK', 'An activity cannot be linked to itself', c.id);
      if (from.type === 'summary' || to.type === 'summary') throw new CommandError('LINK_TO_SUMMARY', 'Summaries cannot be linked', c.id);
      if (doc.links.some((x) => x.from === l.from && x.to === l.to)) throw new CommandError('DUPLICATE_LINK', `${from.code} is already linked to ${to.code}`, c.id);
      if (reaches(doc, to.id, from.id)) throw new CommandError('CYCLE', `Linking ${from.code} → ${to.code} would create a loop`, c.id);
      if (!Number.isInteger(l.lag)) throw new CommandError('INVALID', 'Lag must be whole minutes', c.id);
      return { doc: { ...doc, links: [...doc.links, l] }, inverse: [inv({ kind: 'deleteLink', linkId: l.id })] };
    }

    case 'updateLink': {
      const l = findLink(doc, c.linkId, c);
      const { next, undo } = patchRecord(l, c.patch as Record<string, unknown>);
      if (!Number.isInteger(next.lag)) throw new CommandError('INVALID', 'Lag must be whole minutes', c.id);
      return {
        doc: { ...doc, links: doc.links.map((x) => (x.id === l.id ? next : x)) },
        inverse: [inv({ kind: 'updateLink', linkId: l.id, patch: undo as Partial<LinkRecord> })],
      };
    }

    case 'deleteLink': {
      const l = findLink(doc, c.linkId, c);
      return { doc: { ...doc, links: doc.links.filter((x) => x.id !== l.id) }, inverse: [inv({ kind: 'addLink', link: l })] };
    }

    case 'setConstraint': {
      const a = findActivity(doc, c.activityId, c);
      const needsDate = !['ASAP', 'ALAP'].includes(c.constraint);
      if (needsDate && (c.constraintDate === undefined || c.constraintDate === null)) {
        throw new CommandError('MISSING_CONSTRAINT_DATE', `${c.constraint} needs a date`, c.id);
      }
      const { next, undo } = patchRecord(a, { constraint: c.constraint, constraintDate: needsDate ? c.constraintDate : null });
      return {
        doc: replaceActivity(doc, next),
        inverse: [inv({ kind: 'updateActivity', activityId: a.id, patch: undo as ActivityPatch })],
      };
    }

    case 'setCalendar': {
      const a = findActivity(doc, c.activityId, c);
      if (c.calendarId !== null && !doc.calendars.some((x) => x.id === c.calendarId)) throw new CommandError('NOT_FOUND', `Calendar ${c.calendarId} does not exist`, c.id);
      const { next, undo } = patchRecord(a, { calendarId: c.calendarId });
      return { doc: replaceActivity(doc, next), inverse: [inv({ kind: 'updateActivity', activityId: a.id, patch: undo as ActivityPatch })] };
    }

    case 'setProgress': {
      const a = findActivity(doc, c.activityId, c);
      const p = c.progress;
      if (p.percentComplete !== undefined && p.percentComplete !== null && (!Number.isInteger(p.percentComplete) || p.percentComplete < 0 || p.percentComplete > 10000)) {
        throw new CommandError('INVALID', 'Percent complete is in basis points, 0–10000', c.id);
      }
      const { next, undo } = patchRecord(a, p as Record<string, unknown>);
      return { doc: replaceActivity(doc, next), inverse: [inv({ kind: 'updateActivity', activityId: a.id, patch: undo as ActivityPatch })] };
    }
  }
}

/** Apply a batch in order; all or nothing. Returns inverses in the order they must be applied. */
export function applyCommands(doc: ScheduleDoc, cmds: Command[]): Applied {
  let d = doc;
  const inverses: Command[][] = [];
  for (const c of cmds) {
    const r = applyCommand(d, c);
    d = r.doc;
    inverses.push(r.inverse);
  }
  return { doc: { ...d, version: doc.version + 1 }, inverse: inverses.reverse().flat() };
}
