/**
 * Compiled working-time calendars.
 *
 * Model: W(t) is the cumulative count of working minutes from an arbitrary anchor to
 * instant t. It is non-decreasing and flat across non-working time. Then:
 *   workBetween(a, b) = W(b) − W(a)
 *   finishFrom(s, d)  = smallest t with W(t) ≥ W(nextWorkStart(s)) + d   (lands on an interval end, never the next start)
 *   startFrom(f, d)   = largest  t with W(t) ≤ W(prevWorkEnd(f)) − d     (lands on an interval start, never the previous end)
 *
 * Days are expanded lazily and cached by local day number; per-week totals feed a lazily
 * extended prefix-sum array, so finishFrom/startFrom cost O(log weeks) after warm-up.
 * Weeks run Monday–Sunday: week k covers local days [7k − 3, 7k + 4).
 */
import type { CalendarException, CalendarInput, CompiledCalendar, Interval, Minutes, Weekday } from './types.js';
import { CalendarError, NoWorkingTimeError } from './errors.js';
import { isoToDay, MIN_PER_DAY, weekdayOfDay } from './dates.js';
import { zone, type Zone } from './zone.js';

interface DayInfo {
  s: Minutes[]; // interval starts (instants)
  e: Minutes[]; // interval ends (instants)
  total: Minutes;
}

interface ExceptionRange {
  fromDay: number;
  toDay: number;
  intervals: Interval[];
}

const EMPTY: Interval[] = [];
/** Consecutive Monday–Sunday weeks with no working time (53 weeks = 371 days > 366) that make a calendar invalid. */
const MAX_EMPTY_WEEKS = 53;

const weekOf = (day: number) => Math.floor((day + 3) / 7);
const firstDayOfWeek = (k: number) => 7 * k - 3;

function assertInt(name: string, v: number): void {
  if (!Number.isInteger(v)) throw new TypeError(`${name} must be an integer number of minutes, got ${v}`);
}

function normaliseIntervals(intervals: readonly Interval[], calendarId: string): Interval[] {
  const sorted = [...intervals].map((iv) => [iv[0], iv[1]] as const).sort((x, y) => x[0] - y[0]);
  const out: [Minutes, Minutes][] = [];
  for (const [a, b] of sorted) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > MIN_PER_DAY || a >= b) {
      throw new CalendarError('INVALID_INTERVAL', `Invalid working interval [${a}, ${b}) in calendar "${calendarId}"`, calendarId);
    }
    const last = out[out.length - 1];
    if (last && a < last[1]) {
      throw new CalendarError('INVALID_INTERVAL', `Overlapping working intervals in calendar "${calendarId}"`, calendarId);
    }
    if (last && a === last[1]) last[1] = b; // touching intervals merge
    else out.push([a, b]);
  }
  return out;
}

function compileExceptions(list: readonly CalendarException[] | undefined, calendarId: string): ExceptionRange[] {
  const ranges = (list ?? []).map((x) => {
    const fromDay = isoToDay(x.from);
    const toDay = isoToDay(x.to);
    if (toDay < fromDay) throw new CalendarError('INVALID_DATE', `Exception ends before it starts in calendar "${calendarId}"`, calendarId);
    return { fromDay, toDay, intervals: normaliseIntervals(x.intervals, calendarId) };
  });
  ranges.sort((a, b) => a.fromDay - b.fromDay);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i]!.fromDay <= ranges[i - 1]!.toDay) {
      throw new CalendarError('OVERLAPPING_EXCEPTIONS', `Overlapping exceptions in calendar "${calendarId}"`, calendarId);
    }
  }
  return ranges;
}

function findRange(ranges: ExceptionRange[], day: number): ExceptionRange | undefined {
  let lo = 0, hi = ranges.length - 1, found: ExceptionRange | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (r.fromDay <= day) { found = r; lo = mid + 1; } else hi = mid - 1;
  }
  return found && found.toDay >= day ? found : undefined;
}

class WorkCalendar implements CompiledCalendar {
  readonly elapsed = false;
  private readonly z: Zone;
  private readonly days = new Map<number, DayInfo>();
  private readonly weekTotals = new Map<number, Minutes>();
  private anchor: number | null = null;
  private readonly fw: Minutes[] = [0]; // fw[i] = W(start of week anchor + i)
  private readonly bw: Minutes[] = [0]; // bw[i] = W(start of week anchor − i)
  private fwZeroRun = 0; // consecutive empty weeks at the forward end of fw
  private bwZeroRun = 0;

