/** Activity editor dialog: general, predecessors, successors, constraints, progress, notes. */
import { useMemo, useState } from 'react';
import type { CompiledCalendar } from '@northmatter/calendar';
import type { ActivityType, ConstraintType, LinkType } from '@northmatter/schedule-engine';
import {
  cmd,
  formatDuration,
  lookupId,
  newId,
  parseDuration,
  type ActivityPatch,
  type ActivityRecord,
  type Command,
  type LinkRecord,
  type LookupsPatch,
  type ScheduleDoc,
} from '@northmatter/schedule-commands';
import { fromInputValue, toInputValue } from './format.js';
import type { Translate } from './i18n.js';

type Tab = 'general' | 'predecessors' | 'successors' | 'constraints' | 'progress' | 'notes';
const TABS: Tab[] = ['general', 'predecessors', 'successors', 'constraints', 'progress', 'notes'];
const TYPES: ActivityType[] = ['task', 'start_milestone', 'finish_milestone', 'summary', 'level_of_effort'];
const CONSTRAINTS: ConstraintType[] = ['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'];
const LINK_TYPES: LinkType[] = ['FS', 'SS', 'FF', 'SF'];

interface PredRow { linkId?: string; from: string; type: LinkType; lag: string }

/** Select value meaning "type a new name". */
const NEW = '__new__';

/** Trades in construction order, plus any trade id an activity uses that the list lacks. */
export function tradeOptions(doc: ScheduleDoc): [string, string][] {
  const out: [string, string][] = (doc.templates ?? []).map((x) => [x.id, x.name]);
  for (const a of doc.activities) if (a.activityTemplateId && !out.some(([id]) => id === a.activityTemplateId)) out.push([a.activityTemplateId, a.activityTemplateId]);
  return out;
}

export interface ActivityEditorProps {
  doc: ScheduleDoc;
  activity: ActivityRecord;
  cal: CompiledCalendar;
  tz: string;
  t: Translate;
  readOnly: boolean;
  onSave: (cmds: Command[]) => void;
  onClose: () => void;
}

