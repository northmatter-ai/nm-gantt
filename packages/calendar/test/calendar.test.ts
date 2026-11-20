import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  compileCalendar,
  compileCalendars,
  defaultTenantCalendar,
  ELAPSED,
  finishFrom,
  formatLocal,
  NoWorkingTimeError,
  nextWorkStart,
  parseLocal,
  prevWorkEnd,
  shift,
  startFrom,
  workBetween,
  CalendarError,
  type CalendarInput,
} from '../src/index.js';

const TZ = 'Asia/Kolkata';
const at = (s: string) => parseLocal(TZ, s);
const fmt = (t: number) => formatLocal(TZ, t);
const H = 60;
const DAY = 480;

// 2026-11-23 is a Monday; 2026-11-22 a Sunday.
const cal = compileCalendar(defaultTenantCalendar('std', [{ from: '2026-11-25', to: '2026-11-25', intervals: [], reason: 'Holiday' }]));

describe('nextWorkStart', () => {
  it('returns t at the start of an interval', () => expect(fmt(nextWorkStart(cal, at('2026-11-23T09:00')))).toBe('2026-11-23T09:00'));
  it('returns t inside an interval', () => expect(fmt(nextWorkStart(cal, at('2026-11-23T09:01')))).toBe('2026-11-23T09:01'));
  it('moves one minute before the start to the start', () => expect(fmt(nextWorkStart(cal, at('2026-11-23T08:59')))).toBe('2026-11-23T09:00'));
  it('moves the end of the morning to the afternoon start (lunch break)', () => expect(fmt(nextWorkStart(cal, at('2026-11-23T13:00')))).toBe('2026-11-23T14:00'));
  it('returns one minute before an interval end unchanged', () => expect(fmt(nextWorkStart(cal, at('2026-11-23T17:59')))).toBe('2026-11-23T17:59'));
  it('moves the day end to the next morning', () => expect(fmt(nextWorkStart(cal, at('2026-11-23T18:00')))).toBe('2026-11-24T09:00'));
  it('skips Sunday', () => expect(fmt(nextWorkStart(cal, at('2026-11-21T18:00')))).toBe('2026-11-23T09:00'));
  it('skips a holiday', () => expect(fmt(nextWorkStart(cal, at('2026-11-24T18:00')))).toBe('2026-11-26T09:00'));
});

describe('prevWorkEnd', () => {
  it('returns t at the end of an interval', () => expect(fmt(prevWorkEnd(cal, at('2026-11-23T18:00')))).toBe('2026-11-23T18:00'));
  it('returns t inside an interval', () => expect(fmt(prevWorkEnd(cal, at('2026-11-23T17:59')))).toBe('2026-11-23T17:59'));
  it('moves one minute after the end back to the end', () => expect(fmt(prevWorkEnd(cal, at('2026-11-23T18:01')))).toBe('2026-11-23T18:00'));
  it('moves an interval start back to the previous end', () => expect(fmt(prevWorkEnd(cal, at('2026-11-23T14:00')))).toBe('2026-11-23T13:00'));
  it('moves Monday 09:00 back over Sunday to Saturday 18:00', () => expect(fmt(prevWorkEnd(cal, at('2026-11-23T09:00')))).toBe('2026-11-21T18:00'));
  it('skips a holiday', () => expect(fmt(prevWorkEnd(cal, at('2026-11-26T09:00')))).toBe('2026-11-24T18:00'));
});

describe('finishFrom', () => {
  it('one day from Monday 09:00 finishes Monday 18:00, not Tuesday 09:00', () => {
    expect(fmt(finishFrom(cal, at('2026-11-23T09:00'), DAY))).toBe('2026-11-23T18:00');
  });
  it('four hours lands on the lunch-break start (an interval end)', () => {
    expect(fmt(finishFrom(cal, at('2026-11-23T09:00'), 4 * H))).toBe('2026-11-23T13:00');
  });
  it('crosses the lunch break', () => expect(fmt(finishFrom(cal, at('2026-11-23T12:00'), 2 * H))).toBe('2026-11-23T15:00'));
  it('crosses a weekend', () => expect(fmt(finishFrom(cal, at('2026-11-21T09:00'), 2 * DAY))).toBe('2026-11-23T18:00'));
  it('crosses a holiday', () => expect(fmt(finishFrom(cal, at('2026-11-24T09:00'), 2 * DAY))).toBe('2026-11-26T18:00'));
  it('zero duration returns nextWorkStart', () => expect(fmt(finishFrom(cal, at('2026-11-23T18:00'), 0))).toBe('2026-11-24T09:00'));
  it('starts from nextWorkStart of a non-working start', () => expect(fmt(finishFrom(cal, at('2026-11-22T10:00'), H))).toBe('2026-11-23T10:00'));
  it('negative duration walks backward', () => expect(fmt(finishFrom(cal, at('2026-11-23T18:00'), -DAY))).toBe('2026-11-23T09:00'));
  it('one minute', () => expect(fmt(finishFrom(cal, at('2026-11-23T17:59'), 1))).toBe('2026-11-23T18:00'));
  it('long spans over years', () => {
    const s = at('2026-01-05T09:00');
    const f = finishFrom(cal, s, 300 * DAY);
    expect(workBetween(cal, s, f)).toBe(300 * DAY);
  });
});

