/**
 * Line of balance: x = time, y = floor. One line per activity template, joining its planned finish on
 * each floor; plan solid, actual (certified) dashed in the same colour. Crossing lines are clashes.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, ticks, type Scale, type Zoom } from '@nm/gantt';
import type { BaselineView, ScheduleDoc } from '@nm/schedule-commands';
import type { ScheduleResult } from '@nm/schedule-engine';
import { buildLob, templatesOf, towersOf, type LobLine, type SiteData } from './model.js';
import { vt } from './i18n.js';

/** Categorical slots in fixed order; templates past the eighth fold into a neutral "other". */
const SLOTS = 8;

export interface LineOfBalanceProps {
  doc: ScheduleDoc;
  results?: ScheduleResult;
  site: SiteData;
  towerId?: string;
  baselines?: BaselineView[];
  locale?: 'en' | 'hi';
  height?: number;
}

const M = { left: 76, right: 24, top: 52, bottom: 12 };

export function LineOfBalance({ doc, results, site, towerId: towerProp, baselines = [], locale = 'en', height }: LineOfBalanceProps) {
  const t = useMemo(() => vt(locale), [locale]);
  const towers = towersOf(doc);
  const [towerId, setTowerId] = useState(towerProp ?? towers[0]?.id ?? '');
  const [source, setSource] = useState<string>('live');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const allTemplates = useMemo(() => templatesOf(doc), [doc]);
  const slotOf = useMemo(() => new Map(allTemplates.map((tp, i) => [tp.id, i < SLOTS ? i + 1 : 0])), [allTemplates]);
  const nameOf = useMemo(() => new Map(allTemplates.map((tp) => [tp.id, tp.name])), [allTemplates]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(allTemplates.slice(SLOTS).map((x) => x.id)));
  const baseline = baselines.find((b) => b.id === source);
  const lob = useMemo(() => buildLob(doc, results, site, towerId, baseline), [doc, results, site, towerId, baseline]);
  const tz = doc.calendars.find((c) => c.id === doc.defaultCalendarId)?.timeZone ?? 'Asia/Kolkata';

  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const floors = lob.floors;
  const h = height ?? Math.max(260, floors.length * 26 + M.top + M.bottom);
  const plotW = Math.max(100, width - M.left - M.right);
  const plotH = h - M.top - M.bottom;
  const pad = Math.max(7 * 1440, Math.round((lob.to - lob.from) * 0.04));
  const scale: Scale = useMemo(() => {
    const viewStart = lob.from - pad, viewEnd = lob.to + pad;
    const ppm = plotW / Math.max(1, viewEnd - viewStart);
    return { viewStart, viewEnd, ppm, width: plotW, x: (tt) => (tt - viewStart) * ppm, t: (x) => Math.round(viewStart + x / ppm) };
  }, [lob.from, lob.to, pad, plotW]);
  const spanDays = (scale.viewEnd - scale.viewStart) / 1440;
  const zoom: Zoom = spanDays > 720 ? 'year' : spanDays > 300 ? 'quarter' : spanDays > 90 ? 'month' : 'week';
  const header = useMemo(() => ticks(scale, zoom, tz, scale.viewStart, scale.viewEnd, locale), [scale, zoom, tz, locale]);
  const rowH = plotH / Math.max(1, floors.length);
  const y = (floor: number) => M.top + plotH - (floor + 0.5) * rowH;
  const x = (tt: number) => M.left + scale.x(tt);

  const [hover, setHover] = useState<{ line: LobLine; px: number; py: number } | null>(null);
  const visible = lob.lines.filter((l) => !hidden.has(l.templateId));
  const rateText = (r?: number) => (r === undefined ? '—' : `${r.toFixed(2)} ${t('rate')}`);
  const colorVar = (id: string) => { const s = slotOf.get(id) ?? 0; return s ? `var(--nmc-s${s})` : 'var(--nmc-other)'; };
  const path = (pts: { t: number; floor: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.floor).toFixed(1)}`).join(' ');
  const directLabels = visible.length <= 4;

  return (
    <div className="nmc nmc-lob">
      <div className="nmc-toolbar">
        {!towerProp && (
          <label>{t('tower')} <select aria-label={t('tower')} value={towerId} onChange={(e) => setTowerId(e.target.value)}>
            {towers.map((tw) => <option key={tw.id} value={tw.id}>{tw.name}</option>)}
          </select></label>
        )}
        <label>{t('planSource')} <select aria-label={t('planSource')} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="live">{t('liveSchedule')}</option>
          {baselines.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select></label>
        <div className="nmc-seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>{t('chartView')}</button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>{t('tableView')}</button>
        </div>
        <span className="nmc-key"><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" className="nmc-key-line" /></svg>{t('planned')}</span>
        <span className="nmc-key"><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" className="nmc-key-line dashed" /></svg>{t('actual')}</span>
        <span className="nmc-key"><span className="nmc-clash-key" aria-hidden="true">!</span>{t('clash')} ({lob.clashes.length})</span>
      </div>

      <div className="nmc-chips" role="group" aria-label={t('templates')}>
        <button type="button" className="nmc-chip-ctl" onClick={() => setHidden(new Set())}>{t('showAll')}</button>
        <button type="button" className="nmc-chip-ctl" onClick={() => setHidden(new Set(lob.lines.map((l) => l.templateId)))}>{t('showNone')}</button>
        {lob.lines.map((l) => (
          <label key={l.templateId} className={`nmc-chip ${hidden.has(l.templateId) ? 'off' : ''}`}>
            <input type="checkbox" checked={!hidden.has(l.templateId)} onChange={() => setHidden((s) => { const n = new Set(s); if (n.has(l.templateId)) n.delete(l.templateId); else n.add(l.templateId); return n; })} />
            <span className="nmc-chip-sw" style={{ background: colorVar(l.templateId) }} />
            {nameOf.get(l.templateId)}
          </label>
        ))}
      </div>

      <div ref={wrap} className="nmc-lob-plot">
        {floors.length === 0 ? <p className="nmc-muted">{t('noData')}</p> : view === 'table' ? (
          <table className="nmc-table">
            <thead><tr><th>{t('templates')}</th><th>{floors[0]?.name} — {t('finish')}</th><th>{floors[floors.length - 1]?.name} — {t('finish')}</th><th>{t('planned')}</th><th>{t('actual')}</th></tr></thead>
            <tbody>
              {lob.lines.map((l) => (
                <tr key={l.templateId}>
                  <td><span className="nmc-chip-sw" style={{ background: colorVar(l.templateId) }} /> {nameOf.get(l.templateId)}</td>
                  <td>{fmtDate(tz, l.plan[0]?.t)}</td>
                  <td>{fmtDate(tz, l.plan[l.plan.length - 1]?.t)}</td>
                  <td className="num">{rateText(l.planRate)}</td>
                  <td className="num">{rateText(l.actualRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <svg width={width} height={h} role="img" aria-label={`Line of balance, ${towers.find((tw) => tw.id === towerId)?.name ?? ''}`}
            onMouseLeave={() => setHover(null)}>
            {/* time header, two tiers */}
            <g className="nmc-axis">
              {header.top.map((tk) => <text key={tk.key} x={M.left + Math.max(0, tk.x) + 4} y={16} className="nmc-axis-top">{tk.label}</text>)}
              {header.bottom.map((tk) => (
                <g key={tk.key}>
                  <line x1={M.left + tk.x} x2={M.left + tk.x} y1={22} y2={M.top + plotH} className="nmc-gridline" />
                  {tk.w > 28 && <text x={M.left + tk.x + 4} y={38}>{tk.label}</text>}
                </g>
              ))}
            </g>
            {/* floors */}
            <g className="nmc-axis">
              {floors.map((f, i) => (
                <g key={f.id}>
                  <line x1={M.left} x2={M.left + plotW} y1={y(i)} y2={y(i)} className="nmc-gridline faint" />
                  <text x={M.left - 8} y={y(i) + 4} textAnchor="end">{f.name}</text>
                </g>
              ))}
              <text x={8} y={M.top - 8} className="nmc-axis-title">{t('floorsAxis')}</text>
            </g>
            <rect x={M.left} y={M.top} width={plotW} height={plotH} className="nmc-plot-frame" />
            {/* data date */}
            {doc.dataDate >= scale.viewStart && doc.dataDate <= scale.viewEnd && (
              <g>
                <line x1={x(doc.dataDate)} x2={x(doc.dataDate)} y1={M.top} y2={M.top + plotH} className="nmc-data-line" />
                <text x={x(doc.dataDate) + 4} y={M.top + 12} className="nmc-data-label">{t('dataDate')}</text>
              </g>
            )}
            {/* lines */}
            {visible.map((l) => {
              const c = colorVar(l.templateId);
              const active = hover?.line.templateId === l.templateId;
              return (
                <g key={l.templateId} className={`nmc-series ${hover && !active ? 'dim' : ''}`} style={{ color: c }}>
                  {l.plan.length > 1 && <path d={path(l.plan)} className="nmc-line" />}
                  {l.actual.length > 1 && <path d={path(l.actual)} className="nmc-line dashed" />}
                  {floors.length <= 24 && l.plan.map((p) => <circle key={p.activityId} cx={x(p.t)} cy={y(p.floor)} r={3} className="nmc-dot" />)}
                  {l.actual.length === 1 && <circle cx={x(l.actual[0]!.t)} cy={y(l.actual[0]!.floor)} r={4} className="nmc-dot hollow" />}
                  {[l.plan, l.actual].map((pts, k) => pts.length > 1 && (
                    <path key={k} d={path(pts)} className="nmc-hit"
                      onMouseMove={(e) => {
                        const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                        setHover({ line: l, px: e.clientX - box.left, py: e.clientY - box.top });
                      }} />
                  ))}
                  {directLabels && l.plan.length > 0 && (
                    <text x={x(l.plan[l.plan.length - 1]!.t) + 6} y={y(l.plan[l.plan.length - 1]!.floor) - 6} className="nmc-direct">{nameOf.get(l.templateId)}</text>
                  )}
                </g>
              );
            })}
            {/* clashes */}
            {lob.clashes.filter((c) => !hidden.has(c.earlier) && !hidden.has(c.later)).map((c, i) => (
              <g key={i} className="nmc-clash" transform={`translate(${x(c.t)},${y(c.floor)})`}>
                <circle r={8} />
                <text y={4} textAnchor="middle">!</text>
                <title>{`${t('clash')}: ${nameOf.get(c.later)} → ${nameOf.get(c.earlier)}, ${floors[c.floor]?.name}, ${fmtDate(tz, c.t)}`}</title>
              </g>
            ))}
          </svg>
        )}
        {hover && view === 'chart' && (
          <div className="nmc-tip" style={{ left: Math.min(hover.px + 14, width - 240), top: hover.py + 14 }}>
            <strong><span className="nmc-chip-sw" style={{ background: colorVar(hover.line.templateId) }} /> {nameOf.get(hover.line.templateId)}</strong>
            <div>{t('planned')}: {rateText(hover.line.planRate)}</div>
            <div>{t('actual')}: {rateText(hover.line.actualRate)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
