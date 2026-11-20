import type { CalendarInput, Minutes } from '@nm/calendar';
import type { ActivityInput, LinkInput, ScheduleInput, ScheduleResult, ScheduleSettings } from '@nm/schedule-engine';

/** An activity as stored in a schedule version (spec: Data model → activity). */
export interface ActivityRecord extends ActivityInput {
  /** Same across versions so baselines can be compared. */
  stableKey: string;
  code: string;
  name: string;
  /** Fractional index ordering siblings. */
  sortKey: string;
  towerId?: string;
  floorId?: string;
  workFrontId?: string;
  activityTemplateId?: string;
  /** Paise. */
  budgetedCost?: number;
  notes?: string;
  /** Round-trip reference, e.g. MS Project UID. */
  externalRef?: string;
  /** Set when indenting turned this task into a summary; outdenting its last child turns it back (D-027). */
  autoSummary?: boolean;
}

export type LinkRecord = LinkInput;

export interface BaselineView {
  id: string;
  label: string;
  /** Baseline results keyed by stable key. */
  byStableKey: Record<string, { es: Minutes; ef: Minutes }>;
}

/** One schedule version, as the Gantt and the Planning API exchange it. */
export interface ScheduleDoc {
  id: string;
  name: string;
  kind: 'draft' | 'published' | 'baseline';
  /** Incremented on every write; sent as baseVersion with commands. */
  version: number;
  projectStart: Minutes;
  projectFinishTarget?: Minutes;
  dataDate: Minutes;
  defaultCalendarId: string;
  calendars: CalendarInput[];
  activities: ActivityRecord[];
  links: LinkRecord[];
  settings: Partial<ScheduleSettings>;
  /** Display names for tower and floor ids. */
  towers?: Record<string, string>;
  floors?: Record<string, string>;
  /** Floor ids bottom to top (default: natural sort of floor names). */
  floorOrder?: string[];
  /** Projects' activity templates in construction order (excavation, footing, columns, slab…). */
  templates?: { id: string; name: string; short?: string }[];
}

/** What the Gantt receives (spec: ScheduleVersionView). */
export interface ScheduleVersionView {
  doc: ScheduleDoc;
  results?: ScheduleResult;
  baselines?: BaselineView[];
}

export function toScheduleInput(doc: ScheduleDoc): ScheduleInput {
  return {
    projectStart: doc.projectStart,
    ...(doc.projectFinishTarget !== undefined ? { projectFinishTarget: doc.projectFinishTarget } : {}),
    dataDate: doc.dataDate,
    defaultCalendarId: doc.defaultCalendarId,
    calendars: doc.calendars,
    activities: doc.activities.map((a) => {
      const out: ActivityInput = { id: a.id, code: a.code, type: a.type, duration: a.duration, constraint: a.constraint };
      if (a.parentId !== undefined) out.parentId = a.parentId;
      if (a.calendarId !== undefined) out.calendarId = a.calendarId;
      if (a.constraintDate !== undefined) out.constraintDate = a.constraintDate;
      if (a.deadline !== undefined) out.deadline = a.deadline;
      if (a.actualStart !== undefined) out.actualStart = a.actualStart;
      if (a.actualFinish !== undefined) out.actualFinish = a.actualFinish;
      if (a.remaining !== undefined) out.remaining = a.remaining;
      if (a.percentComplete !== undefined) out.percentComplete = a.percentComplete;
      return out;
    }),
    links: doc.links,
    settings: doc.settings,
  };
}

/** Baseline view from a calculated version. */
export function makeBaseline(id: string, label: string, doc: ScheduleDoc, results: ScheduleResult): BaselineView {
  const byStableKey: BaselineView['byStableKey'] = {};
  for (const a of doc.activities) {
    const r = results.activities[a.id];
    if (r) byStableKey[a.stableKey] = { es: r.es, ef: r.ef };
  }
  return { id, label, byStableKey };
}
