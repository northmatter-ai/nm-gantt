/**
 * Phone view (spec: "View and mobile modes"): read-only list-plus-bars of one tower or the look-ahead window,
 * pinch to zoom the bars, tap a row for details. No editing on phones.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { dayStartInstant, instantToLocal, ymdToDay, type Minutes } from '@northmatter-ai/calendar';
import type { ActivityRecord, ScheduleVersionView } from '@northmatter-ai/schedule-commands';
import type { ActivityResult } from '@northmatter-ai/schedule-engine';
import { fmtDate, formatDuration } from './format.js';
import { translator, type Translate } from './i18n.js';
import { buildPhoneList, LOOKAHEAD_WEEKS, shortDate, weekStart, zoomWindow, type PhoneItem, type PhoneScope } from './phoneModel.js';
import type { Locale } from './types.js';

export interface PhoneScheduleProps {
  version: ScheduleVersionView;
  locale?: Locale;
  /** Starting scope; the viewer can switch with the picker. Default: 3-week look-ahead. */
  initialScope?: PhoneScope;
  onScopeChange?: (s: PhoneScope) => void;
  /** Baseline drawn under each bar and used for "late" when given. */
  showBaselineId?: string;
  /** Height of the component; defaults to filling its parent. */
  height?: number | string;
}

const HEADER_H = 34;
const ROW_H = 66;
const DAY = 1440;

const scopeKey = (s: PhoneScope) => (s.kind === 'lookahead' ? `la:${s.weeks}` : s.kind === 'tower' ? `t:${s.towerId}` : 'all');
const parseScope = (k: string): PhoneScope => (k.startsWith('la:') ? { kind: 'lookahead', weeks: Number(k.slice(3)) } : k.startsWith('t:') ? { kind: 'tower', towerId: k.slice(2) } : { kind: 'all' });

