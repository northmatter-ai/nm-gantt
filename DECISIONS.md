# Decisions

Where the build spec is silent or ambiguous, we match Microsoft Project's default behaviour, record the choice here, and add a test. Each entry names the test that pins it. **None of these has been checked against real MS Project output yet.** That happens when the golden-file corpus arrives (see README, "Inputs needed").

### D-001 Time zones use per-UTC-day offset caching
Local dates come from `Intl.DateTimeFormat` only. Offsets are cached per UTC day. When a day contains a DST change, the change minute is found by binary search. A local time inside a DST gap moves forward.
*Test:* `calendar.test.ts › time zones with daylight saving`.

### D-002 `prevWorkEnd` treats an interval start as outside the interval
`nextWorkStart` treats an interval end as outside (the next start is returned). `prevWorkEnd` mirrors that: at an interval start it returns the previous end. So `prevWorkEnd(Tue 09:00) = Mon 18:00`, and an FS predecessor's late finish displays as Monday 18:00, as MS Project shows it.
*Test:* `calendar.test.ts › prevWorkEnd › moves an interval start back to the previous end`.

### D-003 A zero shift is the identity
The spec defines `shift(cal, t, 0) = finishFrom(cal, t, 0) = nextWorkStart(t)`. Taken literally, a finish milestone after a task that ends Monday 18:00 would land on Tuesday 09:00, which contradicts the milestone rule in step 2. We use `shift(t, 0) = t` instead. Tasks are unaffected because every task candidate then goes through `nextWorkStart`.
*Tests:* `calendar.test.ts › shift › zero is the identity`, `engine.test.ts › Milestones`.

### D-004 Milestone late dates
Finish milestones keep `prevWorkEnd` late dates (Mon 18:00). Start milestones normalise late dates with `nextWorkStart` (Tue 09:00), so ES and LS read the same way.
*Test:* `engine.test.ts › Milestones`.

### D-005 Completed activities
Completed activities have total float 0 but are **not** critical, as in MS Project. In the backward pass, links into a completed successor are ignored. In `progress_override` mode, links into in-progress successors are ignored as well.
*Test:* `engine.test.ts › complete activities keep actual dates and have no float`.

### D-006 In-progress activities
- Retained logic uses candidates from *unfinished* predecessors only. The spec gives the formulas; we read "unfinished" literally.
- FF and SF candidates use the remaining duration.
- Hard constraints (MSO, MFO) are ignored once an activity has started.
- With remaining = 0 and no actual finish, EF is the remaining start.
- Precedence for remaining: explicit `remaining`, else percent complete, else `D − workBetween(actualStart, dataDate)`.

*Tests:* `engine.test.ts › Progress and the data date`.

### D-007 Free float counts links and the project finish only
SNLT, FNLT and deadlines do not reduce free float, because they don't delay a successor or the project.
*Test:* `engine.test.ts › free float is smaller than total float…`.

### D-008 Level of effort
Only SS predecessors (start) and FF successors (finish) count. Any other link on a level-of-effort activity raises the new warning `LOE_LINK_IGNORED`. With no SS predecessor, the start is the project start. With no FF successor, the finish is the project finish.
*Test:* `engine.test.ts › level of effort spans…`.

### D-009 Summaries
A summary with no children sits at the project start with zero duration. Status rolls up: all children the same → that status; any started → in progress. `isLongestPath` is true if any child is on it.

### D-010 Extra validation codes
Added: `DUPLICATE_ACTIVITY`, `UNKNOWN_CALENDAR`, `PARENT_NOT_SUMMARY`, `INVALID_CALENDAR` (malformed calendar), `NEGATIVE_DURATION`, and `NEGATIVE_LAG_NOT_ALLOWED` (when `negative_lag_allowed` is false). The spec's progress errors are named `ACTUAL_AFTER_DATA_DATE`, `ACTUAL_FINISH_WITHOUT_START` and `ACTUAL_FINISH_BEFORE_START`.

### D-011 `compare()` takes the calendar explicitly
Variance is `workBetween(default calendar, …)`, but a `ScheduleResult` carries no calendars. The signature is therefore `compare(current, baseline, keyOf, { calendar, baselineKeyOf? })`.

