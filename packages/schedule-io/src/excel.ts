/**
 * Excel import and export with the spec's single template (spec: "Import and export → Excel"):
 * WBS, Code, Name, Type, Duration (days), Calendar, Predecessors, Constraint, Constraint date, Tower, Floor,
 * Actual start, Actual finish, % complete. Predecessors use MS Project's text form ("12FS+2d; 15SS") and refer
 * to codes or WBS numbers. Import returns the same dry-run report as MSPDI and never saves anything itself.
 * Interpretations: DECISIONS.md D-028 … D-030.
 */
import {
  compileCalendars,
  dayStartInstant,
  dayToIso,
  defaultTenantCalendar,
  instantToLocal,
  isoToDay,
  parseLocal,
  type CalendarInput,
  type CompiledCalendar,
  type Minutes,
} from '@northmatter-ai/calendar';
import { calculate, type ActivityType, type ConstraintType, type ScheduleResult } from '@northmatter-ai/schedule-engine';
import {
  evenKeys,
  formatDuration,
  lookupId,
  parseDuration,
  parsePredecessors,
  toScheduleInput,
  type ActivityRecord,
  type ScheduleDoc,
} from '@northmatter-ai/schedule-commands';
import { resolveLinks, type PendingLink } from './links.js';
import type { ImportReport, ImportResult } from './mspdi.js';
import { readXlsx, writeXlsx, type CellValue, type SheetData, type WriteSheet } from './xlsx.js';

/** The template columns, in order. */
export const EXCEL_COLUMNS = [
  'WBS', 'Code', 'Name', 'Type', 'Duration (days)', 'Calendar', 'Predecessors', 'Constraint', 'Constraint date',
  'Tower', 'Floor', 'Actual start', 'Actual finish', '% complete',
] as const;
type Col = (typeof EXCEL_COLUMNS)[number] | typeof EXCEL_REMAINING_COLUMN | typeof EXCEL_TRADE_COLUMN;

/**
 * Optional column after the template: remaining working days of in-progress work. Written on export only where an
 * activity has an explicit remaining duration, so a round trip keeps the same forecast (D-028).
 */
export const EXCEL_REMAINING_COLUMN = 'Remaining (days)';

/** Optional column after the template: the trade (activity template) that puts an activity on the tower × floor grid (D-033). */
export const EXCEL_TRADE_COLUMN = 'Trade';

/** Written after the template on export so the sheet is useful to read; ignored on import. */
export const EXCEL_CALCULATED_COLUMNS = ['Start (calculated)', 'Finish (calculated)', 'Total float (days)', 'Critical'] as const;

const TYPE_LABEL: Record<ActivityType, string> = {
  task: 'Task', start_milestone: 'Start milestone', finish_milestone: 'Finish milestone', summary: 'Summary', level_of_effort: 'Level of effort',
};
const CONSTRAINT_WORDS: Record<string, ConstraintType> = {
  asap: 'ASAP', assoonaspossible: 'ASAP', alap: 'ALAP', aslateaspossible: 'ALAP',
  mso: 'MSO', muststarton: 'MSO', mfo: 'MFO', mustfinishon: 'MFO',
  snet: 'SNET', startnoearlierthan: 'SNET', snlt: 'SNLT', startnolaterthan: 'SNLT',
  fnet: 'FNET', finishnoearlierthan: 'FNET', fnlt: 'FNLT', finishnolaterthan: 'FNLT',
};
const START_CONSTRAINTS = new Set<ConstraintType>(['MSO', 'SNET', 'SNLT']);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, '');
const HEADER_ALIASES: Record<string, Col> = {
  wbs: 'WBS', outline: 'WBS', outlinenumber: 'WBS',
  code: 'Code', activitycode: 'Code', activityid: 'Code', id: 'Code',
  name: 'Name', activity: 'Name', activityname: 'Name', task: 'Name', taskname: 'Name', description: 'Name',
  type: 'Type', activitytype: 'Type',
  durationdays: 'Duration (days)', duration: 'Duration (days)', dur: 'Duration (days)', durationd: 'Duration (days)',
  calendar: 'Calendar',
  predecessors: 'Predecessors', predecessor: 'Predecessors', preds: 'Predecessors',
  constraint: 'Constraint', constrainttype: 'Constraint',
  constraintdate: 'Constraint date',
  tower: 'Tower', block: 'Tower',
  floor: 'Floor', level: 'Floor',
  actualstart: 'Actual start', actualfinish: 'Actual finish',
  trade: EXCEL_TRADE_COLUMN, worktype: EXCEL_TRADE_COLUMN, activitytemplate: EXCEL_TRADE_COLUMN, template: EXCEL_TRADE_COLUMN,
  remainingdays: EXCEL_REMAINING_COLUMN, remaining: EXCEL_REMAINING_COLUMN, remainingduration: EXCEL_REMAINING_COLUMN,
  '%complete': '% complete', complete: '% complete', percentcomplete: '% complete', pctcomplete: '% complete', progress: '% complete',
};
const CALCULATED = new Set(EXCEL_CALCULATED_COLUMNS.map(norm).concat(['start', 'finish', 'totalfloat', 'totalfloatdays', 'freefloat', 'critical']));