export function PhoneSchedule({ version, locale = 'en', initialScope, onScopeChange, showBaselineId, height = '100%' }: PhoneScheduleProps) {
  const t = useMemo(() => translator(locale), [locale]);
  const { doc, results } = version;
  const tz = doc.calendars.find((c) => c.id === doc.defaultCalendarId)?.timeZone ?? 'Asia/Kolkata';
  const hpd = doc.calendars.find((c) => c.id === doc.defaultCalendarId)?.hoursPerDay ?? 480;
  const [scope, setScopeRaw] = useState<PhoneScope>(initialScope ?? { kind: 'lookahead', weeks: 3 });
  const setScope = (s: PhoneScope) => { setScopeRaw(s); onScopeChange?.(s); };
  const [hideComplete, setHideComplete] = useState(false);
  const [text, setText] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const baseline = showBaselineId ? version.baselines?.find((b) => b.id === showBaselineId) : undefined;

  const list = useMemo(() => buildPhoneList(doc, results, scope, {
    hideComplete, text,
    labels: { inProgress: t('phInProgress'), thisWeek: t('phThisWeek'), nextWeek: t('phNextWeek'), weekOf: (d) => t('phWeekOf', { d }), project: t('phProject') },
  }), [doc, results, scope, hideComplete, text, t]);

  // The time window the bars share; reset when the scope changes, then pinched/panned by the viewer.
  const [win, setWin] = useState(list.window);
  const winKey = `${scopeKey(scope)}|${list.window.from}|${list.window.to}`;
  const lastKey = useRef(winKey);
  useEffect(() => { if (lastKey.current !== winKey) { lastKey.current = winKey; setWin(list.window); } }, [winKey, list.window]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: list.items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (list.items[i]?.kind === 'header' ? HEADER_H : ROW_H),
    overscan: 10,
  });
  useEffect(() => { virt.measure(); }, [list.items, virt]);

  // ---------------- pinch, pan and wheel zoom on the bars
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'none' | 'maybe' | 'pan' | 'pinch'; startX: number; startY: number; startWin: typeof win; startDist: number; anchor: Minutes; moved: boolean }>({ kind: 'none', startX: 0, startY: 0, startWin: win, startDist: 0, anchor: 0, moved: false });
  const width = () => scrollRef.current?.clientWidth ?? 360;
  const timeAt = (clientX: number, w = win) => {
    const rect = scrollRef.current?.getBoundingClientRect();
    const x = clientX - (rect?.left ?? 0);
    return w.from + (x / width()) * (w.to - w.from);
  };
  const onPointerDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse') return; // mouse: wheel and buttons
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) Object.assign(g, { kind: 'maybe', startX: e.clientX, startY: e.clientY, startWin: win, moved: false });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      Object.assign(g, { kind: 'pinch', startWin: win, startDist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, anchor: timeAt((a!.x + b!.x) / 2), moved: true });
    }
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      setWin(zoomWindow(g.startWin, g.startDist / dist, g.anchor));
    } else if (g.kind === 'maybe') {
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { g.kind = 'pan'; g.moved = true; }
      else if (Math.abs(dy) > 8) { g.kind = 'none'; g.moved = true; } // vertical scroll belongs to the browser
    }
    if (g.kind === 'pan') {
      const span = g.startWin.to - g.startWin.from;
      const shift = -((e.clientX - g.startX) / width()) * span;
      setWin({ from: Math.round(g.startWin.from + shift), to: Math.round(g.startWin.to + shift) });
    }
  };
  const onPointerEnd = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) setTimeout(() => { g.kind = 'none'; g.moved = false; }, 0);
    else if (g.kind === 'pinch') g.kind = 'none';
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); setWin((w) => zoomWindow(w, Math.exp(e.deltaY * 0.01), timeAt(e.clientX, w))); }
      else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); setWin((w) => { const s = ((w.to - w.from) * e.deltaX) / width(); return { from: Math.round(w.from + s), to: Math.round(w.to + s) }; }); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  const zoomBy = (f: number) => setWin((w) => zoomWindow(w, f, (w.from + w.to) / 2));

  const x = (m: Minutes) => ((m - win.from) / (win.to - win.from)) * 100;
  const dataX = x(doc.dataDate);
  const towers = Object.entries(doc.towers ?? {});
  const open = openId ? doc.activities.find((a) => a.id === openId) : undefined;
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastOpened = useRef<string | null>(null);
  const openDetails = (id: string) => { if (gesture.current.moved) return; lastOpened.current = id; setOpenId(id); };
  const closeDetails = () => { setOpenId(null); requestAnimationFrame(() => { if (lastOpened.current) rowRefs.current.get(lastOpened.current)?.focus(); }); };

  // Axis: month labels at wide spans, weeks when zoomed in.
  const axis = useMemo(() => {
    const span = win.to - win.from;
    const step = span > 120 * DAY ? 'month' : 'week';
    const out: { t: Minutes; label: string }[] = [];
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (step === 'week') {
      let tm = weekStart(tz, win.from);
      if (tm < win.from) tm += 7 * DAY;
      for (; tm < win.to && out.length < 30; tm += 7 * DAY) out.push({ t: tm, label: shortDate(tz, tm) });
    } else {
      const p = instantToLocal(tz, win.from);
      let y = p.year, m = p.month + 1;
      for (let i = 0; i < 40; i++, m++) {
        if (m > 12) { m = 1; y++; }
        const tm = dayStartInstant(tz, ymdToDay(y, m, 1));
        if (tm >= win.to) break;
        out.push({ t: tm, label: `${MON[m - 1]}${m === 1 ? ` ${String(y).slice(2)}` : ''}` });
      }
    }
    return out;
  }, [win, tz]);

  return (
    <div className="nm-gantt nm-phone" style={{ height }} lang={locale}>
      <div className="nm-ph-bar" role="toolbar" aria-label={t('phTools')}>
        <select aria-label={t('phScope')} value={scopeKey(scope)} onChange={(e) => setScope(parseScope(e.target.value))}>
          <optgroup label={t('phLookahead')}>
            {LOOKAHEAD_WEEKS.map((w) => <option key={w} value={`la:${w}`}>{t('phLookaheadWeeks', { n: w })}</option>)}
          </optgroup>
          {towers.length > 0 && <optgroup label={t('tower')}>{towers.map(([id, n]) => <option key={id} value={`t:${id}`}>{n}</option>)}</optgroup>}
          <option value="all">{t('phAll')}</option>
        </select>
        <input type="search" aria-label={t('phFind')} placeholder={t('phFind')} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="nm-ph-sub">
        <span>{t('phCount', { n: list.count })}</span>
        {scope.kind !== 'lookahead' && <label><input type="checkbox" checked={hideComplete} onChange={(e) => setHideComplete(e.target.checked)} /> {t('phHideDone')}</label>}
        <span className="nm-ph-zoom">
          <button type="button" aria-label={t('phZoomOut')} onClick={() => zoomBy(1.5)}>−</button>
          <button type="button" aria-label={t('phZoomIn')} onClick={() => zoomBy(1 / 1.5)}>+</button>
          <button type="button" onClick={() => setWin(list.window)}>{t('phFit')}</button>
        </span>
      </div>
      <div className="nm-ph-axis" aria-hidden="true">
        {axis.map((a) => <span key={a.t} style={{ left: `${x(a.t)}%` }}>{a.label}</span>)}
        {dataX >= 0 && dataX <= 100 && <i className="nm-ph-dd" style={{ left: `${dataX}%` }} />}
      </div>
      <div className="nm-ph-scroll" ref={scrollRef} role="list" aria-label={t('phListLabel')}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onPointerLeave={onPointerEnd}>
        {list.count === 0 && <p className="nm-empty">{t('noRows')}</p>}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => {
            const it = list.items[v.index]!;
            return (
              <div key={it.key} className="nm-ph-item" style={{ transform: `translateY(${v.start}px)`, height: v.size }} role={it.kind === 'header' ? 'presentation' : 'listitem'}>
                {it.kind === 'header'
                  ? <div className="nm-ph-head" role="heading" aria-level={3}>{it.label}<span>{it.count}</span></div>
                  : <PhoneRow item={it} t={t} tz={tz} hpd={hpd} x={x} dataX={dataX}
                      where={scope.kind === 'tower' ? '' : [it.activity.towerId && doc.towers?.[it.activity.towerId], it.activity.floorId && doc.floors?.[it.activity.floorId]].filter(Boolean).join(' · ')} baseline={baseline?.byStableKey[it.activity.stableKey]}
                      onOpen={openDetails} refFn={(el) => { if (el) rowRefs.current.set(it.activity.id, el); else rowRefs.current.delete(it.activity.id); }} />}
              </div>
            );
          })}
        </div>
      </div>
      {open && results?.activities[open.id] && (
        <PhoneDetails a={open} r={results.activities[open.id]!} version={version} t={t} tz={tz} hpd={hpd}
          baseline={baseline?.byStableKey[open.stableKey]} onClose={closeDetails} onOpen={(id) => { lastOpened.current = id; setOpenId(id); }} />
      )}
    </div>
  );
}