  constructor(
    readonly id: string,
    readonly timeZone: string,
    readonly hoursPerDay: Minutes,
    private readonly week: Interval[][],
    /** Exception layers, most specific (the calendar itself) first. */
    private readonly layers: ExceptionRange[][],
  ) {
    this.z = zone(timeZone);
    const weekly = week.reduce((sum, ivs) => sum + ivs.reduce((s, [a, b]) => s + b - a, 0), 0);
    if (weekly === 0) throw new NoWorkingTimeError(id);
  }

  // ----- day and week expansion -----

  private intervalsFor(day: number): Interval[] {
    for (const layer of this.layers) {
      const r = findRange(layer, day);
      if (r) return r.intervals;
    }
    return this.week[weekdayOfDay(day)] ?? EMPTY;
  }

  private day(d: number): DayInfo {
    let info = this.days.get(d);
    if (!info) {
      const base = d * MIN_PER_DAY;
      const s: Minutes[] = [], e: Minutes[] = [];
      let total = 0;
      for (const [a, b] of this.intervalsFor(d)) {
        const us = this.z.localToUtc(base + a);
        const ue = this.z.localToUtc(base + b);
        if (ue > us) { s.push(us); e.push(ue); total += ue - us; }
      }
      info = { s, e, total };
      this.days.set(d, info);
    }
    return info;
  }

  private weekTotal(k: number): Minutes {
    let t = this.weekTotals.get(k);
    if (t === undefined) {
      t = 0;
      const f = firstDayOfWeek(k);
      for (let d = f; d < f + 7; d++) t += this.day(d).total;
      this.weekTotals.set(k, t);
    }
    return t;
  }

  /** W at the start of week k. */
  private weekStartW(k: number): Minutes {
    if (this.anchor === null) this.anchor = k;
    const i = k - this.anchor;
    if (i >= 0) {
      while (this.fw.length <= i) {
        const n = this.fw.length;
        const wt = this.weekTotal(this.anchor + n - 1);
        this.fwZeroRun = wt === 0 ? this.fwZeroRun + 1 : 0;
        if (this.fwZeroRun >= MAX_EMPTY_WEEKS) throw new NoWorkingTimeError(this.id);
        this.fw.push(this.fw[n - 1]! + wt);
      }
      return this.fw[i]!;
    }
    const j = -i;
    while (this.bw.length <= j) {
      const n = this.bw.length;
      this.bw.push(this.bw[n - 1]! - this.weekTotal(this.anchor - n));
    }
    return this.bw[j]!;
  }

  dayOf(t: Minutes): number {
    return Math.floor(this.z.utcToLocal(t) / MIN_PER_DAY);
  }

  dayStart(day: number): Minutes {
    return this.z.localToUtc(day * MIN_PER_DAY);
  }

  workOnDay(day: number): Minutes {
    return this.day(day).total;
  }

  /** Cumulative working minutes W(t). */
  private work(t: Minutes): Minutes {
    const d = this.dayOf(t);
    const k = weekOf(d);
    let w = this.weekStartW(k);
    for (let x = firstDayOfWeek(k); x < d; x++) w += this.day(x).total;
    const info = this.day(d);
    for (let i = 0; i < info.s.length; i++) {
      const s = info.s[i]!, e = info.e[i]!;
      if (t >= e) w += e - s;
      else { if (t > s) w += t - s; break; }
    }
    return w;
  }

