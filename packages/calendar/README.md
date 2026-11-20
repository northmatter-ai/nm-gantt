# @northmatter-ai/calendar

Working-time arithmetic on integer minutes (UTC instants, working-minute durations). No dependencies; time zones via `Intl` only.

- `compileCalendars(inputs)` resolves base-calendar inheritance and returns compiled calendars. It throws `CalendarError` or `NoWorkingTimeError`.
- On a compiled calendar: `nextWorkStart`, `prevWorkEnd`, `finishFrom`, `startFrom`, `workBetween`, `shift`, plus `dayOf`, `dayStart` and `workOnDay` for UIs.
- `ELAPSED` is the 24×7 calendar for elapsed lags.
- `defaultTenantCalendar()`: Mon–Sat 09:00–13:00 and 14:00–18:00, Asia/Kolkata.
- `parseLocal(tz, 'YYYY-MM-DDTHH:mm')` and `formatLocal(tz, t)` convert to and from wall-clock time.

Days expand lazily and are cached. Week totals feed a prefix-sum array, so `finishFrom` and `startFrom` cost O(log weeks). See DECISIONS D-001–D-003 and D-013.
