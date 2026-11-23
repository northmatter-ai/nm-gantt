/** Activity panel opened from a grid cell: dates, float, inspections and latest DPR photos from Site. */
import { useEffect, useRef } from 'react';
import { compileCalendars, type CompiledCalendar } from '@northmatter/calendar';
import { fmtDate } from '@northmatter/gantt';
import { formatDuration, type BaselineView, type ScheduleDoc } from '@northmatter/schedule-commands';
import type { ScheduleResult } from '@northmatter/schedule-engine';
import { cellState, type SiteData } from './model.js';
import { StateIcon } from './StateIcon.js';
import type { VT } from './i18n.js';

export interface ActivityDetailsProps {
  doc: ScheduleDoc;
  results?: ScheduleResult;
  site: SiteData;
  activityId: string;
  baseline?: BaselineView;
  t: VT;
  onClose: () => void;
  onOpenInGantt?: (activityId: string) => void;
}

export function ActivityDetails({ doc, results, site, activityId, baseline, t, onClose, onOpenInGantt }: ActivityDetailsProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const a = doc.activities.find((x) => x.id === activityId);
  if (!a) return null;
  const r = results?.activities[a.id];
  let cal: CompiledCalendar | undefined;
  try { cal = compileCalendars(doc.calendars).get(a.calendarId ?? doc.defaultCalendarId); } catch { cal = undefined; }
  const tz = cal?.timeZone ?? 'Asia/Kolkata';
  const hpd = cal?.hoursPerDay ?? 480;
  const base = baseline?.byStableKey[a.stableKey];
  const state = cellState(a, r, site, base?.ef);
  const inspections = site.inspections?.[a.stableKey] ?? [];
  const photos = [...(site.photos?.[a.stableKey] ?? [])].sort((x, y) => y.date - x.date).slice(0, 6);
  const variance = base && r && cal ? cal.workBetween(base.ef, r.ef) : undefined;
  const row = (label: string, value: React.ReactNode) => <><dt>{label}</dt><dd>{value}</dd></>;

  return (
    <div className="nmc-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nmc-dialog" role="dialog" aria-modal="true" aria-label={`${a.code} ${a.name}`} tabIndex={-1} ref={ref}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <header>
          <div>
            <strong>{a.name}</strong>
            <span className="nmc-muted">{a.code} · {doc.towers?.[a.towerId ?? ''] ?? a.towerId} · {doc.floors?.[a.floorId ?? ''] ?? a.floorId}</span>
          </div>
          <button type="button" className="nmc-x" aria-label={t('close')} onClick={onClose}>×</button>
        </header>
        <div className="nmc-dialog-body">
          <p className="nmc-state-line"><span className={`nmc-swatch s-${state}`}><StateIcon state={state} /></span>{t(state)}</p>
          <dl className="nmc-dl">
            {row(t('start'), fmtDate(tz, r?.es, true))}
            {row(t('finish'), fmtDate(tz, r?.ef, true))}
            {row(t('lateStart'), fmtDate(tz, r?.ls, true))}
            {row(t('lateFinish'), fmtDate(tz, r?.lf, true))}
            {row(t('totalFloat'), r ? formatDuration(r.totalFloat, hpd) : '')}
            {base && row(t('baselineFinish'), fmtDate(tz, base.ef, true))}
            {variance !== undefined && row(t('variance'), `${variance > 0 ? '+' : ''}${formatDuration(variance, hpd)}`)}
            {site.reported?.[a.stableKey] && row(t('reported'), fmtDate(tz, site.reported[a.stableKey]!.date))}
            {site.certified?.[a.stableKey] && row(t('certified'), fmtDate(tz, site.certified[a.stableKey]!.date))}
          </dl>
          <h3>{t('inspections')}</h3>
          {inspections.length ? (
            <ul className="nmc-inspections">
              {inspections.map((i) => (
                <li key={i.id}><span className={`nmc-pill ${i.status}`}>{i.status === 'passed' ? `✓ ${t('passed')}` : i.status === 'failed' ? `✗ ${t('failed')}` : `… ${t('pending')}`}</span> {i.name}{i.date !== undefined ? <span className="nmc-muted"> · {fmtDate(tz, i.date)}</span> : null}</li>
              ))}
            </ul>
          ) : <p className="nmc-muted">{t('none')}</p>}
          <h3>{t('photos')}</h3>
          {photos.length ? (
            <div className="nmc-photos">
              {photos.map((p, i) => (
                <figure key={i}><img src={p.url} alt={p.caption ?? a.name} loading="lazy" /><figcaption>{p.caption} · {fmtDate(tz, p.date)}</figcaption></figure>
              ))}
            </div>
          ) : <p className="nmc-muted">{t('none')}</p>}
        </div>
        {onOpenInGantt && (
          <footer><button type="button" className="nmc-btn" onClick={() => onOpenInGantt(a.id)}>{t('openInGantt')}</button></footer>
        )}
      </div>
    </div>
  );
}