  /** Smallest week k with W(start of k) ≥ target, searching outward from week `hint`. */
  private firstWeekReaching(target: Minutes, hint: number): number {
    // Find lo with W(lo) < target and hi with W(hi) ≥ target by galloping, then bisect.
    let lo = hint, hi = hint;
    if (this.weekStartW(hint) >= target) {
      let step = 1;
      lo = hint - 1;
      while (this.weekStartW(lo) >= target) {
        hi = lo;
        step *= 2;
        const next = lo - step;
        if (step >= MAX_EMPTY_WEEKS && this.weekStartW(next) === this.weekStartW(lo)) throw new NoWorkingTimeError(this.id);
        lo = next;
      }
    } else {
      let step = 1;
      hi = hint + 1;
      while (this.weekStartW(hi) < target) {
        lo = hi;
        step *= 2;
        const next = hi + step;
        if (step >= MAX_EMPTY_WEEKS && this.weekStartW(next) === this.weekStartW(hi)) throw new NoWorkingTimeError(this.id);
        hi = next;
      }
    }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.weekStartW(mid) >= target) hi = mid; else lo = mid;
    }
    return hi;
  }

  /** Largest week k with W(start of k) ≤ target. */
  private lastWeekWithin(target: Minutes, hint: number): number {
    let lo = hint, hi = hint;
    if (this.weekStartW(hint) <= target) {
      let step = 1;
      hi = hint + 1;
      while (this.weekStartW(hi) <= target) {
        lo = hi;
        step *= 2;
        const next = hi + step;
        if (step >= MAX_EMPTY_WEEKS && this.weekStartW(next) === this.weekStartW(hi)) throw new NoWorkingTimeError(this.id);
        hi = next;
      }
    } else {
      let step = 1;
      lo = hint - 1;
      while (this.weekStartW(lo) > target) {
        hi = lo;
        step *= 2;
        const next = lo - step;
        if (step >= MAX_EMPTY_WEEKS && this.weekStartW(next) === this.weekStartW(lo)) throw new NoWorkingTimeError(this.id);
        lo = next;
      }
    }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.weekStartW(mid) <= target) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Smallest t with W(t) ≥ target (target strictly above W at the hint's week start is not required). */
  private atWorkForward(target: Minutes, hintT: Minutes): Minutes {
    const k = this.firstWeekReaching(target, weekOf(this.dayOf(hintT))) - 1; // W(k) < target ≤ W(k+1)
    let c = this.weekStartW(k);
    const f = firstDayOfWeek(k);
    for (let d = f; d < f + 7; d++) {
      const info = this.day(d);
      if (c + info.total >= target) {
        for (let i = 0; i < info.s.length; i++) {
          const len = info.e[i]! - info.s[i]!;
          if (c + len >= target) return info.s[i]! + (target - c);
          c += len;
        }
      }
      c += info.total;
    }
    /* c8 ignore next */
    throw new Error('calendar invariant broken (forward)');
  }

  /** Largest t with W(t) ≤ target. */
  private atWorkBackward(target: Minutes, hintT: Minutes): Minutes {
    const k = this.lastWeekWithin(target, weekOf(this.dayOf(hintT))); // W(k) ≤ target < W(k+1)
    let c = this.weekStartW(k);
    const f = firstDayOfWeek(k);
    for (let d = f; d < f + 7; d++) {
      const info = this.day(d);
      if (c + info.total > target) {
        for (let i = 0; i < info.s.length; i++) {
          const len = info.e[i]! - info.s[i]!;
          if (c + len > target) return info.s[i]! + (target - c);
          c += len;
        }
      }
      c += info.total;
    }
    /* c8 ignore next */
    throw new Error('calendar invariant broken (backward)');
  }

  // ----- the five functions -----

  nextWorkStart(t: Minutes): Minutes {
    assertInt('t', t);
    let d = this.dayOf(t);
    for (let n = 0; n <= 370; n++, d++) {
      const info = this.day(d);
      for (let i = 0; i < info.s.length; i++) {
        if (t < info.e[i]!) return Math.max(info.s[i]!, t);
      }
    }
    throw new NoWorkingTimeError(this.id);
  }

  prevWorkEnd(t: Minutes): Minutes {
    assertInt('t', t);
    let d = this.dayOf(t);
    for (let n = 0; n <= 370; n++, d--) {
      const info = this.day(d);
      for (let i = info.s.length - 1; i >= 0; i--) {
        if (t > info.s[i]!) return Math.min(info.e[i]!, t);
      }
    }
    throw new NoWorkingTimeError(this.id);
  }

  finishFrom(start: Minutes, d: Minutes): Minutes {
    assertInt('d', d);
    const s = this.nextWorkStart(start);
    if (d === 0) return s;
    if (d < 0) return this.startFrom(start, -d);
    return this.atWorkForward(this.work(s) + d, s);
  }

  startFrom(finish: Minutes, d: Minutes): Minutes {
    assertInt('d', d);
    const f = this.prevWorkEnd(finish);
    if (d === 0) return f;
    if (d < 0) return this.finishFrom(finish, -d);
    return this.atWorkBackward(this.work(f) - d, f);
  }

  workBetween(a: Minutes, b: Minutes): Minutes {
    assertInt('a', a);
    assertInt('b', b);
    if (a === b) return 0;
    return this.work(b) - this.work(a);
  }

  shift(t: Minutes, m: Minutes): Minutes {
    assertInt('m', m);
    // A zero shift is the identity (see DECISIONS.md D-003), so a finish milestone
    // driven by a 0-lag FS link can sit at the end of a working interval.
    if (m === 0) return t;
    return m > 0 ? this.finishFrom(t, m) : this.startFrom(t, -m);
  }
}