function statusText(t: Translate, a: ActivityRecord, r: ActivityResult): string {
  if (r.status === 'complete') return t('phDone');
  if (r.status === 'in_progress') return a.percentComplete ? `${t('in_progress')} ${Math.round(a.percentComplete / 100)}%` : t('in_progress');
  return t('not_started');
}

function PhoneRow({ item, t, tz, hpd, x, dataX, baseline, onOpen, refFn, where }: {
  item: Extract<PhoneItem, { kind: 'activity' }>; t: Translate; where: string; tz: string; hpd: number; x: (m: Minutes) => number; dataX: number;
  baseline?: { es: Minutes; ef: Minutes } | undefined; onOpen: (id: string) => void; refFn: (el: HTMLButtonElement | null) => void;
}) {
  const { activity: a, result: r } = item;
  const ms = a.type === 'start_milestone' || a.type === 'finish_milestone';
  const late = r.totalFloat < 0;
  const left = x(r.es), right = x(ms ? r.es : r.ef);
  const doneTo = r.status === 'complete' ? right : r.status === 'in_progress' ? x(r.remainingStart ?? r.es) : left;
  const dates = ms ? shortDate(tz, r.es) : `${shortDate(tz, r.es)} – ${shortDate(tz, r.ef)}`;
  const label = `${a.name}${where ? `, ${where}` : ''}, ${dates}, ${statusText(t, a, r)}${r.isCritical ? `, ${t('critical')}` : ''}${late ? `, ${t('phLate', { n: formatDuration(-r.totalFloat, hpd) })}` : ''}`;
  return (
    <button type="button" ref={refFn} className={`nm-ph-row is-${r.status}${r.isCritical ? ' is-critical' : ''}`} aria-label={label} onClick={() => onOpen(a.id)}>
      <span className="nm-ph-name">{a.name}{where && <small> · {where}</small>}</span>
      <span className="nm-ph-meta">
        <span>{dates}</span>
        {!ms && <span>{formatDuration(a.duration, hpd)}</span>}
        <span className="nm-ph-status">{r.status === 'complete' ? '✓ ' : r.status === 'in_progress' ? '◐ ' : ''}{statusText(t, a, r)}</span>
        {r.isCritical && <span className="nm-ph-crit">◆ {t('critical')}</span>}
        {late && <span className="nm-ph-late">▲ {t('phLate', { n: formatDuration(-r.totalFloat, hpd) })}</span>}
      </span>
      <span className="nm-ph-track" aria-hidden="true">
        {baseline && !ms && <i className="nm-ph-base" style={{ left: `${x(baseline.es)}%`, width: `${Math.max(0.5, x(baseline.ef) - x(baseline.es))}%` }} />}
        {ms
          ? <i className="nm-ph-ms" style={{ left: `${left}%` }} />
          : <>
              <i className="nm-ph-fill" style={{ left: `${left}%`, width: `${Math.max(0.8, right - left)}%` }} />
              {doneTo > left && <i className="nm-ph-done" style={{ left: `${left}%`, width: `${Math.min(right, doneTo) - left}%` }} />}
            </>}
        {dataX >= 0 && dataX <= 100 && <i className="nm-ph-dd" style={{ left: `${dataX}%` }} />}
      </span>
    </button>
  );
}

