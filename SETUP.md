# Setup guide — running nm-gantt locally

This gets the planning app (Gantt, tower × floor grid, line of balance, look-ahead) running on your machine in about five minutes.

> **What "the server" is today.** There is no backend to start yet. `pnpm dev` runs a **Vite dev server** that serves the app. The app talks to an **in-browser mock Planning server** ([apps/demo/src/mockServer.ts](apps/demo/src/mockServer.ts)) that behaves like the real API: command batches, version checks, recalculation and baselines. Your edits are saved in your browser's `localStorage`. The real Planning service will live in the Projects backend (`re-projects`).

## 1. Prerequisites

| Tool | Version | Check | Install |
|---|---|---|---|
| Node.js | **22 or newer** | `node -v` | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| pnpm | **12.21.0** (pinned in `package.json`) | `pnpm -v` | `corepack enable` (ships with Node) |

With Corepack enabled, running `pnpm` in this folder automatically uses the pinned version. Answer "yes" if it asks to download it.

## 2. Install

```bash
cd nm-gantt
pnpm install
```

`esbuild` (used by Vite) needs its install script to run. That's already allowed in `pnpm-workspace.yaml` (`allowBuilds`), so no prompt should appear.

## 3. Start the app

```bash
pnpm dev
```

Open **http://localhost:3600**. Code changes reload instantly.

What you'll see:
- **Sample: 2 towers**: a 215-activity residential project with progress to 11 Jan 2027, a saved baseline, and mock Site data.
- Tabs: **Gantt · Tower × floor · Line of balance · Look-ahead**.
- The schedule dropdown also has two stress cases: **5,000 activities** (Gantt performance) and **tower 40 floors × 30 trades** (grid performance).
- **Import…** loads an Excel workbook (.xlsx) or an MS Project XML file. **Export…** saves either format, or a blank Excel template.
- The **Phone** tab previews the phone view. On a real phone (or a browser narrower than 700 px) it opens automatically.

Stop the server with `Ctrl+C`.

### Creating your own project

1. Click **+ New project** in the toolbar.
2. Enter a name and start date, then choose what to start with:
   - **Tower schedule**: pick the number of towers and floors. You get mobilisation, substructure, a linked floor-by-floor cycle of 7 trades, facade, lifts and handover for each tower. The construction views work immediately.
   - **Blank**: no activities. Add them with **+ Activity** (or the Insert key), then link them by dragging from one bar's end to another.
3. Your project appears under **Your projects** in the schedule dropdown and is kept between visits. **Import…** also creates a new project from an Excel or MS Project file. **Delete project** removes the one you're viewing.

Projects are stored in this browser only (`localStorage`) until the Planning service exists. Another browser or machine won't see them. Use **Export… → Excel** or **MS Project XML** to take a copy.

### Excel import and export

1. To start in Excel, choose **Export… → Blank Excel template**. Fill in the **Schedule** sheet; the **Instructions** sheet explains each column. Format the WBS column as Text so Excel doesn't turn 1.10 into 1.1.
2. Choose **Import…** and pick the .xlsx file. A preview lists what will be created, anything skipped or converted, and any errors. Nothing is saved until you click **Create project**.
3. **Export… → Excel (.xlsx)** writes the current project in the same layout, plus calculated Start, Finish, Total float and Critical columns. Importing that file again gives the same schedule.

Old `.xls` files aren't supported. Save them as Excel Workbook (.xlsx) first.

### On a phone

Open the app on a phone on the same network (see "Dev server reachable from other devices" below), or add `?view=phone` to the address on a computer.
- Pick **Next 2–6 weeks**, a tower, or the whole project.
- Tap an activity for its dates, float and links.
- Pinch, or use − / + / Fit, to zoom the bars. Swipe sideways to move in time.

Phones are view-only, as the spec requires.

### Towers, floors and trades (for the Tower × floor grid)

