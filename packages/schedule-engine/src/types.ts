import type { CalendarInput, Minutes } from '@northmatter-ai/calendar';

export type { CalendarInput, Minutes };
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type ConstraintType = 'ASAP' | 'ALAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
export type ActivityType = 'task' | 'start_milestone' | 'finish_milestone' | 'summary' | 'level_of_effort';
export type LagCalendar = 'successor' | 'predecessor' | 'schedule_default' | 'elapsed';

export interface ScheduleSettings {
  defaultLagCalendar: LagCalendar;
  criticalThresholdMinutes: Minutes;
  criticalDefinition: 'total_float' | 'longest_path';
  progressMode: 'retained_logic' | 'progress_override';
  useExpectedFinish: boolean;
  negativeLagAllowed: boolean;
  calendarForFloat: 'activity';
}

export const DEFAULT_SETTINGS: ScheduleSettings = Object.freeze({
  defaultLagCalendar: 'successor',
  criticalThresholdMinutes: 0,
  criticalDefinition: 'total_float',
  progressMode: 'retained_logic',
  useExpectedFinish: false,
  negativeLagAllowed: true,
  calendarForFloat: 'activity',
});

export interface ActivityInput {
  id: string;
  /** Human code (e.g. KAV-T1-F05-SLAB), used in messages such as cycle reports. */
  code?: string;
  parentId?: string;
  type: ActivityType;
  duration: Minutes;
  calendarId?: string;
  constraint: ConstraintType;
  constraintDate?: Minutes;
  deadline?: Minutes;
  actualStart?: Minutes;
  actualFinish?: Minutes;
  remaining?: Minutes;
  /** Basis points, 0–10000. */
  percentComplete?: number;
}

export interface LinkInput {
  id: string;
  from: string;
  to: string;
  type: LinkType;
  lag: Minutes;
  lagCalendar?: LagCalendar;
}

export interface ScheduleInput {
  projectStart: Minutes;
  projectFinishTarget?: Minutes;
  dataDate: Minutes;
  defaultCalendarId: string;
  calendars: CalendarInput[];
  activities: ActivityInput[];
  links: LinkInput[];
  settings?: Partial<ScheduleSettings>;
}

export type ErrorCode =
  | 'UNKNOWN_ACTIVITY'
  | 'UNKNOWN_CALENDAR'
  | 'DUPLICATE_ACTIVITY'
  | 'SELF_LINK'
  | 'DUPLICATE_LINK'
  | 'LINK_TO_SUMMARY'
  | 'PARENT_NOT_SUMMARY'
  | 'CYCLE'
  | 'NO_WORKING_TIME'
  | 'INVALID_CALENDAR'
  | 'MISSING_CONSTRAINT_DATE'
  | 'NEGATIVE_DURATION'
  | 'NEGATIVE_LAG_NOT_ALLOWED'
  | 'ACTUAL_AFTER_DATA_DATE'
  | 'ACTUAL_FINISH_WITHOUT_START'
  | 'ACTUAL_FINISH_BEFORE_START';

export type WarningCode =
  | 'OPEN_START'
  | 'OPEN_END'
  | 'NEGATIVE_FLOAT'
  | 'LOGIC_VIOLATED'
  | 'OUT_OF_SEQUENCE'
  | 'HARD_CONSTRAINT'
  | 'LONG_LAG'
  | 'LONG_DURATION'
  | 'NEGATIVE_LAG'
  | 'MILESTONE_DURATION_IGNORED'
  | 'LOE_LINK_IGNORED';

export interface Issue {
  code: ErrorCode | WarningCode;
  severity: 'error' | 'warning';
  message: string;
  activityId?: string;
  linkId?: string;
  /** For CYCLE: the activity ids in cycle order. */
  activityIds?: string[];
}

export interface ActivityResult {
  id: string;
  es: Minutes;
  ef: Minutes;
  ls: Minutes;
  lf: Minutes;
  totalFloat: Minutes;
  freeFloat: Minutes;
  isCritical: boolean;
  isLongestPath: boolean;
  drivingLinkIds: string[];
  drivingPredecessorIds: string[];
  /** In-progress activities: where remaining work starts. */
  remainingStart?: Minutes;
  /** In-progress activities: remaining working minutes used. */
  remaining?: Minutes;
  status: 'not_started' | 'in_progress' | 'complete';
}

export interface ScheduleResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  projectFinish?: Minutes;
  activities: Record<string, ActivityResult>;
  /** Stable hash of the normalised input. */
  inputHash: string;
}

export interface Variance {
  key: string;
  status: 'matched' | 'added' | 'removed';
  startVariance?: Minutes;
  finishVariance?: Minutes;
  durationVariance?: Minutes;
}
