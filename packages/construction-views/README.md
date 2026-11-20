# @northmatter-ai/construction-views

The three high-rise views from the spec. They read the same schedule version and results as the Gantt and use its time-scale utilities.

| Component | What it shows |
|---|---|
| `TowerFloorGrid` | One grid per tower: floors as rows (top floor at the top), activity templates as columns in construction order. Each cell is coloured **and** iconised by state: not started, in progress ▸, late vs baseline !, reported complete R (hatched), certified ✓ (solid). Clicking a cell opens dates, float, inspections and the latest DPR photos. |
| `LineOfBalance` | x = time, y = floor. One line per template joining its finish on each floor; plan solid (live schedule or any baseline), actual dashed (certified finishes). Hover shows floors/week planned vs actual. Crossing trades get a red **!** clash marker. Legend chips toggle trades, and there is a table view. |
| `LookAhead` | A rolling 2–6 week window (default 3) of activities due to start or in progress, grouped by tower and contractor. Shows Site readiness (drawings, material, labour, predecessor, inspection: ready / not ready with owner / n/a), this week's commitment and PPC per contractor. **Export PDF** prints the board alone with a title block. |

Site inputs come in as a `SiteData` object keyed by activity `stableKey`: reported, certified, readiness, contractors, commitments, inspections and photos. Predecessor readiness is derived from the schedule unless Site supplies it.

All derivations (`buildTowerGrid`, `buildLob`, `buildLookahead`, `cellState`) are pure functions in `model.ts`, so the server can reuse them for reports.

Import `@northmatter-ai/construction-views/views.css`. Colours follow a validated categorical palette in fixed order (never cycled; trades past the eighth are drawn neutral grey), with light and dark steps.