describe('startFrom', () => {
  it('one day back from Monday 18:00 is Monday 09:00', () => expect(fmt(startFrom(cal, at('2026-11-23T18:00'), DAY))).toBe('2026-11-23T09:00'));
  it('lands on the afternoon start, not the morning end', () => expect(fmt(startFrom(cal, at('2026-11-23T18:00'), 4 * H))).toBe('2026-11-23T14:00'));
  it('crosses a weekend backward', () => expect(fmt(startFrom(cal, at('2026-11-23T18:00'), 2 * DAY))).toBe('2026-11-21T09:00'));
  it('crosses a holiday backward', () => expect(fmt(startFrom(cal, at('2026-11-26T18:00'), 2 * DAY))).toBe('2026-11-24T09:00'));
  it('zero returns prevWorkEnd', () => expect(fmt(startFrom(cal, at('2026-11-23T09:00'), 0))).toBe('2026-11-21T18:00'));
});

describe('workBetween', () => {
  it('counts a working day', () => expect(workBetween(cal, at('2026-11-23T09:00'), at('2026-11-23T18:00'))).toBe(DAY));
  it('excludes lunch', () => expect(workBetween(cal, at('2026-11-23T12:00'), at('2026-11-23T15:00'))).toBe(2 * H));
  it('is signed', () => expect(workBetween(cal, at('2026-11-23T18:00'), at('2026-11-23T09:00'))).toBe(-DAY));
  it('is zero across non-working time', () => expect(workBetween(cal, at('2026-11-21T18:00'), at('2026-11-23T09:00'))).toBe(0));
  it('excludes holidays', () => expect(workBetween(cal, at('2026-11-23T09:00'), at('2026-11-28T18:00'))).toBe(5 * DAY));
  it('zero for equal instants', () => expect(workBetween(cal, at('2026-11-23T10:00'), at('2026-11-23T10:00'))).toBe(0));
});

describe('shift', () => {
  it('positive is finishFrom', () => expect(shift(cal, at('2026-11-23T18:00'), H)).toBe(at('2026-11-24T10:00')));
  it('negative is startFrom', () => expect(shift(cal, at('2026-11-24T09:00'), -H)).toBe(at('2026-11-23T17:00')));
  it('zero is the identity (DECISIONS D-003)', () => expect(shift(cal, at('2026-11-23T18:00'), 0)).toBe(at('2026-11-23T18:00')));
});

describe('elapsed calendar', () => {
  it('is plain minute addition', () => {
    expect(ELAPSED.finishFrom(100, 50)).toBe(150);
    expect(ELAPSED.startFrom(100, 50)).toBe(50);
    expect(ELAPSED.workBetween(100, 40)).toBe(-60);
    expect(ELAPSED.shift(100, -7)).toBe(93);
  });
});

describe('inheritance', () => {
  const base: CalendarInput = defaultTenantCalendar('base', [
    { from: '2026-11-25', to: '2026-11-25', intervals: [], reason: 'Base holiday' },
    { from: '2026-11-27', to: '2026-11-27', intervals: [], reason: 'Base holiday 2' },
  ]);
  const child: CalendarInput = {
    id: 'child', baseId: 'base', timeZone: TZ, hoursPerDay: 480,
    week: { 0: [[540, 780]] }, // Sunday mornings work
    exceptions: [{ from: '2026-11-27', to: '2026-11-27', intervals: [[540, 600]] }], // overrides base holiday
  };
  const cals = compileCalendars([child, base]);
  const c = cals.get('child')!;
  it('inherits base exceptions', () => expect(c.workOnDay(c.dayOf(at('2026-11-25T10:00')))).toBe(0));
  it('child exception overrides base exception', () => expect(c.workOnDay(c.dayOf(at('2026-11-27T10:00')))).toBe(60));
  it('child week overrides base week', () => expect(fmt(nextWorkStart(c, at('2026-11-21T18:00')))).toBe('2026-11-22T09:00'));
  it('inherits the rest of the week', () => expect(c.workOnDay(c.dayOf(at('2026-11-23T10:00')))).toBe(DAY));
  it('rejects unknown bases and cycles', () => {
    expect(() => compileCalendars([{ ...child, baseId: 'nope' }])).toThrow(CalendarError);
    expect(() => compileCalendars([{ ...base, baseId: 'child' }, child])).toThrow(CalendarError);
  });
});

