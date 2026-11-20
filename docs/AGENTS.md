# nm-gantt: state of the build, for AI agents

Read this before changing anything. It says what exists, where it lives, the rules the code follows, and what is still open. It is accurate as of **20 Nov 2026**. Update it when you finish a piece of work.

**The contract** is the Claude Doc "Scheduling Engine & Gantt — Build Spec": <https://claude.ai/artifact/Xjs4Hs64dP2FdcNaNewfDW>. Read it with the Claude Docs connector, not a web fetch. Where the code and the spec disagree, the spec wins. Where the spec is silent, the interpretation is recorded in [DECISIONS.md](../DECISIONS.md).

## 1. Rules you must follow

| Rule | What it means in practice |
|---|---|
| **Licences** | Dependencies must be MIT, Apache-2.0, BSD-2/3-Clause or ISC. `node scripts/check-licenses.mjs` enforces this. An SPDX `OR` passes if any branch is allowed. The only exception is `caniuse-lite`, a dev-only tool listed in `scripts/license-exceptions.json`, and it still awaits sign-off (D-012). Check a new dependency's **whole tree** before adding it; that is why ExcelJS was rejected (D-028). |
| **Clean room** | Never copy or port code from commercial Gantt products (Bryntum, DHTMLX, …) or from GPL code. Write from public specs (ECMA-376, the MSPDI schema) and from the build spec. |
| **TypeScript strict** | All 7 packages. `pnpm typecheck` must pass. |
| **Pure engine** | `@northmatter-ai/calendar` and `@northmatter-ai/schedule-engine` have no I/O and no runtime dependencies, and use no `Date.now()`. All times are **integer minutes**, and ties are broken by id, so results are deterministic. |
| **Every rule has a test** | A behaviour you add or change needs a unit test named after the rule. Anything visible in the UI also needs a Playwright test. |
| **Interpretations go in DECISIONS.md** | The next free number is **D-034**. Each entry names the test that pins it. |
| **Git** | The folder is **not a git repository** yet. Don't commit unless the user asks. |

## 2. Repository map

```
packages/calendar             working-time arithmetic (no deps)
packages/schedule-engine      CPM engine (no deps)
packages/schedule-commands    document model + 12 edit commands with inverses
packages/schedule-io          MSPDI (XML) and Excel (.xlsx) import/export
packages/gantt                React Gantt + read-only phone view
packages/construction-views   tower × floor grid, line of balance, look-ahead
apps/demo                     Vite app, mock Planning server, sample data, Playwright tests
scripts/                      licence gate
docs/                         this file
SETUP.md  README.md  DECISIONS.md
```

The dependencies run one way: `calendar` ← `schedule-engine` ← `schedule-commands` ← `schedule-io`, `gantt` ← `construction-views` and `apps/demo`.

## 3. What is built, package by package

### `@northmatter-ai/calendar` (M1, done)
- `src/calendar.ts` provides `compileCalendar(s)`, `nextWorkStart`, `prevWorkEnd`, `finishFrom`, `startFrom`, `workBetween`, `shift`, `ELAPSED` and `defaultTenantCalendar(id, holidays)` (Mon–Sat, 8 h, Asia/Kolkata).
- `src/dates.ts` and `src/zone.ts` handle local dates via `Intl` with per-day offset caching (D-001). Helpers: `parseLocal(tz, 'YYYY-MM-DDTHH:MM')`, `formatLocal`, `instantToLocal`, `dayStartInstant`, `isoToDay`/`dayToIso` (days since 1970-01-01), `weekdayOfDay` (0 = Sunday) and `instantFromEpochMs`.
- Calendars support inheritance (`baseId`), exceptions and IANA zones.
- Tests: 54, including the performance target (100k `finishFrom` in under 150 ms, best of 3 runs).

### `@northmatter-ai/schedule-engine` (M2–M4, done in code but not yet verified against MS Project)
- `calculate(input) → ScheduleResult` **never throws**. On a bad schedule it returns `ok: false` with `errors`.
- It covers:
  - validation (Tarjan cycle detection), Kahn ordering, and the forward and backward passes;
  - FS/SS/FF/SF links, lags (including elapsed) and 8 constraints;
  - deadlines, total and free float, driving links, critical and longest path, ALAP;
  - summaries, level of effort, progress and the data date (retained logic / progress override);
  - warnings: `OPEN_START`, `OPEN_END`, `NEGATIVE_FLOAT`, `LOGIC_VIOLATED`, `OUT_OF_SEQUENCE`, `HARD_CONSTRAINT`, `LONG_LAG`, `LONG_DURATION`, `NEGATIVE_LAG`, `MILESTONE_DURATION_IGNORED`, `LOE_LINK_IGNORED`.
