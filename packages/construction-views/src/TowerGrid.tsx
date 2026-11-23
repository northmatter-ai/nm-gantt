/**
 * Tower × floor grid: rows are floors (top floor at the top), columns are activity templates in
 * construction order, each cell the activity for that floor and template, coloured and patterned by state.
 */
import { memo, useMemo, useState } from 'react';
import type { BaselineView, ScheduleDoc } from '@northmatter/schedule-commands';
import type { ScheduleResult } from '@northmatter/schedule-engine';
import { fmtDate } from '@northmatter/gantt';
import { buildTowerGrid, CELL_STATES, towersOf, type SiteData } from './model.js';
import { ActivityDetails } from './ActivityDetails.js';
import { StateIcon } from './StateIcon.js';
import { vt } from './i18n.js';

export interface TowerFloorGridProps {
  doc: ScheduleDoc;
  results?: ScheduleResult;
  site: SiteData;
  /** One grid per tower; defaults to every tower. */
  towerIds?: string[];
  baseline?: BaselineView;
  locale?: 'en' | 'hi';
  onOpenInGantt?: (activityId: string) => void;
}

export function TowerFloorGrid({ doc, results, site, towerIds, baseline, locale = 'en', onOpenInGantt }: TowerFloorGridProps) {
  const t = useMemo(() => vt(locale), [locale]);
  const towers = towerIds ?? towersOf(doc).map((x) => x.id);
  const grids = useMemo(() => towers.map((id) => buildTowerGrid(doc, results, site, id, baseline)), [doc, results, site, baseline, towers.join('|')]);
  const [open, setOpen] = useState<string | null>(null);
  const tz = doc.calendars.find((c) => c.id === doc.defaultCalendarId)?.timeZone ?? 'Asia/Kolkata';

  return (
    <div className="nmc nmc-grids">
      <Legend t={t} />
      <div className="nmc-grid-row">
        {grids.map((g) => (
          <section key={g.towerId} className="nmc-tower" aria-label={g.towerName}>
            <h2>{g.towerName} <span className="nmc-muted">{g.counts.certified}/{g.cells.size} {t('certified').toLowerCase()}</span></h2>
            {g.cells.size === 0 ? <p className="nmc-muted">{t('noData')}</p> : (
              <div className="nmc-tf" role="grid" aria-rowcount={g.floors.length + 1} aria-colcount={g.templates.length + 1}
                style={{ gridTemplateColumns: `minmax(64px, max-content) repeat(${g.templates.length}, minmax(22px, 72px))` }}>
                <div role="row" className="nmc-tf-row head">
                  <div role="columnheader" className="nmc-corner">{t('floor')}</div>
                  {g.templates.map((tp) => (
                    <div key={tp.id} role="columnheader" className="nmc-tf-col" title={tp.name}><span>{tp.short ?? tp.name}</span></div>
                  ))}
                </div>
                {g.floors.map((f) => (
                  <div key={f.id} role="row" className="nmc-tf-row">
                    <div role="rowheader" className="nmc-floor">{f.name}</div>
                    {g.templates.map((tp) => {
                      const c = g.cells.get(`${f.id}|${tp.id}`);
                      if (!c) return <div key={tp.id} role="gridcell" className="nmc-cell empty" />;
                      return (
                        <Cell key={tp.id} id={c.activity.id} state={c.state}
                          label={`${f.name}, ${tp.name}: ${t(c.state)}. ${t('finish')} ${fmtDate(tz, c.result?.ef)}`}
                          onOpen={setOpen} />
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      {open && (
        <ActivityDetails doc={doc} {...(results ? { results } : {})} site={site} activityId={open} {...(baseline ? { baseline } : {})} t={t}
          onClose={() => setOpen(null)} {...(onOpenInGantt ? { onOpenInGantt: (id: string) => { setOpen(null); onOpenInGantt(id); } } : {})} />
      )}
    </div>
  );
}

const Cell = memo(function Cell({ id, state, label, onOpen }: { id: string; state: string; label: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" role="gridcell" className={`nmc-cell s-${state}`} aria-label={label} title={label} onClick={() => onOpen(id)}>
      <StateIcon state={state as never} />
    </button>
  );
});

export function Legend({ t }: { t: ReturnType<typeof vt> }) {
  return (
    <div className="nmc-legend" aria-label="Legend">
      {CELL_STATES.map((s) => (
        <span key={s}><span className={`nmc-swatch s-${s}`}><StateIcon state={s} /></span>{t(s)}</span>
      ))}
    </div>
  );
}
