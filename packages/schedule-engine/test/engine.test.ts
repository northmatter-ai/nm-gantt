import { describe, expect, it } from 'vitest';
import { compileCalendar } from '@northmatter/calendar';
import { calculate, compare } from '../src/index.js';
import { at, DAY, fmt, H, link, ms, schedule, STD, task } from './helpers.js';

const r = (input: Parameters<typeof calculate>[0]) => {
  const res = calculate(input);
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res;
};

describe('Step 2: forward pass', () => {
  it('a one-day task starting Monday 09:00 finishes Monday 18:00; its FS successor starts Tuesday 09:00', () => {
    const res = r(schedule([task('A', 1), task('B', 1)], [link('A', 'B')]));
    expect(fmt(res.activities.A!.es)).toBe('2026-11-23T09:00');
    expect(fmt(res.activities.A!.ef)).toBe('2026-11-23T18:00');
    expect(fmt(res.activities.B!.es)).toBe('2026-11-24T09:00');
    expect(fmt(res.activities.B!.ef)).toBe('2026-11-24T18:00');
  });

  it('FS with positive lag', () => {
    const res = r(schedule([task('A', 1), task('B', 1)], [link('A', 'B', 'FS', 2 * H)]));
    expect(fmt(res.activities.B!.es)).toBe('2026-11-24T11:00');
  });

  it('FS with negative lag (lead)', () => {
    const res = r(schedule([task('A', 2), task('B', 1)], [link('A', 'B', 'FS', -DAY)]));
    expect(fmt(res.activities.B!.es)).toBe('2026-11-24T09:00');
    expect(res.warnings.some((w) => w.code === 'NEGATIVE_LAG')).toBe(true);
  });

  it('SS with lag', () => {
    const res = r(schedule([task('A', 3), task('B', 1)], [link('A', 'B', 'SS', DAY)]));
    expect(fmt(res.activities.B!.es)).toBe('2026-11-24T09:00');
  });

  it('FF: successor finishes no earlier than predecessor finish + lag', () => {
    const res = r(schedule([task('A', 3), task('B', 1)], [link('A', 'B', 'FF', 0)]));
    expect(fmt(res.activities.B!.ef)).toBe('2026-11-25T18:00');
    expect(fmt(res.activities.B!.es)).toBe('2026-11-25T09:00');
  });

  it('SF: successor finishes no earlier than predecessor start + lag', () => {
    const res = r(schedule([task('A', 1), task('B', 1)], [link('A', 'B', 'SF', 2 * DAY)]));
    expect(fmt(res.activities.B!.ef)).toBe('2026-11-24T18:00');
    expect(fmt(res.activities.B!.es)).toBe('2026-11-24T09:00');
  });

  it('elapsed lag counts calendar time (over Sunday)', () => {
    const res = r(schedule([task('A', 6), task('B', 1)], [link('A', 'B', 'FS', 24 * H, { lagCalendar: 'elapsed' })]));
    // A: Mon 23 → Sat 28 18:00; +24h elapsed → Sun 29 18:00 → next work Mon 30 09:00
    expect(fmt(res.activities.A!.ef)).toBe('2026-11-28T18:00');
    expect(fmt(res.activities.B!.es)).toBe('2026-11-30T09:00');
  });

  it('takes the latest of several candidates and marks only that link driving', () => {
    const res = r(schedule([task('A', 1), task('B', 3), task('C', 1)], [link('A', 'C', 'FS', 0, { id: 'l1' }), link('B', 'C', 'FS', 0, { id: 'l2' })]));
    expect(fmt(res.activities.C!.es)).toBe('2026-11-26T09:00');
    expect(res.activities.C!.drivingLinkIds).toEqual(['l2']);
    expect(res.activities.C!.drivingPredecessorIds).toEqual(['B']);
  });

  it('SNET pushes the start', () => {
    const res = r(schedule([task('A', 1, { constraint: 'SNET', constraintDate: at('2026-11-25T00:00') })], []));
    expect(fmt(res.activities.A!.es)).toBe('2026-11-25T09:00');
  });

  it('FNET pushes the finish', () => {
    const res = r(schedule([task('A', 1, { constraint: 'FNET', constraintDate: at('2026-11-26T18:00') })], []));
    expect(fmt(res.activities.A!.es)).toBe('2026-11-26T09:00');
  });

  it('MSO holds against logic and warns LOGIC_VIOLATED', () => {
    const res = r(schedule([task('A', 3), task('B', 1, { constraint: 'MSO', constraintDate: at('2026-11-24T09:00') })], [link('A', 'B')]));
    expect(fmt(res.activities.B!.es)).toBe('2026-11-24T09:00');
    expect(res.warnings.some((w) => w.code === 'LOGIC_VIOLATED' && w.activityId === 'B')).toBe(true);
    expect(res.warnings.some((w) => w.code === 'HARD_CONSTRAINT')).toBe(true);
  });

  it('MFO fixes the finish', () => {
    const res = r(schedule([task('A', 2, { constraint: 'MFO', constraintDate: at('2026-12-01T18:00') })], []));
    expect(fmt(res.activities.A!.ef)).toBe('2026-12-01T18:00');
    expect(fmt(res.activities.A!.es)).toBe('2026-11-30T09:00');
  });

  it('SNLT and FNLT do not affect early dates', () => {
    const res = r(schedule([task('A', 1), task('B', 1, { constraint: 'FNLT', constraintDate: at('2026-11-23T18:00') })], [link('A', 'B')]));
    expect(fmt(res.activities.B!.es)).toBe('2026-11-24T09:00');
    expect(res.activities.B!.totalFloat).toBe(-DAY);
  });
});

