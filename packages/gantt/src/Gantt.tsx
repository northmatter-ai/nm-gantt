/**
 * @nm/gantt — grid on the left, timeline on the right, one vertical scroll.
 * Holds no business rules: user actions become commands, previewed by the engine in a Web Worker,
 * then sent through onCommands; the server's result always wins.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { compileCalendars, dayToIso, ELAPSED, instantFromEpochMs, parseLocal, type CompiledCalendar, type Minutes } from '@nm/calendar';
import type { LinkType, ScheduleResult } from '@nm/schedule-engine';
import {
  applyCommands,
  childrenOf,
  cmd,
  formatDuration,
  formatPredecessor,
  keyAfter,
  keyBetween,
  newId,
  parseDuration,
  parsePredecessors,
  reaches,
  descendantsOf,
  type ActivityRecord,
  type Command,
  type LinkRecord,
  type ScheduleDoc,
} from '@nm/schedule-commands';
import { ActivityEditor, LinkEditor } from './ActivityEditor.js';
import { ContextMenu, Legend, type MenuItem } from './Chrome.js';
import { fmtDate, fmtFloat } from './format.js';
import { columnTitle, translator } from './i18n.js';
import { routeLink } from './links.js';
import { buildRows, buildTree, trace, type Row } from './rows.js';
import { makeScale, snapDay, ticks, ZOOMS } from './timescale.js';
import { DEFAULT_COLUMNS, type ColumnDef, type ColumnKey, type GanttProps, type Zoom } from './types.js';
import { usePreview } from './usePreview.js';

const HEADER_H = 48;
const EDITABLE: Partial<Record<ColumnKey, true>> = { name: true, code: true, duration: true, start: true, finish: true, predecessors: true, percent: true };

export interface GanttHandle {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  scrollToDate(t: Minutes): void;
  addActivity(): void;
  expandAll(): void;
  collapseAll(): void;
  /** Expand its ancestors, select it and scroll it into view. */
  focusActivity(id: string): void;
}

type Drag =
  | { kind: 'move'; ids: string[]; id: string; x0: number; dx: number; px: number; py: number }
  | { kind: 'resize'; ids: string[]; id: string; x0: number; dx: number; px: number; py: number }
  | { kind: 'resize-start'; ids: string[]; id: string; x0: number; dx: number; px: number; py: number }
  | { kind: 'progress'; ids: string[]; id: string; x0: number; dx: number; px: number; py: number }
  | { kind: 'link'; ids: string[]; id: string; x0: number; dx: number; px: number; py: number; fromEnd: 'start' | 'finish'; lx: number; ly: number; target?: { id: string; end: 'start' | 'finish'; valid: boolean; reason?: string } };

const isMilestone = (a: ActivityRecord) => a.type === 'start_milestone' || a.type === 'finish_milestone';

