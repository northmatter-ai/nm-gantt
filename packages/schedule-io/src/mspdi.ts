/**
 * MS Project XML (MSPDI) import and export. See the spec, "Import and export".
 * Field codes follow Microsoft's published MSPDI schema; anything not mapped is listed in the report.
 */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { dayToIso, formatLocal, instantToDay, parseLocal, type CalendarException, type CalendarInput, type Interval, type Minutes, type Weekday } from '@northmatter/calendar';
import { calculate, type ActivityType, type ConstraintType, type Issue, type LinkType, type ScheduleResult } from '@northmatter/schedule-engine';
import { evenKeys, toScheduleInput, type ActivityRecord, type LinkRecord, type ScheduleDoc } from '@northmatter/schedule-commands';
import { resolveLinks, type PendingLink } from './links.js';

export interface ImportReport {
  unmapped: string[];
  conversions: string[];
  errors: Issue[];
  warnings: Issue[];
  counts: { activities: number; links: number; calendars: number };
}

export interface ImportResult {
  doc: ScheduleDoc;
  result: ScheduleResult;
  report: ImportReport;
}

export interface ImportOptions {
  /** Zone the file's local times are read in. Default Asia/Kolkata. */
  timeZone?: string;
  /** Id generator; defaults to deterministic ids derived from MSPDI UIDs. */
  idFor?: (kind: 'activity' | 'link' | 'calendar', uid: string) => string;
  name?: string;
}

const CONSTRAINT_FROM: Record<string, ConstraintType> = { 0: 'ASAP', 1: 'ALAP', 2: 'MSO', 3: 'MFO', 4: 'SNET', 5: 'SNLT', 6: 'FNET', 7: 'FNLT' };
const CONSTRAINT_TO: Record<ConstraintType, number> = { ASAP: 0, ALAP: 1, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 };
const LINK_FROM: Record<string, LinkType> = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };
const LINK_TO: Record<LinkType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
/** LagFormat codes for elapsed units (em, eh, ed, ew, emo, e%) and their estimated variants. */
const ELAPSED_FORMATS = new Set([4, 6, 8, 10, 12, 20, 36, 38, 40, 42, 44, 52]);
const PERCENT_FORMATS = new Set([19, 20, 51, 52]);

const ARRAYS = new Set(['Task', 'Calendar', 'WeekDay', 'WorkingTime', 'Exception', 'PredecessorLink', 'Resource', 'Assignment', 'ExtendedAttribute']);

type X = Record<string, unknown>;
const arr = (v: unknown): X[] => (Array.isArray(v) ? (v as X[]) : v === undefined || v === null || v === '' ? [] : [v as X]);
const str = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));
const num = (v: unknown): number | undefined => (str(v) === undefined ? undefined : Number(v));

/** ISO 8601 duration such as PT16H0M0S or P1DT2H → minutes (days = 24 h, as MSPDI writes hours). */
export function parseIsoDuration(text: string | undefined): Minutes {
  if (!text) return 0;
  const m = /^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text.trim());
  if (!m) return 0;
  const mins = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 60;
  return Math.round(text.trim().startsWith('-') ? -mins : mins);
}