const PROJECT_SHEET = 'Project';
const PROJECT_FIELDS = { name: 'Project name', start: 'Project start', dataDate: 'Data date', timeZone: 'Time zone' } as const;

export interface ExcelImportOptions {
  /** Used when the workbook has no Project sheet name. */
  name?: string;
  /** Used when the workbook has no Project sheet time zone. Default Asia/Kolkata. */
  timeZone?: string;
  /** Calendars the Calendar column can name (by id or name). Default: the standard site calendar. */
  calendars?: CalendarInput[];
  defaultCalendarId?: string;
  /** Used when the workbook has no Project sheet start date. */
  projectStart?: Minutes;
  /** Used when the workbook has no Project sheet data date. Default: the project start. */
  dataDate?: Minutes;
  /** The tenant's trades; the Trade column matches their name, short name or id. Unknown trades are added. */
  templates?: { id: string; name: string; short?: string }[];
}

// ------------------------------------------------------------------ dates

interface DateText { day: number; time?: string }
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** A cell's date (Excel date, ISO text, dd/mm/yyyy, 1-Dec-2026) → local day number and optional HH:MM. */
export function readDateCell(v: CellValue): DateText | null | 'invalid' {
  if (v === null || v === '') return null;
  if (v instanceof Date) {
    const day = isoToDay(v.toISOString().slice(0, 10));
    const hh = v.getUTCHours(), mm = v.getUTCMinutes();
    return hh || mm ? { day, time: `${pad(hh)}:${pad(mm)}` } : { day };
  }
  if (typeof v !== 'string') return 'invalid';
  const s = v.trim();
  const time = /(?:[ T](\d{1,2}):(\d{2}))\s*$/.exec(s);
  const datePart = time ? s.slice(0, time.index).trim() : s;
  const t = time ? `${pad(Number(time[1]))}:${time[2]}` : undefined;
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(datePart))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(datePart))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s,-]+(\d{2}|\d{4})$/i.exec(datePart))) {
    const mi = MONTHS.indexOf(r[2]!.toLowerCase());
    if (mi >= 0) [d, m, y] = [Number(r[1]), mi + 1, Number(r[3])];
  }
  if (y === undefined || m === undefined || d === undefined) return 'invalid';
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return 'invalid';
  let day: number;
  try { day = isoToDay(`${y}-${pad(m)}-${pad(d)}`); } catch { return 'invalid'; }
  if (t && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t) && t !== '00:00') return { day, time: t };
  return { day };
}

/**
 * Date-only start dates mean the first working minute of that day; date-only finish dates mean the last working
 * minute of that day (D-029). A time of day, when given, is used as is.
 */
function toInstant(dt: DateText, kind: 'start' | 'finish', tz: string, cal: CompiledCalendar): Minutes {
  if (dt.time) {
    return parseLocal(tz, `${dayToIso(dt.day)}T${dt.time}`);
  }
  return kind === 'start' ? cal.nextWorkStart(dayStartInstant(tz, dt.day)) : cal.prevWorkEnd(dayStartInstant(tz, dt.day + 1));
}

/** Instant → Date whose UTC fields are the local wall clock (what Excel shows). */
function excelDate(tz: string, t: Minutes): Date {
  const p = instantToLocal(tz, t);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute));
}

// ------------------------------------------------------------------ import

const cellText = (v: CellValue | undefined): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
};

function findHeader(rows: CellValue[][]): { at: number; cols: Map<Col, number>; calculated: string[]; unknown: string[] } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cols = new Map<Col, number>();
    const calculated: string[] = [], unknown: string[] = [];
    (rows[r] ?? []).forEach((v, c) => {
      const text = cellText(v);
      if (!text) return;
      const key = norm(text);
      const col = HEADER_ALIASES[key];
      if (col && !cols.has(col)) cols.set(col, c);
      else if (CALCULATED.has(key)) calculated.push(text);
      else unknown.push(text);
    });
    if (cols.has('Name') && cols.size >= 3) return { at: r, cols, calculated, unknown };
  }
  return null;
}