The Tower × floor grid, line of balance and phone tower view show an activity only once it has a **tower**, a **floor** and a **trade** (the repeating work type: columns, slab, blockwork…).
- **One activity at a time:** double-click it, then on the General tab pick a Tower, Floor and Trade. Choose **+ Add tower…** (or floor, or trade) to type a new one. It's added to the project when you save.
- **The whole list:** **Towers, floors & trades…** in the toolbar lets you add towers, add floors in a range ("from 1 to 12"), rename, put floors and trades in order, and remove entries no activity uses.
- **From Excel:** fill the Tower, Floor and optional **Trade** columns.

Projects made with **+ New project → Tower schedule** come with all three already set.

### Changing dates on the chart

- **Drag a bar** to move it. This sets a "start no earlier than" date, as MS Project does.
- **Drag either end** (grips appear on hover) to change the start or the finish. The tooltip shows the new dates and duration as you drag.
- **In-progress bars** keep their actual start. Drag the right end to change the remaining work.
- **Drag a summary bar** to move everything inside it that hasn't started.
- Completed activities are locked.
- You can also type dates in the grid's **Start** and **Finish** cells (double-click a cell).

### Other ways to run it

| Command | What it does | URL |
|---|---|---|
| `pnpm dev` | Development server with hot reload | http://localhost:3600 |
| `pnpm preview` | Production build, then serves it (closest to what users get) | http://localhost:3600 |
| `pnpm build` | Production build only, into `apps/demo/dist/` (static files; host on any web server) | — |
| `pnpm --filter @northmatter/gantt-demo exec vite --port 3600 --host` | Dev server reachable from other devices on your network (e.g. to try it on a phone or tablet) | http://\<your-ip\>:3600 |

## 4. Run the checks

```bash
pnpm test        # unit + property tests (engine, calendar, commands, io incl. Excel, views, phone)
pnpm typecheck   # TypeScript strict across all packages
pnpm run licenses # fails on any dependency outside MIT / Apache-2.0 / BSD / ISC
pnpm e2e         # browser tests (Playwright); builds and serves the app itself on port 3612
pnpm run ci       # all of the above, in that order
```

Before the first `pnpm e2e`, download the test browser once:

```bash
pnpm exec playwright install chromium
```

To save screenshots while the browser tests run, set `SHOT_DIR`:

```bash
SHOT_DIR=/tmp/shots pnpm e2e
```

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| `Port 3600 is in use` | Something else is on 3600, perhaps another `pnpm dev`. Stop it, or run `pnpm --filter @northmatter/gantt-demo exec vite --port 3601`. |
| `ERR_PNPM_IGNORED_BUILDS … esbuild` | You're on an older pnpm that ignores `allowBuilds`. Run `corepack enable`, then reinstall. Or run `pnpm approve-builds` and approve esbuild. |
| `Unsupported engine` / syntax errors on start | Node is older than 22. Run `nvm use 22` (or install Node 22+). |
| The sample looks wrong or old after code changes | Edits persist in `localStorage`. Click **Reset** in the toolbar, or run `localStorage.clear()` in the browser console and reload. |
| `pnpm e2e` says the browser is missing | Run `pnpm exec playwright install chromium`. |
| `pnpm e2e` fails with "port 3612 already used" | A previous test run is still serving. Run `pkill -f "vite preview --port 3612"`. |
| Hindi text shows boxes | Install a Devanagari font (e.g. Noto Sans Devanagari). macOS and Windows include one. |

## 6. Where things are

```
packages/calendar             working-time arithmetic
packages/schedule-engine      critical path engine
packages/schedule-commands    document model + edit commands (shared with the future server)
packages/schedule-io          MS Project XML import/export
packages/gantt                React Gantt chart
packages/construction-views   tower × floor grid, line of balance, look-ahead
apps/demo                     the app you run, mock Planning server, mock Site data, browser tests
```

Read next: [README.md](README.md) for what's built and what's pending, and [DECISIONS.md](DECISIONS.md) for how the spec was interpreted.
