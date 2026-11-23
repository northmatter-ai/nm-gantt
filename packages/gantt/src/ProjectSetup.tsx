/** Towers, floors and trades for the whole project: add, rename, reorder, remove unused. One undoable command. */
import { useMemo, useState } from 'react';
import { cmd, lookupId, type Command, type LookupsPatch, type ScheduleDoc } from '@northmatter/schedule-commands';
import { floorOptions } from './ActivityEditor.js';
import type { Translate } from './i18n.js';

interface Entry { id: string; name: string; short?: string; isNew?: boolean }
type Kind = 'towers' | 'floors' | 'trades';

export interface ProjectSetupProps {
  doc: ScheduleDoc;
  t: Translate;
  readOnly: boolean;
  onSave: (cmds: Command[]) => void;
  onClose: () => void;
}

/** Diff the edited lists against the document into one updateLookups command (or none). */
export function setupCommand(doc: ScheduleDoc, towers: Entry[], floors: Entry[], trades: Entry[]): Command | null {
  const patch: LookupsPatch = {};
  const dict = (orig: Record<string, string> | undefined, list: Entry[]) => {
    const out: Record<string, string | null> = {};
    for (const e of list) if (orig?.[e.id] !== e.name.trim()) out[e.id] = e.name;
    for (const id of Object.keys(orig ?? {})) if (!list.some((e) => e.id === id)) out[id] = null;
    return Object.keys(out).length ? out : undefined;
  };
  const tw = dict(doc.towers, towers);
  if (tw) patch.towers = tw;
  const fl = dict(doc.floors, floors);
  if (fl) patch.floors = fl;
  const order = floors.map((f) => f.id);
  const before = floorOptions(doc).map(([id]) => id);
  if (fl || order.join('|') !== before.join('|') || (!doc.floorOrder && order.length)) patch.floorOrder = order.length ? order : null;
  const tr = trades.map((e) => ({ id: e.id, name: e.name, ...(e.short?.trim() ? { short: e.short.trim() } : {}) }));
  const trBefore = (doc.templates ?? []).map((e) => ({ id: e.id, name: e.name, ...(e.short ? { short: e.short } : {}) }));
  if (JSON.stringify(tr.map((x) => ({ ...x, name: x.name.trim() }))) !== JSON.stringify(trBefore)) patch.templates = tr.length ? tr : null;
  return Object.keys(patch).length ? cmd({ kind: 'updateLookups', patch }) : null;
}