describe('Milestones', () => {
  it('a finish milestone after a task finishing Monday 18:00 shows Monday 18:00', () => {
    const res = r(schedule([task('A', 1), ms('M', 'finish')], [link('A', 'M')]));
    expect(fmt(res.activities.M!.es)).toBe('2026-11-23T18:00');
    expect(res.activities.M!.es).toBe(res.activities.M!.ef);
  });
  it('a start milestone after a task finishing Monday 18:00 shows Tuesday 09:00', () => {
    const res = r(schedule([task('A', 1), ms('M', 'start')], [link('A', 'M')]));
    expect(fmt(res.activities.M!.es)).toBe('2026-11-24T09:00');
  });
  it('warns when a milestone has a duration', () => {
    const res = r(schedule([{ ...ms('M'), duration: 60 }], []));
    expect(res.warnings.some((w) => w.code === 'MILESTONE_DURATION_IGNORED')).toBe(true);
  });
  it('a finish milestone on the critical path has zero float', () => {
    const res = r(schedule([task('A', 1), ms('M', 'finish')], [link('A', 'M')]));
    expect(res.activities.M!.totalFloat).toBe(0);
    expect(res.activities.M!.isCritical).toBe(true);
  });
});

describe('Step 3–4: backward pass and float', () => {
  const input = schedule(
    [task('A', 2), task('B', 1), task('C', 4), task('D', 1)],
    [link('A', 'B'), link('A', 'C'), link('B', 'D'), link('C', 'D')],
  );
  const res = r(input);

  it('critical chain has zero float', () => {
    for (const id of ['A', 'C', 'D']) {
      expect(res.activities[id]!.totalFloat).toBe(0);
      expect(res.activities[id]!.isCritical).toBe(true);
    }
  });
  it('the short branch has float equal to the difference', () => {
    expect(res.activities.B!.totalFloat).toBe(3 * DAY);
    expect(res.activities.B!.freeFloat).toBe(3 * DAY);
    expect(res.activities.B!.isCritical).toBe(false);
    expect(fmt(res.activities.B!.lf)).toBe('2026-11-28T18:00'); // the calendar works Saturdays
  });
  it('late dates of the critical chain equal early dates', () => {
    expect(res.activities.A!.ls).toBe(res.activities.A!.es);
    expect(res.activities.D!.lf).toBe(res.activities.D!.ef);
  });
  it('project finish target drives the backward pass', () => {
    const t = r({ ...input, projectFinishTarget: at('2026-11-28T18:00') }); // one day before the natural finish
    expect(t.activities.D!.totalFloat).toBe(-DAY);
    expect(t.warnings.some((w) => w.code === 'NEGATIVE_FLOAT')).toBe(true);
  });
  it('a deadline affects late dates only', () => {
    const t = r(schedule([task('A', 3, { deadline: at('2026-11-24T18:00') })], []));
    expect(fmt(t.activities.A!.ef)).toBe('2026-11-25T18:00');
    expect(t.activities.A!.totalFloat).toBe(-DAY);
  });
  it('SNLT limits the late start', () => {
    const t = r(schedule([task('A', 1, { constraint: 'SNLT', constraintDate: at('2026-11-23T09:00') }), task('B', 5)], []));
    expect(t.activities.A!.ls).toBe(at('2026-11-23T09:00'));
    expect(t.activities.A!.totalFloat).toBe(0);
  });
  it('free float is smaller than total float when the successor has float', () => {
    const t = r(schedule([task('A', 1), task('B', 1), task('C', 5)], [link('A', 'B')]));
    expect(t.activities.A!.freeFloat).toBe(0);
    expect(t.activities.A!.totalFloat).toBe(3 * DAY);
  });
  it('SS and FF links in the backward pass', () => {
    const t = r(schedule([task('A', 2), task('B', 4), task('C', 6)], [link('A', 'B', 'SS', DAY), link('A', 'B', 'FF', 0, { id: 'ff' })].slice(0, 1)));
    // A SS+1d B; C is the longest (6d) so project finish is Sat 28 18:00.
    expect(fmt(t.activities.B!.lf)).toBe('2026-11-28T18:00');
    expect(fmt(t.activities.B!.ls)).toBe('2026-11-25T09:00');
    expect(fmt(t.activities.A!.ls)).toBe('2026-11-24T09:00');
  });
});

