/**
 * Look-ahead board: rolling window (3 weeks by default, 2–6) of activities due to start or in
 * progress, grouped by tower and contractor, with Site readiness, this week's commitments and PPC.
 */
import { useMemo, useState } from 'react';
import { formatLocal, instantFromEpochMs, parseLocal, type Minutes } from '@nm/calendar';
import { fmtDate } from '@nm/gantt';
import { formatDuration, type ScheduleDoc } from '@nm/schedule-commands';
import type { ScheduleResult } from '@nm/schedule-engine';
import { buildLookahead, READINESS_KEYS, towersOf, type Readiness, type SiteData } from './model.js';
import { ActivityDetails } from './ActivityDetails.js';
import { vt, type VT } from './i18n.js';

export interface LookAheadProps {
  doc: ScheduleDoc;
  results?: ScheduleResult;
  site: SiteData;
  /** Window start; defaults to the data date. */
  from?: Minutes;
  weeks?: number;
  locale?: 'en' | 'hi';
  projectName?: string;
  printedBy?: string;
  onOpenInGantt?: (activityId: string) => void;
}

export function LookAhead({ doc, results, site, from: fromProp, weeks: weeksProp = 3, locale = 'en', projectName, printedBy, onOpenInGantt }: LookAheadProps) {
  const t = useMemo(() => vt(locale), [locale]);
  const tz = doc.calendars.find((c) => c.id === doc.defaultCalendarId)?.timeZone ?? 'Asia/Kolkata';
  const [weeks, setWeeks] = useState(weeksProp);
  const [from, setFrom] = useState<Minutes>(fromProp ?? doc.dataDate);
  const [towerId, setTowerId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const la = useMemo(() => buildLookahead(doc, results, site, { from, weeks, ...(towerId ? { towerId } : {}) }), [doc, results, site, from, weeks, towerId]);
  const hpd = doc.calendars.find((c) => c.id === doc.defaultCalendarId)?.hoursPerDay ?? 480;

  const exportPdf = () => {
    // Browser print-to-PDF of the board only; the server-side PDF job will render this same view.
    document.body.classList.add('nmc-printing');
    const done = () => { document.body.classList.remove('nmc-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1000);
  };

  return (
    <div className="nmc nmc-lookahead">
      <div className="nmc-toolbar no-print">
        <label>{t('from')} <input type="date" aria-label={t('from')} value={formatLocal(tz, from).slice(0, 10)}
          onChange={(e) => { if (e.target.value) setFrom(parseLocal(tz, e.target.value)); }} /></label>
        <label>{t('window')} <select aria-label={t('window')} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
          {[2, 3, 4, 5, 6].map((w) => <option key={w} value={w}>{w} {t('weeks')}</option>)}
        </select></label>
        <label>{t('tower')} <select aria-label={t('tower')} value={towerId} onChange={(e) => setTowerId(e.target.value)}>
          <option value="">{t('allTowers')}</option>
          {towersOf(doc).map((tw) => <option key={tw.id} value={tw.id}>{tw.name}</option>)}
        </select></label>
        <button type="button" className="nmc-btn" onClick={exportPdf}>{t('exportPdf')}</button>
      </div>

      <header className="nmc-print-title">
        <h2>{t('lookahead')} · {projectName ?? doc.name}</h2>
        <p>
          {fmtDate(tz, la.from)} – {fmtDate(tz, la.to - 1)} ({weeks} {t('weeks')}) · {t('dataDate')} {fmtDate(tz, doc.dataDate)} ·
          {' '}{t('printedAt')} {fmtDate(tz, instantFromEpochMs(Date.now()), true)}{printedBy ? ` · ${printedBy}` : ''}
        </p>
      </header>

      {la.total === 0 ? <p className="nmc-muted">{t('noActivities')}</p> : (
        <table className="nmc-table nmc-board">
          <thead>
            <tr>
              <th>{t('activity')}</th><th>{t('floor')}</th><th>{t('start')}</th><th>{t('finish')}</th><th className="num">{t('totalFloat')}</th>
              {READINESS_KEYS.map((k) => <th key={k} className="ready-col">{t(k)}</th>)}
              <th>{t('commitment')}</th>
            </tr>
          </thead>
          {la.towers.map((tw) => (
            <tbody key={tw.towerId}>
              <tr className="nmc-group tower"><th colSpan={6 + READINESS_KEYS.length} scope="rowgroup">{tw.name}</th></tr>
              {tw.contractors.map((c) => (
                <ContractorRows key={c.contractorId} group={c} t={t} tz={tz} hpd={hpd} onOpen={setOpen} floors={doc.floors} />
              ))}
            </tbody>
          ))}
        </table>
      )}
      {open && (
        <ActivityDetails doc={doc} {...(results ? { results } : {})} site={site} activityId={open} t={t} onClose={() => setOpen(null)}
          {...(onOpenInGantt ? { onOpenInGantt: (id: string) => { setOpen(null); onOpenInGantt(id); } } : {})} />
      )}
    </div>
  );
}

function ContractorRows({ group, t, tz, hpd, onOpen, floors }: {
  group: ReturnType<typeof buildLookahead>['towers'][number]['contractors'][number];
  t: VT; tz: string; hpd: number; onOpen: (id: string) => void; floors?: Record<string, string>;
}) {
  return (
    <>
      <tr className="nmc-group contractor">
        <th colSpan={6 + READINESS_KEYS.length} scope="rowgroup">
          {group.name}
          <span className="nmc-ppc">{t('ppc')}: {group.ppc.pct !== undefined ? `${group.ppc.pct}% (${group.ppc.done}/${group.ppc.committed})` : '—'}</span>
        </th>
      </tr>
      {group.rows.map((r) => (
        <tr key={r.activity.id} className={r.ready ? '' : 'not-ready'}>
          <td>
            <button type="button" className="nmc-linkish" onClick={() => onOpen(r.activity.id)}>{r.activity.name}</button>
            <span className="nmc-muted nmc-code">{r.activity.code}{r.result.status === 'in_progress' ? ` · ${t('in_progress')}` : ''}</span>
          </td>
          <td>{r.activity.floorId ? floors?.[r.activity.floorId] ?? r.activity.floorId : ''}</td>
          <td>{fmtDate(tz, r.result.es)}</td>
          <td>{fmtDate(tz, r.result.ef)}</td>
          <td className={`num ${r.result.totalFloat < 0 ? 'neg' : ''}`}>{formatDuration(r.result.totalFloat, hpd)}</td>
          {READINESS_KEYS.map((k) => <ReadyCell key={k} r={r.readiness[k]} t={t} />)}
          <td>{r.commitment ? (
            <span>
              {r.commitment.committed}{' '}
              <span className={`nmc-pill ${r.commitment.done === undefined ? 'pending' : r.commitment.done ? 'passed' : 'failed'}`}>
                {r.commitment.done === undefined ? `… ${t('pending')}` : r.commitment.done ? `✓ ${t('done')}` : `✗ ${t('missed')}`}
              </span>
            </span>
          ) : ''}</td>
        </tr>
      ))}
    </>
  );
}

function ReadyCell({ r, t }: { r: Readiness; t: VT }) {
  if (r.status === 'ready') return <td className="ready-col ok" title={t('ready')}><span aria-hidden="true">✓</span><span className="sr-only">{t('ready')}</span></td>;
  if (r.status === 'na') return <td className="ready-col na" title={t('na')}><span aria-hidden="true">–</span><span className="sr-only">{t('na')}</span></td>;
  return (
    <td className="ready-col bad" title={`${t('notReady')}${r.owner ? ` — ${r.owner}` : ''}${r.note ? ` (${r.note})` : ''}`}>
      <span aria-hidden="true">✗</span> <span className="owner">{r.owner ?? t('notReady')}</span>
      <span className="sr-only">{t('notReady')}</span>
    </td>
  );
}
