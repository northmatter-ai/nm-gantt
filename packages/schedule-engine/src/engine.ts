/**
 * Critical path method. See the build spec, "Scheduling engine" and "Progress" sections.
 * Pure: no I/O, no randomness, no Date arithmetic; ties are broken by activity id.
 */
import {
  CalendarError,
  compileCalendars,
  ELAPSED,
  NoWorkingTimeError,
  type CompiledCalendar,
  type Minutes,
} from '@northmatter-ai/calendar';
import { cycleOrder, findCycles, topoOrder } from './graph.js';
import { hashInput } from './hash.js';
import {
  DEFAULT_SETTINGS,
  type ActivityInput,
  type ActivityResult,
  type ErrorCode,
  type Issue,
  type LinkInput,
  type ScheduleInput,
  type ScheduleResult,
  type ScheduleSettings,
  type WarningCode,
} from './types.js';

type Status = ActivityResult['status'];
type DriveSource = 'project_start' | 'data_date' | 'constraint';

interface Node {
  a: ActivityInput;
  id: string;
  label: string;
  cal: CompiledCalendar;
  /** Original duration (0 for milestones). */
  D: Minutes;
  isMilestone: boolean;
  isFinishMilestone: boolean;
  status: Status;
  /** Duration that remains to be scheduled (D, or remaining for in-progress). */
  work: Minutes;
  preds: Edge[];
  succs: Edge[];
  es: Minutes; ef: Minutes; ls: Minutes; lf: Minutes;
  rs?: Minutes;
  tf: Minutes; ff: Minutes;
  driving: Edge[];
  drivenBy: Set<DriveSource>;
  hardEs?: Minutes; hardEf?: Minutes;
  longest: boolean;
}

interface Edge {
  l: LinkInput;
  from: Node;
  to: Node;
  lagCal: CompiledCalendar;
}

const NETWORK_TYPES = new Set(['task', 'start_milestone', 'finish_milestone']);
const HARD = new Set(['MSO', 'MFO']);
const NEEDS_DATE = new Set(['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO']);
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function assertInt(what: string, v: number | undefined): void {
  if (v !== undefined && !Number.isInteger(v)) throw new TypeError(`${what} must be an integer, got ${v}`);
}

/** Programming errors (non-integer minutes) throw; bad schedules return ok: false. */
function assertIntegers(input: ScheduleInput): void {
  assertInt('projectStart', input.projectStart);
  assertInt('projectFinishTarget', input.projectFinishTarget);
  assertInt('dataDate', input.dataDate);
  for (const a of input.activities) {
    for (const k of ['duration', 'constraintDate', 'deadline', 'actualStart', 'actualFinish', 'remaining', 'percentComplete'] as const) {
      assertInt(`activity ${a.id}.${k}`, a[k]);
    }
  }
  for (const l of input.links) assertInt(`link ${l.id}.lag`, l.lag);
}