describe('validation', () => {
  it('rejects a calendar with no working time', () => {
    expect(() => compileCalendar({ id: 'x', timeZone: TZ, hoursPerDay: 480, week: {} })).toThrow(NoWorkingTimeError);
  });
  it('detects a 366-day window with no working time at run time', () => {
    const c = compileCalendar(defaultTenantCalendar('y', [{ from: '2027-01-01', to: '2028-06-30', intervals: [] }]));
    expect(() => finishFrom(c, at('2026-12-31T09:00'), 3 * DAY)).toThrow(NoWorkingTimeError);
  });
  it('rejects bad intervals', () => {
    expect(() => compileCalendar({ id: 'x', timeZone: TZ, hoursPerDay: 480, week: { 1: [[600, 540]] } })).toThrow(CalendarError);
    expect(() => compileCalendar({ id: 'x', timeZone: TZ, hoursPerDay: 480, week: { 1: [[0, 1500]] } })).toThrow(CalendarError);
  });
  it('rejects non-integer minutes as programming errors', () => {
    expect(() => finishFrom(cal, at('2026-11-23T09:00'), 1.5)).toThrow(TypeError);
  });
});

describe('a night-shift calendar split across midnight', () => {
  const night = compileCalendar({
    id: 'night', timeZone: TZ, hoursPerDay: 480,
    week: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[0, 120], [1320, 1440]]])),
  });
  it('works through midnight', () => {
    expect(fmt(finishFrom(night, at('2026-11-23T22:00'), 4 * H))).toBe('2026-11-24T02:00');
    expect(workBetween(night, at('2026-11-23T23:00'), at('2026-11-24T01:00'))).toBe(2 * H);
  });
});

describe('time zones with daylight saving', () => {
  const ny = compileCalendar({
    id: 'ny', timeZone: 'America/New_York', hoursPerDay: 480,
    week: Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, [[540, 1020]]])),
  });
  it('keeps local 09:00 starts across the March DST change', () => {
    const fri = parseLocal('America/New_York', '2026-03-06T09:00');
    const f = finishFrom(ny, fri, 2 * DAY);
    expect(formatLocal('America/New_York', f)).toBe('2026-03-09T17:00');
  });
});

describe('properties', () => {
  const start = at('2025-01-01T00:00');
  const span = 3 * 365 * 1440;
  it('startFrom(finishFrom(s, d), d) == nextWorkStart(s) for working s and d > 0', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: span }), fc.integer({ min: 1, max: 400 * DAY }), (off, d) => {
      const s = nextWorkStart(cal, start + off);
      return startFrom(cal, finishFrom(cal, s, d), d) === s;
    }), { numRuns: 2000 });
  });
  it('workBetween(s, finishFrom(s, d)) == d', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: span }), fc.integer({ min: 0, max: 400 * DAY }), (off, d) => {
      const s = start + off;
      return workBetween(cal, nextWorkStart(cal, s), finishFrom(cal, s, d)) === d;
    }), { numRuns: 2000 });
  });
  it('workBetween is additive', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: span }), fc.integer({ min: 0, max: span }), fc.integer({ min: 0, max: span }), (a, b, c) => {
      return workBetween(cal, start + a, start + b) + workBetween(cal, start + b, start + c) === workBetween(cal, start + a, start + c);
    }), { numRuns: 2000 });
  });
});

describe('performance', () => {
  it('100,000 finishFrom calls over random spans up to 3 years in under 150 ms', () => {
    const c = compileCalendar(defaultTenantCalendar('perf', [{ from: '2026-01-26', to: '2026-01-26', intervals: [] }]));
    const t0 = at('2026-01-01T00:00');
    // deterministic pseudo-random inputs
    let seed = 42;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const inputs: [number, number][] = [];
    for (let i = 0; i < 100_000; i++) inputs.push([t0 + Math.floor(rnd() * 365 * 1440), Math.floor(rnd() * 3 * 300 * DAY)]);
    for (let i = 0; i < 2000; i++) c.finishFrom(inputs[i]![0], inputs[i]![1]); // warm the day cache
    // Best of three, so a busy machine doesn't fail the budget.
    let ms = Infinity;
    for (let run = 0; run < 3; run++) {
      const begin = performance.now();
      for (const [s, d] of inputs) c.finishFrom(s, d);
      ms = Math.min(ms, performance.now() - begin);
    }
    expect(ms).toBeLessThan(150);
  });
});
