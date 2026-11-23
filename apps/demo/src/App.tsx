import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatLocal, instantFromEpochMs, parseLocal } from '@northmatter/calendar';
import { createUndoHistory, Gantt, PhoneSchedule, type FilterSpec, type GanttHandle, type GroupBy, type Locale, type Zoom } from '@northmatter/gantt';
import { LineOfBalance, LookAhead, TowerFloorGrid } from '@northmatter/construction-views';
import { toScheduleInput } from '@northmatter/schedule-commands';
import { calculate } from '@northmatter/schedule-engine';
import { excelTemplate, exportExcel, exportMspdi, importExcel, importMspdi } from '@northmatter/schedule-io';
import { MockPlanningServer, type ServerState } from './mockServer';
import { blankProject, calendars, FLOOR_TEMPLATES, largeSchedule, sampleSchedule, stressTower, withProgress } from './sample';
import { ImportDialog, type PendingImport } from './ImportDialog';
import { NewProjectDialog, type NewProjectInput } from './NewProjectDialog';
import { listProjects, newProjectId, projectSource, projectStorageKey, removeProjectData, saveProjects, STORAGE, type ProjectEntry } from './projects';
import type { ScheduleDoc } from '@northmatter/schedule-commands';
import { mockSite } from './siteMock';

/** 'sample' | 'large' | 'tower40' | `p:<project id>` */
type Source = string;
type Tab = 'gantt' | 'grid' | 'lob' | 'lookahead' | 'phone';
const TABS: { id: Tab; label: string }[] = [
  { id: 'gantt', label: 'Gantt' },
  { id: 'grid', label: 'Tower × floor' },
  { id: 'lob', label: 'Line of balance' },
  { id: 'lookahead', label: 'Look-ahead' },
  { id: 'phone', label: 'Phone' },
];

/** Phones get the read-only phone view (spec: no editing on phones). ?view=phone or ?view=desktop overrides. */
function usePhoneLayout(): boolean {
  const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('view') : null;
  const query = '(max-width: 700px)';
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return forced === 'phone' ? true : forced === 'desktop' ? false : narrow;
}
type Theme = 'system' | 'light' | 'dark';


function buildSample(): MockPlanningServer {
  const doc = sampleSchedule();
  const first = calculate(toScheduleInput(doc));
  const server = new MockPlanningServer(doc, [], `${STORAGE}:sample`);
  server.saveBaseline('Baseline 1 — approved Nov 2026');
  const dataDate = parseLocal('Asia/Kolkata', '2027-01-11T09:00');
  server.replace(withProgress(doc, first.activities, dataDate));
  return server;
}

function makeServer(source: Source): MockPlanningServer {
  if (source === 'sample') return MockPlanningServer.restore(`${STORAGE}:sample`) ?? buildSample();
  if (source === 'large') return new MockPlanningServer(largeSchedule());
  if (source === 'tower40') return new MockPlanningServer(stressTower());
  if (source.startsWith('p:')) return MockPlanningServer.restore(projectStorageKey(source.slice(2))) ?? buildSample();
  return MockPlanningServer.restore(`${STORAGE}:sample`) ?? buildSample();
}

/** Create and persist a project; returns its server. */
function createProjectServer(doc: ScheduleDoc, id: string): MockPlanningServer {
  const server = new MockPlanningServer(doc, [], projectStorageKey(id));
  server.replace(doc); // persists
  return server;
}