function scheduleSheet(sheets: SheetData[]): { sheet: SheetData; header: NonNullable<ReturnType<typeof findHeader>> } | null {
  const ordered = [...sheets].sort((a, b) => (norm(a.name) === 'schedule' ? -1 : norm(b.name) === 'schedule' ? 1 : 0));
  for (const sheet of ordered) {
    if (norm(sheet.name) === norm(PROJECT_SHEET) || norm(sheet.name) === 'instructions') continue;
    const header = findHeader(sheet.rows);
    if (header) return { sheet, header };
  }
  return null;
}

function readProjectSheet(sheets: SheetData[]): Record<string, CellValue> {
  const sh = sheets.find((s) => norm(s.name) === norm(PROJECT_SHEET));
  const out: Record<string, CellValue> = {};
  for (const row of sh?.rows ?? []) {
    const k = norm(cellText(row[0]));
    if (k) out[k] = row[1] ?? null;
  }
  return out;
}

const slug = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'X';

/** Turn template rows into a schedule document; pure apart from the workbook parse. */
export function importExcelSheets(sheets: SheetData[], options: ExcelImportOptions = {}): ImportResult {
  const report: ImportReport = { unmapped: [], conversions: [], errors: [], warnings: [], counts: { activities: 0, links: 0, calendars: 0 } };
  const found = scheduleSheet(sheets);
  if (!found) throw new Error(`No schedule table found. The first sheet needs a header row with at least Name and two more of: ${EXCEL_COLUMNS.join(', ')}.`);
  const { sheet, header } = found;
  if (header.unknown.length) report.unmapped.push(`Columns not in the template, skipped: ${header.unknown.join(', ')}`);
  if (header.calculated.length) report.conversions.push(`Calculated columns ignored (the engine recalculates them): ${header.calculated.join(', ')}`);
  const at = (row: CellValue[], col: Col): CellValue => { const c = header.cols.get(col); return c === undefined ? null : row[c] ?? null; };

  // ----- project settings -----
  const proj = readProjectSheet(sheets);
  const tz = cellText(proj[norm(PROJECT_FIELDS.timeZone)]) || options.timeZone || 'Asia/Kolkata';
  const calendars = options.calendars?.length ? options.calendars : [{ ...defaultTenantCalendar('site'), name: 'Site (Mon–Sat, 8 h)', timeZone: tz }];
  const defaultCalendarId = options.defaultCalendarId && calendars.some((c) => c.id === options.defaultCalendarId) ? options.defaultCalendarId : calendars[0]!.id;
  const compiled = compileCalendars(calendars);
  const calOf = (id: string | undefined) => compiled.get(id ?? defaultCalendarId) ?? compiled.get(defaultCalendarId)!;
  const hpdOf = (id: string | undefined) => calendars.find((c) => c.id === (id ?? defaultCalendarId))?.hoursPerDay ?? 480;
  const calByKey = new Map<string, string>();
  for (const c of calendars) { calByKey.set(norm(c.id), c.id); if (c.name) calByKey.set(norm(c.name), c.id); }

  // ----- rows -----
  interface Draft { line: number; row: CellValue[]; wbs?: string; a: ActivityRecord; typeText: string; genericMilestone: boolean }
  const drafts: Draft[] = [];
  const codes = new Map<string, Draft>();
  const wbsMap = new Map<string, Draft>();
  const templates = (options.templates ?? []).map((x) => ({ ...x }));
  const tradeByKey = new Map<string, string>();
  for (const x of templates) for (const k of [x.id, x.name, x.short]) if (k) tradeByKey.set(norm(k), x.id);
  const towers: Record<string, string> = {};
  const floors: Record<string, string> = {};
  const floorOrder: string[] = [];
  let earliest = Infinity;

  for (let r = header.at + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    if (row.every((v) => cellText(v) === '')) continue;
    const line = r + 1;
    const name = cellText(at(row, 'Name'));
    const wbsText = cellText(at(row, 'WBS')).replace(/\.0+$/, '');
    let code = cellText(at(row, 'Code'));
    if (!name && !code) { report.unmapped.push(`Row ${line}: no name or code, skipped`); continue; }
    if (!code) { code = wbsText ? `WBS-${wbsText}` : `ROW-${line}`; report.conversions.push(`Row ${line}: no code; ${code} assigned`); }
    if (codes.has(code.toLowerCase())) {
      let n = 2; while (codes.has(`${code}-${n}`.toLowerCase())) n++;
      report.conversions.push(`Row ${line}: code ${code} already used; renamed ${code}-${n}`);
      code = `${code}-${n}`;
    }
    const typeText = cellText(at(row, 'Type'));
    const tnorm = norm(typeText);
    let type: ActivityType = 'task';
    let genericMilestone = false;
    if (!tnorm || tnorm === 'task') type = 'task';
    else if (tnorm === 'startmilestone') type = 'start_milestone';
    else if (tnorm === 'finishmilestone') type = 'finish_milestone';
    else if (tnorm === 'milestone' || tnorm === 'ms') { type = 'finish_milestone'; genericMilestone = true; }
    else if (tnorm === 'summary' || tnorm === 'wbssummary') type = 'summary';
    else if (tnorm === 'levelofeffort' || tnorm === 'loe' || tnorm === 'hammock') type = 'level_of_effort';
    else report.conversions.push(`Row ${line} (${code}): type "${typeText}" not recognised; imported as Task`);

    const id = `a-${drafts.length + 1}`;
    const a: ActivityRecord = { id, stableKey: id, code, name: name || code, sortKey: '', type, duration: 0, constraint: 'ASAP', externalRef: `row-${line}` };

    // Calendar first: durations and dates depend on it.
    const calText = cellText(at(row, 'Calendar'));
    if (calText) {
      const cid = calByKey.get(norm(calText));
      if (cid) { if (cid !== defaultCalendarId) a.calendarId = cid; }
      else report.unmapped.push(`Row ${line} (${code}): calendar "${calText}" not found; project calendar used`);
    }
    const hpd = hpdOf(a.calendarId);
    const cal = calOf(a.calendarId);

    const durCell = at(row, 'Duration (days)');
    if (type === 'task' || type === 'level_of_effort') {
      if (typeof durCell === 'number') a.duration = Math.round(durCell * hpd);
      else if (cellText(durCell)) {
        const d = parseDuration(cellText(durCell), hpd);
        if (d === null) report.unmapped.push(`Row ${line} (${code}): duration "${cellText(durCell)}" not understood; 1 day used`);
        a.duration = d ?? hpd;
      } else if (type === 'task') { a.duration = hpd; report.conversions.push(`Row ${line} (${code}): no duration; 1 day used (as MS Project does)`); }
      if (a.duration < 0) { report.unmapped.push(`Row ${line} (${code}): negative duration; 0 used`); a.duration = 0; }
    }

    const date = (col: Col, kind: 'start' | 'finish'): Minutes | undefined => {
      const dt = readDateCell(at(row, col));
      if (dt === null) return undefined;
      if (dt === 'invalid') { report.unmapped.push(`Row ${line} (${code}): ${col} "${cellText(at(row, col))}" is not a date; skipped`); return undefined; }
      const t = toInstant(dt, kind, tz, cal);
      earliest = Math.min(earliest, dayStartInstant(tz, dt.day));
      return t;
    };

    const consText = cellText(at(row, 'Constraint'));
    if (consText) {
      const c = CONSTRAINT_WORDS[norm(consText)];
      if (!c) report.unmapped.push(`Row ${line} (${code}): constraint "${consText}" not recognised; ASAP used`);
      else if (c !== 'ASAP' && c !== 'ALAP') {
        const cd = date('Constraint date', START_CONSTRAINTS.has(c) ? 'start' : 'finish');
        if (cd === undefined) report.conversions.push(`Row ${line} (${code}): ${c} without a date imported as ASAP`);
        else { a.constraint = c; a.constraintDate = cd; }
      } else a.constraint = c;
    } else if (cellText(at(row, 'Constraint date'))) {
      const cd = date('Constraint date', 'start');
      if (cd !== undefined) { a.constraint = 'SNET'; a.constraintDate = cd; report.conversions.push(`Row ${line} (${code}): constraint date without a type read as SNET`); }
    }

    const as = date('Actual start', 'start');
    const af = date('Actual finish', 'finish');
    if (as !== undefined) a.actualStart = as;
    if (af !== undefined) a.actualFinish = af;
    const pctCell = at(row, '% complete');
    if (cellText(pctCell)) {
      const raw = typeof pctCell === 'number' ? pctCell : Number(cellText(pctCell).replace('%', ''));
      if (!Number.isFinite(raw)) report.unmapped.push(`Row ${line} (${code}): % complete "${cellText(pctCell)}" is not a number; skipped`);
      else {
        // Stored in hundredths of a percent (10000 = 100%), as everywhere in the model.
        const pct = Math.min(10000, Math.max(0, Math.round(raw * 100)));
        if (raw < 0 || raw > 100) report.conversions.push(`Row ${line} (${code}): % complete ${raw} read as ${pct / 100}`);
        if (pct > 0) a.percentComplete = pct;
      }
    }
    const remCell = at(row, EXCEL_REMAINING_COLUMN);
    if (cellText(remCell)) {
      const rem = typeof remCell === 'number' ? Math.round(remCell * hpd) : parseDuration(cellText(remCell), hpd);
      if (rem === null || rem < 0) report.unmapped.push(`Row ${line} (${code}): remaining "${cellText(remCell)}" not understood; skipped`);
      else a.remaining = rem;
    }

    const tradeText = cellText(at(row, EXCEL_TRADE_COLUMN));
    if (tradeText) {
      let tid = tradeByKey.get(norm(tradeText));
      if (!tid) {
        tid = lookupId('TR', tradeText, templates.map((x) => x.id));
        templates.push({ id: tid, name: tradeText });
        tradeByKey.set(norm(tradeText), tid);
        report.conversions.push(`Trade "${tradeText}" is new; added to the project's trades`);
      }
      a.activityTemplateId = tid;
    }

    const towerText = cellText(at(row, 'Tower'));
    if (towerText) {
      const tid = `T-${slug(towerText)}`;
      towers[tid] ??= towerText;
      a.towerId = tid;
    }
    const floorText = cellText(at(row, 'Floor'));
    if (floorText) {
      const fid = `F-${slug(floorText)}`;
      if (!(fid in floors)) { floors[fid] = /^\d+$/.test(floorText) ? `Floor ${floorText}` : floorText; floorOrder.push(fid); }
      a.floorId = fid;
    }

    const d: Draft = { line, row, a, typeText, genericMilestone, ...(wbsText ? { wbs: wbsText } : {}) };
    if (wbsText) {
      if (wbsMap.has(wbsText)) { report.conversions.push(`Row ${line} (${code}): WBS ${wbsText} repeats row ${wbsMap.get(wbsText)!.line}; placed at the top level`); delete d.wbs; }
      else wbsMap.set(wbsText, d);
    }
    codes.set(code.toLowerCase(), d);
    drafts.push(d);
  }
  if (!drafts.length) throw new Error('The schedule table has a header row but no activities.');

  // ----- hierarchy from WBS numbers -----
  for (const d of drafts) {
    if (!d.wbs) continue;
    const parts = d.wbs.split('.');
    for (let k = parts.length - 1; k > 0; k--) {
      const parent = wbsMap.get(parts.slice(0, k).join('.'));
      if (parent) { d.a.parentId = parent.a.id; break; }
    }
    if (!d.a.parentId && parts.length > 1) report.conversions.push(`Row ${d.line} (${d.a.code}): no row with a parent WBS of ${d.wbs}; placed at the top level`);
  }
  const hasChildren = new Set(drafts.map((d) => d.a.parentId).filter((x): x is string => !!x));
  for (const d of drafts) {
    if (hasChildren.has(d.a.id) && d.a.type !== 'summary') {
      if (d.typeText) report.conversions.push(`Row ${d.line} (${d.a.code}): has activities under it in the WBS, so imported as a Summary (was ${d.typeText})`);
      d.a.type = 'summary';
      d.a.duration = 0;
      d.genericMilestone = false;
    }
  }
  // Siblings keep row order.
  const groups = new Map<string, ActivityRecord[]>();
  for (const d of drafts) { const k = d.a.parentId ?? ''; groups.set(k, [...(groups.get(k) ?? []), d.a]); }
  for (const g of groups.values()) { const keys = evenKeys(g.length); g.forEach((a, i) => { a.sortKey = keys[i]!; }); }
  const activities = drafts.map((d) => d.a);
  report.counts.activities = activities.length;

  // ----- predecessors -----
  const pending: PendingLink[] = [];
  for (const d of drafts) {
    const text = cellText(at(d.row, 'Predecessors'));
    if (!text) continue;
    const parsed = parsePredecessors(text, hpdOf(d.a.calendarId));
    if ('error' in parsed) { report.unmapped.push(`Row ${d.line} (${d.a.code}): predecessors "${text}" not understood (${parsed.error})`); continue; }
    for (const p of parsed) {
      const ref = p.ref.replace(/\.0+$/, '');
      const from = codes.get(ref.toLowerCase()) ?? wbsMap.get(ref);
      if (!from) { report.unmapped.push(`Row ${d.line} (${d.a.code}): predecessor "${p.ref}" is not a code or WBS number in the sheet; link skipped`); continue; }
      if (from.a.id === d.a.id) { report.unmapped.push(`Row ${d.line} (${d.a.code}): links to itself; link skipped`); continue; }
      pending.push({ from: from.a, to: d.a, type: p.type, lag: p.lag });
    }
  }
  const links = resolveLinks(activities, pending, report.conversions, (_f, _t, n) => `l-${n + 1}`);
  report.counts.links = links.length;

  // "Milestone" without start/finish: finish if it has predecessors and no successors, else start (as MSPDI).
  for (const d of drafts) {
    if (!d.genericMilestone) continue;
    const hasPred = links.some((l) => l.to === d.a.id);
    const hasSucc = links.some((l) => l.from === d.a.id);
    d.a.type = hasPred && !hasSucc ? 'finish_milestone' : 'start_milestone';
    report.conversions.push(`${d.a.code}: milestone imported as ${d.a.type === 'finish_milestone' ? 'finish' : 'start'} milestone`);
  }

  // ----- project start and data date -----
  const projDate = (key: string, kind: 'start' | 'finish'): Minutes | undefined => {
    const dt = readDateCell(proj[norm(key)] ?? null);
    return dt && dt !== 'invalid' ? toInstant(dt, kind, tz, calOf(undefined)) : undefined;
  };
  let projectStart = projDate(PROJECT_FIELDS.start, 'start') ?? options.projectStart;
  if (projectStart === undefined && Number.isFinite(earliest)) {
    projectStart = calOf(undefined).nextWorkStart(earliest);
    report.conversions.push('No project start given; the earliest date in the sheet was used');
  }
  if (projectStart === undefined) throw new Error('No project start date. Add it on the "Project" sheet (Project start) and import again.');
  const dataDate = projDate(PROJECT_FIELDS.dataDate, 'start') ?? options.dataDate ?? projectStart;

  const doc: ScheduleDoc = {
    id: 'imported',
    name: cellText(proj[norm(PROJECT_FIELDS.name)]) || options.name || 'Imported schedule',
    kind: 'draft',
    version: 1,
    projectStart,
    dataDate,
    defaultCalendarId,
    calendars,
    activities,
    links,
    settings: {},
    ...(Object.keys(towers).length ? { towers } : {}),
    ...(Object.keys(floors).length ? { floors, floorOrder } : {}),
    ...(templates.length ? { templates } : {}),
  };
  report.counts.calendars = calendars.length;
  const result = calculate(toScheduleInput(doc));
  report.errors = result.errors;
  report.warnings = result.warnings;
  return { doc, result, report };
}