/** Floors bottom to top: the project's order, else natural order of names. */
export function floorOptions(doc: ScheduleDoc): [string, string][] {
  const all = Object.entries(doc.floors ?? {});
  if (doc.floorOrder?.length) {
    const rank = new Map(doc.floorOrder.map((id, i) => [id, i]));
    return all.sort(([a], [b]) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
  }
  return all.sort(([, x], [, y]) => x.localeCompare(y, undefined, { numeric: true }));
}

export function ActivityEditor({ doc, activity: a, cal, tz, t, readOnly, onSave, onClose }: ActivityEditorProps) {
  const [tab, setTab] = useState<Tab>('general');
  const [name, setName] = useState(a.name);
  const [code, setCode] = useState(a.code);
  const [type, setType] = useState<ActivityType>(a.type);
  const [duration, setDuration] = useState(formatDuration(a.duration, cal.hoursPerDay));
  const [calendarId, setCalendarId] = useState(a.calendarId ?? '');
  const [towerId, setTowerId] = useState(a.towerId ?? '');
  const [floorId, setFloorId] = useState(a.floorId ?? '');
  const [tradeId, setTradeId] = useState(a.activityTemplateId ?? '');
  const [newName, setNewName] = useState<Record<'tower' | 'floor' | 'trade', string>>({ tower: '', floor: '', trade: '' });
  const [constraint, setConstraint] = useState<ConstraintType>(a.constraint);
  const [constraintDate, setConstraintDate] = useState(toInputValue(tz, a.constraintDate));
  const [deadline, setDeadline] = useState(toInputValue(tz, a.deadline));
  const [actualStart, setActualStart] = useState(toInputValue(tz, a.actualStart));
  const [actualFinish, setActualFinish] = useState(toInputValue(tz, a.actualFinish));
  const [percent, setPercent] = useState(a.percentComplete !== undefined ? String(a.percentComplete / 100) : '');
  const [remaining, setRemaining] = useState(a.remaining !== undefined ? formatDuration(a.remaining, cal.hoursPerDay) : '');
  const [notes, setNotes] = useState(a.notes ?? '');
  const initialPreds = useMemo<PredRow[]>(() => doc.links.filter((l) => l.to === a.id).map((l) => ({ linkId: l.id, from: l.from, type: l.type, lag: l.lag ? formatDuration(l.lag, cal.hoursPerDay) : '0d' })), [doc.links, a.id, cal.hoursPerDay]);
  const [preds, setPreds] = useState<PredRow[]>(initialPreds);
  const [removedSuccs, setRemovedSuccs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const others = useMemo(() => doc.activities.filter((x) => x.id !== a.id && x.type !== 'summary').sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true })), [doc.activities, a.id]);
  const byId = useMemo(() => new Map(doc.activities.map((x) => [x.id, x])), [doc.activities]);
  const succs = doc.links.filter((l) => l.to !== a.id && l.from === a.id);

  const save = () => {
    const cmds: Command[] = [];
    const patch: ActivityPatch = {};
    if (name !== a.name) patch.name = name;
    if (code !== a.code) patch.code = code;
    if (type !== a.type) patch.type = type;
    const d = parseDuration(duration, cal.hoursPerDay);
    if (d === null || d < 0) { setError(`${t('duration')}: "${duration}"`); return; }
    if (d !== a.duration) patch.duration = d;
    // New towers, floors and trades typed here are added to the project first, in the same undoable batch.
    const lookups: LookupsPatch = {};
    const resolve = (kind: 'tower' | 'floor' | 'trade', sel: string, existing: [string, string][], prefix: string): string | null | false => {
      if (sel !== NEW) return sel || null;
      const typed = newName[kind].trim();
      if (!typed) { setError(t('lookupNameNeeded', { what: t(kind) })); return false; }
      const hit = existing.find(([, n]) => n.toLowerCase() === typed.toLowerCase());
      if (hit) return hit[0];
      const id = lookupId(prefix, typed, existing.map(([i]) => i));
      if (kind === 'tower') lookups.towers = { [id]: typed };
      if (kind === 'floor') { lookups.floors = { [id]: typed }; if (doc.floorOrder) lookups.floorOrder = [...doc.floorOrder, id]; }
      if (kind === 'trade') lookups.templates = [...(doc.templates ?? []), { id, name: typed }];
      return id;
    };
    const tw = resolve('tower', towerId, Object.entries(doc.towers ?? {}), 'T');
    const fl = resolve('floor', floorId, Object.entries(doc.floors ?? {}), 'F');
    const tr = resolve('trade', tradeId, tradeOptions(doc), 'TR');
    if (tw === false || fl === false || tr === false) return;
    if (Object.keys(lookups).length) cmds.push(cmd({ kind: 'updateLookups', patch: lookups }));
    if ((tw ?? undefined) !== a.towerId) patch.towerId = tw;
    if ((fl ?? undefined) !== a.floorId) patch.floorId = fl;
    if ((tr ?? undefined) !== a.activityTemplateId) patch.activityTemplateId = tr;
    const dl = fromInputValue(tz, deadline);
    if (dl !== a.deadline) patch.deadline = dl ?? null;
    if ((notes || undefined) !== a.notes) patch.notes = notes || null;
    if (Object.keys(patch).length) cmds.push(cmd({ kind: 'updateActivity', activityId: a.id, patch }));
    if ((calendarId || undefined) !== a.calendarId) cmds.push(cmd({ kind: 'setCalendar', activityId: a.id, calendarId: calendarId || null }));
    const cd = fromInputValue(tz, constraintDate);
    if (constraint !== a.constraint || cd !== a.constraintDate) {
      cmds.push(cmd({ kind: 'setConstraint', activityId: a.id, constraint, constraintDate: cd ?? null }));
    }
    const as = fromInputValue(tz, actualStart), af = fromInputValue(tz, actualFinish);
    const pct = percent === '' ? undefined : Math.round(Number(percent) * 100);
    const rem = remaining === '' ? undefined : parseDuration(remaining, cal.hoursPerDay) ?? undefined;
    if (pct !== undefined && (Number.isNaN(pct) || pct < 0 || pct > 10000)) { setError(`${t('percentComplete')}: 0–100`); return; }
    if (as !== a.actualStart || af !== a.actualFinish || pct !== a.percentComplete || rem !== a.remaining) {
      cmds.push(cmd({ kind: 'setProgress', activityId: a.id, progress: { actualStart: as ?? null, actualFinish: af ?? null, percentComplete: pct ?? null, remaining: rem ?? null } }));
    }
    // Predecessors diff
    const keep = new Set<string>();
    for (const p of preds) {
      if (!p.from) continue;
      const lag = parseDuration(p.lag || '0', cal.hoursPerDay);
      if (lag === null) { setError(`${t('lag')}: "${p.lag}"`); return; }
      const existing = p.linkId ? doc.links.find((l) => l.id === p.linkId) : undefined;
      if (existing && existing.from === p.from) {
        keep.add(existing.id);
        if (existing.type !== p.type || existing.lag !== lag) cmds.push(cmd({ kind: 'updateLink', linkId: existing.id, patch: { type: p.type, lag } }));
      } else {
        const link: LinkRecord = { id: newId('lnk'), from: p.from, to: a.id, type: p.type, lag };
        cmds.push(cmd({ kind: 'addLink', link }));
      }
    }
    for (const l of initialPreds) if (l.linkId && !keep.has(l.linkId)) cmds.unshift(cmd({ kind: 'deleteLink', linkId: l.linkId }));
    for (const id of removedSuccs) cmds.unshift(cmd({ kind: 'deleteLink', linkId: id }));
    onSave(cmds);
  };

  const field = (label: string, input: React.ReactNode) => (
    <label className="nm-field"><span>{label}</span>{input}</label>
  );
  const lookupField = (kind: 'tower' | 'floor' | 'trade', value: string, set: (v: string) => void, options: [string, string][], addLabel: string, example: string) => (
    <div className="nm-field">
      <label htmlFor={`nm-lk-${kind}`}>{t(kind)}</label>
      <div className="nm-lookup">
        <select id={`nm-lk-${kind}`} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {options.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          <option value={NEW}>{addLabel}</option>
        </select>
        {value === NEW && (
          <input autoFocus aria-label={t('lookupNewName', { what: t(kind) })} placeholder={example} value={newName[kind]}
            onChange={(e) => setNewName({ ...newName, [kind]: e.target.value })} />
        )}
      </div>
    </div>
  );

  return (
    <div className="nm-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nm-modal" role="dialog" aria-modal="true" aria-label={`${a.code} ${a.name}`} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
        <header className="nm-modal-head">
          <strong>{a.code}</strong> <span>{a.name}</span>
          <button type="button" className="nm-icon-btn" aria-label={t('close')} onClick={onClose}>×</button>
        </header>
        <div className="nm-tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'active' : ''} onClick={() => setTab(x)}>{t(x)}</button>
          ))}
        </div>
        <fieldset className="nm-modal-body" disabled={readOnly}>
          {tab === 'general' && (
            <div className="nm-form">
              {field(t('name'), <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />)}
              {field(t('code'), <input value={code} onChange={(e) => setCode(e.target.value)} />)}
              {field(t('type'), <select value={type} onChange={(e) => setType(e.target.value as ActivityType)}>{TYPES.map((x) => <option key={x} value={x}>{t(x)}</option>)}</select>)}
              {field(t('duration'), <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="5d, 3w, 16h" />)}
              {field(t('calendar'), <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}><option value="">{t('defaultCal')}</option>{doc.calendars.map((c) => <option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}</select>)}
              {lookupField('tower', towerId, setTowerId, Object.entries(doc.towers ?? {}), t('addTower'), 'Tower A')}
              {lookupField('floor', floorId, setFloorId, floorOptions(doc), t('addFloor'), 'Floor 1')}
              {lookupField('trade', tradeId, setTradeId, tradeOptions(doc), t('addTrade'), t('tradeExample'))}
              <p className="nm-form-hint">{t('lookupHint')}</p>
            </div>
          )}
          {tab === 'predecessors' && (
            <div className="nm-form">
              <table className="nm-mini-table">
                <thead><tr><th>{t('activity')}</th><th>{t('linkType')}</th><th>{t('lag')}</th><th /></tr></thead>
                <tbody>
                  {preds.map((p, i) => (
                    <tr key={p.linkId ?? `new-${i}`}>
                      <td>
                        <select value={p.from} onChange={(e) => setPreds(preds.map((x, j) => (j === i ? { ...x, from: e.target.value, linkId: undefined } : x)))}>
                          <option value="">—</option>
                          {others.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.name}</option>)}
                        </select>
                      </td>
                      <td><select value={p.type} onChange={(e) => setPreds(preds.map((x, j) => (j === i ? { ...x, type: e.target.value as LinkType } : x)))}>{LINK_TYPES.map((x) => <option key={x}>{x}</option>)}</select></td>
                      <td><input size={6} value={p.lag} onChange={(e) => setPreds(preds.map((x, j) => (j === i ? { ...x, lag: e.target.value } : x)))} /></td>
                      <td><button type="button" className="nm-link-btn" onClick={() => setPreds(preds.filter((_, j) => j !== i))}>{t('remove')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="nm-btn" onClick={() => setPreds([...preds, { from: '', type: 'FS', lag: '0d' }])}>+ {t('add')}</button>
            </div>
          )}
          {tab === 'successors' && (
            <table className="nm-mini-table">
              <thead><tr><th>{t('activity')}</th><th>{t('linkType')}</th><th>{t('lag')}</th><th /></tr></thead>
              <tbody>
                {succs.filter((l) => !removedSuccs.has(l.id)).map((l) => {
                  const s = byId.get(l.to);
                  return (
                    <tr key={l.id}>
                      <td>{s?.code} · {s?.name}</td><td>{l.type}</td><td>{formatDuration(l.lag, cal.hoursPerDay)}</td>
                      <td><button type="button" className="nm-link-btn" onClick={() => setRemovedSuccs(new Set([...removedSuccs, l.id]))}>{t('remove')}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {tab === 'constraints' && (
            <div className="nm-form">
              {field(t('constraint'), <select value={constraint} onChange={(e) => setConstraint(e.target.value as ConstraintType)}>{CONSTRAINTS.map((x) => <option key={x}>{x}</option>)}</select>)}
              {constraint !== 'ASAP' && constraint !== 'ALAP' && field(t('constraintDate'), <input type="datetime-local" value={constraintDate} onChange={(e) => setConstraintDate(e.target.value)} />)}
              {field(t('deadline'), <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />)}
            </div>
          )}
          {tab === 'progress' && (
            <div className="nm-form">
              {field(t('actualStart'), <input type="datetime-local" value={actualStart} onChange={(e) => setActualStart(e.target.value)} />)}
              {field(t('actualFinish'), <input type="datetime-local" value={actualFinish} onChange={(e) => setActualFinish(e.target.value)} />)}
              {field(t('percentComplete'), <input type="number" min={0} max={100} step={1} value={percent} onChange={(e) => setPercent(e.target.value)} />)}
              {field(t('remaining'), <input value={remaining} onChange={(e) => setRemaining(e.target.value)} placeholder="2d" />)}
            </div>
          )}
          {tab === 'notes' && <textarea className="nm-notes" rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label={t('notes')} />}
        </fieldset>
        {error && <div className="nm-error" role="alert">{error}</div>}
        <footer className="nm-modal-foot">
          <button type="button" className="nm-btn" onClick={onClose}>{t('cancel')}</button>
          {!readOnly && <button type="button" className="nm-btn primary" onClick={save}>{t('save')}</button>}
        </footer>
      </div>
    </div>
  );
}

export interface LinkEditorProps {
  link: LinkRecord;
  doc: ScheduleDoc;
  hoursPerDay: number;
  t: Translate;
  onSave: (cmds: Command[]) => void;
  onClose: () => void;
}

export function LinkEditor({ link, doc, hoursPerDay, t, onSave, onClose }: LinkEditorProps) {
  const [type, setType] = useState<LinkType>(link.type);
  const [lag, setLag] = useState(formatDuration(link.lag, hoursPerDay));
  const [error, setError] = useState<string | null>(null);
  const from = doc.activities.find((a) => a.id === link.from), to = doc.activities.find((a) => a.id === link.to);
  return (
    <div className="nm-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nm-modal small" role="dialog" aria-modal="true" aria-label={t('editLink')} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
        <header className="nm-modal-head"><strong>{t('editLink')}</strong><span>{from?.code} → {to?.code}</span></header>
        <div className="nm-form nm-modal-body">
          <label className="nm-field"><span>{t('linkType')}</span><select autoFocus value={type} onChange={(e) => setType(e.target.value as LinkType)}>{LINK_TYPES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="nm-field"><span>{t('lag')}</span><input value={lag} onChange={(e) => setLag(e.target.value)} /></label>
        </div>
        {error && <div className="nm-error" role="alert">{error}</div>}
        <footer className="nm-modal-foot">
          <button type="button" className="nm-btn danger" onClick={() => onSave([cmd({ kind: 'deleteLink', linkId: link.id })])}>{t('deleteLink')}</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="nm-btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="nm-btn primary" onClick={() => {
            const v = parseDuration(lag || '0', hoursPerDay);
            if (v === null) { setError(`${t('lag')}: "${lag}"`); return; }
            if (v === link.lag && type === link.type) { onClose(); return; }
            onSave([cmd({ kind: 'updateLink', linkId: link.id, patch: { type, lag: v } })]);
          }}>{t('save')}</button>
        </footer>
      </div>
    </div>
  );
}