### D-012 Licence exception: `caniuse-lite` (CC-BY-4.0) — **needs sign-off**
This is browser-support data that `@vitejs/plugin-react` (via Babel) reads at build time, and only for the demo app. It is never bundled. It is listed in `scripts/license-exceptions.json`, and the check prints it on every run. Two alternatives if this isn't acceptable:
- Use `@vitejs/plugin-react-swc` in the demo.
- Build the demo with plain esbuild.

### D-013 Detecting a calendar with no working time
At compile time, a weekly pattern with no working time is rejected. At run time, 53 consecutive Monday–Sunday weeks (371 days) without work throw `NO_WORKING_TIME`. Gaps of exactly 366–370 days are not caught; they would need a per-day scan.
*Test:* `calendar.test.ts › validation`.

### D-014 Indent and outdent
Indent makes the row above a summary, as in MS Project, but only if that row has no links. Summaries can't carry links (`LINK_TO_SUMMARY`), so otherwise the command is refused with `HAS_LINKS`. Outdenting the last child turns its parent back into a task, and the parent's stored duration is kept, but only if indent created that summary (see D-027).
*Tests:* `commands.test.ts`, e2e `grid editing…`.

### D-015 Double-click in the grid
Double-clicking an editable cell (name, code, duration, start, predecessors, %) edits it in place. Double-clicking any other cell, the row, or a bar opens the activity editor. Shift+Enter always opens the editor.

### D-016 Drag snapping
Moving a bar snaps to local midnight at day, week and month zoom, and to Monday at quarter and year zoom. It then applies `nextWorkStart` on the activity's calendar. Resizing snaps the finish the same way and then applies `prevWorkEnd`.

### D-017 MSPDI details still to verify against the schema
- Percentage lag formats (19, 20, 51, 52) are read as `LinkLag / 10` percent of the predecessor's duration.
- Recurring exceptions (`Type ≠ 1`) are imported as one continuous range and listed in the report.
- A `ToDate` at 00:00 is treated as exclusive.

All three are flagged for checking against Microsoft's published schema before golden-file work.

### D-018 Where the base version comes from
The Gantt's `onCommands(cmds)` matches the spec's component contract and sends no version. The host adds `baseVersion` when it calls `POST /commands`. The demo's mock server checks it and returns `VERSION_CONFLICT`.

### D-019 Grid predecessor references
In the Predecessors column, a reference resolves first to an activity **code**, then a **WBS number**, then a 1-based **row number** in tree order. Display always uses codes.

## Construction views

### D-020 Cell state precedence and "late"
The order is certified > reported > late > in progress > not started.
- An activity with an actual finish counts as certified, because schedule actuals come from Site certifications.
- "Late" means the forecast finish is after the baseline finish. If no baseline is shown, it means negative total float.

*Test:* `construction-views/test/model.test.ts › cell state`.

### D-021 Line-of-balance clash
A clash is marked where a trade's planned finish on a floor is at or before the finish of the trade **immediately before it** in construction order, on the same floor. Only the first floor of each crossing gets a marker. Non-adjacent trades are not compared.
*Test:* `… › flags a clash …`.

### D-022 Line-of-balance rate
Floors per week = (top point's floor − bottom point's floor) ÷ calendar weeks between their finishes. A line needs at least two points.

### D-023 Line-of-balance colours
Templates take categorical slots 1–8 in construction order, so a trade keeps its colour when others are hidden. Templates 9+ are drawn in neutral grey and start hidden. Light-mode slots 3–5 are below 3:1 contrast, so the legend chips carry names and a table view is provided.

### D-024 Look-ahead inclusion and PPC
- **Included:** tasks (not milestones, summaries or level of effort) that are not complete or certified, and that either start inside the window or are in progress and started before its end.
- **Predecessor readiness**, when Site doesn't send it: ready when every FS and SS predecessor is complete or certified. Otherwise not ready, with the first open predecessor's contractor as owner.
- **PPC** = commitments done ÷ commitments with a known outcome.
- The window is clamped to 2–6 weeks.

### D-025 Look-ahead PDF
Until the server-side Playwright PDF job exists, **Export PDF** uses the browser's print-to-PDF. Print CSS isolates the board, repeats the table header, avoids splitting rows, and adds a title block (project, window, data date, printed at), on A4 landscape. The server job can render the same component.