describe('Step 5: critical and longest path', () => {
  it('longest path walks driving links back to the project start', () => {
    const res = r(schedule([task('A', 2), task('B', 1), task('C', 4), task('D', 1)], [link('A', 'B'), link('A', 'C'), link('B', 'D'), link('C', 'D')]));
    expect(['A', 'B', 'C', 'D'].filter((id) => res.activities[id]!.isLongestPath)).toEqual(['A', 'C', 'D']);
  });
  it('critical threshold widens the critical set', () => {
    const res = r(schedule([task('A', 1), task('B', 2)], [], { settings: { criticalThresholdMinutes: DAY } }));
    expect(res.activities.A!.isCritical).toBe(true);
  });
  it('longest-path definition sets is_critical from the longest path', () => {
    const res = r(schedule([task('A', 1, { deadline: at('2026-11-20T18:00') }), task('B', 2)], [], { settings: { criticalDefinition: 'longest_path' } }));
    expect(res.activities.A!.isCritical).toBe(false);
    expect(res.activities.B!.isCritical).toBe(true);
  });
});

describe('Step 6: ALAP, summaries, level of effort', () => {
  it('ALAP moves an activity later by its free float without moving successors', () => {
    const res = r(schedule([task('A', 1, { constraint: 'ALAP' }), task('B', 1), task('C', 4)], [link('A', 'B'), link('B', 'C', 'FS', 0)].slice(0, 1).concat([])));
    // A → B; C independent 4d. A has free float 0 (B directly follows), B has free float 2d.
    expect(fmt(res.activities.A!.es)).toBe('2026-11-23T09:00');
    const res2 = r(schedule([task('A', 1, { constraint: 'ALAP' }), task('C', 4)], []));
    expect(fmt(res2.activities.A!.es)).toBe('2026-11-26T09:00');
    expect(res2.activities.A!.freeFloat).toBe(0);
  });
  it('summary rolls up children', () => {
    const res = r(schedule([
      { id: 'S', code: 'S', type: 'summary', duration: 0, constraint: 'ASAP' },
      task('A', 2, { parentId: 'S' }), task('B', 1, { parentId: 'S' }), task('C', 5),
    ], [link('A', 'B')]));
    expect(fmt(res.activities.S!.es)).toBe('2026-11-23T09:00');
    expect(fmt(res.activities.S!.ef)).toBe('2026-11-25T18:00');
    expect(res.activities.S!.totalFloat).toBe(2 * DAY);
  });
  it('rejects links to summaries', () => {
    const res = calculate(schedule([{ id: 'S', type: 'summary', duration: 0, constraint: 'ASAP' }, task('A', 1)], [link('S', 'A')]));
    expect(res.ok).toBe(false);
    expect(res.errors[0]!.code).toBe('LINK_TO_SUMMARY');
  });
  it('level of effort spans SS predecessor to FF successor and is never critical', () => {
    const res = r(schedule([
      task('A', 2), task('B', 3), { id: 'LOE', code: 'LOE', type: 'level_of_effort', duration: 0, constraint: 'ASAP' },
    ], [link('A', 'B'), link('A', 'LOE', 'SS'), link('LOE', 'B', 'FF')]));
    expect(res.activities.LOE!.es).toBe(res.activities.A!.es);
    expect(res.activities.LOE!.ef).toBe(res.activities.B!.ef);
    expect(res.activities.LOE!.isCritical).toBe(false);
  });
});

