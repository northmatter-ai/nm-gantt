# @northmatter-ai/gantt

React Gantt chart: a tree grid and an SVG timeline sharing one vertical scroll, virtualised with `@tanstack/react-virtual`.

**Props** follow the spec's component contract: `version`, `mode`, `columns`, `zoom`, `showBaselineId`, `filter`, `groupBy`, `onCommands`, `onSelect`, plus `showFloat`, `compact`, `locale` (`en`/`hi`), `today`, `userKey` and `createWorker`. A `ref` exposes `undo`, `redo`, `scrollToDate`, `addActivity`, `expandAll` and `collapseAll`.

**Interactions** (each becomes a command):

| Action | Result |
|---|---|
| Drag a bar | SNET constraint (a summary moves its not-started children) |
| Drag the left end | New start: SNET + duration |
| Drag the right end | Duration (remaining work if started) |
| Edit the Finish cell | Duration (remaining work if started) |
| Drag the progress handle | % complete |
| Drag from a bar end to another bar | Link (FS/SS/FF/SF from the ends) |
| Double-click | Editor |
| Edit a grid cell | Field update |
| Tab / Shift+Tab | Indent / outdent |
| Insert / Delete | Add / delete activity |
| Drag a row | Reorder |
| Click a link, then Delete | Remove link |
| Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z | Undo / redo (100 steps) |
| Ctrl/Cmd+wheel | Zoom around the pointer |
| Shift+wheel | Horizontal scroll |
| Right-click | Context menu |

Import `@northmatter-ai/gantt/gantt.css`. Theme it with CSS variables on `.nm-gantt`. Dark mode follows `prefers-color-scheme`, or set `data-theme="dark"|"light"` on `<html>`.

## Phone view

```tsx
import { PhoneSchedule } from '@northmatter-ai/gantt';
<PhoneSchedule version={{ doc, results, baselines }} initialScope={{ kind: 'lookahead', weeks: 3 }} showBaselineId="bl-1" locale="hi" />
```

This is a read-only list-plus-bars view for the Site app (spec: "View and mobile modes").

- **Scope:** the viewer picks a 2–6 week look-ahead, one tower, or the whole project.
- **Grouping:** rows are grouped by WBS parent (floors), or by week of start in the look-ahead.
- **Zoom:** all bars share one time window. Pinch to zoom, swipe sideways to move in time, or use the −/+/Fit buttons and Ctrl+wheel.
- **Details:** tap a row to open a details sheet with dates, float, variance against the baseline, and predecessors and successors you can tap through.
- **No editing.**

The list rules live in `buildPhoneList` (pure, unit-tested). See DECISIONS D-031.

## Undo history across remounts

The Gantt keeps undo/redo stacks of inverse command batches, 100 steps deep. If your app unmounts the Gantt (tabs, routes), keep the history yourself and pass it back:

```tsx
const history = useMemo(() => createUndoHistory(), [scheduleId]);
<Gantt history={history} … />
```
