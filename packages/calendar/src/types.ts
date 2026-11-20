/** Integer minutes. Instants are minutes since 1970-01-01T00:00Z; durations are working minutes. */
export type Minutes = number;

/** Half-open [start, end) interval in minutes of the local day (0–1440). */
export type Interval = readonly [Minutes, Minutes];

/** 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface CalendarException {
  /** ISO local date, inclusive. */
  from: string;
  /** ISO local date, inclusive. */
  to: string;
  /** Working intervals on each of those days; empty = holiday. */
  intervals: Interval[];
  reason?: string;
}

export interface CalendarInput {
  id: string;
  name?: string;
  baseId?: string;
  /** IANA zone name, default Asia/Kolkata. */
  timeZone: string;
  /** Minutes in a "day" when durations are shown in days, default 480. */
  hoursPerDay: Minutes;
  /** Weekly pattern. A weekday missing here inherits from the base calendar (or is non-working). */
  week?: Partial<Record<Weekday, Interval[]>>;
  exceptions?: CalendarException[];
}

/** A calendar ready for working-time arithmetic. All functions take and return integer minutes. */
export interface CompiledCalendar {
  readonly id: string;
  readonly timeZone: string;
  readonly hoursPerDay: Minutes;
  /** True for the 24×7 elapsed calendar. */
  readonly elapsed: boolean;
  nextWorkStart(t: Minutes): Minutes;
  prevWorkEnd(t: Minutes): Minutes;
  finishFrom(start: Minutes, d: Minutes): Minutes;
  startFrom(finish: Minutes, d: Minutes): Minutes;
  workBetween(a: Minutes, b: Minutes): Minutes;
  shift(t: Minutes, m: Minutes): Minutes;
  /** Local day number (days since 1970-01-01 in the calendar's zone) containing t. */
  dayOf(t: Minutes): number;
  /** Instant at which a local day starts. */
  dayStart(day: number): Minutes;
  /** Working minutes on a local day. */
  workOnDay(day: number): Minutes;
}