### D-026 Dragging bar ends, started bars and summaries
- **Left end:** sets an SNET constraint at the new start and changes the duration, so the finish stays put. If logic drives the activity later than the new start, the logic wins, as in MS Project.
- **Started activities:** the start is fixed, so they can't be moved or stretched from the left. Dragging the right end, or editing the Finish cell, sets the **remaining** duration, not the original one.
- **Summaries:** dragging a summary applies the same snapped delta to every not-started task and milestone under it, each getting an SNET constraint. Started and completed children stay where they are.
- **Moving several at once:** multi-select moves use one shared delta (from the bar under the pointer) instead of snapping each bar separately.

### D-027 Explicit summaries survive outdent
Indent records `autoSummary: true` when it turns a task into a summary. Outdenting that summary's last child turns it back into a task and clears the flag. A summary the user chose (Type = Summary in the editor, or imported) has no flag. It stays a summary when it becomes empty, sitting at the project start with zero duration (D-009). MS Project always keeps the summary; we keep the revert only for summaries indent created, so a stray Tab followed by Shift+Tab undoes cleanly.
*Tests:* `commands.test.ts › indent turns the row above into a summary; outdent reverses it`, `… › outdent keeps a summary the user created explicitly`.

## Excel and the phone view

### D-028 Excel without ExcelJS
The spec names ExcelJS (MIT). Its dependency tree pulls in six packages outside the licence allow-list, and they would ship in the browser bundle:
- `big-integer` (Unlicense)
- `graceful-fs` (BlueOak-1.0.0)
- `pako` (MIT AND Zlib)
- `buffers` (no licence)
- `chainsaw` (MIT/X11)
- `jszip` (MIT OR GPL-3.0)

So the .xlsx reader and writer are our own (`schedule-io/src/xlsx.ts`, about 250 lines, written from ECMA-376). They use `fflate` (MIT, no dependencies) for the zip and `fast-xml-parser` (MIT) for the XML.

Coverage:
- **Writes:** cell values, a bold frozen header, column widths, and drop-down lists for Type and Constraint.
- **Reads:** shared or inline strings, numbers, booleans, Excel dates (including 1904-based workbooks), and namespace-prefixed parts.
- **Not supported:** formulas (the cached value is read), merged cells, and the old .xls format (it is refused with a message).

The output was checked with openpyxl, but it has not yet been opened in Microsoft Excel itself.

Two additions to the template, both optional on import:
- A **Project** sheet (name, start, data date, time zone), so a round trip keeps them.
- A **Remaining (days)** column, written only when an in-progress activity has an explicit remaining duration. Without it a round trip would recompute the remaining work from % complete and move the finish.

Calculated columns (Start, Finish, Total float, Critical) are written for reading and ignored on import.
*Tests:* `excel.test.ts`.

### D-029 Excel dates
A cell can hold an Excel date, `2026-12-01`, `01/12/2026` or `1-Dec-2026`, with an optional `HH:MM`. Slashed dates are read **day first** (Indian convention).
- A date with no time means the first working minute of that day for start-type fields (Actual start; SNET, SNLT and MSO dates).
- It means the last working minute of that day for finish-type fields (Actual finish; FNET, FNLT and MFO dates).
- A time, when given, is used exactly. Export writes the exact time, formatted to show the date only, so a round trip is exact.
*Tests:* `excel.test.ts › reads constraints with dates…`, `reads the dates planners type`.

### D-030 Excel row rules
- **References and summaries:**
  - Predecessor references resolve to a **code** first, then a **WBS number**, as in the grid (D-019, without row numbers).
  - A row whose WBS has rows under it becomes a summary, whatever its Type says, and the change is logged.
  - "Milestone" with no start/finish is resolved as MSPDI does: a finish milestone if it has predecessors and no successors, otherwise a start milestone.
- **Values and defaults:**
  - A task with no duration gets 1 day, as MS Project does.
  - % complete is 0–100 (the model stores hundredths) and is clamped.
  - Missing codes become `WBS-<n>` or `ROW-<n>`, and duplicate codes get `-2`, `-3`.
  - The Calendar column names a calendar the importing tenant already has (by name or id). An unknown name falls back to the project calendar and is reported.