export function ProjectSetup({ doc, t, readOnly, onSave, onClose }: ProjectSetupProps) {
  const [towers, setTowers] = useState<Entry[]>(() => Object.entries(doc.towers ?? {}).map(([id, name]) => ({ id, name })));
  const [floors, setFloors] = useState<Entry[]>(() => floorOptions(doc).map(([id, name]) => ({ id, name })));
  const [trades, setTrades] = useState<Entry[]>(() => (doc.templates ?? []).map((x) => ({ id: x.id, name: x.name, ...(x.short ? { short: x.short } : {}) })));
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const used = useMemo(() => {
    const count = (f: (a: ScheduleDoc['activities'][number]) => string | undefined) => {
      const m = new Map<string, number>();
      for (const a of doc.activities) { const k = f(a); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
      return m;
    };
    return { towers: count((a) => a.towerId), floors: count((a) => a.floorId), trades: count((a) => a.activityTemplateId) };
  }, [doc.activities]);

  const lists = { towers: [towers, setTowers], floors: [floors, setFloors], trades: [trades, setTrades] } as const;
  const prefix: Record<Kind, string> = { towers: 'T', floors: 'F', trades: 'TR' };
  const allIds = (k: Kind) => [...lists[k][0].map((e) => e.id), ...Object.keys(k === 'towers' ? doc.towers ?? {} : k === 'floors' ? doc.floors ?? {} : {}), ...(k === 'trades' ? (doc.templates ?? []).map((x) => x.id) : [])];

  const add = (k: Kind, name = '') => {
    const [list, set] = lists[k];
    const id = lookupId(prefix[k], name || `${t('newEntry')} ${list.length + 1}`, allIds(k));
    set([...list, { id, name, isNew: true }]);
  };
  const addFloorRange = () => {
    const a = Number(from), b = Number(to);
    if (!Number.isInteger(a) || !Number.isInteger(b) || b < a || b - a > 200) { setError(`${t('addFloorsRange')}: ${from}–${to}`); return; }
    const names = new Set(floors.map((f) => f.name.toLowerCase()));
    const taken = allIds('floors');
    const extra: Entry[] = [];
    for (let n = a; n <= b; n++) {
      const name = `Floor ${n}`;
      if (names.has(name.toLowerCase())) continue;
      const id = lookupId('F', name, [...taken, ...extra.map((e) => e.id)]);
      extra.push({ id, name, isNew: true });
    }
    setFloors([...floors, ...extra]);
    setError(null);
  };
  const move = (k: Kind, i: number, d: -1 | 1) => {
    const [list, set] = lists[k];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set(next);
  };

  const save = () => {
    for (const k of ['towers', 'floors', 'trades'] as const) {
      const seen = new Set<string>();
      for (const e of lists[k][0]) {
        const n = e.name.trim().toLowerCase();
        if (!n) { setError(`${t(k === 'towers' ? 'towersList' : k === 'floors' ? 'floorsList' : 'tradesList')}: ${t('lookupNameNeeded', { what: t(k === 'towers' ? 'tower' : k === 'floors' ? 'floor' : 'trade') })}`); return; }
        if (seen.has(n)) { setError(`"${e.name.trim()}" ×2`); return; }
        seen.add(n);
      }
    }
    const c = setupCommand(doc, towers, floors, trades);
    onSave(c ? [c] : []);
  };

  const section = (k: Kind, title: string, ordered: boolean, withShort: boolean) => {
    const [list, set] = lists[k];
    return (
      <section className="nm-setup-sec" aria-label={title}>
        <h3>{title}</h3>
        {list.length === 0 && <p className="nm-form-hint">{t('setupEmpty')}</p>}
        <ol className="nm-setup-list">
          {list.map((e, i) => {
            const n = used[k].get(e.id) ?? 0;
            return (
              <li key={e.id}>
                <input aria-label={`${title} ${i + 1} ${t('nameCol')}`} value={e.name} autoFocus={e.isNew && i === list.length - 1}
                  onChange={(ev) => set(list.map((x) => (x.id === e.id ? { ...x, name: ev.target.value } : x)))} />
                {withShort && <input className="nm-setup-short" aria-label={`${title} ${i + 1} ${t('shortCol')}`} placeholder={t('shortCol')} value={e.short ?? ''}
                  onChange={(ev) => set(list.map((x) => (x.id === e.id ? { ...x, short: ev.target.value } : x)))} />}
                <span className="nm-setup-used">{n ? t('usedBy', { n }) : ''}</span>
                {ordered && <>
                  <button type="button" className="nm-setup-icon" aria-label={`${t('moveUp')}: ${e.name}`} disabled={i === 0} onClick={() => move(k, i, -1)}>↑</button>
                  <button type="button" className="nm-setup-icon" aria-label={`${t('moveDown')}: ${e.name}`} disabled={i === list.length - 1} onClick={() => move(k, i, 1)}>↓</button>
                </>}
                <button type="button" className="nm-setup-icon" aria-label={`${t('remove')}: ${e.name}`} disabled={n > 0} title={n > 0 ? t('inUseNoRemove') : t('remove')}
                  onClick={() => set(list.filter((x) => x.id !== e.id))}>×</button>
              </li>
            );
          })}
        </ol>
        <div className="nm-setup-add">
          <button type="button" className="nm-btn" onClick={() => add(k)}>{k === 'towers' ? t('addTower') : k === 'floors' ? t('addFloor') : t('addTrade')}</button>
          {k === 'floors' && (
            <span className="nm-setup-range">
              {t('addFloorsRange')} {t('fromN')} <input aria-label={`${t('addFloorsRange')} ${t('fromN')}`} inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} />
              {' '}{t('toN')} <input aria-label={`${t('addFloorsRange')} ${t('toN')}`} inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />
              <button type="button" className="nm-btn" onClick={addFloorRange} disabled={!to}>{t('add')}</button>
            </span>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="nm-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nm-modal nm-setup" role="dialog" aria-modal="true" aria-label={t('setupTitle')} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
        <header className="nm-modal-head">
          <strong>{t('setupTitle')}</strong>
          <button type="button" className="nm-icon-btn" aria-label={t('close')} onClick={onClose}>×</button>
        </header>
        <fieldset className="nm-modal-body" disabled={readOnly}>
          <p className="nm-form-hint">{t('lookupHint')}</p>
          {section('towers', t('towersList'), false, false)}
          {section('floors', t('floorsList'), true, false)}
          {section('trades', t('tradesList'), true, true)}
        </fieldset>
        {error && <div className="nm-error" role="alert">{error}</div>}
        <footer className="nm-modal-foot">
          <button type="button" className="nm-btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="nm-btn primary" onClick={save} disabled={readOnly}>{t('save')}</button>
        </footer>
      </div>
    </div>
  );
}