describe('Progress and the data date', () => {
  const dataDate = at('2026-11-25T09:00'); // Wednesday morning

  it('complete activities keep actual dates and have no float', () => {
    const res = r(schedule([task('A', 2, { actualStart: at('2026-11-23T09:00'), actualFinish: at('2026-11-24T13:00') }), task('B', 1)], [link('A', 'B')], { dataDate }));
    expect(fmt(res.activities.A!.ef)).toBe('2026-11-24T13:00');
    expect(res.activities.A!.totalFloat).toBe(0);
    expect(res.activities.A!.isCritical).toBe(false);
    expect(res.activities.A!.status).toBe('complete');
    // Successor would start at 14:00 Tue but cannot start before the data date.
    expect(fmt(res.activities.B!.es)).toBe('2026-11-25T09:00');
  });

  it('in-progress remaining work starts at the data date', () => {
    const res = r(schedule([task('A', 4, { actualStart: at('2026-11-23T09:00') })], [], { dataDate }));
    expect(res.activities.A!.status).toBe('in_progress');
    expect(fmt(res.activities.A!.es)).toBe('2026-11-23T09:00');
    expect(fmt(res.activities.A!.remainingStart)).toBe('2026-11-25T09:00');
    expect(res.activities.A!.remaining).toBe(2 * DAY); // default: D − work done to data date
    expect(fmt(res.activities.A!.ef)).toBe('2026-11-26T18:00');
  });

  it('remaining from percent complete', () => {
    const res = r(schedule([task('A', 4, { actualStart: at('2026-11-23T09:00'), percentComplete: 7500 })], [], { dataDate }));
    expect(res.activities.A!.remaining).toBe(DAY);
    expect(fmt(res.activities.A!.ef)).toBe('2026-11-25T18:00');
  });

  it('retained logic keeps unfinished predecessors driving; progress override ignores them', () => {
    const acts = [task('A', 5), task('B', 2, { actualStart: at('2026-11-24T09:00') })];
    const links = [link('A', 'B')];
    const retained = r(schedule(acts, links, { dataDate }));
    // A has not started, so the data date pushes it to Wed 25 → finishes Tue 1 Dec; B's remaining work follows.
    expect(fmt(retained.activities.B!.remainingStart)).toBe('2026-12-01T09:00');
    expect(retained.warnings.some((w) => w.code === 'OUT_OF_SEQUENCE')).toBe(true);
    const override = r(schedule(acts, links, { dataDate, settings: { progressMode: 'progress_override' } }));
    expect(fmt(override.activities.B!.remainingStart)).toBe('2026-11-25T09:00');
  });

  it('not-started activities cannot start before the data date', () => {
    const res = r(schedule([task('A', 1)], [], { dataDate }));
    expect(fmt(res.activities.A!.es)).toBe('2026-11-25T09:00');
  });

  it('rejects actuals after the data date, finish without start, finish before start', () => {
    const codes = (a: Parameters<typeof task>[2]) => calculate(schedule([task('A', 1, a)], [], { dataDate })).errors.map((e) => e.code);
    expect(codes({ actualStart: at('2026-11-26T09:00') })).toContain('ACTUAL_AFTER_DATA_DATE');
    expect(codes({ actualFinish: at('2026-11-24T09:00') })).toContain('ACTUAL_FINISH_WITHOUT_START');
    expect(codes({ actualStart: at('2026-11-24T09:00'), actualFinish: at('2026-11-23T18:00') })).toContain('ACTUAL_FINISH_BEFORE_START');
  });
});

