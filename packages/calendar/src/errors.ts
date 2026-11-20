export type CalendarErrorCode =
  | 'INVALID_TIME_ZONE'
  | 'INVALID_INTERVAL'
  | 'INVALID_DATE'
  | 'OVERLAPPING_EXCEPTIONS'
  | 'UNKNOWN_BASE_CALENDAR'
  | 'BASE_CALENDAR_CYCLE'
  | 'DUPLICATE_CALENDAR';

/** A calendar definition is malformed. */
export class CalendarError extends Error {
  constructor(readonly code: CalendarErrorCode, message: string, readonly calendarId?: string) {
    super(message);
    this.name = 'CalendarError';
  }
}

/** A calendar has no working time in some 366-day window (spec: NO_WORKING_TIME). */
export class NoWorkingTimeError extends Error {
  readonly code = 'NO_WORKING_TIME' as const;
  constructor(readonly calendarId: string) {
    super(`Calendar "${calendarId}" has no working time in a 366-day window`);
    this.name = 'NoWorkingTimeError';
  }
}