/** Import an .xlsx workbook laid out as the template. Throws with a readable message on a file it cannot use. */
export function importExcel(data: Uint8Array | ArrayBuffer, options: ExcelImportOptions = {}): ImportResult {
  return importExcelSheets(readXlsx(data), options);
}

// ------------------------------------------------------------------ export

function treeOrder(doc: ScheduleDoc): { order: ActivityRecord[]; wbs: Map<string, string> } {
  const byParent = new Map<string, ActivityRecord[]>();
  const ids = new Set(doc.activities.map((a) => a.id));
  for (const a of doc.activities) {
    const k = a.parentId && ids.has(a.parentId) ? a.parentId : '';
    byParent.set(k, [...(byParent.get(k) ?? []), a]);
  }
  for (const g of byParent.values()) g.sort((x, y) => (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : x.id < y.id ? -1 : 1));
  const order: ActivityRecord[] = [];
  const wbs = new Map<string, string>();
  const walk = (pid: string, prefix: string) => (byParent.get(pid) ?? []).forEach((a, i) => {
    const w = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    wbs.set(a.id, w);
    order.push(a);
    walk(a.id, w);
  });
  walk('', '');
  return { order, wbs };
}

/** "KAV-T1-SLAB SS+2d" — a space before the type keeps codes readable; FS with no lag is just the code. */
function predText(code: string, type: string, lag: Minutes, hpd: Minutes): string {
  const lagText = lag === 0 ? '' : `${lag > 0 ? '+' : '-'}${formatDuration(Math.abs(lag), hpd)}`;
  if (type === 'FS' && !lagText) return code;
  return `${code}${/^\d/.test(code) && /^[\d.]+$/.test(code) ? '' : ' '}${type}${lagText}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function instructionsSheet(): WriteSheet {
  const rows: CellValue[][] = [
    ['Column', 'What to enter', 'Example'],
    ['WBS', 'Outline number. Rows with rows under them (1 → 1.1, 1.2) become summaries. Format this column as Text, or Excel turns 1.10 into 1.1.', '1.2'],
    ['Code', 'Unique code; predecessors refer to it. Left blank, one is made from the WBS.', 'T1-RAFT'],
    ['Name', 'Activity name (required).', 'Raft foundation'],
    ['Type', 'Task, Start milestone, Finish milestone, Milestone, Summary or Level of effort. Blank = Task.', 'Task'],
    ['Duration (days)', 'Working days on the activity\'s calendar. Decimals allowed; "4h" or "2w" also work.', '8'],
    ['Calendar', 'Calendar name. Blank = the project calendar.', ''],
    ['Predecessors', 'Codes or WBS numbers, with type and lag, separated by semicolons. FS is the default.', 'T1-PCC; T1-EXC SS+2d'],
    ['Constraint', 'ASAP, ALAP, SNET, SNLT, FNET, FNLT, MSO or MFO (or the words, e.g. Start No Earlier Than).', 'SNET'],
    ['Constraint date', 'Date for the constraint. Start constraints use the start of that working day, finish constraints its end.', '01-Dec-2026'],
    ['Tower', 'Tower or block name, for the tower × floor grid.', 'Tower A'],
    ['Floor', 'Floor name or number.', '3'],
    ['Actual start', 'Date work actually started.', ''],
    ['Actual finish', 'Date work actually finished.', ''],
    ['% complete', '0 to 100.', '40'],
    ['Trade', 'Optional, after the template: the repeating work type (Columns, Slab, Blockwork…). With Tower and Floor it puts the activity on the tower × floor grid. New names are added to the project.', 'Slab'],
    ['Remaining (days)', 'Optional, after the template: working days left on started work. Blank = worked out from % complete.', '3'],
    [],
    ['Dates', 'Excel dates, 2026-12-01, 01/12/2026 (day first) or 1-Dec-2026. Add a time (09:00) only if it matters.', ''],
    ['Calculated columns', 'Start, Finish, Total float and Critical are written on export for reading; import ignores them.', ''],
    ['Project sheet', 'Project name, start, data date and time zone. Used on import when present.', ''],
  ];
  return { name: 'Instructions', rows, header: true, widths: [20, 100, 24] };
}

/** Write a schedule as the Excel template, with calculated dates and float alongside. */
export function exportExcel(doc: ScheduleDoc, result?: ScheduleResult): Uint8Array {
  const tz = doc.calendars.find((c) => c.id === doc.defaultCalendarId)?.timeZone ?? 'Asia/Kolkata';
  const hpdOf = (id: string | undefined) => doc.calendars.find((c) => c.id === (id ?? doc.defaultCalendarId))?.hoursPerDay ?? 480;
  const calName = (id: string | undefined) => (id ? doc.calendars.find((c) => c.id === id)?.name ?? id : '');
  const { order, wbs } = treeOrder(doc);
  const byId = new Map(doc.activities.map((a) => [a.id, a]));
  const predsOf = new Map<string, string[]>();
  for (const l of doc.links) {
    const from = byId.get(l.from);
    if (!from) continue;
    predsOf.set(l.to, [...(predsOf.get(l.to) ?? []), predText(from.code, l.type, l.lag, hpdOf(byId.get(l.to)?.calendarId))]);
  }
  const withRemaining = doc.activities.some((a) => a.remaining !== undefined && a.actualFinish === undefined);
  const withTrade = doc.activities.some((a) => a.activityTemplateId);
  const tradeName = (id: string | undefined) => (id ? doc.templates?.find((x) => x.id === id)?.name ?? id : '');
  const header: CellValue[] = [...EXCEL_COLUMNS, ...(withTrade ? [EXCEL_TRADE_COLUMN] : []), ...(withRemaining ? [EXCEL_REMAINING_COLUMN] : []), ...EXCEL_CALCULATED_COLUMNS];
  const rows: CellValue[][] = [header];
  for (const a of order) {
    const r = result?.activities[a.id];
    const hpd = hpdOf(a.calendarId);
    const start = a.actualStart ?? r?.es;
    const finish = a.actualFinish ?? r?.ef;
    rows.push([
      wbs.get(a.id)!,
      a.code,
      a.name,
      TYPE_LABEL[a.type],
      a.type === 'summary' ? null : round2(a.duration / hpd),
      calName(a.calendarId),
      (predsOf.get(a.id) ?? []).join('; '),
      a.constraint === 'ASAP' ? '' : a.constraint,
      a.constraintDate !== undefined ? excelDate(tz, a.constraintDate) : null,
      a.towerId ? doc.towers?.[a.towerId] ?? a.towerId : '',
      a.floorId ? doc.floors?.[a.floorId] ?? a.floorId : '',
      a.actualStart !== undefined ? excelDate(tz, a.actualStart) : null,
      a.actualFinish !== undefined ? excelDate(tz, a.actualFinish) : null,
      a.percentComplete !== undefined ? a.percentComplete / 100 : a.actualFinish !== undefined ? 100 : null,
      ...(withTrade ? [tradeName(a.activityTemplateId)] : []),
      ...(withRemaining ? [a.remaining !== undefined && a.actualFinish === undefined ? round2(a.remaining / hpd) : null] : []),
      start !== undefined ? excelDate(tz, start) : null,
      finish !== undefined ? excelDate(tz, finish) : null,
      r ? round2(r.totalFloat / hpd) : null,
      r?.isCritical ? 'Yes' : '',
    ]);
  }
  const schedule: WriteSheet = {
    name: 'Schedule', rows, header: true,
    widths: [8, 16, 40, 16, 14, 18, 30, 11, 15, 12, 10, 14, 14, 11, ...(withTrade ? [24] : []), ...(withRemaining ? [16] : []), 17, 17, 17, 9],
    lists: [
      { col: 3, options: Object.values(TYPE_LABEL).concat('Milestone') },
      { col: 7, options: ['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'] },
    ],
  };
  const project: WriteSheet = {
    name: PROJECT_SHEET, header: true, widths: [18, 30],
    rows: [
      ['Field', 'Value'],
      [PROJECT_FIELDS.name, doc.name],
      [PROJECT_FIELDS.start, excelDate(tz, doc.projectStart)],
      [PROJECT_FIELDS.dataDate, excelDate(tz, doc.dataDate)],
      [PROJECT_FIELDS.timeZone, tz],
    ],
  };
  return writeXlsx([schedule, project, instructionsSheet()]);
}

/** A blank template with a few example rows, for planners starting in Excel. */
export function excelTemplate(projectStartIso?: string): Uint8Array {
  const rows: CellValue[][] = [
    [...EXCEL_COLUMNS, EXCEL_TRADE_COLUMN],
    ['1', 'TA', 'Tower A', 'Summary', null, '', '', '', null, 'Tower A', '', null, null, null, ''],
    ['1.1', 'TA-MOB', 'Site mobilisation', 'Task', 10, '', '', '', null, 'Tower A', '', null, null, null, ''],
    ['1.2', 'TA-EXC', 'Excavation', 'Task', 12, '', 'TA-MOB', '', null, 'Tower A', '', null, null, null, ''],
    ['1.3', 'TA-RAFT', 'Raft foundation', 'Task', 8, '', 'TA-EXC FS+2d', '', null, 'Tower A', '', null, null, null, ''],
    ['1.4', 'TA-F01-SLAB', 'Floor 1 slab', 'Task', 5, '', 'TA-RAFT', '', null, 'Tower A', '1', null, null, null, 'Slab'],
    ['1.5', 'TA-HO', 'Tower A handover', 'Finish milestone', 0, '', 'TA-F01-SLAB', '', null, 'Tower A', '', null, null, null, ''],
  ];
  const start = projectStartIso ? new Date(`${projectStartIso}T00:00Z`) : null;
  return writeXlsx([
    { name: 'Schedule', rows, header: true, widths: [8, 16, 40, 16, 14, 18, 30, 11, 15, 12, 10, 14, 14, 11, 20],
      lists: [{ col: 3, options: Object.values(TYPE_LABEL).concat('Milestone') }, { col: 7, options: ['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'] }] },
    { name: PROJECT_SHEET, header: true, widths: [18, 30], rows: [['Field', 'Value'], [PROJECT_FIELDS.name, ''], [PROJECT_FIELDS.start, start], [PROJECT_FIELDS.dataDate, null], [PROJECT_FIELDS.timeZone, 'Asia/Kolkata']] },
    instructionsSheet(),
  ]);
}
