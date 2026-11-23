# nm-gantt — NorthMatter scheduling engine and Gantt

A critical path scheduling engine and React Gantt chart, MIT-licensed and published on npm under `@northmatter`. This repo builds it from the build spec "Scheduling Engine & Gantt — Build Spec" (Claude Docs). Where code and spec disagree, the spec wins. Interpretations are recorded in [DECISIONS.md](DECISIONS.md).

## Packages

| Package | What it is | Runs in |
|---|---|---|
| [`@northmatter/calendar`](packages/calendar) | Working-time calendars: `nextWorkStart`, `prevWorkEnd`, `finishFrom`, `startFrom`, `workBetween`, `shift`; inheritance, exceptions, IANA zones via `Intl` | Node, browser |
| [`@northmatter/schedule-engine`](packages/schedule-engine) | CPM: validation (Tarjan cycles), Kahn ordering, forward/backward passes, 4 link types, lags, 8 constraints, deadlines, total and free float, driving links, critical and longest path, ALAP, summaries, level of effort, progress and data date, baselines and variance, warnings | Node, browser, Web Worker |
| [`@northmatter/schedule-commands`](packages/schedule-commands) | The schedule document model and the edit commands with inverses: the spec's 12 plus `updateLookups` for towers, floors and trades (D-032). Undo/redo, audit, server; fractional sort keys; duration and predecessor text parsing | Node, browser |
| [`@northmatter/schedule-io`](packages/schedule-io) | MS Project XML (MSPDI) and Excel (.xlsx, the spec's template) import with a dry-run report, and export with computed dates | Node, browser |
| [`@northmatter/construction-views`](packages/construction-views) | Tower × floor grid, line of balance, look-ahead board (readiness, commitments, PPC, print to PDF), activity details with inspections and DPR photos | Browser |
| [`@northmatter/gantt`](packages/gantt) | React Gantt: virtualised tree grid and SVG timeline, all bar types, links, zoom, filters, grouping, drag/resize/progress/link-drawing, editor, undo/redo, keyboard, ARIA treegrid, light/dark, English/Hindi; read-only phone view (pinch zoom, tap for details) | Browser |
| [`apps/demo`](apps/demo) | Demo app with a mock Planning server (command batches, version check, recalculation) and sample schedules | Browser |

All packages have no runtime dependencies except these: `@tanstack/react-virtual` (MIT) in the Gantt, and `fast-xml-parser` (MIT) and `fflate` (MIT) in schedule-io. The engine and calendar have none at all.

## Install

```bash
npm install @northmatter/gantt react react-dom   # pulls in calendar, schedule-engine, schedule-commands
npm install @northmatter/schedule-io             # optional: MS Project XML and Excel
npm install @northmatter/construction-views      # optional: tower grid, line of balance, look-ahead
```

```tsx
import { Gantt } from '@northmatter/gantt';
import '@northmatter/gantt/gantt.css';
```

The packages are ES modules only and need a bundler that handles `new URL('./x.js', import.meta.url)` workers (Vite, webpack 5, Rollup, Parcel). To publish a new version, see [RELEASING.md](RELEASING.md).

## Run it

First time? Follow **[SETUP.md](SETUP.md)**.

```bash
pnpm install
pnpm dev          # demo at http://localhost:3600
pnpm test         # unit + property tests (Vitest, fast-check)
pnpm e2e          # Playwright UI tests (first time: npx playwright install chromium)
pnpm typecheck
pnpm run licenses # fails on anything outside MIT / Apache-2.0 / BSD / ISC
pnpm run ci       # all of the above
```

The demo opens a sample residential project: two towers × 12 floors and 215 activities, with progress to an 11 Jan 2027 data date and a saved baseline. **Stress: 5,000 activities** loads the performance schedule. **Import…** reads an Excel (.xlsx) or MS Project XML file and shows the import report before creating a project; **Export…** writes either format or a blank Excel template. On a phone (or the **Phone** tab) the schedule shows as a read-only list with bars. Edits persist to `localStorage`; **Reset** rebuilds the sample.

## Using the engine

```ts
import { calculate } from '@northmatter/schedule-engine';
const result = calculate({ projectStart, dataDate, defaultCalendarId: 'std', calendars, activities, links, settings });
if (!result.ok) console.log(result.errors); // never throws on a bad schedule
result.activities['A'].totalFloat;           // integer working minutes
```

## Using the Gantt

```tsx
import { Gantt } from '@northmatter/gantt';
import '@northmatter/gantt/gantt.css';

<Gantt
  version={{ doc, results, baselines }}
  mode="edit"                       // "view" | "print"
  zoom="week" groupBy="wbs" filter={{ criticalOnly: true }} showBaselineId="bl-1"
  onCommands={(cmds) => api.post(`/schedule-versions/${id}/commands`, { baseVersion, commands: cmds })}
/>
```

The component holds no business rules. Each user action becomes a command. The engine previews it in a Web Worker, then `onCommands` sends it to the server, and the server's result always wins. Theme it through CSS variables (`--nm-brand`, `--nm-critical`, …) on `.nm-gantt`.

## Status against the build plan

| # | Milestone | Status |
|---|---|---|
| M1 | `@northmatter/calendar` | **Done.** All calendar tests pass, plus the performance target: 100k `finishFrom` in < 150 ms. |
| M2 | Engine core | **Done.** Golden files are not yet matched (none available). |
| M3 | Link types, lags, constraints, float, paths, ALAP, summaries, LOE | **Done.** Property tests 1–7 pass. 10k activities + 20k links calculate in < 500 ms. Synthetic MSP golden files not yet matched. |
| M4 | Progress, data date, baselines, variance, validation, warnings | **Done** in the engine. Golden files with a status date are pending. |
| M5 | `schedule-io`, Planning data model and API **in Projects**, migration | **Partly done.** MSPDI and Excel import/export are built and round-trip tested. Excel uses our own small .xlsx reader/writer instead of ExcelJS, for licence reasons (D-028). The Planning service and the migration belong in `northmatter-ai/re-projects` and are **not built**. The demo's mock server copies the API contract. |
| M6 | Gantt view mode | **Done.** Layout, virtualisation, every bar type, links, zoom, filters, grouping and baselines. The 5,000-activity schedule renders in about 125 ms in headless Chromium. Formal performance CI is not yet set up. |
| M7 | Gantt editing | **Done.** Commands, Worker preview, drag/resize/progress, link drawing, editor, grid editing, undo/redo, keyboard and context menu. The Playwright suite covers the main paths. The planner usability session is still to do. |
| M8 | PDF printing, construction views, Site progress endpoint and events | **Construction views done.** Tower × floor grid (40 × 30 renders in ~20 ms vs the 500 ms budget), line of balance, look-ahead with browser print-to-PDF. They run on mock Site data until the Site integration exists. **Not built:** server-side Gantt PDF job, Site progress endpoint and events. |

**Phone view** (spec: "View and mobile modes") is built: read-only list-plus-bars of one tower or the look-ahead, pinch zoom, tap for details. It has not been tried on a physical phone yet; the touch tests run in Chromium's mobile emulation.

Also not built yet: screenshot comparison tests and performance-regression CI.

## Inputs needed from the team

1. **Real MS Project files** (MSPDI XML with calculated dates) for the golden corpus. The engine has **not** yet been checked to the minute against MS Project. That check is M2–M4's real exit criterion.
2. Windlass's standard site calendar and holiday list for each location.
3. Activity templates and construction order, for the tower × floor grid (the sample uses 7 illustrative trades).
4. The Site data contract (`SiteData` in [construction-views/src/model.ts](packages/construction-views/src/model.ts)) needs confirming with the Site app team: DPR reports, certifications, readiness, commitments, inspections, photos.
5. Sign-off on the `caniuse-lite` dev-only licence exception ([DECISIONS.md D-012](DECISIONS.md)).