export const Gantt = forwardRef<GanttHandle, GanttProps>(function Gantt(props, ref) {
  const {
    version, mode = 'edit', columns: columnsProp, zoom: zoomProp, onZoomChange, showBaselineId, showFloat = false,
    filter, groupBy = 'wbs', onCommands, onSelect, compact = false, locale = 'en', today: todayProp, userKey = 'default',
    createWorker, height = '100%',
  } = props;
  const t = useMemo(() => translator(locale), [locale]);
  const print = mode === 'print';
  const editable = mode === 'edit' && !!onCommands && version.doc.kind !== 'baseline';

  // ---------------------------------------------------------------- document state
  const [doc, setDocState] = useState<ScheduleDoc>(version.doc);
  const [results, setResults] = useState<ScheduleResult | undefined>(version.results);
  const docRef = useRef(doc);
  const setDoc = (d: ScheduleDoc) => { docRef.current = d; setDocState(d); };
  const pending = useRef(0);
  const latestVersion = useRef(version);
  latestVersion.current = version;
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'error' | 'info'; text?: string }>({ kind: 'idle' });

  useEffect(() => {
    if (pending.current === 0) { setDoc(version.doc); setResults(version.results); }
  }, [version.doc, version.results]);

  const preview = usePreview(createWorker, (r, d) => { if (d === docRef.current) setResults(r); });
  const history = useRef<{ undo: Command[][]; redo: Command[][] }>({ undo: [], redo: [] });
  const [, bump] = useState(0);

  const run = useCallback(async (cmds: Command[], record: 'do' | 'undo' | 'redo' = 'do'): Promise<boolean> => {
    if (!editable || !onCommands || cmds.length === 0) return false;
    let applied;
    try {
      applied = applyCommands(docRef.current, cmds);
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
      return false;
    }
    const h = history.current;
    if (record === 'do') { h.undo.push(applied.inverse); if (h.undo.length > 100) h.undo.shift(); h.redo = []; }
    else if (record === 'undo') h.redo.push(applied.inverse);
    else h.undo.push(applied.inverse);
    bump((n) => n + 1);
    setDoc(applied.doc);
    preview(applied.doc);
    pending.current++;
    setStatus({ kind: 'saving', text: t('saving') });
    try {
      const res = await onCommands(cmds);
      pending.current--;
      if (!res.ok) {
        setStatus({ kind: 'error', text: res.error });
        if (pending.current === 0) {
          setDoc(latestVersion.current.doc);
          setResults(latestVersion.current.results);
          history.current = { undo: [], redo: [] };
        }
        return false;
      }
      if (pending.current === 0) { setDoc(res.doc); setResults(res.results); setStatus({ kind: 'idle' }); }
      return true;
    } catch (e) {
      pending.current--;
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
      if (pending.current === 0) { setDoc(latestVersion.current.doc); setResults(latestVersion.current.results); }
      return false;
    }
  }, [editable, onCommands, preview, t]);

  const fresh = (cmds: Command[]) => cmds.map((c) => ({ ...c, id: newId('cmd') }) as Command);
  const undo = useCallback(() => { const c = history.current.undo.pop(); if (c) void run(fresh(c), 'undo'); }, [run]);
  const redo = useCallback(() => { const c = history.current.redo.pop(); if (c) void run(fresh(c), 'redo'); }, [run]);

  // ---------------------------------------------------------------- calendars, tree, rows
  const cals = useMemo(() => { try { return compileCalendars(doc.calendars); } catch { return new Map<string, CompiledCalendar>(); } }, [doc.calendars]);
  const defaultCal = cals.get(doc.defaultCalendarId) ?? ELAPSED;
  const tz = defaultCal.timeZone;
  const calOf = useCallback((a: ActivityRecord) => (a.calendarId ? cals.get(a.calendarId) : undefined) ?? defaultCal, [cals, defaultCal]);
  const tree = useMemo(() => buildTree(doc), [doc]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => buildRows(doc, tree, results, collapsed, filter, groupBy), [doc, tree, results, collapsed, filter, groupBy]);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);
  const rowH = compact ? 24 : 32;
  const bh = compact ? 12 : 16;
  const baseline = showBaselineId ? version.baselines?.find((b) => b.id === showBaselineId) : undefined;
  const today = todayProp ?? instantFromEpochMs(Date.now());

  // ---------------------------------------------------------------- columns and splitter
  const [columns, setColumns] = useState<ColumnDef[]>(columnsProp ?? DEFAULT_COLUMNS);
  useEffect(() => { if (columnsProp) setColumns(columnsProp); }, [columnsProp]);
  const gridWidth = columns.reduce((s, c) => s + c.width, 0);
  const splitKey = `nm-gantt-split:${userKey}`;
  const [split, setSplit] = useState<number>(() => {
    try { const v = Number(localStorage.getItem(splitKey)); return v > 120 ? v : Math.min(gridWidth, 640); } catch { return Math.min(gridWidth, 640); }
  });

  // ---------------------------------------------------------------- zoom and time scale
  const [zoomState, setZoomState] = useState<Zoom>(zoomProp ?? 'week');
  const zoom = zoomProp ?? zoomState;
  const setZoom = useCallback((z: Zoom) => { setZoomState(z); onZoomChange?.(z); }, [onZoomChange]);

  const rangeRef = useRef<{ start: Minutes; end: Minutes } | null>(null);
  const range = useMemo(() => {
    let lo = Math.min(doc.projectStart, doc.dataDate), hi = Math.max(doc.projectStart, doc.dataDate);
    for (const r of Object.values(results?.activities ?? {})) { if (r.es < lo) lo = r.es; if (r.ef > hi) hi = r.ef; if (r.lf > hi) hi = r.lf; }
    for (const b of Object.values(baseline?.byStableKey ?? {})) { if (b.es < lo) lo = b.es; if (b.ef > hi) hi = b.ef; }
    lo = defaultCal.dayStart(defaultCal.dayOf(lo) - 14);
    hi = defaultCal.dayStart(defaultCal.dayOf(hi) + 60);
    const prev = rangeRef.current;
    return prev ? { start: Math.min(prev.start, lo), end: Math.max(prev.end, hi) } : { start: lo, end: hi };
  }, [results, baseline, doc.projectStart, doc.dataDate, defaultCal]);
  useEffect(() => { rangeRef.current = range; }, [range]);
  const scale = useMemo(() => makeScale(range.start, range.end, zoom), [range, zoom]);

  // ---------------------------------------------------------------- scrolling
  const gridRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollX] = useState(0);
  const [viewW, setViewW] = useState(800);
  const [sbH, setSbH] = useState(0);
  const syncing = useRef(false);
  const rafRef = useRef(0);

  const onTlScroll = () => {
    const tl = tlRef.current, g = gridRef.current;
    if (!tl) return;
    if (g && !syncing.current && g.scrollTop !== tl.scrollTop) { syncing.current = true; g.scrollTop = tl.scrollTop; }
    else syncing.current = false;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setScrollX(tl.scrollLeft));
  };
  const onGridScroll = () => {
    const tl = tlRef.current, g = gridRef.current;
    if (!tl || !g) return;
    if (!syncing.current && tl.scrollTop !== g.scrollTop) { syncing.current = true; tl.scrollTop = g.scrollTop; }
    else syncing.current = false;
  };

  useLayoutEffect(() => {
    const tl = tlRef.current;
    if (!tl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { setViewW(tl.clientWidth); setSbH(tl.offsetHeight - tl.clientHeight); });
    ro.observe(tl);
    return () => ro.disconnect();
  }, []);

  // Keep the date under the anchor (pointer or centre) fixed when the scale changes.
  const prevScale = useRef(scale);
  const zoomAnchor = useRef<number | null>(null);
  const didInitialScroll = useRef(false);
  useLayoutEffect(() => {
    const tl = tlRef.current;
    const prev = prevScale.current;
    prevScale.current = scale;
    if (!tl) return;
    if (!didInitialScroll.current) {
      didInitialScroll.current = true;
      // Open at the data date: that is where the planner's attention is.
      tl.scrollLeft = Math.max(0, scale.x(doc.dataDate) - tl.clientWidth / 3);
      setScrollX(tl.scrollLeft);
      return;
    }
    if (prev === scale || (prev.ppm === scale.ppm && prev.viewStart === scale.viewStart)) return;
    const anchor = zoomAnchor.current ?? tl.clientWidth / 2;
    zoomAnchor.current = null;
    const at = prev.t(tl.scrollLeft + anchor);
    tl.scrollLeft = Math.max(0, scale.x(at) - anchor);
    setScrollX(tl.scrollLeft);
  }, [scale, doc.projectStart, doc.dataDate]);

  const onWheel = useCallback((e: WheelEvent) => {
    const tl = tlRef.current;
    if (!tl) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const i = ZOOMS.indexOf(zoom);
      const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + (e.deltaY > 0 ? 1 : -1)))]!;
      if (next !== zoom) {
        zoomAnchor.current = e.clientX - tl.getBoundingClientRect().left;
        setZoom(next);
      }
    } else if (e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
      e.preventDefault();
      tl.scrollLeft += e.deltaY;
    }
  }, [zoom, setZoom]);
  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    tl.addEventListener('wheel', onWheel, { passive: false });
    return () => tl.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tlRef.current,
    estimateSize: () => rowH,
    overscan: 12,
    scrollMargin: HEADER_H,
  });
  useEffect(() => { virt.measure(); }, [rowH, virt]);
  const items = print
    ? rows.map((_, i) => ({ index: i, start: HEADER_H + i * rowH, key: i }))
    : virt.getVirtualItems().map((v) => ({ index: v.index, start: v.start, key: v.key }));
  const totalH = rows.length * rowH;

  // ---------------------------------------------------------------- selection, focus, editing
  const [selected, setSelected] = useState<string[]>([]);
  const anchorRow = useRef<string | null>(null);
  const [focusCell, setFocusCell] = useState<{ row: number; col: number }>({ row: 0, col: 1 });
  const [editing, setEditing] = useState<{ id: string; col: ColumnKey; value: string } | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [traced, setTraced] = useState<ReturnType<typeof trace> | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [linkEditorId, setLinkEditorId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id?: string; linkId?: string } | null>(null);
  const [dropLine, setDropLine] = useState<{ index: number; pos: 'above' | 'below' } | null>(null);

  useEffect(() => { onSelect?.(selected); }, [selected, onSelect]);

  const select = (id: string, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    setSelectedLink(null);
    if (e?.shiftKey && anchorRow.current) {
      const a = rowIndex.get(anchorRow.current), b = rowIndex.get(id);
      if (a !== undefined && b !== undefined) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(rows.slice(lo, hi + 1).filter((r) => r.kind === 'activity').map((r) => r.key));
        return;
      }
    }
    if (e?.ctrlKey || e?.metaKey) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    } else setSelected([id]);
    anchorRow.current = id;
  };

  const linksTo = useMemo(() => {
    const m = new Map<string, LinkRecord[]>();
    for (const l of doc.links) { const list = m.get(l.to); if (list) list.push(l); else m.set(l.to, [l]); }
    return m;
  }, [doc.links]);
  const linksByEnd = useMemo(() => {
    const m = new Map<string, LinkRecord[]>();
    for (const l of doc.links) for (const k of [l.from, l.to]) { const list = m.get(k); if (list) list.push(l); else m.set(k, [l]); }
    return m;
  }, [doc.links]);

  const readOnlyReason = (a: ActivityRecord | undefined): string | null => {
    if (!editable) return t('readOnlyView');
    if (a?.actualFinish !== undefined) return t('readOnlyComplete');
    return null;
  };

  // ---------------------------------------------------------------- edit actions
  const uniqueCode = () => {
    const codes = new Set(doc.activities.map((a) => a.code));
    let n = doc.activities.length + 1;
    while (codes.has(`NEW-${n}`)) n++;
    return `NEW-${n}`;
  };

  const addBelow = useCallback((afterId?: string) => {
    const after = afterId ? tree.byId.get(afterId) : undefined;
    const parentId = after?.parentId ?? null;
    const id = newId('act');
    const activity: ActivityRecord = {
      id, stableKey: id, code: uniqueCode(), name: t('newActivity'),
      sortKey: after ? keyAfter(doc, parentId, after.id) : keyBetween(childrenOf(doc, null).at(-1)?.sortKey ?? null, null),
      type: 'task', duration: defaultCal.hoursPerDay, constraint: 'ASAP',
      ...(parentId ? { parentId } : {}),
      ...(after?.towerId ? { towerId: after.towerId } : {}),
      ...(after?.floorId ? { floorId: after.floorId } : {}),
    };
    void run([cmd({ kind: 'addActivity', activity })]).then((ok) => { if (ok) { setSelected([id]); setEditing({ id, col: 'name', value: activity.name }); } });
  }, [tree, doc, defaultCal, run, t]);

  const deleteIds = useCallback((ids: string[]) => {
    const acts = ids.map((id) => tree.byId.get(id)).filter((a): a is ActivityRecord => !!a);
    if (!acts.length) return;
    const all = new Set(acts.flatMap((a) => [a.id, ...descendantsOf(doc, a.id).map((d) => d.id)]));
    const n = doc.links.filter((l) => all.has(l.from) || all.has(l.to)).length;
    if (n > 0 && typeof window !== 'undefined' && !window.confirm(t('confirmDeleteLinks', { n }))) return;
    // Delete only top-most selected (children go with their parents).
    const top = acts.filter((a) => !acts.some((p) => p.id !== a.id && descendantsOf(doc, p.id).some((d) => d.id === a.id)));
    void run(top.map((a) => cmd({ kind: 'deleteActivity', activityId: a.id })));
    setSelected([]);
  }, [tree, doc, run, t]);

  const indent = (ids: string[], out: boolean) => {
    const ordered = [...ids].sort((a, b) => (rowIndex.get(a) ?? 0) - (rowIndex.get(b) ?? 0));
    void run((out ? ordered.reverse() : ordered).map((id) => cmd({ kind: out ? 'outdent' : 'indent', activityId: id })));
  };

  const resolveRef = (ref: string): ActivityRecord | undefined => {
    const byCode = doc.activities.find((a) => a.code === ref);
    if (byCode) return byCode;
    for (const [id, w] of tree.wbs) if (w === ref) return tree.byId.get(id);
    const n = Number(ref);
    if (Number.isInteger(n) && n >= 1 && n <= tree.order.length) return tree.byId.get(tree.order[n - 1]!);
    return undefined;
  };

  const commitEdit = (value: string) => {
    if (!editing) return;
    const a = tree.byId.get(editing.id);
    setEditing(null);
    if (!a) return;
    const cal = calOf(a);
    const fail = (text: string) => setStatus({ kind: 'error', text });
    switch (editing.col) {
      case 'name': if (value !== a.name) void run([cmd({ kind: 'updateActivity', activityId: a.id, patch: { name: value } })]); break;
      case 'code': if (value && value !== a.code) void run([cmd({ kind: 'updateActivity', activityId: a.id, patch: { code: value } })]); break;
      case 'duration': {
        const d = parseDuration(value, cal.hoursPerDay);
        if (d === null || d < 0) return fail(`${t('duration')}: "${value}"`);
        if (d !== a.duration) void run([cmd({ kind: 'updateActivity', activityId: a.id, patch: { duration: d } })]);
        break;
      }
      case 'start': {
        if (!value) return;
        let s: Minutes;
        try { s = cal.nextWorkStart(parseLocal(tz, value)); } catch { return fail(`${t('col_start')}: "${value}"`); }
        if (s !== results?.activities[a.id]?.es) void run([cmd({ kind: 'setConstraint', activityId: a.id, constraint: 'SNET', constraintDate: s })]);
        break;
      }
      case 'finish': {
        if (!value) return;
        const r = results?.activities[a.id];
        if (!r || a.type === 'summary' || isMilestone(a)) return;
        let end: Minutes;
        try { end = cal.prevWorkEnd(parseLocal(tz, value) + 1440); } catch { return fail(`${t('col_finish')}: "${value}"`); }
        const from = r.remainingStart ?? r.es;
        if (end <= from) return fail(`${t('col_finish')}: ${t('finishBeforeStart')}`);
        const work = cal.workBetween(from, end);
        if (a.actualStart !== undefined) void run([cmd({ kind: 'setProgress', activityId: a.id, progress: { remaining: work } })]);
        else if (work !== a.duration) void run([cmd({ kind: 'updateActivity', activityId: a.id, patch: { duration: work } })]);
        break;
      }
      case 'percent': {
        const p = Number(value.replace('%', ''));
        if (!Number.isFinite(p) || p < 0 || p > 100) return fail(`${t('percentComplete')}: 0–100`);
        if (a.actualStart === undefined) return fail(t('percentComplete') + ': ' + t('actualStart') + '?');
        void run([cmd({ kind: 'setProgress', activityId: a.id, progress: { percentComplete: Math.round(p * 100) } })]);
        break;
      }
      case 'predecessors': {
        const parsed = parsePredecessors(value, cal.hoursPerDay);
        if ('error' in parsed) return fail(parsed.error);
        const wanted: { from: string; type: LinkType; lag: Minutes }[] = [];
        for (const p of parsed) {
          const from = resolveRef(p.ref);
          if (!from) return fail(`${t('predecessors')}: "${p.ref}"?`);
          wanted.push({ from: from.id, type: p.type, lag: p.lag });
        }
        const existing = linksTo.get(a.id) ?? [];
        const cmds: Command[] = [];
        for (const l of existing) {
          const w = wanted.find((x) => x.from === l.from);
          if (!w) cmds.push(cmd({ kind: 'deleteLink', linkId: l.id }));
          else if (w.type !== l.type || w.lag !== l.lag) cmds.push(cmd({ kind: 'updateLink', linkId: l.id, patch: { type: w.type, lag: w.lag } }));
        }
        for (const w of wanted) {
          if (!existing.some((l) => l.from === w.from)) cmds.push(cmd({ kind: 'addLink', link: { id: newId('lnk'), from: w.from, to: a.id, type: w.type, lag: w.lag } }));
        }
        void run(cmds);
        break;
      }
      default: break;
    }
  };

  // ---------------------------------------------------------------- imperative handle
  useImperativeHandle(ref, () => ({
    undo, redo,
    canUndo: () => history.current.undo.length > 0,
    canRedo: () => history.current.redo.length > 0,
    scrollToDate: (at: Minutes) => { const tl = tlRef.current; if (tl) tl.scrollLeft = Math.max(0, scale.x(at) - tl.clientWidth / 3); },
    addActivity: () => addBelow(selected[selected.length - 1]),
    expandAll: () => setCollapsed(new Set()),
    focusActivity: (id: string) => {
      const ancestors = new Set<string>();
      let cur = tree.byId.get(id);
      while (cur?.parentId) { ancestors.add(cur.parentId); cur = tree.byId.get(cur.parentId); }
      setCollapsed((c) => new Set([...c].filter((k) => !ancestors.has(k))));
      setSelected([id]);
      setPendingFocus(id);
    },
    collapseAll: () => setCollapsed(new Set([...doc.activities.filter((a) => a.type === 'summary').map((a) => a.id), ...rows.filter((r) => r.kind === 'group').map((r) => r.key)])),
  }), [undo, redo, scale, addBelow, selected, doc.activities, rows, tree]);

  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingFocus) return;
    const i = rowIndex.get(pendingFocus);
    if (i === undefined) return;
    setPendingFocus(null);
    setFocusCell((f) => ({ ...f, row: i }));
    virt.scrollToIndex(i, { align: 'center' });
    const r = results?.activities[pendingFocus];
    const tl = tlRef.current;
    if (r && tl) tl.scrollLeft = Math.max(0, scale.x(r.es) - tl.clientWidth / 3);
  }, [pendingFocus, rowIndex, results, scale, virt]);

  // ---------------------------------------------------------------- keyboard (ARIA treegrid)
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    const row = rows[focusCell.row];
    const id = row?.kind === 'activity' ? row.key : undefined;
    const targets = selected.length ? selected : id ? [id] : [];
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const next = Math.max(0, Math.min(rows.length - 1, focusCell.row + (e.key === 'ArrowDown' ? 1 : -1)));
        setFocusCell({ ...focusCell, row: next });
        const r = rows[next];
        if (r?.kind === 'activity') select(r.key, { shiftKey: e.shiftKey });
        virt.scrollToIndex(next);
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const nameCol = columns.findIndex((c) => c.key === 'name');
        if (row && row.hasChildren && focusCell.col === nameCol) {
          const isOpen = !collapsed.has(row.key);
          if (e.key === 'ArrowLeft' && isOpen) { toggle(row.key); return; }
          if (e.key === 'ArrowRight' && !isOpen) { toggle(row.key); return; }
        }
        setFocusCell({ ...focusCell, col: Math.max(0, Math.min(columns.length - 1, focusCell.col + (e.key === 'ArrowRight' ? 1 : -1))) });
        return;
      }
      case 'Enter':
      case 'F2': {
        const col = columns[focusCell.col];
        if (e.key === 'Enter' && e.shiftKey && id) { setEditorId(id); return; }
        if (id && col && EDITABLE[col.key] && editable) {
          e.preventDefault();
          const a = tree.byId.get(id)!;
          setEditing({ id, col: col.key, value: editValue(col.key, a) });
        } else if (id) setEditorId(id);
        return;
      }
      case 'Tab':
        if (!editable || !targets.length) return;
        e.preventDefault();
        indent(targets, e.shiftKey);
        return;
      case 'Insert':
        if (!editable) return;
        e.preventDefault();
        addBelow(id);
        return;
      case 'Delete':
      case 'Backspace':
        if (!editable) return;
        e.preventDefault();
        if (selectedLink) { void run([cmd({ kind: 'deleteLink', linkId: selectedLink })]); setSelectedLink(null); }
        else deleteIds(targets);
        return;
      case 'Escape':
        setTraced(null); setSelectedLink(null);
        return;
      default:
    }
  };

  const toggle = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  // ---------------------------------------------------------------- cell text
  const editValue = (col: ColumnKey, a: ActivityRecord): string => {
    const cal = calOf(a);
    switch (col) {
      case 'name': return a.name;
      case 'code': return a.code;
      case 'duration': return formatDuration(a.duration, cal.hoursPerDay);
      case 'start': { const r = results?.activities[a.id]; return r ? fmtInputDate(r.es) : ''; }
      case 'finish': { const r = results?.activities[a.id]; return r ? fmtInputDate(r.ef - 1) : ''; }
      case 'percent': return a.percentComplete !== undefined ? String(a.percentComplete / 100) : '';
      case 'predecessors': return predText(a);
      default: return '';
    }
  };
  const fmtInputDate = (at: Minutes) => dayToIso(defaultCal.dayOf(at));
  const predText = (a: ActivityRecord) => (linksTo.get(a.id) ?? [])
    .map((l) => { const p = tree.byId.get(l.from); return p ? formatPredecessor(p.code, l.type, l.lag, calOf(a).hoursPerDay) : ''; })
    .filter(Boolean).join('; ');

  const cellText = (col: ColumnKey, row: Row): string => {
    if (row.kind === 'group') return col === 'name' ? row.label ?? '' : '';
    const a = row.activity!, r = row.result, cal = calOf(a);
    switch (col) {
      case 'wbs': return row.wbs;
      case 'code': return a.code;
      case 'name': return a.name;
      case 'duration':
        if (a.type === 'summary' || a.type === 'level_of_effort') return r ? formatDuration(defaultCal.workBetween(r.es, r.ef), defaultCal.hoursPerDay) : '';
        return isMilestone(a) ? '0d' : formatDuration(a.duration, cal.hoursPerDay);
      case 'start': return fmtDate(tz, r?.es);
      case 'finish': return fmtDate(tz, r?.ef);
      case 'totalFloat': return r ? fmtFloat(r.totalFloat, cal.hoursPerDay) : '';
      case 'freeFloat': return r ? fmtFloat(r.freeFloat, cal.hoursPerDay) : '';
      case 'predecessors': return predText(a);
      case 'percent': return a.percentComplete !== undefined ? `${a.percentComplete / 100}%` : r?.status === 'complete' ? '100%' : '';
      case 'constraint': return a.constraint === 'ASAP' ? '' : `${a.constraint}${a.constraintDate !== undefined ? ` ${fmtDate(tz, a.constraintDate)}` : ''}`;
      case 'calendar': return a.calendarId ? doc.calendars.find((c) => c.id === a.calendarId)?.name ?? a.calendarId : '';
      case 'tower': return a.towerId ? doc.towers?.[a.towerId] ?? a.towerId : '';
      case 'floor': return a.floorId ? doc.floors?.[a.floorId] ?? a.floorId : '';
      case 'status': return r ? t(r.status) : '';
    }
  };

  // ---------------------------------------------------------------- dragging on the timeline
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const beginDrag = (e: ReactPointerEvent, kind: Drag['kind'], id: string, extra: Partial<Drag> = {}) => {
    if (e.button !== 0) return;
    const a = tree.byId.get(id);
    e.stopPropagation();
    if (!editable || !a) { select(id, e); return; }
    if (kind !== 'link' && readOnlyReason(a)) { select(id, e); setStatus({ kind: 'info', text: readOnlyReason(a)! }); return; }
    if ((kind === 'move' || kind === 'resize-start') && a.type !== 'summary' && a.actualStart !== undefined) {
      select(id, e); setStatus({ kind: 'info', text: t('startedFixed') }); return;
    }
    e.preventDefault();
    const movable = (x: ActivityRecord | undefined) => !!x && x.type !== 'summary' && x.type !== 'level_of_effort' && x.actualStart === undefined;
    let ids: string[] = [id];
    if (kind === 'move' && a.type === 'summary') {
      const desc = descendantsOf(doc, id);
      ids = desc.filter(movable).map((x) => x.id);
      if (!ids.length) { select(id, e); setStatus({ kind: 'info', text: t(desc.length ? 'nothingToMove' : 'emptySummary') }); return; }
    } else if (kind === 'move' && selected.includes(id)) {
      ids = selected.flatMap((s) => { const x = tree.byId.get(s); return x?.type === 'summary' ? descendantsOf(doc, s).filter(movable).map((c) => c.id) : movable(x) ? [s] : []; });
      if (!ids.includes(id) && movable(a)) ids.push(id);
    }
    const d = { kind, ids, id, x0: e.clientX, dx: 0, px: e.clientX, py: e.clientY, ...extra } as Drag;
    dragRef.current = d;
    setDrag(d);
  };

  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, dx: e.clientX - d.x0, px: e.clientX, py: e.clientY } as Drag;
      if (next.kind === 'link' && svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        next.lx = e.clientX - rect.left;
        next.ly = e.clientY - rect.top;
        const r = rows[Math.floor(next.ly / rowH)];
        const ta = r?.kind === 'activity' ? r.activity : undefined;
        const tr = r?.result;
        if (ta && tr) {
          const mid = (scale.x(tr.es) + scale.x(tr.ef)) / 2;
          const end = next.lx < mid ? 'start' : 'finish';
          let reason: string | undefined;
          if (ta.id === next.id) reason = 'self';
          else if (ta.type === 'summary') reason = 'summary';
          else if (doc.links.some((l) => l.from === next.id && l.to === ta.id)) reason = 'duplicate';
          else if (reaches(doc, ta.id, next.id)) reason = 'cycle';
          next.target = { id: ta.id, end, valid: !reason, ...(reason ? { reason } : {}) };
        } else delete next.target;
      }
      dragRef.current = next;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setDrag(next));
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      cancelAnimationFrame(raf);
      setDrag(null);
      if (!d) return;
      if (Math.abs(d.dx) < 3 && d.kind !== 'link') { select(d.id, e); return; }
      const cmds = dragCommands(d);
      if (cmds.length) void run(cmds);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  /** New start/finish while dragging (for the tooltip and the command). */
  const dragPreview = (d: Drag, id: string): { start: Minutes; finish: Minutes; pct?: number; work?: Minutes } | null => {
    const a = tree.byId.get(id), r = results?.activities[id];
    if (!a || !r) return null;
    const cal = calOf(a);
    const dt = Math.round(d.dx / scale.ppm);
    if (d.kind === 'move') {
      // Everything moves by the same snapped delta, measured on the bar under the pointer.
      const anchor = results?.activities[d.id] ?? r;
      const delta = snapDay(anchor.es + dt, zoom, tz) - anchor.es;
      if (a.type === 'summary') return { start: r.es + delta, finish: r.ef + delta };
      const s = cal.nextWorkStart(r.es + delta);
      return { start: s, finish: isMilestone(a) ? s : cal.finishFrom(s, a.duration), work: a.duration };
    }
    if (d.kind === 'resize') {
      const from = r.remainingStart ?? r.es;
      const end = cal.prevWorkEnd(snapDay(r.ef + dt, zoom, tz));
      const work = Math.max(0, cal.workBetween(from, end));
      return { start: r.es, finish: work === 0 ? from : cal.finishFrom(from, work), work };
    }
    if (d.kind === 'resize-start') {
      const s = Math.min(cal.nextWorkStart(snapDay(r.es + dt, zoom, tz)), r.ef);
      return { start: s, finish: r.ef, work: Math.max(0, cal.workBetween(s, r.ef)) };
    }
    if (d.kind === 'progress') {
      const w = scale.x(r.ef) - scale.x(r.es);
      const cur = ((a.percentComplete ?? 0) / 10000) * w;
      const pct = Math.round(Math.max(0, Math.min(1, (cur + d.dx) / Math.max(1, w))) * 100);
      return { start: r.es, finish: r.ef, pct };
    }
    return null;
  };

  const dragCommands = (d: Drag): Command[] => {
    if (d.kind === 'link') {
      if (!d.target?.valid) return [];
      const type = `${d.fromEnd === 'finish' ? 'F' : 'S'}${d.target.end === 'start' ? 'S' : 'F'}` as LinkType;
      return [cmd({ kind: 'addLink', link: { id: newId('lnk'), from: d.id, to: d.target.id, type, lag: 0 } })];
    }
    const out: Command[] = [];
    for (const id of d.ids) {
      const a = tree.byId.get(id), r = results?.activities[id];
      const p = dragPreview(d, id);
      if (!a || !r || !p) continue;
      if (d.kind === 'move' && p.start !== r.es) out.push(cmd({ kind: 'setConstraint', activityId: id, constraint: 'SNET', constraintDate: p.start }));
      if (d.kind === 'resize' && p.work !== undefined) {
        if (a.actualStart !== undefined) {
          if (p.work !== (r.remaining ?? a.remaining)) out.push(cmd({ kind: 'setProgress', activityId: id, progress: { remaining: p.work } }));
        } else if (p.work !== a.duration) out.push(cmd({ kind: 'updateActivity', activityId: id, patch: { duration: p.work } }));
      }
      if (d.kind === 'resize-start' && p.work !== undefined && p.start !== r.es) {
        out.push(cmd({ kind: 'setConstraint', activityId: id, constraint: 'SNET', constraintDate: p.start }));
        if (p.work !== a.duration) out.push(cmd({ kind: 'updateActivity', activityId: id, patch: { duration: p.work } }));
      }
      if (d.kind === 'progress' && p.pct !== undefined && p.pct * 100 !== (a.percentComplete ?? 0)) {
        out.push(cmd({ kind: 'setProgress', activityId: id, progress: { percentComplete: p.pct * 100 } }));
      }
    }
    return out;
  };

  // ---------------------------------------------------------------- context menu
  const openMenu = (e: ReactMouseEvent, id?: string, linkId?: string) => {
    e.preventDefault();
    if (id && !selected.includes(id)) select(id);
    if (linkId) setSelectedLink(linkId);
    setMenu({ x: e.clientX, y: e.clientY, ...(id ? { id } : {}), ...(linkId ? { linkId } : {}) });
  };
  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    if (menu.linkId) {
      const linkId = menu.linkId;
      return [
        { label: t('editLink'), onSelect: () => setLinkEditorId(linkId) },
        { label: t('deleteLink'), onSelect: () => void run([cmd({ kind: 'deleteLink', linkId })]), disabled: !editable, danger: true },
      ];
    }
    const id = menu.id;
    const targets = selected.length ? selected : id ? [id] : [];
    return [
      { label: t('edit'), onSelect: () => id && setEditorId(id), disabled: !id },
      { label: t('insertBelow'), onSelect: () => addBelow(id), disabled: !editable },
      { label: t('indent'), onSelect: () => indent(targets, false), disabled: !editable || !id },
      { label: t('outdent'), onSelect: () => indent(targets, true), disabled: !editable || !id },
      { label: t('traceBack'), onSelect: () => id && setTraced(trace(doc, results, id, 'back')), disabled: !id },
      { label: t('traceForward'), onSelect: () => id && setTraced(trace(doc, results, id, 'forward')), disabled: !id },
      ...(traced ? [{ label: t('clearTrace'), onSelect: () => setTraced(null) }] : []),
      { label: t('delete'), onSelect: () => deleteIds(targets), disabled: !editable || !id, danger: true },
    ];
  };

  // ---------------------------------------------------------------- row drag in the grid (moveActivity)
  const rowDrag = useRef<string | null>(null);
  const onRowDragOver = (e: React.DragEvent, index: number) => {
    if (!rowDrag.current) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropLine({ index, pos: e.clientY - rect.top < rect.height / 2 ? 'above' : 'below' });
  };
  const onRowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const id = rowDrag.current;
    rowDrag.current = null;
    const dl = dropLine;
    setDropLine(null);
    if (!id || !dl) return;
    const target = rows[dl.index];
    if (!target || target.kind !== 'activity' || target.key === id) return;
    const ta = target.activity!;
    if (descendantsOf(doc, id).some((d) => d.id === ta.id)) return;
    const parentId = ta.parentId ?? null;
    const sibs = childrenOf(doc, parentId).filter((s) => s.id !== id);
    const i = sibs.findIndex((s) => s.id === ta.id);
    const sortKey = dl.pos === 'above'
      ? keyBetween(sibs[i - 1]?.sortKey ?? null, ta.sortKey)
      : keyBetween(ta.sortKey, sibs[i + 1]?.sortKey ?? null);
    void run([cmd({ kind: 'moveActivity', activityId: id, parentId, sortKey })]);
  };

  // ---------------------------------------------------------------- render helpers
  const visFrom = scale.t(Math.max(0, scrollX - viewW));
  const visTo = scale.t(scrollX + 2 * viewW);
  const header = useMemo(() => ticks(scale, zoom, tz, visFrom, visTo, locale), [scale, zoom, tz, visFrom, visTo, locale]);

  const nonWorking = useMemo(() => {
    if (zoom !== 'day' && zoom !== 'week') return [];
    const out: { x: number; w: number; key: number }[] = [];
    const d0 = defaultCal.dayOf(visFrom), d1 = defaultCal.dayOf(visTo);
    for (let d = d0; d <= d1; d++) {
      if (defaultCal.workOnDay(d) === 0) {
        const x = scale.x(defaultCal.dayStart(d));
        out.push({ x, w: scale.x(defaultCal.dayStart(d + 1)) - x, key: d });
      }
    }
    return out;
  }, [zoom, defaultCal, visFrom, visTo, scale]);

  const renderedIds = new Set(items.map((it) => rows[it.index]?.key).filter(Boolean) as string[]);
  const visibleLinks = useMemo(() => {
    const seen = new Set<string>();
    const out: LinkRecord[] = [];
    for (const id of renderedIds) for (const l of linksByEnd.get(id) ?? []) {
      if (seen.has(l.id) || !rowIndex.has(l.from) || !rowIndex.has(l.to)) continue;
      seen.add(l.id);
      out.push(l);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...renderedIds].join('|'), linksByEnd, rowIndex]);

  const barLabel = (a: ActivityRecord, r: ScheduleResult['activities'][string]) =>
    `${a.code} ${a.name}, ${t('col_start')} ${fmtDate(tz, r.es, true)}, ${t('col_finish')} ${fmtDate(tz, r.ef, true)}, ${t('totalFloat')} ${fmtFloat(r.totalFloat, calOf(a).hoursPerDay)}, ${r.isCritical ? t('critical') : t('notCritical')}`;

  const renderBar = (row: Row, index: number) => {
    if (row.kind !== 'activity' || !row.result) return null;
    const a = row.activity!, r = row.result, cal = calOf(a);
    const cy = index * rowH + rowH / 2;
    if (r.ef < visFrom && r.lf < visFrom) return null;
    if (r.es > visTo) return null;
    let dx = 0, dw = 0;
    let pctOverride: number | undefined;
    if (drag && drag.kind !== 'link' && (drag.ids.includes(a.id) || drag.id === a.id)) {
      const p = dragPreview(drag, a.id);
      if (p && drag.kind === 'move') dx = scale.x(p.start) - scale.x(r.es);
      if (p && drag.kind === 'resize') dw = scale.x(p.finish) - scale.x(r.ef);
      if (p && drag.kind === 'resize-start') { dx = scale.x(p.start) - scale.x(r.es); dw = -dx; }
      if (p && drag.kind === 'progress') pctOverride = p.pct;
    }
    const x0 = scale.x(r.es) + dx;
    const w = Math.max(isMilestone(a) ? 0 : 2, scale.x(r.ef) - scale.x(r.es) + dw);
    const sel = selected.includes(a.id);
    const dim = traced && !traced.ids.has(a.id);
    const cls = ['nm-bar-g', r.isCritical ? 'critical' : '', sel ? 'selected' : '', dim ? 'dim' : '', drag && drag.kind !== 'link' && (drag.ids.includes(a.id) || drag.id === a.id) ? 'dragging' : '', a.actualFinish !== undefined ? 'complete' : ''].join(' ');
    const ro = readOnlyReason(a);
    const pct = pctOverride ?? (a.percentComplete !== undefined ? a.percentComplete / 100 : r.status === 'complete' ? 100 : 0);
    const base = baseline?.byStableKey[a.stableKey];
    const hpd = cal.hoursPerDay;
    const style: CSSProperties = { transform: `translate(${x0}px, ${cy}px)` };
    const common = {
      role: 'img' as const,
      'aria-label': barLabel(a, r),
      onDoubleClick: () => setEditorId(a.id),
      onContextMenu: (e: ReactMouseEvent) => openMenu(e, a.id),
    };
    const labelX = (isMilestone(a) ? bh / 2 : w) + 6 + (r.totalFloat < 0 ? 34 : 0);

    const handles = editable && a.type !== 'summary' ? (
      <>
        <circle className="nm-link-handle" cx={isMilestone(a) ? -bh / 2 - 9 : -10} cy={0} r={4} onPointerDown={(e) => beginDrag(e, 'link', a.id, { fromEnd: 'start', lx: x0, ly: cy })} />
        <circle className="nm-link-handle" cx={isMilestone(a) ? bh / 2 + 9 : w + 10} cy={0} r={4} onPointerDown={(e) => beginDrag(e, 'link', a.id, { fromEnd: 'finish', lx: x0 + w, ly: cy })} />
      </>
    ) : null;

    const grip = (side: 'start' | 'finish', x: number) => (
      <g className="nm-grip-g" onPointerDown={(e) => beginDrag(e, side === 'start' ? 'resize-start' : 'resize', a.id)}>
        <title>{side === 'start' ? t('dragStart') : t('dragFinish')}</title>
        <rect className="nm-grip-hit" x={x - 6} y={-bh / 2 - 2} width={12} height={bh + 4} />
        <rect className="nm-grip" x={side === 'start' ? x + 1 : x - 4} y={-bh / 2 + 3} width={3} height={bh - 6} rx={1.5} />
      </g>
    );
    let shape: React.ReactNode;
    if (a.type === 'summary') {
      shape = (
        <path className="nm-summary" d={`M0 ${-bh / 2} H${w} V${-bh / 2 + 6} L${w - 4} ${-bh / 2 + 11} L${w - 8} ${-bh / 2 + 6} H8 L4 ${-bh / 2 + 11} L0 ${-bh / 2 + 6} Z`}
          onPointerDown={(e) => beginDrag(e, 'move', a.id)} />
      );
    } else if (isMilestone(a)) {
      const s = bh / 2 + 1;
      shape = <path className={`nm-milestone ${r.isCritical ? 'critical' : ''}`} d={`M0 ${-s} L${s} 0 L0 ${s} L${-s} 0 Z`} onPointerDown={(e) => beginDrag(e, 'move', a.id)} />;
    } else if (a.type === 'level_of_effort') {
      shape = <rect className="nm-loe" x={0} y={-3} height={6} style={{ width: w }} onPointerDown={(e) => { e.stopPropagation(); select(a.id, e); }} />;
    } else if (r.status === 'in_progress' && r.remainingStart !== undefined) {
      const xd = Math.min(scale.x(doc.dataDate), scale.x(r.ef)) - scale.x(r.es);
      const xr = scale.x(r.remainingStart) - scale.x(r.es);
      shape = (
        <>
          <rect className="nm-bar actual" x={0} y={-bh / 2} height={bh} rx={3} style={{ width: Math.max(2, xd) }} onPointerDown={(e) => beginDrag(e, 'move', a.id)} />
          <rect className={`nm-bar remaining ${r.isCritical ? 'critical' : ''}`} x={xr} y={-bh / 2} height={bh} rx={3} style={{ width: Math.max(2, w - xr) }} onPointerDown={(e) => beginDrag(e, 'move', a.id)} />
          {r.isCritical && <rect className="nm-crit-overlay" x={xr} y={-bh / 2} height={bh} rx={3} style={{ width: Math.max(2, w - xr) }} pointerEvents="none" />}
          <rect className="nm-progress" x={0} y={-bh / 2 + 4} height={bh - 8} style={{ width: (Math.max(0, w) * pct) / 100 }} pointerEvents="none" />
          {editable && !ro && <rect className="nm-progress-handle" x={(w * pct) / 100 - 3} y={-bh / 2} width={6} height={bh} onPointerDown={(e) => beginDrag(e, 'progress', a.id)} />}
          {editable && !ro && grip('finish', w)}
        </>
      );
    } else {
      shape = (
        <>
          <rect className={`nm-bar ${r.isCritical ? 'critical' : ''}`} x={0} y={-bh / 2} height={bh} rx={3} style={{ width: w }} onPointerDown={(e) => beginDrag(e, 'move', a.id)} />
          {r.isCritical && <rect className="nm-crit-overlay" x={0} y={-bh / 2} height={bh} rx={3} style={{ width: w }} pointerEvents="none" />}
          {pct > 0 && <rect className="nm-progress" x={0} y={-bh / 2 + 4} height={bh - 8} style={{ width: (w * pct) / 100 }} pointerEvents="none" />}
          {editable && !ro && w >= 14 && grip('start', 0)}
          {editable && !ro && grip('finish', w)}
          {editable && !ro && a.actualStart !== undefined && <rect className="nm-progress-handle" x={(w * pct) / 100 - 3} y={-bh / 2} width={6} height={bh} onPointerDown={(e) => beginDrag(e, 'progress', a.id)} />}
        </>
      );
    }

    return (
      <g key={a.id} className={cls} style={style} {...common} data-id={a.id}>
        <title>{ro ? `${barLabel(a, r)} — ${ro}` : barLabel(a, r)}</title>
        {base && <rect className="nm-baseline" x={scale.x(base.es) - x0} y={bh / 2 + 2} width={Math.max(isMilestone(a) ? 4 : 2, scale.x(base.ef) - scale.x(base.es))} height={4} />}
        {showFloat && a.type !== 'summary' && r.lf > r.ef && (
          <line className="nm-float-line" x1={w} y1={0} x2={scale.x(r.lf) - x0} y2={0} />
        )}
        {shape}
        {a.constraint !== 'ASAP' && a.constraint !== 'ALAP' && a.constraintDate !== undefined && (
          <path className={`nm-constraint ${a.constraint === 'MSO' || a.constraint === 'MFO' ? 'hard' : ''}`}
            d={`M${scale.x(a.constraintDate) - x0} ${-bh / 2 - 1} l-4 -6 h8 z`}>
            <title>{`${a.constraint} ${fmtDate(tz, a.constraintDate, true)}`}</title>
          </path>
        )}
        {a.deadline !== undefined && (
          <path className={`nm-deadline ${r.ef > a.deadline ? 'missed' : ''}`} d={`M${scale.x(a.deadline) - x0} ${-bh / 2 - 1} l-4 -7 h3 v-3 h2 v3 h3 z`}>
            <title>{`${t('deadline')} ${fmtDate(tz, a.deadline, true)}`}</title>
          </path>
        )}
        {r.totalFloat < 0 && a.type !== 'summary' && (
          <text className="nm-neg-float" x={(isMilestone(a) ? bh / 2 : w) + 4} y={4}>{fmtFloat(r.totalFloat, hpd)}</text>
        )}
        <text className="nm-bar-label" x={labelX} y={4}>{a.name}</text>
        {handles}
      </g>
    );
  };

  const linkPath = (l: LinkRecord) => {
    const fi = rowIndex.get(l.from)!, ti = rowIndex.get(l.to)!;
    const fr = results?.activities[l.from], tr = results?.activities[l.to];
    const fa = tree.byId.get(l.from), ta = tree.byId.get(l.to);
    if (!fr || !tr || !fa || !ta) return null;
    const off = (a: ActivityRecord, end: 'start' | 'finish') => (isMilestone(a) ? (end === 'start' ? -bh / 2 : bh / 2) : 0);
    const x1 = (l.type === 'FS' || l.type === 'FF' ? scale.x(fr.ef) + off(fa, 'finish') : scale.x(fr.es) + off(fa, 'start'));
    const x2 = (l.type === 'FS' || l.type === 'SS' ? scale.x(tr.remainingStart ?? tr.es) + off(ta, 'start') : scale.x(tr.ef) + off(ta, 'finish'));
    const y1 = fi * rowH + rowH / 2, y2 = ti * rowH + rowH / 2;
    const driving = tr.drivingLinkIds.includes(l.id);
    const critical = driving && fr.isCritical && tr.isCritical;
    const dim = traced && !traced.links.has(l.id);
    const cls = ['nm-link', driving ? 'driving' : '', critical ? 'critical' : '', selectedLink === l.id ? 'selected' : '', dim ? 'dim' : '', traced?.driving.has(l.id) ? 'traced-driving' : ''].join(' ');
    const d = routeLink(l.type, x1, y1, x2, y2, rowH);
    return (
      <g key={l.id} className={cls}>
        <path className="nm-link-hit" d={d}
          onClick={(e) => { e.stopPropagation(); setSelectedLink(l.id); setSelected([]); }}
          onDoubleClick={() => setLinkEditorId(l.id)}
          onContextMenu={(e) => openMenu(e, undefined, l.id)}>
          <title>{`${fa.code} → ${ta.code} ${l.type}${l.lag ? ` ${l.lag > 0 ? '+' : ''}${formatDuration(l.lag, calOf(ta).hoursPerDay)}` : ''}`}</title>
        </path>
        <path className="nm-link-line" d={d} markerEnd={`url(#nm-arrow${critical ? '-crit' : ''})`} />
      </g>
    );
  };

  // ---------------------------------------------------------------- splitter
  const onSplitDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = split;
    const move = (ev: PointerEvent) => setSplit(Math.max(120, Math.min(w0 + ev.clientX - x0, 1200)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSplit((w) => { try { localStorage.setItem(splitKey, String(w)); } catch { /* storage unavailable */ } return w; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onColResize = (e: ReactPointerEvent, i: number) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = columns[i]!.width;
    const move = (ev: PointerEvent) => setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, width: Math.max(32, w0 + ev.clientX - x0) } : c)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const colDrag = useRef<number | null>(null);

  // ---------------------------------------------------------------- render
  const errors = results && !results.ok ? results.errors : [];
  const editorAct = editorId ? tree.byId.get(editorId) : undefined;
  const linkEdit = linkEditorId ? doc.links.find((l) => l.id === linkEditorId) : undefined;
  const dragTip = drag && drag.kind !== 'link' ? dragPreview(drag, drag.id) : null;
  const xToday = scale.x(today), xData = scale.x(doc.dataDate);

  return (
    <div className={`nm-gantt ${print ? 'print' : ''} ${compact ? 'compact' : ''}`} style={{ height: print ? 'auto' : height, '--nm-row-h': `${rowH}px` } as CSSProperties}>
      {errors.length > 0 && (
        <div className="nm-banner error" role="alert">
          <strong>{t('scheduleErrors')}:</strong> {errors.slice(0, 3).map((e) => e.message).join(' · ')}{errors.length > 3 ? ` (+${errors.length - 3})` : ''}
        </div>
      )}
      {status.kind !== 'idle' && status.text && (
        <div className={`nm-status ${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
          {status.text}
          {status.kind !== 'saving' && <button type="button" className="nm-icon-btn" aria-label={t('close')} onClick={() => setStatus({ kind: 'idle' })}>×</button>}
        </div>
      )}
      <div className="nm-body">
        {/* ------------------------------------------------ grid */}
        <div
          className="nm-grid"
          ref={gridRef}
          style={{ width: split }}
          onScroll={onGridScroll}
          role="treegrid"
          aria-rowcount={rows.length + 1}
          aria-colcount={columns.length}
          aria-multiselectable="true"
          aria-readonly={!editable}
          aria-activedescendant={rows[focusCell.row] ? `nm-cell-${focusCell.row}-${focusCell.col}` : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <div className="nm-grid-head" role="row" aria-rowindex={1} style={{ width: gridWidth }}>
            {columns.map((c, i) => (
              <div key={c.key} role="columnheader" className="nm-th" style={{ width: c.width }} draggable
                onDragStart={() => { colDrag.current = i; }}
                onDragOver={(e) => { if (colDrag.current !== null) e.preventDefault(); }}
                onDrop={() => {
                  const from = colDrag.current; colDrag.current = null;
                  if (from === null || from === i) return;
                  setColumns((cs) => { const n = [...cs]; const [m] = n.splice(from, 1); n.splice(i, 0, m!); return n; });
                }}>
                <span>{c.title ?? columnTitle(t, c.key)}</span>
                <span className="nm-col-resize" onPointerDown={(e) => onColResize(e, i)} />
              </div>
            ))}
          </div>
          <div className="nm-grid-rows" style={{ height: totalH + sbH, width: gridWidth }}>
            {items.map((it) => {
              const row = rows[it.index];
              if (!row) return null;
              const a = row.activity;
              const sel = selected.includes(row.key);
              const r = row.result;
              return (
                <div
                  key={row.key}
                  role="row"
                  aria-rowindex={it.index + 2}
                  aria-level={row.depth + 1}
                  aria-expanded={row.hasChildren ? !collapsed.has(row.key) : undefined}
                  aria-selected={sel}
                  className={`nm-tr is-${row.kind} ${sel ? 'is-selected' : ''} ${a?.type === 'summary' ? 'is-summary' : ''} ${r?.isCritical ? 'is-critical' : ''} ${traced && !traced.ids.has(row.key) ? 'is-dim' : ''} ${dropLine?.index === it.index ? `is-drop-${dropLine.pos}` : ''}`}
                  style={{ transform: `translateY(${it.start - HEADER_H}px)`, height: rowH }}
                  onClick={(e) => { if (row.kind === 'activity') select(row.key, e); setFocusCell((f) => ({ ...f, row: it.index })); gridRef.current?.focus({ preventScroll: true }); }}
                  onDoubleClick={() => a && setEditorId(a.id)}
                  onContextMenu={(e) => openMenu(e, a?.id)}
                  onDragOver={(e) => onRowDragOver(e, it.index)}
                  onDrop={onRowDrop}
                  title={a ? readOnlyReason(a) ?? undefined : undefined}
                >
                  {columns.map((c, ci) => {
                    const isEditing = editing && editing.id === row.key && editing.col === c.key;
                    const focused = focusCell.row === it.index && focusCell.col === ci;
                    return (
                      <div key={c.key} id={`nm-cell-${it.index}-${ci}`} role="gridcell" aria-colindex={ci + 1}
                        className={`nm-td col-${c.key} ${focused ? 'focused' : ''}`} style={{ width: c.width }}
                        onClick={() => setFocusCell({ row: it.index, col: ci })}
                        onDoubleClick={(e) => {
                          if (a && editable && EDITABLE[c.key] && !((c.key === 'duration' || c.key === 'finish') && (a.type === 'summary' || isMilestone(a)))) {
                            e.stopPropagation();
                            setEditing({ id: a.id, col: c.key, value: editValue(c.key, a) });
                          }
                        }}>
                        {c.key === 'wbs' && a && editable && (
                          <span className="nm-drag-handle" draggable aria-hidden="true"
                            onDragStart={(e) => { rowDrag.current = a.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', a.code); }}
                            onDragEnd={() => { rowDrag.current = null; setDropLine(null); }}>⋮⋮</span>
                        )}
                        {c.key === 'name' && (
                          <span className="nm-indent" style={{ width: row.depth * 16 }} />
                        )}
                        {c.key === 'name' && (row.hasChildren ? (
                          <button type="button" className="nm-toggle" tabIndex={-1} aria-label={collapsed.has(row.key) ? 'Expand' : 'Collapse'}
                            onClick={(e) => { e.stopPropagation(); toggle(row.key); }}>{collapsed.has(row.key) ? '▸' : '▾'}</button>
                        ) : <span className="nm-toggle-space" />)}
                        {isEditing ? (
                          <CellEditor col={c.key} initial={editing.value} onCommit={commitEdit} onCancel={() => { setEditing(null); gridRef.current?.focus(); }} />
                        ) : (
                          <span className="nm-cell-text">{cellText(c.key, row)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {rows.length === 0 && <div className="nm-empty">{t('noRows')}</div>}
          </div>
        </div>

        {!print && <div className="nm-splitter" role="separator" aria-orientation="vertical" aria-valuenow={split} tabIndex={0}
          onPointerDown={onSplitDown}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') setSplit((w) => Math.max(120, w - 16)); if (e.key === 'ArrowRight') setSplit((w) => w + 16); }} />}

        {/* ------------------------------------------------ timeline */}
        <div className="nm-timeline" ref={tlRef} onScroll={onTlScroll}
          onClick={() => { setSelectedLink(null); }}
          onContextMenu={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}>
          <div className="nm-tl-head" style={{ width: scale.width }}>
            <div className="nm-tier top">
              {header.top.map((tk) => <div key={tk.key} className="nm-tick" style={{ left: tk.x, width: tk.w }}><span>{tk.label}</span></div>)}
            </div>
            <div className="nm-tier bottom">
              {header.bottom.map((tk) => <div key={tk.key} className="nm-tick" style={{ left: tk.x, width: tk.w }}><span>{tk.label}</span></div>)}
              <div className="nm-line-tag today" style={{ left: xToday }}>{t('today')}</div>
              <div className="nm-line-tag data" style={{ left: xData }}>{t('dataDate')}</div>
            </div>
          </div>
          <svg ref={svgRef} className={`nm-svg ${drag?.kind === 'link' ? (drag.target && !drag.target.valid ? 'blocked' : 'linking') : ''}`} width={scale.width} height={Math.max(totalH, 1)}
            onClick={() => { setSelectedLink(null); }}>
            <defs>
              <marker id="nm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" className="nm-arrow" /></marker>
              <marker id="nm-arrow-crit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" className="nm-arrow critical" /></marker>
              <pattern id="nm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" className="nm-hatch-bg" /><line x1="0" y1="0" x2="0" y2="6" className="nm-hatch-line" /></pattern>
              <pattern id="nm-crit-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="6" className="nm-stripe" /></pattern>
            </defs>
            <g className="nm-shading">
              {nonWorking.map((n) => <rect key={n.key} x={n.x} y={0} width={n.w} height={Math.max(totalH, 1)} />)}
            </g>
            <g className="nm-row-bands">
              {items.map((it) => (rows[it.index]?.kind === 'group' || rows[it.index]?.activity?.type === 'summary')
                ? <rect key={it.key} x={0} y={(it.start - HEADER_H)} width={scale.width} height={rowH} className={rows[it.index]?.kind === 'group' ? 'group' : 'summary'} />
                : null)}
              {selected.map((id) => { const i = rowIndex.get(id); return i === undefined ? null : <rect key={`sel-${id}`} x={0} y={i * rowH} width={scale.width} height={rowH} className="selected" />; })}
            </g>
            <line className="nm-today-line" x1={xToday} x2={xToday} y1={0} y2={Math.max(totalH, 1)} />
            <line className="nm-data-line" x1={xData} x2={xData} y1={0} y2={Math.max(totalH, 1)} />
            <g className="nm-links">{visibleLinks.map(linkPath)}</g>
            <g className="nm-bars">{items.map((it) => { const row = rows[it.index]; return row ? renderBar(row, it.index) : null; })}</g>
            {drag?.kind === 'link' && (
              <line className={`nm-link-draft ${drag.target && !drag.target.valid ? 'blocked' : ''}`} x1={dragStartX(drag)} y1={(rowIndex.get(drag.id) ?? 0) * rowH + rowH / 2} x2={drag.lx} y2={drag.ly} />
            )}
          </svg>
        </div>
      </div>
      {!print && <Legend t={t} showBaseline={!!baseline} />}
      {dragTip && drag && (
        <div className="nm-drag-tip" style={{ left: drag.px + 14, top: drag.py + 14 }}>
          {dragTip.pct !== undefined ? `${dragTip.pct}%` : <>
            {t('newStart')}: {fmtDate(tz, dragTip.start, true)}<br />
            {t('newFinish')}: {fmtDate(tz, dragTip.finish, true)}
            {dragTip.work !== undefined && <><br />{tree.byId.get(drag.id)?.actualStart !== undefined ? t('remaining') : t('duration')}: {formatDuration(dragTip.work, defaultCal.hoursPerDay)}</>}
          </>}
        </div>
      )}
      {drag?.kind === 'link' && drag.target && (
        <div className="nm-drag-tip" style={{ left: drag.px + 14, top: drag.py + 14 }}>
          {drag.target.valid ? `${drag.fromEnd === 'finish' ? 'F' : 'S'}${drag.target.end === 'start' ? 'S' : 'F'} → ${tree.byId.get(drag.target.id)?.code}` : `⊘ ${drag.target.reason}`}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
      {editorAct && (
        <ActivityEditor doc={doc} activity={editorAct} cal={calOf(editorAct)} tz={tz} t={t} readOnly={!editable}
          onClose={() => { setEditorId(null); gridRef.current?.focus(); }}
          onSave={(cmds) => { setEditorId(null); void run(cmds); }} />
      )}
      {linkEdit && (
        <LinkEditor link={linkEdit} doc={doc} hoursPerDay={defaultCal.hoursPerDay} t={t}
          onClose={() => setLinkEditorId(null)}
          onSave={(cmds) => { setLinkEditorId(null); void run(cmds); }} />
      )}
    </div>
  );

  function dragStartX(d: Extract<Drag, { kind: 'link' }>): number {
    const r = results?.activities[d.id];
    const a = tree.byId.get(d.id);
    if (!r || !a) return 0;
    return d.fromEnd === 'finish' ? scale.x(r.ef) + (isMilestone(a) ? bh / 2 : 0) : scale.x(r.es) - (isMilestone(a) ? bh / 2 : 0);
  }
});

function CellEditor({ col, initial, onCommit, onCancel }: { col: ColumnKey; initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  return (
    <input
      className="nm-cell-input"
      autoFocus
      type={col === 'start' || col === 'finish' ? 'date' : 'text'}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { done.current = true; onCommit(v); }
        if (e.key === 'Escape') { done.current = true; onCancel(); }
      }}
      onBlur={() => { if (!done.current) { done.current = true; onCommit(v); } }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