- **Project start**, in order of preference: the Project sheet, then the caller's default (the demo uses today), then the earliest date in the sheet. If none is found, the import fails with a message.
*Tests:* `excel.test.ts › Excel import rules`.

### D-031 Phone view
- **Scopes:**
  - **Look-ahead (2–6 weeks, default 3):** lists unfinished tasks and milestones that start before the window ends. They are grouped as "In progress", then by the Monday-based week of start. Bars are drawn from up to a week before the data date, so work already under way shows whole.
  - **One tower, or the whole project:** lists tasks and milestones in WBS order, grouped by WBS parent, optionally hiding finished work.
- **What is left out:** summaries and level of effort.
- **Zoom:** all rows share one time window. Pinch zoom keeps the time under the fingers fixed, and the span is clamped to 3 days–3 years.
- **Identity cues:** critical and late are marked with an icon and text, not colour alone.
- **Layout:** the demo switches to this view below 700 px wide, or with `?view=phone`.
*Tests:* `gantt/test/phone.test.ts`, e2e `phone.spec.ts`.

## Towers, floors and trades

### D-032 A 13th command: `updateLookups`
The spec lists 12 commands, and none of them can create a tower, floor or trade. So a project that didn't start from the tower template could never reach the tower × floor grid. `updateLookups` changes the lists that activities point at:
- `towers` and `floors` (id → name; null removes);
- `floorOrder` (bottom to top);
- `templates` (trades in construction order).

Rules:
- Names are trimmed, must not be empty, and must be unique ignoring case.
- An entry an activity still uses cannot be removed (`IN_USE`).
- The inverse restores exactly the previous lists, so one undo reverses an editor save that added a tower and tagged the activity.
- `updateActivity` now refuses tower, floor or trade ids the project doesn't have (`UNKNOWN_TOWER`, `UNKNOWN_FLOOR`, `UNKNOWN_TRADE`).
- New ids are readable and unique (`lookupId`: `T-TOWER-A`, `F-FLOOR-3`, `TR-WATERPROOFING`).

The Planning API needs the same command when it is built.
*Tests:* `commands.test.ts › updateLookups…`, `gantt/test/setup.test.ts`, e2e `lookups.spec.ts`.

### D-033 Excel Trade column
**Trade** is an optional column after the template, as Remaining is (D-028), since the spec's template has no trade.
- **Import:** the column matches the importing tenant's trades by name, short name or id, ignoring case. An unknown trade is added to the project and listed in the report.
- **Export:** the column is written whenever an activity has a trade.
*Tests:* `excel.test.ts › matches trades…`, round trip.

### D-034 Publishing to npm
The six packages are published as public, MIT-licensed packages under `@northmatter-ai` (it was `@nm`, which we don't own on npm). They release together at one version. See [RELEASING.md](RELEASING.md).
- **Build:** plain `tsc` emit to `dist` (ESM + `.d.ts` + source maps, with `src` shipped for the maps), with no bundler. The worker keeps the `new URL('./engine.worker.js', import.meta.url)` form, which every major bundler understands. The build only rewrites `.ts` → `.js` in that URL.
- **Dev vs published:** `exports` stays on `src` for the workspace. `publishConfig.exports` points at `dist` for the tarball. Sibling packages resolve to each other's `dist` types at build time (`paths` in `tsconfig.build.json`), so no package re-emits another's sources.
- **No Changesets:** its dev dependencies (`argparse` Python-2.0, `graceful-fs` BlueOak-1.0.0, `spawndamnit` unlicensed) fail the licence allow-list. A small `set-version` script and a `v*` tag trigger do the same job here.
- **CI publish:** uses npm trusted publishing (OIDC) with provenance, so no npm token is stored. The first publish has to be by hand, because npm can only register a trusted publisher on a package that already exists.
- **Checked by:** `scripts/check-packages.mjs` (tarball contents), and a throwaway Vite + React app installed from the tarballs. That app type-checks with `skipLibCheck: false`, renders the Gantt, starts the engine worker from the published `.js`, and runs both exporters with no console errors.