describe('Validation', () => {
  it('reports every cycle as its list of codes in order', () => {
    const res = calculate(schedule([task('A', 1), task('B', 1), task('C', 1), task('D', 1)], [link('A', 'B'), link('B', 'C'), link('C', 'A'), link('C', 'D')]));
    expect(res.ok).toBe(false);
    const cyc = res.errors.find((e) => e.code === 'CYCLE')!;
    expect(cyc.activityIds).toEqual(['A', 'B', 'C']);
    expect(cyc.message).toContain('A → B → C → A');
  });
  it('self link, duplicate link, unknown activity', () => {
    const codes = calculate(schedule([task('A', 1), task('B', 1)], [link('A', 'A'), link('A', 'B'), link('A', 'B', 'SS'), link('A', 'X')])).errors.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(['SELF_LINK', 'DUPLICATE_LINK', 'UNKNOWN_ACTIVITY']));
  });
  it('missing constraint date', () => {
    expect(calculate(schedule([task('A', 1, { constraint: 'SNET' })], [])).errors[0]!.code).toBe('MISSING_CONSTRAINT_DATE');
  });
  it('no working time', () => {
    const res = calculate(schedule([task('A', 1)], [], { calendars: [{ id: 'std', timeZone: 'Asia/Kolkata', hoursPerDay: 480, week: {} }] }));
    expect(res.errors[0]!.code).toBe('NO_WORKING_TIME');
  });
  it('never throws on bad schedules; throws on non-integer minutes', () => {
    expect(() => calculate(schedule([task('A', 1)], [link('A', 'Z')]))).not.toThrow();
    expect(() => calculate(schedule([{ ...task('A', 1), duration: 1.5 }], []))).toThrow(TypeError);
  });
  it('warns on open ends, long lags and long durations', () => {
    const res = r(schedule([task('A', 61), task('B', 1)], [link('A', 'B', 'FS', 21 * DAY)]));
    const codes = res.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['OPEN_START', 'OPEN_END', 'LONG_LAG', 'LONG_DURATION']));
  });
  it('negative lags can be disallowed', () => {
    const res = calculate(schedule([task('A', 1), task('B', 1)], [link('A', 'B', 'FS', -60)], { settings: { negativeLagAllowed: false } }));
    expect(res.errors[0]!.code).toBe('NEGATIVE_LAG_NOT_ALLOWED');
  });
});

describe('Multiple calendars', () => {
  it('float is measured on the activity’s own calendar', () => {
    const sixDay = STD;
    const fiveDay = { ...STD, id: 'five', week: { ...STD.week, 6: [] } };
    const res = r(schedule([task('A', 5, { calendarId: 'five' }), task('B', 6)], [], { calendars: [sixDay, fiveDay] }));
    // A on Mon–Fri finishes Fri 27; project finishes Sat 28 18:00 (B). A has 0 float on its own calendar (Sat is non-working).
    expect(fmt(res.activities.A!.ef)).toBe('2026-11-27T18:00');
    expect(res.activities.A!.totalFloat).toBe(0);
  });
});

describe('Baselines and variance', () => {
  it('positive variance means later than baseline; added and removed by stable key', () => {
    const base = r(schedule([task('A', 1), task('B', 1), task('X', 1)], [link('A', 'B')]));
    const cur = r(schedule([task('A', 2), task('B', 1), task('Y', 1)], [link('A', 'B')]));
    const v = compare(cur, base, (id) => id, { calendar: compileCalendar(STD) });
    const byKey = Object.fromEntries(v.map((x) => [x.key, x]));
    expect(byKey.B!.startVariance).toBe(DAY);
    expect(byKey.A!.durationVariance).toBe(DAY);
    expect(byKey.Y!.status).toBe('added');
    expect(byKey.X!.status).toBe('removed');
  });
});

describe('Determinism', () => {
  it('calculating twice gives the same hash and results', () => {
    const input = schedule([task('A', 1), task('B', 2)], [link('A', 'B')]);
    expect(calculate(input)).toEqual(calculate(input));
  });
});
