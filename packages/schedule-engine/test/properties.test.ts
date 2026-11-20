import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compileCalendar } from '@nm/calendar';
import { calculate, type ActivityInput, type LinkInput, type LinkType, type ScheduleInput } from '../src/index.js';
import { at, DAY, STD } from './helpers.js';

const cal = compileCalendar(STD);
const TYPES: LinkType[] = ['FS', 'SS', 'FF', 'SF'];

/** Random acyclic schedule: links only go from lower to higher index. */
const scheduleArb = (maxN: number) =>
  fc.integer({ min: 1, max: maxN }).chain((n) =>
    fc.record({
      durations: fc.array(fc.integer({ min: 0, max: 10 * DAY }), { minLength: n, maxLength: n }),
      links: fc.uniqueArray(
        fc.tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 }), fc.constantFrom(...TYPES), fc.integer({ min: -DAY, max: 3 * DAY })),
        { maxLength: n * 2, selector: ([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}` },
      ),
    }).map(({ durations, links }): ScheduleInput => {
      const id = (i: number) => `A${String(i).padStart(5, '0')}`;
      const activities: ActivityInput[] = durations.map((d, i) => ({ id: id(i), type: 'task', duration: d, constraint: 'ASAP' }));
      const ls: LinkInput[] = links
        .filter(([a, b]) => a !== b)
        .map(([a, b, type, lag], k) => ({ id: `L${String(k).padStart(5, '0')}`, from: id(Math.min(a, b)), to: id(Math.max(a, b)), type, lag }));
      const projectStart = at('2026-11-23T09:00');
      return { projectStart, dataDate: projectStart, defaultCalendarId: 'std', calendars: [STD], activities, links: ls };
    }),
  );

function linkHolds(l: LinkInput, res: ReturnType<typeof calculate>): boolean {
  const i = res.activities[l.from]!, j = res.activities[l.to]!;
  switch (l.type) {
    case 'FS': return j.es >= cal.nextWorkStart(cal.shift(i.ef, l.lag)) || cal.workBetween(cal.shift(i.ef, l.lag), j.es) >= 0;
    case 'SS': return cal.workBetween(cal.shift(i.es, l.lag), j.es) >= 0;
    case 'FF': return cal.workBetween(cal.shift(i.ef, l.lag), j.ef) >= 0;
    case 'SF': return cal.workBetween(cal.shift(i.es, l.lag), j.ef) >= 0;
  }
}

function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const RUNS = { numRuns: 60 };

describe('engine properties on random valid schedules', () => {
  it('1. at early dates every link condition holds', () => {
    fc.assert(fc.property(scheduleArb(300), (input) => {
      const res = calculate(input);
      return res.ok && input.links.every((l) => linkHolds(l, res));
    }), RUNS);
  });

  it('2. for not-started tasks workBetween(ES, EF) = D', () => {
    fc.assert(fc.property(scheduleArb(300), (input) => {
      const res = calculate(input);
      return input.activities.every((a) => cal.workBetween(res.activities[a.id]!.es, res.activities[a.id]!.ef) === a.duration);
    }), RUNS);
  });

  it('3. total float ≥ free float ≥ 0 whenever total float ≥ 0', () => {
    fc.assert(fc.property(scheduleArb(300), (input) => {
      const res = calculate(input);
      return Object.values(res.activities).every((r) => r.totalFloat < 0 || (r.totalFloat >= r.freeFloat && r.freeFloat >= 0));
    }), RUNS);
  });

  it('4. with no constraints the smallest total float is 0 and the longest path reaches the project finish', () => {
    fc.assert(fc.property(scheduleArb(300), (input) => {
      const res = calculate(input);
      const rs = Object.values(res.activities);
      const minTf = Math.min(...rs.map((r) => r.totalFloat));
      const lp = rs.filter((r) => r.isLongestPath);
      return minTf === 0 && lp.some((r) => r.ef === res.projectFinish) && lp.some((r) => r.drivingLinkIds.length === 0);
    }), RUNS);
  });

  it('5. shuffling activities and links gives identical results', () => {
    fc.assert(fc.property(scheduleArb(300), fc.integer(), (input, seed) => {
      const a = calculate(input);
      const b = calculate({ ...input, activities: shuffle(input.activities, seed), links: shuffle(input.links, seed + 1) });
      expect(b).toEqual(a);
      return true;
    }), RUNS);
  });

  it('6. adding a link never makes an early date earlier; removing one never makes one later', () => {
    fc.assert(fc.property(scheduleArb(200), fc.nat(), fc.nat(), (input, x, y) => {
      const n = input.activities.length;
      if (n < 2) return true;
      const a = Math.min(x % n, y % n), b = Math.max(x % n, y % n);
      if (a === b) return true;
      const from = input.activities[a]!.id, to = input.activities[b]!.id;
      if (input.links.some((l) => (l.from === from && l.to === to))) return true;
      const before = calculate(input);
      const after = calculate({ ...input, links: [...input.links, { id: 'ZZZ', from, to, type: 'FS', lag: 0 }] });
      return input.activities.every((act) => after.activities[act.id]!.es >= before.activities[act.id]!.es);
    }), RUNS);
  });

  it('7. calculating twice gives the same inputHash and results', () => {
    fc.assert(fc.property(scheduleArb(200), (input) => {
      expect(calculate(input)).toEqual(calculate(input));
      return true;
    }), { numRuns: 20 });
  });
});

describe('performance', () => {
  it('10,000 activities and 20,000 links calculate in under 500 ms', () => {
    const n = 10_000;
    const activities: ActivityInput[] = [];
    const links: LinkInput[] = [];
    let s = 7;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < n; i++) activities.push({ id: `A${String(i).padStart(6, '0')}`, type: 'task', duration: (1 + Math.floor(rnd() * 10)) * DAY, constraint: 'ASAP' });
    const seen = new Set<string>();
    while (links.length < 20_000) {
      const b = 1 + Math.floor(rnd() * (n - 1));
      const a = Math.max(0, b - 1 - Math.floor(rnd() * 50));
      const key = `${a}-${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ id: `L${String(links.length).padStart(6, '0')}`, from: activities[a]!.id, to: activities[b]!.id, type: TYPES[Math.floor(rnd() * 4)]!, lag: 0 });
    }
    const input: ScheduleInput = { projectStart: at('2026-01-05T09:00'), dataDate: at('2026-01-05T09:00'), defaultCalendarId: 'std', calendars: [STD], activities, links };
    calculate(input); // warm-up (JIT)
    // Best of three, so a busy machine doesn't fail the budget.
    let ms = Infinity;
    let res = calculate(input);
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      res = calculate(input);
      ms = Math.min(ms, performance.now() - t0);
    }
    expect(res.ok).toBe(true);
    expect(ms).toBeLessThan(500);
  });
});