/** The 24×7 calendar used for elapsed lags: plain minute addition. */
class ElapsedCalendar implements CompiledCalendar {
  readonly id = '__elapsed__';
  readonly timeZone = 'UTC';
  readonly hoursPerDay = MIN_PER_DAY;
  readonly elapsed = true;
  nextWorkStart(t: Minutes) { assertInt('t', t); return t; }
  prevWorkEnd(t: Minutes) { assertInt('t', t); return t; }
  finishFrom(start: Minutes, d: Minutes) { assertInt('d', d); return start + d; }
  startFrom(finish: Minutes, d: Minutes) { assertInt('d', d); return finish - d; }
  workBetween(a: Minutes, b: Minutes) { assertInt('a', a); assertInt('b', b); return b - a; }
  shift(t: Minutes, m: Minutes) { assertInt('m', m); return t + m; }
  dayOf(t: Minutes) { return Math.floor(t / MIN_PER_DAY); }
  dayStart(day: number) { return day * MIN_PER_DAY; }
  workOnDay() { return MIN_PER_DAY; }
}

export const ELAPSED: CompiledCalendar = new ElapsedCalendar();

/** Compile a set of calendars, resolving base-calendar inheritance. Throws CalendarError / NoWorkingTimeError. */
export function compileCalendars(inputs: readonly CalendarInput[]): Map<string, CompiledCalendar> {
  const byId = new Map<string, CalendarInput>();
  for (const c of inputs) {
    if (byId.has(c.id)) throw new CalendarError('DUPLICATE_CALENDAR', `Calendar "${c.id}" is defined twice`, c.id);
    byId.set(c.id, c);
  }
  const out = new Map<string, CompiledCalendar>();
  for (const c of [...inputs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    out.set(c.id, compileCalendar(c, (id) => byId.get(id)));
  }
  return out;
}

/** Compile one calendar; `resolve` looks up base calendars by id. */
export function compileCalendar(input: CalendarInput, resolve: (id: string) => CalendarInput | undefined = () => undefined): CompiledCalendar {
  // Chain from the calendar itself up to its root base.
  const chain: CalendarInput[] = [];
  const seen = new Set<string>();
  let cur: CalendarInput | undefined = input;
  while (cur) {
    if (seen.has(cur.id)) throw new CalendarError('BASE_CALENDAR_CYCLE', `Base calendars of "${input.id}" form a cycle`, input.id);
    seen.add(cur.id);
    chain.push(cur);
    if (!cur.baseId) break;
    const base = resolve(cur.baseId);
    if (!base) throw new CalendarError('UNKNOWN_BASE_CALENDAR', `Calendar "${cur.id}" has unknown base "${cur.baseId}"`, cur.id);
    cur = base;
  }
  // Child week overrides base week, weekday by weekday.
  const week: Interval[][] = [];
  for (let wd = 0 as Weekday; wd <= 6; wd = (wd + 1) as Weekday) {
    let ivs: readonly Interval[] = EMPTY;
    for (const c of chain) {
      const v = c.week?.[wd];
      if (v) { ivs = v; break; }
    }
    week.push(normaliseIntervals(ivs, input.id));
    if (wd === 6) break;
  }
  const layers = chain.map((c) => compileExceptions(c.exceptions, c.id));
  const hoursPerDay = input.hoursPerDay ?? 480;
  assertInt('hoursPerDay', hoursPerDay);
  return new WorkCalendar(input.id, input.timeZone || 'Asia/Kolkata', hoursPerDay, week, layers);
}

// Free-function forms matching the spec's signatures.
export const nextWorkStart = (cal: CompiledCalendar, t: Minutes) => cal.nextWorkStart(t);
export const prevWorkEnd = (cal: CompiledCalendar, t: Minutes) => cal.prevWorkEnd(t);
export const finishFrom = (cal: CompiledCalendar, start: Minutes, d: Minutes) => cal.finishFrom(start, d);
export const startFrom = (cal: CompiledCalendar, finish: Minutes, d: Minutes) => cal.startFrom(finish, d);
export const workBetween = (cal: CompiledCalendar, a: Minutes, b: Minutes) => cal.workBetween(a, b);
export const shift = (cal: CompiledCalendar, t: Minutes, m: Minutes) => cal.shift(t, m);

const STD_DAY: Interval[] = [[540, 780], [840, 1080]];

/** Spec default tenant calendar: Mon–Sat 09:00–13:00 and 14:00–18:00, Sunday off. */
export function defaultTenantCalendar(id = 'default', holidays: CalendarException[] = []): CalendarInput {
  return {
    id,
    name: 'Standard site (Mon–Sat)',
    timeZone: 'Asia/Kolkata',
    hoursPerDay: 480,
    week: { 0: [], 1: STD_DAY, 2: STD_DAY, 3: STD_DAY, 4: STD_DAY, 5: STD_DAY, 6: STD_DAY },
    exceptions: holidays,
  };
}
