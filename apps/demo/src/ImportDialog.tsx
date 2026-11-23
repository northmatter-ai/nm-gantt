import { useEffect, useRef, useState } from 'react';
import type { ImportReport } from '@northmatter/schedule-io';

export interface PendingImport {
  fileName: string;
  format: 'Excel' | 'MS Project XML';
  name: string;
  report: ImportReport;
}

/** Dry-run report for an import (spec: "Dry run first"); nothing is saved until the planner confirms. */
export function ImportDialog({ pending, onCreate, onClose }: { pending: PendingImport; onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(pending.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);
  const r = pending.report;
  const errors = r.errors.length;
  const section = (title: string, items: string[], cls = '') =>
    items.length > 0 && (
      <details open={items.length <= 8} className={`rep ${cls}`}>
        <summary>{title} ({items.length})</summary>
        <ul>{items.slice(0, 200).map((x, i) => <li key={i}>{x}</li>)}</ul>
        {items.length > 200 && <p>…and {items.length - 200} more</p>}
      </details>
    );
  return (
    <div className="dlg-backdrop" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="dlg dlg-wide" role="dialog" aria-modal="true" aria-labelledby="imp-title"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim()); }}>
        <h2 id="imp-title">Import {pending.format}: check before creating</h2>
        <p className="muted">{pending.fileName} · nothing is saved until you create the project.</p>
        <p className="rep-counts" aria-label="Import summary">
          <b>{r.counts.activities}</b> activities · <b>{r.counts.links}</b> links · <b>{r.counts.calendars}</b> calendars ·{' '}
          <b className={errors ? 'bad' : ''}>{errors}</b> errors · <b>{r.warnings.length}</b> warnings
        </p>
        <label className="fld"><span>Project name</span><input ref={ref} value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" /></label>
        <div className="rep-list">
          {section('Errors: the schedule cannot be calculated until these are fixed', r.errors.map((e) => e.message), 'bad')}
          {section('Skipped', r.unmapped)}
          {section('Converted', r.conversions)}
          {section('Warnings', r.warnings.map((w) => w.message))}
          {!errors && !r.unmapped.length && !r.conversions.length && !r.warnings.length && <p>Everything imported as written.</p>}
        </div>
        <div className="dlg-foot">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!name.trim()}>{errors ? 'Create project anyway' : 'Create project'}</button>
        </div>
      </form>
    </div>
  );
}