export function calculate(input: ScheduleInput): ScheduleResult {
  assertIntegers(input);
  const settings: ScheduleSettings = { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) };
  const inputHash = hashInput({ ...input, settings });
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (code: ErrorCode, message: string, extra: Partial<Issue> = {}) => errors.push({ code, severity: 'error', message, ...extra });
  const warn = (code: WarningCode, message: string, extra: Partial<Issue> = {}) => warnings.push({ code, severity: 'warning', message, ...extra });
  const fail = (): ScheduleResult => ({ ok: false, errors, warnings, activities: {}, inputHash });

  try {
    return run();
  } catch (e) {
    if (e instanceof NoWorkingTimeError) { err('NO_WORKING_TIME', e.message); return fail(); }
    if (e instanceof CalendarError) { err('INVALID_CALENDAR', e.message); return fail(); }
    throw e;
  }

  function run(): ScheduleResult {
    // ---------- Step 1: build and validate ----------
    const cals = compileCalendars(input.calendars);
    const defaultCal = cals.get(input.defaultCalendarId);
    if (!defaultCal) { err('UNKNOWN_CALENDAR', `Default calendar "${input.defaultCalendarId}" does not exist`); return fail(); }

    const activities = [...input.activities].sort(byId);
    const all = new Map<string, ActivityInput>();
    for (const a of activities) {
      if (all.has(a.id)) err('DUPLICATE_ACTIVITY', `Activity id ${a.id} is used twice`, { activityId: a.id });
      all.set(a.id, a);
    }
    const label = (a: ActivityInput) => a.code ?? a.id;
    const { projectStart, dataDate } = input;

    const nodes = new Map<string, Node>();
    for (const a of activities) {
      if (a.parentId !== undefined) {
        const p = all.get(a.parentId);
        if (!p) err('UNKNOWN_ACTIVITY', `${label(a)} has an unknown parent ${a.parentId}`, { activityId: a.id });
        else if (p.type !== 'summary') err('PARENT_NOT_SUMMARY', `${label(a)}'s parent ${label(p)} is not a summary`, { activityId: a.id });
      }
      const cal = a.calendarId ? cals.get(a.calendarId) : defaultCal;
      if (!cal) { err('UNKNOWN_CALENDAR', `${label(a)} uses unknown calendar ${a.calendarId}`, { activityId: a.id }); continue; }
      if (NEEDS_DATE.has(a.constraint) && a.constraintDate === undefined) {
        err('MISSING_CONSTRAINT_DATE', `${label(a)} has a ${a.constraint} constraint without a date`, { activityId: a.id });
      }
      if (a.duration < 0) err('NEGATIVE_DURATION', `${label(a)} has a negative duration`, { activityId: a.id });
      if (a.actualFinish !== undefined && a.actualStart === undefined) {
        err('ACTUAL_FINISH_WITHOUT_START', `${label(a)} has an actual finish but no actual start`, { activityId: a.id });
      }
      if (a.actualStart !== undefined && a.actualFinish !== undefined && a.actualFinish < a.actualStart) {
        err('ACTUAL_FINISH_BEFORE_START', `${label(a)} finishes before it starts`, { activityId: a.id });
      }
      if ((a.actualStart !== undefined && a.actualStart > dataDate) || (a.actualFinish !== undefined && a.actualFinish > dataDate)) {
        err('ACTUAL_AFTER_DATA_DATE', `${label(a)} has an actual date after the data date`, { activityId: a.id });
      }
      if (!NETWORK_TYPES.has(a.type)) continue;

      const isMilestone = a.type !== 'task';
      if (isMilestone && a.duration !== 0) warn('MILESTONE_DURATION_IGNORED', `${label(a)} is a milestone; its duration is ignored`, { activityId: a.id });
      if (a.type === 'task' && a.duration > 60 * cal.hoursPerDay) warn('LONG_DURATION', `${label(a)} is longer than 60 working days`, { activityId: a.id });
      if (HARD.has(a.constraint)) warn('HARD_CONSTRAINT', `${label(a)} uses a hard ${a.constraint} constraint`, { activityId: a.id });

      const D = isMilestone ? 0 : Math.max(0, a.duration);
      const status: Status = a.actualFinish !== undefined ? 'complete' : a.actualStart !== undefined ? 'in_progress' : 'not_started';
      let work = D;
      if (status === 'in_progress' && a.actualStart !== undefined) {
        if (a.remaining !== undefined) work = Math.max(0, a.remaining);
        else if (a.percentComplete !== undefined) work = Math.round((D * (10000 - a.percentComplete)) / 10000);
        else work = Math.max(0, D - cal.workBetween(a.actualStart, dataDate));
        if (isMilestone) work = 0;
      }
      nodes.set(a.id, {
        a, id: a.id, label: label(a), cal, D, isMilestone, isFinishMilestone: a.type === 'finish_milestone',
        status, work, preds: [], succs: [], es: 0, ef: 0, ls: 0, lf: 0, tf: 0, ff: 0,
        driving: [], drivenBy: new Set(), longest: false,
      });
    }

    const lagCalendarOf = (l: LinkInput, from: CompiledCalendar, to: CompiledCalendar): CompiledCalendar => {
      switch (l.lagCalendar ?? settings.defaultLagCalendar) {
        case 'predecessor': return from;
        case 'schedule_default': return defaultCal;
        case 'elapsed': return ELAPSED;
        default: return to;
      }
    };

    const links = [...input.links].sort(byId);
    const pairs = new Set<string>();
    const loeLinks: LinkInput[] = [];
    for (const l of links) {
      const from = all.get(l.from), to = all.get(l.to);
      if (!from || !to) { err('UNKNOWN_ACTIVITY', `Link ${l.id} refers to an unknown activity`, { linkId: l.id }); continue; }
      if (l.from === l.to) { err('SELF_LINK', `${label(from)} is linked to itself`, { linkId: l.id, activityId: l.from }); continue; }
      const pair = `${l.from}\u0000${l.to}`;
      if (pairs.has(pair)) { err('DUPLICATE_LINK', `More than one link from ${label(from)} to ${label(to)}`, { linkId: l.id }); continue; }
      pairs.add(pair);
      if (from.type === 'summary' || to.type === 'summary') {
        err('LINK_TO_SUMMARY', `Link ${label(from)} → ${label(to)} touches a summary`, { linkId: l.id }); continue;
      }
      if (l.lag < 0) {
        if (!settings.negativeLagAllowed) { err('NEGATIVE_LAG_NOT_ALLOWED', `Link ${label(from)} → ${label(to)} has a negative lag`, { linkId: l.id }); continue; }
        warn('NEGATIVE_LAG', `Link ${label(from)} → ${label(to)} has a lead of ${-l.lag} minutes`, { linkId: l.id });
      }
      if (from.type === 'level_of_effort' || to.type === 'level_of_effort') { loeLinks.push(l); continue; }
      const f = nodes.get(l.from), t = nodes.get(l.to);
      if (!f || !t) continue; // calendar error already reported
      const lagCal = lagCalendarOf(l, f.cal, t.cal);
      if (Math.abs(l.lag) > 20 * lagCal.hoursPerDay) warn('LONG_LAG', `Link ${f.label} → ${t.label} has a lag over 20 working days`, { linkId: l.id });
      const e: Edge = { l, from: f, to: t, lagCal };
      f.succs.push(e);
      t.preds.push(e);
    }
    if (errors.length > 0) return fail();

    const ids = [...nodes.keys()]; // sorted, because activities were sorted
    const succIds = (id: string) => nodes.get(id)!.succs.map((e) => e.to.id);
    const cycles = findCycles(ids, succIds);
    if (cycles.length > 0) {
      for (const comp of cycles) {
        const order = cycleOrder(comp, succIds);
        const codes = order.map((id) => nodes.get(id)!.label);
        err('CYCLE', `Circular logic: ${[...codes, codes[0]].join(' → ')}`, { activityIds: order });
      }
      return fail();
    }
    const order = topoOrder(ids, succIds, (id) => nodes.get(id)!.preds.length);

    for (const n of nodes.values()) {
      if (n.preds.length === 0) warn('OPEN_START', `${n.label} has no predecessors`, { activityId: n.id });
      if (n.succs.length === 0) warn('OPEN_END', `${n.label} has no successors`, { activityId: n.id });
      if (n.status !== 'not_started') {
        for (const e of n.preds) {
          if (e.l.type === 'FS' && e.from.status !== 'complete') {
            warn('OUT_OF_SEQUENCE', `${n.label} started before its predecessor ${e.from.label} finished`, { activityId: n.id, linkId: e.l.id });
          }
        }
      }
    }

    // ---------- Step 2: forward pass ----------
    const msNorm = (n: Node, x: Minutes) =>
      n.isFinishMilestone && n.cal.prevWorkEnd(x) === x ? x : n.cal.nextWorkStart(x);
    const startCandidate = (n: Node, x: Minutes) => (n.isMilestone ? msNorm(n, x) : n.cal.nextWorkStart(x));
    /** Start candidate from a "finish no earlier than x" requirement. */
    const finishCandidate = (n: Node, x: Minutes, d: Minutes) => (n.isMilestone ? msNorm(n, x) : n.cal.startFrom(x, d));

    const linkForward = (e: Edge, d: Minutes): Minutes => {
      const i = e.from, j = e.to, L = e.l.lag;
      switch (e.l.type) {
        case 'FS': return startCandidate(j, e.lagCal.shift(i.ef, L));
        case 'SS': return startCandidate(j, e.lagCal.shift(i.es, L));
        case 'FF': return finishCandidate(j, e.lagCal.shift(i.ef, L), d);
        case 'SF': return finishCandidate(j, e.lagCal.shift(i.es, L), d);
      }
    };

    for (const id of order) {
      const n = nodes.get(id)!;
      const a = n.a;
      if (n.status === 'complete') {
        n.es = a.actualStart!;
        n.ef = a.actualFinish!;
        continue;
      }
      const inProgress = n.status === 'in_progress';
      const d = n.work;
      const cands: { v: Minutes; e?: Edge; src?: DriveSource }[] = [];
      const useLinks = !inProgress || settings.progressMode === 'retained_logic';
      if (useLinks) {
        for (const e of n.preds) {
          if (inProgress && e.from.status === 'complete') continue;
          cands.push({ v: linkForward(e, d), e });
        }
      }
      if (!inProgress) cands.push({ v: startCandidate(n, projectStart), src: 'project_start' });
      cands.push({ v: startCandidate(n, dataDate), src: 'data_date' });
      if (!inProgress && a.constraintDate !== undefined) {
        if (a.constraint === 'SNET') cands.push({ v: startCandidate(n, a.constraintDate), src: 'constraint' });
        if (a.constraint === 'FNET') cands.push({ v: finishCandidate(n, a.constraintDate, d), src: 'constraint' });
      }
      let start = -Infinity;
      for (const c of cands) if (c.v > start) start = c.v;

      if (!inProgress && HARD.has(a.constraint) && a.constraintDate !== undefined) {
        const hard = a.constraint === 'MSO' ? startCandidate(n, a.constraintDate) : finishCandidate(n, a.constraintDate, d);
        if (start > hard) {
          const culprits = cands.filter((c) => c.v === start && c.e).map((c) => c.e!.from.label);
          warn('LOGIC_VIOLATED', `${n.label}'s ${a.constraint} date is earlier than its logic allows${culprits.length ? ` (driven by ${culprits.join(', ')})` : ''}`, { activityId: n.id });
        }
        start = hard;
        n.drivenBy.add('constraint');
      }
      for (const c of cands) {
        if (c.v !== start) continue;
        if (c.e) n.driving.push(c.e);
        else if (c.src) n.drivenBy.add(c.src);
      }
      if (inProgress) {
        n.es = a.actualStart!;
        n.rs = start;
        n.ef = n.isMilestone || d === 0 ? Math.max(start, n.es) : n.cal.finishFrom(start, d);
      } else {
        n.es = start;
        n.ef = n.isMilestone ? start : n.cal.finishFrom(start, d);
      }
      if (HARD.has(a.constraint) && !inProgress) { n.hardEs = n.es; n.hardEf = n.ef; }
    }

    let maxEf = -Infinity;
    for (const n of nodes.values()) if (n.ef > maxEf) maxEf = n.ef;
    if (maxEf === -Infinity) maxEf = defaultCal.nextWorkStart(projectStart);
    const PF = input.projectFinishTarget ?? maxEf;

    // ---------- Step 3: backward pass ----------
    const skipSucc = (j: Node) =>
      j.status === 'complete' || (j.status === 'in_progress' && settings.progressMode === 'progress_override');
    /** Late-finish candidates from successors, using either late (backward pass) or early (free float) dates. */
    const succCandidates = (n: Node, early: boolean): Minutes[] => {
      const out: Minutes[] = [n.cal.prevWorkEnd(PF)];
      const C = n.cal, d = n.work;
      for (const e of n.succs) {
        const j = e.to;
        if (skipSucc(j)) continue;
        const L = e.l.lag;
        const jStart = early ? (j.rs ?? j.es) : j.ls;
        const jFinish = early ? j.ef : j.lf;
        let v: Minutes;
        switch (e.l.type) {
          case 'FS': v = C.prevWorkEnd(e.lagCal.shift(jStart, -L)); break;
          case 'FF': v = C.prevWorkEnd(e.lagCal.shift(jFinish, -L)); break;
          case 'SS': {
            const x = e.lagCal.shift(jStart, -L);
            v = n.isMilestone ? C.prevWorkEnd(x) : C.finishFrom(C.nextWorkStart(x), d);
            break;
          }
          case 'SF': {
            const x = e.lagCal.shift(jFinish, -L);
            v = n.isMilestone ? C.prevWorkEnd(x) : C.finishFrom(C.nextWorkStart(x), d);
            break;
          }
        }
        out.push(v);
      }
      return out;
    };

    for (let k = order.length - 1; k >= 0; k--) {
      const n = nodes.get(order[k]!)!;
      const a = n.a, C = n.cal, d = n.work;
      if (n.status === 'complete') { n.ls = n.es; n.lf = n.ef; continue; }
      const cands = succCandidates(n, false);
      if (n.status === 'not_started' && a.constraintDate !== undefined) {
        if (a.constraint === 'SNLT') cands.push(n.isMilestone ? C.prevWorkEnd(a.constraintDate) : C.finishFrom(C.nextWorkStart(a.constraintDate), d));
        if (a.constraint === 'FNLT') cands.push(C.prevWorkEnd(a.constraintDate));
      }
      if (a.deadline !== undefined) cands.push(C.prevWorkEnd(a.deadline));
      let lf = Infinity;
      for (const v of cands) if (v < lf) lf = v;
      if (n.status === 'not_started' && HARD.has(a.constraint) && n.hardEf !== undefined) {
        n.lf = n.hardEf;
        n.ls = n.hardEs!;
        continue;
      }
      if (n.isMilestone) {
        const late = n.isFinishMilestone ? lf : C.nextWorkStart(lf);
        n.lf = late; n.ls = late;
      } else {
        n.lf = lf;
        n.ls = d === 0 ? lf : C.startFrom(lf, d);
      }
    }

    // ---------- Step 4: float ----------
    for (const n of nodes.values()) {
      const C = n.cal;
      if (n.status === 'complete') { n.tf = 0; n.ff = 0; continue; }
      if (n.status === 'in_progress') n.tf = C.workBetween(n.ef, n.lf);
      else n.tf = Math.min(C.workBetween(n.es, n.ls), C.workBetween(n.ef, n.lf));
      let ffFinish = Infinity;
      for (const v of succCandidates(n, true)) if (v < ffFinish) ffFinish = v;
      const ff = C.workBetween(n.ef, ffFinish);
      n.ff = Math.min(Math.max(ff, 0), Math.max(n.tf, 0));
      if (n.tf < 0) warn('NEGATIVE_FLOAT', `${n.label} has negative float`, { activityId: n.id });
    }

    // ---------- Step 5: longest path ----------
    let latestEf = -Infinity;
    for (const n of nodes.values()) if (n.status !== 'complete' && n.ef > latestEf) latestEf = n.ef;
    const stack: Node[] = [];
    for (const n of nodes.values()) if (n.status !== 'complete' && n.ef === latestEf) stack.push(n);
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.longest) continue;
      n.longest = true;
      if (n.drivenBy.size > 0) continue; // stop at project start, constraints and the data date
      for (const e of n.driving) stack.push(e.from);
    }

    // ---------- Step 6: ALAP ----------
    for (const n of nodes.values()) {
      if (n.a.constraint !== 'ALAP' || n.status !== 'not_started' || n.ff <= 0) continue;
      const C = n.cal;
      const moved = C.finishFrom(n.es, n.ff);
      n.es = n.isMilestone ? msNorm(n, moved) : C.nextWorkStart(moved);
      n.ef = n.isMilestone ? n.es : C.finishFrom(n.es, n.work);
      n.tf = Math.min(C.workBetween(n.es, n.ls), C.workBetween(n.ef, n.lf));
      n.ff = 0;
    }

    // ---------- Results for network nodes ----------
    const results: Record<string, ActivityResult> = {};
    const critical = (n: Node) =>
      n.status !== 'complete' && (settings.criticalDefinition === 'longest_path' ? n.longest : n.tf <= settings.criticalThresholdMinutes);
    for (const n of nodes.values()) {
      const driving = [...n.driving].sort((x, y) => byId(x.l, y.l));
      results[n.id] = {
        id: n.id, es: n.es, ef: n.ef, ls: n.ls, lf: n.lf,
        totalFloat: n.tf, freeFloat: n.ff,
        isCritical: critical(n), isLongestPath: n.longest,
        drivingLinkIds: driving.map((e) => e.l.id),
        drivingPredecessorIds: [...new Set(driving.map((e) => e.from.id))].sort(),
        ...(n.rs !== undefined ? { remainingStart: n.rs, remaining: n.work } : {}),
        status: n.status,
      };
    }

    // ---------- Level of effort ----------
    for (const a of activities) {
      if (a.type !== 'level_of_effort') continue;
      const C = a.calendarId ? cals.get(a.calendarId)! : defaultCal;
      let es = Infinity, ef = -Infinity;
      for (const l of loeLinks) {
        const other = l.to === a.id ? nodes.get(l.from) : l.from === a.id ? nodes.get(l.to) : undefined;
        if (l.to !== a.id && l.from !== a.id) continue;
        const usable = other && ((l.to === a.id && l.type === 'SS') || (l.from === a.id && l.type === 'FF'));
        if (!other || !usable) {
          warn('LOE_LINK_IGNORED', `Link ${l.id} on level-of-effort ${label(a)} is ignored (only SS predecessors and FF successors count)`, { linkId: l.id, activityId: a.id });
          continue;
        }
        const lagCal = lagCalendarOf(l, l.to === a.id ? other.cal : C, l.to === a.id ? C : other.cal);
        if (l.to === a.id) es = Math.min(es, C.nextWorkStart(lagCal.shift(other.es, l.lag)));
        else ef = Math.max(ef, C.prevWorkEnd(lagCal.shift(other.ef, -l.lag)));
      }
      if (es === Infinity) es = C.nextWorkStart(projectStart);
      if (ef === -Infinity) ef = C.prevWorkEnd(PF);
      if (ef < es) ef = es;
      results[a.id] = {
        id: a.id, es, ef, ls: es, lf: ef, totalFloat: 0, freeFloat: 0,
        isCritical: false, isLongestPath: false, drivingLinkIds: [], drivingPredecessorIds: [], status: 'not_started',
      };
    }

    // ---------- Summaries (bottom-up) ----------
    const children = new Map<string, string[]>();
    for (const a of activities) {
      if (a.parentId === undefined) continue;
      const list = children.get(a.parentId) ?? [];
      list.push(a.id);
      children.set(a.parentId, list);
    }
    const summarise = (id: string): ActivityResult | undefined => {
      const existing = results[id];
      if (existing) return existing;
      const a = all.get(id)!;
      if (a.type !== 'summary') return undefined;
      const kids = (children.get(id) ?? []).map(summarise).filter((r): r is ActivityResult => r !== undefined);
      let r: ActivityResult;
      if (kids.length === 0) {
        const t = defaultCal.nextWorkStart(projectStart);
        r = { id, es: t, ef: t, ls: t, lf: t, totalFloat: 0, freeFloat: 0, isCritical: false, isLongestPath: false, drivingLinkIds: [], drivingPredecessorIds: [], status: 'not_started' };
      } else {
        const statuses = new Set(kids.map((k) => k.status));
        r = {
          id,
          es: Math.min(...kids.map((k) => k.es)),
          ef: Math.max(...kids.map((k) => k.ef)),
          ls: Math.min(...kids.map((k) => k.ls)),
          lf: Math.max(...kids.map((k) => k.lf)),
          totalFloat: Math.min(...kids.map((k) => k.totalFloat)),
          freeFloat: 0,
          isCritical: kids.some((k) => k.isCritical),
          isLongestPath: kids.some((k) => k.isLongestPath),
          drivingLinkIds: [],
          drivingPredecessorIds: [],
          status: statuses.size === 1 ? kids[0]!.status : statuses.has('in_progress') || statuses.has('complete') ? 'in_progress' : 'not_started',
        };
      }
      results[id] = r;
      return r;
    };
    for (const a of activities) if (a.type === 'summary') summarise(a.id);

    return { ok: true, errors, warnings, projectFinish: maxEf, activities: results, inputHash };
  }
}
