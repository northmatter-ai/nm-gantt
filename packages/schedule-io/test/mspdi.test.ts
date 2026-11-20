import { describe, expect, it } from 'vitest';
import { defaultTenantCalendar, formatLocal, parseLocal } from '@northmatter-ai/calendar';
import { calculate } from '@northmatter-ai/schedule-engine';
import { toScheduleInput, type ScheduleDoc } from '@northmatter-ai/schedule-commands';
import { exportMspdi, importMspdi, parseIsoDuration } from '../src/index.js';

const TZ = 'Asia/Kolkata';
const at = (s: string) => parseLocal(TZ, s);

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Fixture</Name>
  <StartDate>2026-11-23T09:00:00</StartDate>
  <StatusDate>2026-11-23T09:00:00</StatusDate>
  <ScheduleFromStart>1</ScheduleFromStart>
  <CalendarUID>1</CalendarUID>
  <MinutesPerDay>480</MinutesPerDay>
  <Calendars>
    <Calendar>
      <UID>1</UID><Name>Site</Name><IsBaseCalendar>1</IsBaseCalendar>
      <WeekDays>
        <WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay>
        ${[2, 3, 4, 5, 6, 7].map((d) => `<WeekDay><DayType>${d}</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>09:00:00</FromTime><ToTime>13:00:00</ToTime></WorkingTime><WorkingTime><FromTime>14:00:00</FromTime><ToTime>18:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>`).join('')}
      </WeekDays>
      <Exceptions>
        <Exception><TimePeriod><FromDate>2026-11-25T00:00:00</FromDate><ToDate>2026-11-25T23:59:00</ToDate></TimePeriod><Name>Holiday</Name><Type>1</Type><DayWorking>0</DayWorking></Exception>
      </Exceptions>
    </Calendar>
  </Calendars>
  <Tasks>
    <Task><UID>0</UID><ID>0</ID><Name>Fixture</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>1</UID><ID>1</ID><Name>Structure</Name><OutlineNumber>1</OutlineNumber><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>2</UID><ID>2</ID><Name>Columns</Name><OutlineNumber>1.1</OutlineNumber><OutlineLevel>2</OutlineLevel><Duration>PT16H0M0S</Duration><ConstraintType>0</ConstraintType></Task>
    <Task><UID>3</UID><ID>3</ID><Name>Slab</Name><OutlineNumber>1.2</OutlineNumber><OutlineLevel>2</OutlineLevel><Duration>PT24H0M0S</Duration>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>4800</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
    <Task><UID>4</UID><ID>4</ID><Name>Blockwork</Name><OutlineNumber>2</OutlineNumber><OutlineLevel>1</OutlineLevel><Duration>PT8H0M0S</Duration>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
    <Task><UID>5</UID><ID>5</ID><Name>Handover</Name><OutlineNumber>3</OutlineNumber><OutlineLevel>1</OutlineLevel><Milestone>1</Milestone><Duration>PT0H0M0S</Duration>
      <PredecessorLink><PredecessorUID>4</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
  </Tasks>
  <Resources><Resource><UID>1</UID><Name>Crew</Name></Resource></Resources>
</Project>`;

describe('MSPDI import', () => {
  const { doc, result, report } = importMspdi(FIXTURE);
  const byName = (n: string) => doc.activities.find((a) => a.name === n)!;
  const fmt = (t: number) => formatLocal(TZ, t);

  it('maps tasks, outline, durations and calendars', () => {
    expect(doc.activities).toHaveLength(5);
    expect(byName('Columns').parentId).toBe(byName('Structure').id);
    expect(byName('Structure').type).toBe('summary');
    expect(byName('Slab').duration).toBe(1440);
    expect(doc.calendars[0]!.exceptions).toEqual([{ from: '2026-11-25', to: '2026-11-25', intervals: [], reason: 'Holiday' }]);
  });
  it('converts lag from tenths of a minute', () => {
    expect(doc.links.find((l) => l.to === byName('Slab').id)!.lag).toBe(480);
  });
  it('moves a link out of a summary to its last child and logs it', () => {
    const into = doc.links.filter((l) => l.to === byName('Blockwork').id);
    expect(into.map((l) => l.from)).toEqual([byName('Slab').id]);
    expect(report.conversions.some((c) => c.includes('out of summary'))).toBe(true);
  });
  it('classifies milestones and lists skipped items', () => {
    expect(byName('Handover').type).toBe('finish_milestone');
    expect(report.unmapped).toContain('1 resources skipped');
  });
  it('runs the engine', () => {
    expect(result.ok).toBe(true);
    // Columns Mon 23–Tue 24; +1d lag over the Wed 25 holiday → Slab starts Fri 27.
    expect(fmt(result.activities[byName('Slab').id]!.es)).toBe('2026-11-27T09:00');
    expect(fmt(result.activities[byName('Handover').id]!.es)).toBe('2026-12-01T18:00');
  });
  it('parses ISO durations', () => {
    expect(parseIsoDuration('PT16H30M0S')).toBe(990);
    expect(parseIsoDuration('P1DT2H')).toBe(1560);
  });
});

describe('MSPDI round trip', () => {
  it('export then import gives the same dates', () => {
    const doc: ScheduleDoc = {
      id: 'v', name: 'Round trip', kind: 'draft', version: 1, projectStart: at('2026-11-23T09:00'), dataDate: at('2026-11-23T09:00'),
      defaultCalendarId: 'std', calendars: [defaultTenantCalendar('std')], settings: {},
      activities: [
        { id: 'S', stableKey: 'S', code: '1', name: 'Tower', sortKey: 'a', type: 'summary', duration: 0, constraint: 'ASAP' },
        { id: 'A', stableKey: 'A', code: '1.1', name: 'A', sortKey: 'a', parentId: 'S', type: 'task', duration: 960, constraint: 'ASAP' },
        { id: 'B', stableKey: 'B', code: '1.2', name: 'B', sortKey: 'b', parentId: 'S', type: 'task', duration: 480, constraint: 'SNET', constraintDate: at('2026-11-26T09:00') },
        { id: 'M', stableKey: 'M', code: '2', name: 'Done', sortKey: 'b', type: 'finish_milestone', duration: 0, constraint: 'ASAP' },
      ],
      links: [{ id: 'l1', from: 'A', to: 'B', type: 'SS', lag: 240 }, { id: 'l2', from: 'B', to: 'M', type: 'FS', lag: 0 }],
    };
    const res = calculate(toScheduleInput(doc));
    const xml = exportMspdi(doc, res);
    expect(xml).toContain('<TotalSlack>');
    const back = importMspdi(xml);
    expect(back.result.ok).toBe(true);
    const es = (r: typeof res, name: string, d: ScheduleDoc) => r.activities[d.activities.find((a) => a.name === name)!.id]!.es;
    for (const name of ['A', 'B', 'Done']) expect(es(back.result, name, back.doc)).toBe(es(res, name, doc));
  });
});