function PhoneDetails({ a, r, version, t, tz, hpd, baseline, onClose, onOpen }: {
  a: ActivityRecord; r: ActivityResult; version: ScheduleVersionView; t: Translate; tz: string; hpd: number;
  baseline?: { es: Minutes; ef: Minutes } | undefined; onClose: () => void; onOpen: (id: string) => void;
}) {
  const { doc } = version;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, [a.id]);
  const byId = new Map(doc.activities.map((x) => [x.id, x]));
  const preds = doc.links.filter((l) => l.to === a.id);
  const succs = doc.links.filter((l) => l.from === a.id);
  const lag = (m: number) => (m ? `${m > 0 ? '+' : '−'}${formatDuration(Math.abs(m), hpd)}` : '');
  const path: string[] = [];
  for (let p = a.parentId ? byId.get(a.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) path.unshift(p.name);
  const variance = baseline ? Math.round((r.ef - baseline.ef) / DAY) : undefined;
  const rows: [string, string][] = [
    [t('phStatus'), statusText(t, a, r)],
    [t('phPlanned'), `${fmtDate(tz, r.es)} – ${fmtDate(tz, r.ef)}`],
    ...(a.actualStart !== undefined ? [[t('actualStart'), fmtDate(tz, a.actualStart, true)] as [string, string]] : []),
    ...(a.actualFinish !== undefined ? [[t('actualFinish'), fmtDate(tz, a.actualFinish, true)] as [string, string]] : []),
    [t('duration'), formatDuration(a.duration, hpd)],
    ...(r.remaining !== undefined && r.status === 'in_progress' ? [[t('remaining'), formatDuration(r.remaining, hpd)] as [string, string]] : []),
    [t('phFloat'), `${formatDuration(r.totalFloat, hpd)}${r.isCritical ? ` · ${t('critical')}` : ''}`],
    ...(variance !== undefined ? [[t('phVsBaseline'), variance === 0 ? t('phOnTime') : variance > 0 ? t('phDaysLate', { n: variance }) : t('phDaysEarly', { n: -variance })] as [string, string]] : []),
    ...(a.constraint !== 'ASAP' ? [[t('constraint'), `${a.constraint}${a.constraintDate !== undefined ? ` ${fmtDate(tz, a.constraintDate)}` : ''}`] as [string, string]] : []),
    ...(a.deadline !== undefined ? [[t('deadline'), fmtDate(tz, a.deadline)] as [string, string]] : []),
    ...(a.towerId ? [[t('tower'), doc.towers?.[a.towerId] ?? a.towerId] as [string, string]] : []),
    ...(a.floorId ? [[t('floor'), doc.floors?.[a.floorId] ?? a.floorId] as [string, string]] : []),
  ];
  const linkList = (title: string, items: typeof preds, other: (l: (typeof preds)[number]) => string) => items.length > 0 && (
    <section>
      <h3>{title}</h3>
      <ul>{items.map((l) => { const o = byId.get(other(l)); return o && (
        <li key={l.id}><button type="button" onClick={() => onOpen(o.id)}>{o.name} <small>{l.type}{lag(l.lag)}</small></button></li>
      ); })}</ul>
    </section>
  );
  return (
    <div className="nm-ph-sheet-backdrop" onClick={onClose}>
      <div className="nm-ph-sheet" role="dialog" aria-modal="true" aria-labelledby="nm-ph-title" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <header>
          <div>
            <small>{a.code}{path.length ? ` · ${path.join(' › ')}` : ''}</small>
            <h2 id="nm-ph-title">{a.name}</h2>
          </div>
          <button type="button" ref={closeRef} className="nm-ph-close" aria-label={t('close')} onClick={onClose}>×</button>
        </header>
        <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {a.percentComplete !== undefined && r.status !== 'complete' && (
          <div className="nm-ph-pct" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.percentComplete / 100)} aria-label={t('percentComplete')}>
            <i style={{ width: `${a.percentComplete / 100}%` }} /><span>{Math.round(a.percentComplete / 100)}%</span>
          </div>
        )}
        {linkList(t('predecessors'), preds, (l) => l.from)}
        {linkList(t('successors'), succs, (l) => l.to)}
        {a.notes && <section><h3>{t('notes')}</h3><p>{a.notes}</p></section>}
        <p className="nm-ph-ro">{t('phReadOnly')}</p>
      </div>
    </div>
  );
}