- `compare(current, baseline, keyOf, { calendar })` gives variance (D-011). `hashInput` gives a stable input hash.
- `ActivityResult` fields: `es ef ls lf totalFloat freeFloat isCritical isLongestPath drivingLinkIds drivingPredecessorIds remainingStart? remaining? status`.
- Tests: 48 unit and 8 property tests (spec properties 1–7). 10k activities and 20k links calculate in under 500 ms.

### `@northmatter-ai/schedule-commands`
- `model.ts`:
  - `ScheduleDoc`: id, name, kind, version, projectStart, dataDate, defaultCalendarId, calendars, activities, links, settings, towers?, floors?, floorOrder?, templates?.
  - `ActivityRecord`: adds stableKey, code, name, sortKey, tower/floor ids, notes, externalRef and `autoSummary?` (D-027).
  - `ScheduleVersionView { doc, results?, baselines? }`, `BaselineView`, and `toScheduleInput(doc)`.
- `commands.ts` holds the spec's **12 commands**: `addActivity`, `updateActivity`, `deleteActivity`, `moveActivity`, `indent`, `outdent`, `addLink`, `updateLink`, `deleteLink`, `setConstraint`, `setCalendar`, `setProgress`.
  - It also holds a 13th, **`updateLookups`**, for the tower, floor and trade lists (D-032), plus `lookupId` for new ids.
  - `updateActivity` refuses tower, floor or trade ids the project doesn't have.
  - `applyCommands(doc, cmds)` is all-or-nothing and returns `{ doc, inverse }`, which drives undo/redo.
  - It throws `CommandError` with codes such as `LINK_TO_SUMMARY`, `CYCLE`, `HAS_LINKS`, `PARENT_NOT_SUMMARY`, `IN_USE` and `UNKNOWN_TOWER`.
- `sortKey.ts` has fractional sibling keys (`keyBetween`, `evenKeys`, `keysAfter`).
- `text.ts` has `parseDuration`/`formatDuration` ("5d", "4h", "2w") and `parsePredecessors`/`formatPredecessor` ("12FS+2d; 15SS").

### `@northmatter-ai/schedule-io` (M5, partly done)
- `mspdi.ts`: `importMspdi(xml, opts) → { doc, result, report }` and `exportMspdi(doc, result)`. The report has `unmapped`, `conversions`, `errors`, `warnings` and `counts`, and **is** the dry run. Codes still to verify against the schema are listed in D-017.
- `excel.ts`:
  - **Import:** `importExcel(bytes, { calendars, defaultCalendarId, projectStart, … })`, plus `importExcelSheets` (pure, used by the tests).
  - **Export:** `exportExcel(doc, result)` and `excelTemplate()`.
  - **Template:** the spec's **14 columns**, plus optional `Trade` and `Remaining (days)` columns, an optional `Project` sheet, and calculated columns that import ignores (D-028 to D-030, D-033).
- `xlsx.ts` is our own minimal .xlsx reader/writer on `fflate` and `fast-xml-parser`. **Do not swap in ExcelJS or SheetJS**; see D-028.
- `links.ts` holds `resolveLinks`, the spec's rule for links to summaries, shared by both formats.
- Tests: 7 MSPDI and 23 Excel. Generated files were checked with openpyxl but **not yet in real Excel**.

### `@northmatter-ai/gantt` (M6–M7, done)
- **`Gantt.tsx`:** `<Gantt version mode="edit|view|print" zoom groupBy filter showBaselineId onCommands …/>`.
  - The component holds no business rules. Each user action becomes `Command[]`, the engine previews it in a Web Worker (`engine.worker.ts`, `usePreview.ts`), and then `onCommands` sends it. The server's result always wins.
  - `GanttHandle`: `undo`, `redo`, `canUndo`, `canRedo`, `scrollToDate`, `addActivity`, `expandAll`, `collapseAll`, `focusActivity` and `openSetup`.
  - **Undo history** can be owned by the host: pass `history={createUndoHistory()}` and keep the object. The demo keeps one per open project, so undo survives tab switches. Without the prop, history lives and dies with the component.
