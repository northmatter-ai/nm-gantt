import { useState } from 'react';

export interface NewProjectInput {
  name: string;
  /** YYYY-MM-DD */
  start: string;
  template: 'blank' | 'towers';
  towers: number;
  floors: number;
}

export function NewProjectDialog({ onCreate, onClose }: { onCreate: (p: NewProjectInput) => void; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState('');
  const [start, setStart] = useState(today);
  const [template, setTemplate] = useState<'blank' | 'towers'>('towers');
  const [towers, setTowers] = useState(2);
  const [floors, setFloors] = useState(12);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Give the project a name.'); return; }
    if (!start) { setError('Pick a start date.'); return; }
    if (template === 'towers' && (towers < 1 || towers > 8 || floors < 1 || floors > 80)) { setError('Towers 1–8, floors 1–80.'); return; }
    onCreate({ name: name.trim(), start, template, towers, floors });
  };

  return (
    <div className="dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dlg" role="dialog" aria-modal="true" aria-labelledby="np-title" onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <h2 id="np-title">New project</h2>
        <label className="fld"><span>Project name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sector 21 residences" aria-label="Project name" />
        </label>
        <label className="fld"><span>Start date</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start date" />
        </label>
        <fieldset className="fld">
          <legend>Start with</legend>
          <label className="opt"><input type="radio" name="tpl" checked={template === 'towers'} onChange={() => setTemplate('towers')} />
            <span><b>Tower schedule</b><br /><small>Mobilisation, substructure, a floor-by-floor cycle of 7 trades, facade, lifts and handover per tower — all linked, ready to adjust.</small></span>
          </label>
          <label className="opt"><input type="radio" name="tpl" checked={template === 'blank'} onChange={() => setTemplate('blank')} />
            <span><b>Blank</b><br /><small>No activities. Add them with <b>+ Activity</b> or Insert.</small></span>
          </label>
        </fieldset>
        {template === 'towers' && (
          <div className="row2">
            <label className="fld"><span>Towers</span><input type="number" min={1} max={8} value={towers} onChange={(e) => setTowers(Number(e.target.value))} aria-label="Towers" /></label>
            <label className="fld"><span>Floors per tower</span><input type="number" min={1} max={80} value={floors} onChange={(e) => setFloors(Number(e.target.value))} aria-label="Floors per tower" /></label>
          </div>
        )}
        {error && <p className="dlg-error" role="alert">{error}</p>}
        <div className="dlg-foot">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Create project</button>
        </div>
      </form>
    </div>
  );
}