export function formatIsoDuration(minutes: Minutes): string {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : ''}PT${Math.floor(abs / 60)}H${abs % 60}M0S`;
}

const timeToMinute = (t: string | undefined, isEnd: boolean): number => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  const v = (h ?? 0) * 60 + (m ?? 0);
  return isEnd && v === 0 ? 1440 : v;
};

function workingTimes(node: X | undefined): Interval[] {
  const wt = node ? arr((node.WorkingTimes as X | undefined)?.WorkingTime) : [];
  return wt
    .map((w) => [timeToMinute(str(w.FromTime), false), timeToMinute(str(w.ToTime), true)] as Interval)
    .filter(([a, b]) => b > a);
}

export function importMspdi(xml: string, options: ImportOptions = {}): ImportResult {
  const tz = options.timeZone ?? 'Asia/Kolkata';
  const idFor = options.idFor ?? ((kind, uid) => `${kind === 'activity' ? 'a' : kind === 'link' ? 'l' : 'cal'}-${uid}`);
  const report: ImportReport = { unmapped: [], conversions: [], errors: [], warnings: [], counts: { activities: 0, links: 0, calendars: 0 } };
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, isArray: (name) => ARRAYS.has(name) });
  const root = parser.parse(xml) as X;
  const p = root.Project as X | undefined;
  if (!p) throw new Error('Not an MS Project XML file: no <Project> element');

  const local = (v: unknown): Minutes | undefined => {
    const s = str(v);
    return s ? parseLocal(tz, s.slice(0, 16)) : undefined;
  };
  const minutesPerDay = num(p.MinutesPerDay) ?? 480;

  // ----- calendars -----
  const calendars: CalendarInput[] = [];
  for (const c of arr((p.Calendars as X | undefined)?.Calendar)) {
    const uid = str(c.UID)!;
    const week: Partial<Record<Weekday, Interval[]>> = {};
    const exceptions: CalendarException[] = [];
    for (const wd of arr((c.WeekDays as X | undefined)?.WeekDay)) {
      const type = num(wd.DayType) ?? 0;
      const working = str(wd.DayWorking) === '1';
      if (type >= 1 && type <= 7) {
        week[(type - 1) as Weekday] = working ? workingTimes(wd) : [];
      } else if (type === 0) {
        const tp = wd.TimePeriod as X | undefined;
        const from = str(tp?.FromDate), to = str(tp?.ToDate);
        if (from && to) exceptions.push({ from: from.slice(0, 10), to: inclusiveTo(to), intervals: working ? workingTimes(wd) : [] });
      }
    }
    for (const ex of arr((c.Exceptions as X | undefined)?.Exception)) {
      const tp = ex.TimePeriod as X | undefined;
      const from = str(tp?.FromDate), to = str(tp?.ToDate);
      if (!from || !to) continue;
      const type = num(ex.Type);
      if (type !== undefined && type !== 1) {
        report.unmapped.push(`Calendar ${str(c.Name) ?? uid}: recurring exception "${str(ex.Name) ?? ''}" imported as one continuous range`);
      }
      exceptions.push({ from: from.slice(0, 10), to: inclusiveTo(to), intervals: str(ex.DayWorking) === '1' ? workingTimes(ex) : [], reason: str(ex.Name) ?? '' });
    }
    // Merge-safe: drop exceptions overlapping an earlier one (MSPDI may repeat them in both places).
    exceptions.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    const clean: CalendarException[] = [];
    for (const ex of exceptions) {
      const last = clean[clean.length - 1];
      if (last && ex.from <= last.to) { report.conversions.push(`Calendar ${str(c.Name) ?? uid}: overlapping exception ${ex.from} dropped`); continue; }
      clean.push(ex);
    }
    const baseUid = str(c.BaseCalendarUID);
    calendars.push({
      id: idFor('calendar', uid),
      name: str(c.Name) ?? `Calendar ${uid}`,
      ...(baseUid && baseUid !== '-1' ? { baseId: idFor('calendar', baseUid) } : {}),
      timeZone: tz,
      hoursPerDay: minutesPerDay,
      week,
      exceptions: clean,
    });
  }
  report.counts.calendars = calendars.length;
  const projectCalUid = str(p.CalendarUID);
  let defaultCalendarId = projectCalUid ? idFor('calendar', projectCalUid) : calendars[0]?.id;
  if (!defaultCalendarId || !calendars.some((c) => c.id === defaultCalendarId)) {
    calendars.push({ id: 'cal-standard', name: 'Standard', timeZone: tz, hoursPerDay: minutesPerDay, week: { 1: [[480, 720], [780, 1020]], 2: [[480, 720], [780, 1020]], 3: [[480, 720], [780, 1020]], 4: [[480, 720], [780, 1020]], 5: [[480, 720], [780, 1020]] } });
    defaultCalendarId = 'cal-standard';
    report.conversions.push('No project calendar found; MS Project Standard calendar (Mon–Fri 08:00–17:00) used');
  }

  // ----- tasks -----
  const tasks = arr((p.Tasks as X | undefined)?.Task).filter((t) => str(t.UID) !== '0' && str(t.IsNull) !== '1');
  const keys = evenKeys(tasks.length);
  const activities: ActivityRecord[] = [];
  const byUid = new Map<string, ActivityRecord>();
  const stack: { level: number; id: string }[] = [];
  const rawLinks: { uid: string; pred: string; type: LinkType; lag: Minutes; elapsed: boolean; percent?: number }[] = [];

  tasks.forEach((t, i) => {
    const uid = str(t.UID)!;
    const level = num(t.OutlineLevel) ?? 1;
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    const parentId = stack[stack.length - 1]?.id;
    const isSummary = str(t.Summary) === '1';
    const isMilestone = str(t.Milestone) === '1';
    const id = idFor('activity', uid);
    const constraint = CONSTRAINT_FROM[str(t.ConstraintType) ?? '0'] ?? 'ASAP';
    const a: ActivityRecord = {
      id,
      stableKey: id,
      code: str(t.WBS) ?? str(t.OutlineNumber) ?? str(t.ID) ?? uid,
      name: str(t.Name) ?? '',
      sortKey: keys[i]!,
      type: isSummary ? 'summary' : isMilestone ? 'finish_milestone' : 'task',
      duration: isSummary || isMilestone ? 0 : parseIsoDuration(str(t.Duration)),
      constraint,
      externalRef: uid,
    };
    if (parentId) a.parentId = parentId;
    if (constraint !== 'ASAP' && constraint !== 'ALAP') {
      const cd = local(t.ConstraintDate);
      if (cd !== undefined) a.constraintDate = cd;
      else { a.constraint = 'ASAP'; report.conversions.push(`${a.code}: ${constraint} without a date imported as ASAP`); }
    }
    const deadline = local(t.Deadline);
    if (deadline !== undefined) a.deadline = deadline;
    const calUid = str(t.CalendarUID);
    if (calUid && calUid !== '-1') a.calendarId = idFor('calendar', calUid);
    const as = local(t.ActualStart), af = local(t.ActualFinish);
    if (as !== undefined) a.actualStart = as;
    if (af !== undefined) a.actualFinish = af;
    if (as !== undefined && af === undefined && str(t.RemainingDuration)) a.remaining = parseIsoDuration(str(t.RemainingDuration));
    const pct = num(t.PercentComplete);
    if (pct) a.percentComplete = Math.round(pct * 100);
    activities.push(a);
    byUid.set(uid, a);
    if (isSummary) stack.push({ level, id });

    for (const pl of arr(t.PredecessorLink)) {
      const fmt = num(pl.LagFormat) ?? 7;
      const lagTenths = num(pl.LinkLag) ?? 0;
      rawLinks.push({
        uid, pred: str(pl.PredecessorUID)!, type: LINK_FROM[str(pl.Type) ?? '1'] ?? 'FS',
        lag: Math.round(lagTenths / 10), elapsed: ELAPSED_FORMATS.has(fmt),
        ...(PERCENT_FORMATS.has(fmt) ? { percent: lagTenths / 10 } : {}),
      });
    }
    if (t.ExtendedAttribute !== undefined) report.unmapped.push(`${a.code}: custom fields skipped`);
  });
  report.counts.activities = activities.length;
  if (arr((p.Resources as X | undefined)?.Resource).length) report.unmapped.push(`${arr((p.Resources as X).Resource).length} resources skipped`);
  if (arr((p.Assignments as X | undefined)?.Assignment).length) report.unmapped.push(`${arr((p.Assignments as X).Assignment).length} assignments skipped`);

  // ----- links, with summary conversion -----
  const pending: PendingLink[] = [];
  for (const l of rawLinks) {
    const from = byUid.get(l.pred), to = byUid.get(l.uid);
    if (!from || !to) { report.unmapped.push(`Link from UID ${l.pred} to UID ${l.uid}: unknown task`); continue; }
    pending.push({ from, to, type: l.type, lag: l.lag, elapsed: l.elapsed, ...(l.percent !== undefined ? { percent: l.percent } : {}) });
  }
  const links = resolveLinks(activities, pending, report.conversions, (f, t, n) => idFor('link', `${f.externalRef}-${t.externalRef}-${n}`));
  report.counts.links = links.length;

  // Milestones: finish if it has predecessors and no successors, else start.
  for (const a of activities) {
    if (a.type !== 'finish_milestone') continue;
    const hasPred = links.some((l) => l.to === a.id);
    const hasSucc = links.some((l) => l.from === a.id);
    const kind: ActivityType = hasPred && !hasSucc ? 'finish_milestone' : 'start_milestone';
    a.type = kind;
    report.conversions.push(`${a.code}: milestone imported as ${kind === 'finish_milestone' ? 'finish' : 'start'} milestone`);
  }

  const projectStart = local(p.StartDate) ?? activities.reduce((m, a) => Math.min(m, a.actualStart ?? Infinity), Infinity);
  const scheduleFromFinish = str(p.ScheduleFromStart) === '0';
  const doc: ScheduleDoc = {
    id: 'imported',
    name: options.name ?? str(p.Title) ?? str(p.Name) ?? 'Imported schedule',
    kind: 'draft',
    version: 1,
    projectStart: Number.isFinite(projectStart) ? projectStart : 0,
    dataDate: local(p.StatusDate) ?? (Number.isFinite(projectStart) ? projectStart : 0),
    defaultCalendarId: defaultCalendarId!,
    calendars,
    activities,
    links,
    settings: {},
  };
  if (scheduleFromFinish) {
    const f = local(p.FinishDate);
    if (f !== undefined) doc.projectFinishTarget = f;
  }
  const result = calculate(toScheduleInput(doc));
  report.errors = result.errors;
  report.warnings = result.warnings;
  return { doc, result, report };
}

/** MSPDI ToDate is the end instant of the last day (e.g. 2026-11-25T23:59:00); the exception is inclusive of that date. */
function inclusiveTo(to: string): string {
  const day = to.slice(0, 10);
  const time = to.slice(11, 16);
  if (time === '00:00') {
    // midnight → previous day is the last full day
    const d = instantToDay('UTC', parseLocal('UTC', day)) - 1;
    return dayToIso(d);
  }
  return day;
}

// ------------------------------------------------------------------ export

export function exportMspdi(doc: ScheduleDoc, result: ScheduleResult | undefined): string {
  const defaultCal = doc.calendars.find((c) => c.id === doc.defaultCalendarId);
  const tz = defaultCal?.timeZone ?? 'Asia/Kolkata';
  const dt = (t: Minutes | undefined) => (t === undefined ? undefined : `${formatLocal(tz, t)}:00`);
  const calUid = new Map(doc.calendars.map((c, i) => [c.id, i + 1]));
  const taskUid = new Map<string, number>();
  const ordered = orderTree(doc);
  ordered.forEach(({ a }, i) => taskUid.set(a.id, Number(a.externalRef) || i + 1));
  // ensure uniqueness
  const used = new Set<number>();
  let next = Math.max(0, ...[...taskUid.values()]) + 1;
  for (const [id, uid] of taskUid) { if (used.has(uid) || uid === 0) { taskUid.set(id, next); used.add(next++); } else used.add(uid); }

  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}:00`;

  const calendars = doc.calendars.map((c) => ({
    UID: calUid.get(c.id),
    Name: c.name ?? c.id,
    IsBaseCalendar: c.baseId ? 0 : 1,
    ...(c.baseId ? { BaseCalendarUID: calUid.get(c.baseId) ?? -1 } : {}),
    WeekDays: {
      WeekDay: ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).filter((d) => c.week?.[d] !== undefined).map((d) => {
        const ivs = c.week![d]!;
        return {
          DayType: d + 1,
          DayWorking: ivs.length ? 1 : 0,
          ...(ivs.length ? { WorkingTimes: { WorkingTime: ivs.map(([a, b]) => ({ FromTime: hm(a), ToTime: hm(b) })) } } : {}),
        };
      }),
    },
    ...(c.exceptions?.length ? {
      Exceptions: {
        Exception: c.exceptions.map((x) => ({
          EnteredByOccurrences: 0,
          TimePeriod: { FromDate: `${x.from}T00:00:00`, ToDate: `${x.to}T23:59:00` },
          Occurrences: 1,
          Name: x.reason ?? '',
          Type: 1,
          DayWorking: x.intervals.length ? 1 : 0,
          ...(x.intervals.length ? { WorkingTimes: { WorkingTime: x.intervals.map(([a, b]) => ({ FromTime: hm(a), ToTime: hm(b) })) } } : {}),
        })),
      },
    } : {}),
  }));

  const linksTo = new Map<string, LinkRecord[]>();
  for (const l of doc.links) linksTo.set(l.to, [...(linksTo.get(l.to) ?? []), l]);
  const hasChildren = new Set(doc.activities.map((a) => a.parentId).filter(Boolean) as string[]);

  const tasks = ordered.map(({ a, level, outline }, i) => {
    const r = result?.activities[a.id];
    const isMs = a.type === 'start_milestone' || a.type === 'finish_milestone';
    const isSummary = a.type === 'summary' || hasChildren.has(a.id);
    const duration = isSummary && r ? Math.max(0, r.ef - r.es) : a.duration;
    return {
      UID: taskUid.get(a.id),
      ID: i + 1,
      Name: a.name,
      WBS: a.code,
      OutlineNumber: outline,
      OutlineLevel: level,
      Summary: isSummary ? 1 : 0,
      Milestone: isMs ? 1 : 0,
      ...(r ? {
        Start: dt(r.es), Finish: dt(r.ef),
        EarlyStart: dt(r.es), EarlyFinish: dt(r.ef), LateStart: dt(r.ls), LateFinish: dt(r.lf),
        TotalSlack: r.totalFloat * 10, FreeSlack: r.freeFloat * 10, Critical: r.isCritical ? 1 : 0,
      } : {}),
      Duration: formatIsoDuration(isMs ? 0 : duration),
      DurationFormat: 7,
      ConstraintType: CONSTRAINT_TO[a.constraint],
      ...(a.constraintDate !== undefined ? { ConstraintDate: dt(a.constraintDate) } : {}),
      ...(a.deadline !== undefined ? { Deadline: dt(a.deadline) } : {}),
      CalendarUID: a.calendarId ? calUid.get(a.calendarId) ?? -1 : -1,
      ...(a.actualStart !== undefined ? { ActualStart: dt(a.actualStart) } : {}),
      ...(a.actualFinish !== undefined ? { ActualFinish: dt(a.actualFinish) } : {}),
      ...(a.remaining !== undefined ? { RemainingDuration: formatIsoDuration(a.remaining) } : {}),
      PercentComplete: Math.round((a.percentComplete ?? (a.actualFinish !== undefined ? 10000 : 0)) / 100),
      PredecessorLink: (linksTo.get(a.id) ?? []).map((l) => ({
        PredecessorUID: taskUid.get(l.from),
        Type: LINK_TO[l.type],
        CrossProject: 0,
        LinkLag: l.lag * 10,
        LagFormat: l.lagCalendar === 'elapsed' ? 8 : 7,
      })),
    };
  });

  const finish = result?.projectFinish;
  const project = {
    Project: {
      '@_xmlns': 'http://schemas.microsoft.com/project',
      SaveVersion: 14,
      Name: doc.name,
      Title: doc.name,
      ScheduleFromStart: doc.projectFinishTarget !== undefined ? 0 : 1,
      StartDate: dt(doc.projectStart),
      ...(finish !== undefined ? { FinishDate: dt(doc.projectFinishTarget ?? finish) } : {}),
      StatusDate: dt(doc.dataDate),
      CalendarUID: calUid.get(doc.defaultCalendarId) ?? 1,
      MinutesPerDay: defaultCal?.hoursPerDay ?? 480,
      MinutesPerWeek: (defaultCal?.hoursPerDay ?? 480) * 6,
      Calendars: { Calendar: calendars },
      Tasks: { Task: [{ UID: 0, ID: 0, Name: doc.name, OutlineNumber: 0, OutlineLevel: 0, Summary: 1 }, ...tasks] },
    },
  };
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, suppressEmptyNode: true });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${builder.build(project)}`;
}

function orderTree(doc: ScheduleDoc): { a: ActivityRecord; level: number; outline: string }[] {
  const kids = new Map<string | null, ActivityRecord[]>();
  for (const a of doc.activities) {
    const k = a.parentId ?? null;
    kids.set(k, [...(kids.get(k) ?? []), a]);
  }
  for (const list of kids.values()) list.sort((x, y) => (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : 0));
  const out: { a: ActivityRecord; level: number; outline: string }[] = [];
  const walk = (pid: string | null, level: number, prefix: string) => {
    (kids.get(pid) ?? []).forEach((a, i) => {
      const outline = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      out.push({ a, level, outline });
      walk(a.id, level + 1, outline);
    });
  };
  walk(null, 1, '');
  return out;
}