- **Interactions:**
  - **Dragging:** move a bar (sets SNET), drag either end (left = SNET + duration, right = duration, or remaining if started), drag a summary (moves its not-started children), drag a progress handle, draw a link from bar end to bar end, and reorder rows by dragging. Rules: D-016 and D-026.
  - **Editing:** grid cells, including Start and Finish (D-015, D-019); a double-click opens the editor (`ActivityEditor.tsx`).
  - **Tower, floor and trade:** the editor's pickers have "+ Add…" entries. `ProjectSetup.tsx` (the "Towers, floors & trades" dialog) adds, renames, orders and removes them in one undoable command.
  - **Keyboard and menus:** Tab/Shift+Tab indent (D-014, D-027), Ins/Del, a context menu, trace back/forward, and undo/redo of 100 steps.
- **Display and access:**
  - virtualised grid via `@tanstack/react-virtual`, with zoom from day to year and Ctrl+wheel;
  - filters, grouping (WBS/tower/floor/none), and baseline and float bars;
  - an ARIA treegrid, light/dark themes via CSS variables on `.nm-gantt`, and English/Hindi (`i18n.ts`).
- **`Phone.tsx` and `phoneModel.ts`:** `<PhoneSchedule version initialScope showBaselineId locale/>`.
  - A read-only list with bars, scoped to a 2–6 week look-ahead, one tower, or the whole project.
  - Pinch, swipe, −/+/Fit, and tap for a details sheet (D-031). `buildPhoneList` is pure.
- Tests: 12 helper, 8 phone and 3 setup tests. The 5,000-activity schedule renders in about 125 ms headless.

### `@northmatter-ai/construction-views` (M8, partly done)
- `TowerFloorGrid`, `LineOfBalance`, `LookAhead` (with PPC and browser print-to-PDF) and `ActivityDetails`.
- The models live in `model.ts`: `SiteData`, `cellState`, `buildTowerGrid`, `buildLob` and `buildLookahead`. Rules: D-020 to D-025.
- They run on **mock Site data** (`apps/demo/src/siteMock.ts`). The `SiteData` shape still needs confirming with the Site team.
- Tests: 11. A 40 × 30 grid renders in about 20 ms against a 500 ms budget.

### `apps/demo`
- **`App.tsx`:** the toolbar, tabs (Gantt · Tower × floor · Line of balance · Look-ahead · Phone), the issues panel, and data-date and baseline controls.
  - Below 700 px wide, or with `?view=phone`, it renders only `PhoneSchedule`. `?view=desktop` forces the desktop layout.
- **`mockServer.ts`:** `MockPlanningServer` mimics the Planning API.
  - It provides `commands(cmds, baseVersion)` (checks the version, returning `VERSION_CONFLICT`, then recalculates), `saveBaseline`, `replace`, `subscribe` and `restore(storageKey)`.
  - It persists to `localStorage`.
- **`projects.ts`:** user projects are stored under the `localStorage` prefix `nm-gantt-demo:v1`. A source id is `p:<projectId>`.
- **`NewProjectDialog.tsx`:** creates a tower template or a blank project.
- **`ImportDialog.tsx`:** the dry-run preview for an import; Create or Cancel.
- **`sample.ts`:**
  - `sampleSchedule(floors, opts)` builds 2 towers and 215 activities.
  - `largeSchedule()` builds 5,000 activities; `stressTower(40, 30)` builds the tower stress test; `blankProject`.
  - `withProgress` adds progress up to a data date.
  - `calendars()` returns `site` and `office`.
- **e2e (Playwright, 35 tests):** `gantt` (12), `drag` (8), `phone` (6), `construction` (4), `projects` (3), `excel` (3), `lookups` (3). They build and serve on port 3612.

## 4. Data conventions that catch people out