export function App() {
  const [source, setSource] = useState<Source>(() => {
    try {
      const s = localStorage.getItem(`${STORAGE}:source`) || 'sample';
      return s === 'imported' ? 'sample' : s;
    } catch { return 'sample'; }
  });
  const [projects, setProjectsState] = useState<ProjectEntry[]>(listProjects);
  const setProjects = (list: ProjectEntry[]) => { setProjectsState(list); saveProjects(list); };
  const [newOpen, setNewOpen] = useState(false);
  const [server, setServerRaw] = useState(() => makeServer(source));
  const [epoch, setEpoch] = useState(0);
  const setServer = (s: MockPlanningServer) => { setServerRaw(s); setEpoch((n) => n + 1); };
  const [state, setState] = useState<ServerState>(server.current);
  // One undo history per open project; it outlives the Gantt when you switch tabs.
  const undoHistory = useMemo(() => createUndoHistory(), [server]);
  useEffect(() => { setState(server.current); return server.subscribe(setState); }, [server]);

  const [zoom, setZoom] = useState<Zoom>('week');
  const [groupBy, setGroupBy] = useState<GroupBy>('wbs');
  const [filter, setFilter] = useState<FilterSpec>({});
  const [baselineOn, setBaselineOn] = useState(true);
  const [showFloat, setShowFloat] = useState(false);
  const [compact, setCompact] = useState(false);
  const [locale, setLocale] = useState<Locale>('en');
  const phone = usePhoneLayout();
  const [theme, setTheme] = useState<Theme>('system');
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [selected, setSelected] = useState<string[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [report, setReport] = useState<string[] | null>(null);
  const [pendingImport, setPendingImport] = useState<(PendingImport & { doc: ScheduleDoc }) | null>(null);
  const gantt = useRef<GanttHandle>(null);
  const [tab, setTabRaw] = useState<Tab>(() => {
    try { return (localStorage.getItem(`${STORAGE}:tab`) as Tab) || 'gantt'; } catch { return 'gantt'; }
  });
  const setTab = (x: Tab) => { setTabRaw(x); try { localStorage.setItem(`${STORAGE}:tab`, x); } catch { /* ignore */ } };
  const site = useMemo(() => mockSite(state.doc, state.results), [state.doc, state.results]);
  const pendingFocus = useRef<string | null>(null);
  const openInGantt = (id: string) => { pendingFocus.current = id; setTab('gantt'); };
  const pendingSetup = useRef(false);
  const openSetup = () => {
    if (tab === 'gantt') { gantt.current?.openSetup(); return; }
    pendingSetup.current = true;
    setTab('gantt');
  };
  useEffect(() => {
    if (tab !== 'gantt' || !pendingSetup.current) return;
    pendingSetup.current = false;
    requestAnimationFrame(() => gantt.current?.openSetup());
  }, [tab]);
  useEffect(() => {
    if (tab !== 'gantt' || !pendingFocus.current) return;
    const id = pendingFocus.current;
    pendingFocus.current = null;
    requestAnimationFrame(() => gantt.current?.focusActivity(id));
  }, [tab]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const switchSource = (s: Source) => {
    try { localStorage.setItem(`${STORAGE}:source`, s); } catch { /* ignore */ }
    setSource(s);
    setServer(makeServer(s));
  };

  const onCommands = useCallback((cmds: Parameters<MockPlanningServer['commands']>[0]) => server.commands(cmds), [server]);

  const tz = state.doc.calendars.find((c) => c.id === state.doc.defaultCalendarId)?.timeZone ?? 'Asia/Kolkata';
  const version = useMemo(() => ({ doc: state.doc, results: state.results, baselines: state.baselines }), [state]);
  const res = state.results;
  const critical = Object.values(res.activities).filter((r) => r.isCritical && state.doc.activities.find((a) => a.id === r.id)?.type !== 'summary').length;

  const download = (name: string, data: string | Uint8Array, type: string) => {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const openProject = (entry: ProjectEntry, srv: MockPlanningServer) => {
    setProjects([...projects.filter((p) => p.id !== entry.id), entry]);
    try { localStorage.setItem(`${STORAGE}:source`, projectSource(entry.id)); } catch { /* ignore */ }
    setSource(projectSource(entry.id));
    setServer(srv);
    setTab('gantt');
  };

  const createProject = (p: NewProjectInput) => {
    const id = newProjectId();
    const start = parseLocal('Asia/Kolkata', `${p.start}T09:00`);
    const doc = p.template === 'blank'
      ? blankProject(id, p.name, start)
      : sampleSchedule(p.floors, { id, name: p.name, start, towers: p.towers, deadlines: false });
    setNewOpen(false);
    openProject({ id, name: p.name, createdAt: Date.now() }, createProjectServer(doc, id));
  };

  const deleteProject = () => {
    if (!source.startsWith('p:')) return;
    const id = source.slice(2);
    const entry = projects.find((p) => p.id === id);
    if (!window.confirm(`Delete "${entry?.name ?? 'this project'}"? This cannot be undone.`)) return;
    removeProjectData(id);
    setProjects(projects.filter((p) => p.id !== id));
    switchSource('sample');
  };

  /** Dry run: parse and calculate, then show the report; the project is created only on confirm. */
  const onImport = async (file: File) => {
    try {
      const isExcel = /\.xlsx$/i.test(file.name);
      if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. In Excel, use File → Save As → Excel Workbook (.xlsx).');
      const name = file.name.replace(/\.(xml|xlsx)$/i, '');
      const today = formatLocal('Asia/Kolkata', instantFromEpochMs(Date.now())).slice(0, 10);
      const { doc, report: r } = isExcel
        ? importExcel(await file.arrayBuffer(), { name, calendars: calendars(), defaultCalendarId: 'site', templates: FLOOR_TEMPLATES.map((x) => ({ id: x.key, name: x.name, short: x.short })), projectStart: parseLocal('Asia/Kolkata', `${today}T09:00`) })
        : importMspdi(await file.text(), { name });
      setReport(null);
      setPendingImport({ doc, report: r, fileName: file.name, format: isExcel ? 'Excel' : 'MS Project XML', name: doc.name || name });
    } catch (e) {
      setReport([`Import failed: ${e instanceof Error ? e.message : String(e)}`]);
    }
  };

  const confirmImport = (name: string) => {
    if (!pendingImport) return;
    const id = newProjectId();
    openProject({ id, name, createdAt: Date.now() }, createProjectServer({ ...pendingImport.doc, id, name }, id));
    setPendingImport(null);
  };

  const fileStem = state.doc.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'schedule';
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const setDataDate = (v: string) => {
    if (!v) return;
    server.replace({ ...state.doc, dataDate: parseLocal(tz, `${v}T09:00`) });
  };

  const resetSample = () => {
    try { localStorage.removeItem(`${STORAGE}:sample`); } catch { /* ignore */ }
    setServer(buildSample());
  };

  const towers = state.doc.towers ?? {};
  const baseline = baselineOn ? state.baselines[state.baselines.length - 1]?.id : undefined;
  const issues = [...res.errors, ...res.warnings];
  const latestBaseline = state.baselines[state.baselines.length - 1]?.id;

  if (phone) {
    return (
      <div className="phone-app">
        <header className="phone-top">
          <select aria-label="Schedule" value={source} onChange={(e) => switchSource(e.target.value)}>
            {projects.length > 0 && (
              <optgroup label="Your projects">
                {[...projects].sort((a, b) => b.createdAt - a.createdAt).map((p) => <option key={p.id} value={projectSource(p.id)}>{p.name}</option>)}
              </optgroup>
            )}
            <optgroup label="Samples">
              <option value="sample">Sample: 2 towers</option>
              <option value="large">Stress: 5,000 activities</option>
              <option value="tower40">Stress: tower 40 floors × 30 trades</option>
            </optgroup>
          </select>
          <button type="button" aria-label="Language" onClick={() => setLocale(locale === 'en' ? 'hi' : 'en')}>{locale === 'en' ? 'हि' : 'EN'}</button>
        </header>
        <PhoneSchedule key={`${source}-${epoch}`} version={version} locale={locale} {...(latestBaseline ? { showBaselineId: latestBaseline } : {})} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="toolbar" role="toolbar" aria-label="Schedule tools">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="11" height="4" rx="1.5" fill="currentColor" /><rect x="7" y="10" width="13" height="4" rx="1.5" fill="currentColor" opacity=".7" /><rect x="12" y="16" width="9" height="4" rx="1.5" fill="currentColor" opacity=".45" /></svg>
          <div>
            <strong>{state.doc.name}</strong>
            <span className="sub">v{state.doc.version} · {state.doc.kind} · data date {formatLocal(tz, state.doc.dataDate).slice(0, 10)}</span>
          </div>
        </div>

        <div className="group">
          <select aria-label="Schedule" value={source} onChange={(e) => switchSource(e.target.value)}>
            {projects.length > 0 && (
              <optgroup label="Your projects">
                {[...projects].sort((a, b) => b.createdAt - a.createdAt).map((p) => <option key={p.id} value={projectSource(p.id)}>{p.name}</option>)}
              </optgroup>
            )}
            <optgroup label="Samples">
              <option value="sample">Sample: 2 towers</option>
              <option value="large">Stress: 5,000 activities</option>
              <option value="tower40">Stress: tower 40 floors × 30 trades</option>
            </optgroup>
          </select>
          <button type="button" className="primary" onClick={() => setNewOpen(true)}>+ New project</button>
          <button type="button" onClick={() => fileRef.current?.click()} title="Excel (.xlsx) in the template layout, or MS Project XML (.xml)">Import…</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xml,.xls" hidden aria-label="Import file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ''; }} />
          <select aria-label="Export" value="" onChange={(e) => {
            const v = e.target.value;
            e.target.value = '';
            if (v === 'xlsx') download(`${fileStem}.xlsx`, exportExcel(state.doc, state.results), XLSX);
            if (v === 'xml') download(`${fileStem}.xml`, exportMspdi(state.doc, state.results), 'application/xml');
            if (v === 'template') download('nm-schedule-template.xlsx', excelTemplate(), XLSX);
          }}>
            <option value="" disabled>Export…</option>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="xml">MS Project XML (.xml)</option>
            <option value="template">Blank Excel template</option>
          </select>
          {source === 'sample' && <button type="button" onClick={resetSample} title="Discard edits and rebuild the sample">Reset</button>}
          {source.startsWith('p:') && <button type="button" onClick={deleteProject}>Delete project</button>}
        </div>

        <div className="group">
          <button type="button" onClick={() => gantt.current?.undo()} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">↶</button>
          <button type="button" onClick={() => gantt.current?.redo()} title="Redo (Shift+Ctrl/Cmd+Z)" aria-label="Redo">↷</button>
          <button type="button" onClick={() => gantt.current?.addActivity()} disabled={mode !== 'edit'}>+ Activity</button>
          <button type="button" onClick={openSetup} disabled={mode !== 'edit'} title="Add, rename and order towers, floors and trades">Towers, floors & trades…</button>
          <button type="button" onClick={() => gantt.current?.scrollToDate(instantFromEpochMs(Date.now()))}>Today</button>
          <button type="button" onClick={() => gantt.current?.expandAll()}>Expand</button>
          <button type="button" onClick={() => gantt.current?.collapseAll()}>Collapse</button>
        </div>

        <div className="group">
          <label>Zoom <select aria-label="Zoom" value={zoom} onChange={(e) => setZoom(e.target.value as Zoom)}>{['day', 'week', 'month', 'quarter', 'year'].map((z) => <option key={z}>{z}</option>)}</select></label>
          <label>Group <select aria-label="Group" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}><option value="wbs">WBS</option><option value="tower">Tower</option><option value="floor">Floor</option><option value="none">Flat</option></select></label>
          <label>Tower <select aria-label="Tower" value={filter.towerId ?? ''} onChange={(e) => setFilter({ ...filter, towerId: e.target.value || undefined })}><option value="">All</option>{Object.entries(towers).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          <label>Status <select aria-label="Status" value={filter.status?.[0] ?? ''} onChange={(e) => setFilter({ ...filter, status: e.target.value ? [e.target.value as 'in_progress'] : undefined })}><option value="">All</option><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="complete">Complete</option></select></label>
          <input type="search" placeholder="Find…" aria-label="Find activity" value={filter.text ?? ''} onChange={(e) => setFilter({ ...filter, text: e.target.value || undefined })} />
        </div>

        <div className="group toggles">
          <label><input type="checkbox" checked={!!filter.criticalOnly} onChange={(e) => setFilter({ ...filter, criticalOnly: e.target.checked })} /> Critical</label>
          <label><input type="checkbox" checked={!!filter.longestPath} onChange={(e) => setFilter({ ...filter, longestPath: e.target.checked })} /> Longest path</label>
          <label><input type="checkbox" checked={!!filter.negativeFloat} onChange={(e) => setFilter({ ...filter, negativeFloat: e.target.checked })} /> Negative float</label>
          <label><input type="checkbox" checked={baselineOn} onChange={(e) => setBaselineOn(e.target.checked)} disabled={!state.baselines.length} /> Baseline</label>
          <label><input type="checkbox" checked={showFloat} onChange={(e) => setShowFloat(e.target.checked)} /> Float</label>
          <label><input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} /> Compact</label>
        </div>

        <div className="group">
          <label>Data date <input aria-label="Data date" type="date" value={formatLocal(tz, state.doc.dataDate).slice(0, 10)} onChange={(e) => setDataDate(e.target.value)} /></label>
          <button type="button" onClick={() => server.saveBaseline(`Baseline ${state.baselines.length + 1}`)}>Save baseline</button>
          <select aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value as 'edit' | 'view')}><option value="edit">Edit</option><option value="view">View only</option></select>
          <select aria-label="Language" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}><option value="en">English</option><option value="hi">हिन्दी</option></select>
          <select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}><option value="system">System theme</option><option value="light">Light</option><option value="dark">Dark</option></select>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Views">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>{x.label}</button>
        ))}
      </nav>

      <section className="stats" aria-live="polite">
        <span><b>{res.projectFinish !== undefined ? formatLocal(tz, res.projectFinish).replace('T', ' ') : '—'}</b> project finish</span>
        <span><b>{state.doc.activities.length.toLocaleString()}</b> activities</span>
        <span><b>{state.doc.links.length.toLocaleString()}</b> links</span>
        <span><b>{critical}</b> critical</span>
        <button type="button" className={`issues ${res.errors.length ? 'bad' : ''}`} onClick={() => setShowIssues((v) => !v)} aria-expanded={showIssues}>
          {res.errors.length ? `${res.errors.length} errors · ` : ''}{res.warnings.length} warnings
        </button>
        {selected.length > 0 && <span className="sel">{selected.length} selected</span>}
        {tab === 'gantt' && <span className="hint">Drag a bar to move it · drag either end to change start or finish · drag from a bar end to link · double-click to edit · Tab/Shift+Tab indent · Ins/Del · Ctrl+wheel zoom</span>}
      </section>

      {showIssues && (
        <section className="panel" aria-label="Schedule issues">
          <button type="button" className="close" onClick={() => setShowIssues(false)} aria-label="Close">×</button>
          <ul>{issues.slice(0, 300).map((i, n) => <li key={n} className={i.severity}><code>{i.code}</code> {i.message}</li>)}</ul>
          {issues.length > 300 && <p>…and {issues.length - 300} more</p>}
        </section>
      )}
      {report && (
        <section className="panel" aria-label="Import report">
          <button type="button" className="close" onClick={() => setReport(null)} aria-label="Close">×</button>
          <strong>Import report</strong>
          <ul>{report.slice(0, 300).map((r, n) => <li key={n}>{r}</li>)}</ul>
        </section>
      )}

      {pendingImport && <ImportDialog pending={pendingImport} onCreate={confirmImport} onClose={() => setPendingImport(null)} />}
      {newOpen && <NewProjectDialog onCreate={createProject} onClose={() => setNewOpen(false)} />}
      <main className={`main tab-${tab}`}>
        {tab === 'gantt' && (
          <Gantt
            ref={gantt}
            key={`${source}-${epoch}`}
            version={version}
            mode={mode}
            zoom={zoom}
            onZoomChange={setZoom}
            groupBy={groupBy}
            filter={filter}
            showBaselineId={baseline}
            showFloat={showFloat}
            compact={compact}
            locale={locale}
            onCommands={onCommands}
            onSelect={setSelected}
            history={undoHistory}
            userKey="demo"
          />
        )}
        {tab === 'grid' && (
          <TowerFloorGrid doc={state.doc} results={state.results} site={site} locale={locale}
            {...(baseline ? { baseline: state.baselines.find((b) => b.id === baseline)! } : {})} onOpenInGantt={openInGantt} />
        )}
        {tab === 'lob' && (
          <LineOfBalance key={`${source}-${epoch}`} doc={state.doc} results={state.results} site={site} baselines={state.baselines} locale={locale} />
        )}
        {tab === 'phone' && (
          <div className="phone-preview">
            <div className="phone-frame" aria-label="Phone preview">
              <PhoneSchedule key={`${source}-${epoch}`} version={version} locale={locale} {...(baseline ? { showBaselineId: baseline } : {})} />
            </div>
            <p>How the schedule looks on a phone (the Site app). It opens automatically on screens narrower than 700&nbsp;px. Read-only: pinch or use +/− to zoom the bars, swipe sideways to move in time, tap an activity for details.</p>
          </div>
        )}
        {tab === 'lookahead' && (
          <LookAhead key={`${source}-${epoch}`} doc={state.doc} results={state.results} site={site} locale={locale} projectName={state.doc.name} onOpenInGantt={openInGantt} />
        )}
      </main>
    </div>
  );
}