- **Time:** a `Minutes` value is minutes since the Unix epoch, in UTC. Local wall-clock time exists only at the edges, through `parseLocal`/`formatLocal` with the calendar's `timeZone`.
- **Durations and lags** are **working minutes** on the activity's calendar. A day is `hoursPerDay`, 480 by default.
- **`percentComplete`** is in **hundredths of a percent**: 10000 = 100%. The UI and Excel show it divided by 100.
- **Finish times:** a finish is the end of the last working minute. `prevWorkEnd(Tue 09:00)` is `Mon 18:00` (D-002).
- **Summaries** carry no links. Their dates come from their children, and an empty summary sits at the project start (D-009).
- **Codes and ids:** `code` is what users see and what predecessor text refers to. `stableKey` matches activities to baselines across versions.
- **The tower × floor grid** shows an activity only if it has all three of `towerId`, `floorId` and `activityTemplateId` (its trade), and each must exist in `doc.towers`, `doc.floors` and `doc.templates`.
- **Excel dates** cross the boundary as JS `Date`s whose **UTC fields** hold the wall-clock values.

## 5. Running and checking

```bash
pnpm install          # pnpm 12.21.0 via corepack, Node 22+
pnpm dev              # demo at http://localhost:3600
pnpm typecheck        # all 7 packages
pnpm test             # Vitest: 189 tests
pnpm run licenses     # licence gate; plain "pnpm licenses" is pnpm's own command
pnpm run ci           # all four in order
pnpm e2e              # Playwright: 35 tests; first time: pnpm exec playwright install chromium
SHOT_DIR=/some/dir pnpm e2e       # also saves screenshots
```

Before reporting work as done, run all four checks and look at screenshots of anything visual.

**Gotchas**
- **File names:** macOS is case-insensitive, so `phone.ts` and `Phone.tsx` in one folder break module resolution.
- **Old e2e server:** if a previous preview server is still on port 3612, run `pkill -f "vite preview --port 3612"`.
- **Stale demo data:** it persists in `localStorage`. Use **Reset**, or clear storage, after changing the sample builders.
- **Performance tests** take the best of 3 runs, because a busy machine causes one-off failures.

## 6. Status against the build plan

| # | Milestone | State | Exit criterion met? |
|---|---|---|---|
| M1 | Calendar | Done | Yes |
| M2 | Engine core | Done | No: needs synthetic MS Project golden files |
| M3 | Links, constraints, float, paths, summaries, LOE | Done | Half: property tests 1–7 pass; golden files missing |
| M4 | Progress, baselines, validation, warnings | Done in the engine | No: needs golden files with a status date |
| M5 | schedule-io, Planning service in Projects, migration | MSPDI and Excel done | No: service and migration not built |
| M6 | Gantt view mode | Done | Partly: only first render is measured |
| M7 | Gantt editing | Done | Half: suite green; the planner usability session hasn't happened |
| M8 | PDF, construction views, Site endpoint and events | Construction views and phone view done | No: needs the backend, Site integration and a one-month pilot |

## 7. Not built, and why

| Item | Why | Where it goes |
|---|---|---|
| Planning service: storage, versions, locking, API, events | It belongs inside the Projects backend, which isn't on this machine | `northmatter-ai/re-projects`. Reuse `schedule-engine` and `schedule-commands` there; the mock server shows the contract. |
| Migration of existing schedules (BOQ tie-out within ₹1) | Needs Projects data | `re-projects` |
| Site progress endpoint and events (idempotent by `sourceRef`) | Part of the service; the contract isn't agreed with Site | `re-projects` and the Site app |
| Server-side Gantt PDF job | Runs on the service's infrastructure | Server. It can render `<Gantt mode="print">`. |
| Performance CI (fail on a regression over 20%), screenshot comparison tests, API tests | Not started (API tests need the service) | This repo and `re-projects` |

## 8. Open inputs and sign-offs

1. **Real MS Project files** (MSPDI with calculated dates) for the golden corpus. Until they arrive, the engine is **not verified to the minute**. Don't claim the M2–M4 exit criteria are met.
2. **Sign-offs:** the `caniuse-lite` exception (D-012), and replacing ExcelJS with our own reader/writer (D-028).
3. Real site calendars and holiday lists, construction templates, and a real Imp Sch sheet to test the Excel import against.
4. Confirmation of the `SiteData` contract from the Site team.
5. Manual checks: open an exported .xlsx in Microsoft Excel, and use the phone view on a physical phone.

## 9. When you add something

1. Find the governing spec section. If the spec is silent, write a D-entry.
2. Put logic in a pure function in the right package and keep React components thin. Commands are the only way to change a document.
3. Add unit tests, plus e2e tests for UI. Add strings to `i18n.ts` in **both** English and Hindi.
4. Run every check, then update `README.md` (status table), `SETUP.md` (if users see it) and **this file**.
