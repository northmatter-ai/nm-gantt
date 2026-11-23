import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { defaultTenantCalendar, formatLocal, parseLocal } from '@northmatter/calendar';
import { calculate } from '@northmatter/schedule-engine';
import { evenKeys, toScheduleInput, type ActivityRecord, type LinkRecord, type ScheduleDoc } from '@northmatter/schedule-commands';
import {
  EXCEL_COLUMNS,
  excelTemplate,
  exportExcel,
  importExcel,
  importExcelSheets,
  readDateCell,
  readXlsx,
  writeXlsx,
  type CellValue,
} from '../src/index.js';

const TZ = 'Asia/Kolkata';
const at = (s: string) => parseLocal(TZ, s);
const D = 480;
const local = (t: number | undefined) => (t === undefined ? undefined : formatLocal(TZ, t));

/** Template sheet from rows of partial column → value maps. */
function sheet(rows: Partial<Record<(typeof EXCEL_COLUMNS)[number] | string, CellValue>>[], extraCols: string[] = []) {
  const cols = [...EXCEL_COLUMNS, ...extraCols];
  return [{ name: 'Schedule', rows: [cols as CellValue[], ...rows.map((r) => cols.map((c) => r[c] ?? null))] }];
}
const opts = { projectStart: at('2026-11-23T09:00') };

function fixtureDoc(): ScheduleDoc {
  const site = { ...defaultTenantCalendar('site'), name: 'Site' };
  const office = { id: 'office', name: 'Office', baseId: 'site', timeZone: TZ, hoursPerDay: 480, week: { 6: [] as [number, number][] } };
  const mk = (id: string, extra: Partial<ActivityRecord>): ActivityRecord => ({ id, stableKey: id, code: id, name: `Name ${id}`, sortKey: '', type: 'task', duration: 2 * D, constraint: 'ASAP', ...extra });
  const acts: ActivityRecord[] = [
    mk('TA', { type: 'summary', duration: 0, name: 'Tower A & co <main>' }),
    mk('EXC', { parentId: 'TA', duration: 5 * D, towerId: 'T1', actualStart: at('2026-11-23T09:00'), actualFinish: at('2026-11-28T18:00') }),
    mk('RAFT', { parentId: 'TA', duration: 4 * D, towerId: 'T1', actualStart: at('2026-11-30T09:00'), percentComplete: 4050, remaining: 3 * D }),
    mk('COL', { parentId: 'TA', duration: 3 * D, towerId: 'T1', floorId: 'F01', calendarId: 'office', activityTemplateId: 'COLS' }),
    mk('SLAB', { parentId: 'TA', duration: 2.5 * D, towerId: 'T1', floorId: 'F01', constraint: 'SNET', constraintDate: at('2026-12-14T09:00') }),
    mk('LOE', { type: 'level_of_effort', duration: 0, name: 'Supervision' }),
    mk('HO', { type: 'finish_milestone', duration: 0, constraint: 'FNLT', constraintDate: at('2027-01-30T18:00'), name: 'हस्तांतरण' }),
  ];
  const groups = new Map<string, ActivityRecord[]>();
  for (const a of acts) groups.set(a.parentId ?? '', [...(groups.get(a.parentId ?? '') ?? []), a]);
  for (const g of groups.values()) evenKeys(g.length).forEach((k, i) => { g[i]!.sortKey = k; });
  const links: LinkRecord[] = [
    { id: 'l1', from: 'EXC', to: 'RAFT', type: 'FS', lag: 0 },
    { id: 'l2', from: 'RAFT', to: 'COL', type: 'SS', lag: 2 * D },
    { id: 'l3', from: 'COL', to: 'SLAB', type: 'FF', lag: -D },
    { id: 'l4', from: 'SLAB', to: 'HO', type: 'FS', lag: 0 },
    { id: 'l5', from: 'EXC', to: 'LOE', type: 'SS', lag: 0 },
    { id: 'l6', from: 'LOE', to: 'HO', type: 'FF', lag: 0 },
  ];
  return {
    id: 'fx', name: 'Fixture tower', kind: 'draft', version: 3, projectStart: at('2026-11-23T09:00'), dataDate: at('2026-12-02T09:00'),
    defaultCalendarId: 'site', calendars: [site, office], activities: acts, links, settings: {},
    towers: { T1: 'Tower A' }, floors: { F01: 'Floor 1' }, templates: [{ id: 'COLS', name: 'Columns & shear walls', short: 'Columns' }],
  };
}

describe('xlsx container', () => {
  it('writes and reads back text, numbers, booleans, dates and gaps', () => {
    const when = new Date(Date.UTC(2026, 11, 1, 18, 0));
    const bytes = writeXlsx([
      { name: 'One', rows: [['Head'], ['a & <b>', 1.5, true, when, null, 'हिन्दी "q"'], [], [null, -3]], header: true, widths: [10] },
      { name: 'Two/with:bad*chars', rows: [['x']] },
    ]);
    const [one, two] = readXlsx(bytes);
    expect(one!.name).toBe('One');
    expect(one!.rows[1]).toEqual(['a & <b>', 1.5, true, when, null, 'हिन्दी "q"']);
    expect(one!.rows[2]).toEqual([]);
    expect(one!.rows[3]).toEqual([null, -3]);
    expect(two!.name).toBe('Two with bad chars');
  });

  it('reads shared strings, namespace prefixes, percent and date formats as Excel writes them', () => {
    const files = {
      '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
      'xl/workbook.xml': strToU8('<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="Plan" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/s1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:si><x:t>Name</x:t></x:si><x:si><x:r><x:t>Rich </x:t></x:r><x:r><x:t xml:space="preserve">text </x:t></x:r></x:si></x:sst>'),
      'xl/styles.xml': strToU8('<x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:numFmts><x:numFmt numFmtId="170" formatCode="[$-409]d/mmm/yy;@"/></x:numFmts><x:cellXfs><x:xf numFmtId="0"/><x:xf numFmtId="14"/><x:xf numFmtId="9"/><x:xf numFmtId="170"/><x:xf numFmtId="4"/></x:cellXfs></x:styleSheet>'),
      'xl/worksheets/s1.xml': strToU8('<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="s"><x:v>1</x:v></x:c></x:row><x:row r="3"><x:c r="A3" s="1"><x:v>46357</x:v></x:c><x:c r="B3" s="2"><x:v>0.45</x:v></x:c><x:c r="C3" s="3"><x:v>46357.75</x:v></x:c><x:c r="D3" s="4"><x:v>1234.5</x:v></x:c><x:c r="E3" t="str"><x:v>formula text</x:v></x:c><x:c r="F3" t="e"><x:v>#REF!</x:v></x:c></x:row></x:sheetData></x:worksheet>'),
    };
    const [plan] = readXlsx(zipSync(files));
    expect(plan!.name).toBe('Plan');
    expect(plan!.rows[0]).toEqual(['Name', null, 'Rich text ']);
    expect(plan!.rows[1]).toEqual([]);
    expect(plan!.rows[2]).toEqual([new Date(Date.UTC(2026, 11, 1)), 45, new Date(Date.UTC(2026, 11, 1, 18)), 1234.5, 'formula text', null]);
  });

  it('refuses a file that is not an xlsx with a readable message', () => {
    expect(() => readXlsx(strToU8('Name,Code\nA,B'))).toThrow(/Not an Excel \.xlsx file/);
  });

  it('is deterministic: same schedule, same bytes', () => {
    const doc = fixtureDoc();
    const r = calculate(toScheduleInput(doc));
    expect(exportExcel(doc, r)).toEqual(exportExcel(doc, r));
  });
});

describe('Excel export → import round trip', () => {
  const doc = fixtureDoc();
  const res = calculate(toScheduleInput(doc));
  // Calendars are tenant-wide: the Calendar column names one the importing tenant already has.
  const back = importExcel(exportExcel(doc, res), { calendars: doc.calendars, defaultCalendarId: 'site', templates: doc.templates! });

  it('keeps project settings from the Project sheet', () => {
    expect(back.doc.name).toBe('Fixture tower');
    expect(back.doc.projectStart).toBe(doc.projectStart);
    expect(back.doc.dataDate).toBe(doc.dataDate);
    expect(back.report.unmapped).toEqual([]);
    expect(back.report.conversions).toEqual(['Calculated columns ignored (the engine recalculates them): Start (calculated), Finish (calculated), Total float (days), Critical']);
  });

  it('keeps every activity field the template carries', () => {
    const byCode = new Map(back.doc.activities.map((a) => [a.code, a]));
    const codeOf = (id: string | undefined) => back.doc.activities.find((a) => a.id === id)?.code;
    for (const a of doc.activities) {
      const b = byCode.get(a.code)!;
      expect(b, a.code).toBeDefined();
      expect(b.name).toBe(a.name);
      expect(b.type).toBe(a.type);
      if (a.type !== 'summary') expect(b.duration).toBe(a.duration);
      expect(codeOf(b.parentId)).toBe(a.parentId);
      expect(b.constraint).toBe(a.constraint);
      expect(local(b.constraintDate)).toBe(local(a.constraintDate));
      expect(local(b.actualStart)).toBe(local(a.actualStart));
      expect(local(b.actualFinish)).toBe(local(a.actualFinish));
      expect(b.calendarId).toBe(a.calendarId);
      expect(b.towerId ? back.doc.towers![b.towerId] : undefined).toBe(a.towerId ? doc.towers![a.towerId] : undefined);
      expect(b.floorId ? back.doc.floors![b.floorId] : undefined).toBe(a.floorId ? doc.floors![a.floorId] : undefined);
    }
    expect(byCode.get('COL')!.activityTemplateId).toBe('COLS'); // matched to the tenant's trade by name
    expect(byCode.get('RAFT')!.activityTemplateId).toBeUndefined();
    expect(byCode.get('RAFT')!.percentComplete).toBe(4050); // 40.5%, stored in hundredths
    expect(byCode.get('RAFT')!.remaining).toBe(3 * D);
    expect(byCode.get('COL')!.remaining).toBeUndefined();
    // Children keep their order.
    const kids = back.doc.activities.filter((a) => codeOf(a.parentId) === 'TA').sort((x, y) => (x.sortKey < y.sortKey ? -1 : 1)).map((a) => a.code);
    expect(kids).toEqual(['EXC', 'RAFT', 'COL', 'SLAB']);
  });

  it('keeps links with types and lags', () => {
    const codeOf = (id: string) => back.doc.activities.find((a) => a.id === id)!.code;
    const got = back.doc.links.map((l) => `${codeOf(l.from)}>${codeOf(l.to)} ${l.type} ${l.lag}`).sort();
    const want = doc.links.map((l) => `${l.from}>${l.to} ${l.type} ${l.lag}`).sort();
    expect(got).toEqual(want);
  });

  it('calculates to the same dates', () => {
    expect(back.result.ok).toBe(true);
    for (const a of doc.activities) {
      const b = back.doc.activities.find((x) => x.code === a.code)!;
      expect(local(back.result.activities[b.id]!.es), a.code).toBe(local(res.activities[a.id]!.es));
      expect(local(back.result.activities[b.id]!.ef), a.code).toBe(local(res.activities[a.id]!.ef));
    }
    expect(back.result.projectFinish).toBe(res.projectFinish);
  });
});

describe('Excel import rules', () => {
  it('builds the hierarchy from WBS numbers and turns parents into summaries', () => {
    const { doc, report } = importExcelSheets(sheet([
      { WBS: '1', Code: 'T', Name: 'Tower', Type: 'Task' },
      { WBS: '1.1', Code: 'A', Name: 'A', 'Duration (days)': 2 },
      { WBS: '1.2', Code: 'B', Name: 'B', 'Duration (days)': 3, Predecessors: '1.1' },
      { WBS: '3.1', Code: 'C', Name: 'Orphan', 'Duration (days)': 1 },
    ]), opts);
    const t = doc.activities.find((a) => a.code === 'T')!;
    expect(t.type).toBe('summary');
    expect(doc.activities.filter((a) => a.parentId === t.id).map((a) => a.code)).toEqual(['A', 'B']);
    expect(doc.activities.find((a) => a.code === 'C')!.parentId).toBeUndefined();
    expect(report.conversions.join('\n')).toMatch(/Row 2 \(T\): has activities under it.*Summary \(was Task\)/);
    expect(report.conversions.join('\n')).toMatch(/Row 5 \(C\): no row with a parent WBS of 3\.1/);
    // "1.1" resolves as a WBS number.
    expect(doc.links).toHaveLength(1);
  });

  it('resolves predecessors by code first, then WBS; reads type and lag; reports unknown ones', () => {
    const { doc, report } = importExcelSheets(sheet([
      { WBS: '1', Code: 'X1', Name: 'A', 'Duration (days)': 2 },
      { WBS: '2', Code: '1', Name: 'B (code "1")', 'Duration (days)': 2 },
      { WBS: '3', Code: 'C', Name: 'C', 'Duration (days)': 2, Predecessors: '1; X1SS+2d; NOPE' },
      { WBS: '4', Code: 'D', Name: 'D', 'Duration (days)': 2, Predecessors: '3FF-1d' },
    ]), opts);
    const codeOf = (id: string) => doc.activities.find((a) => a.id === id)!.code;
    // "1" is a code (row B) before it is a WBS number (row X1); "3" is only a WBS number.
    expect(doc.links.map((l) => `${codeOf(l.from)}>${codeOf(l.to)} ${l.type} ${l.lag}`)).toEqual(['1>C FS 0', 'X1>C SS 960', 'C>D FF -480']);
    expect(report.unmapped).toContain('Row 4 (C): predecessor "NOPE" is not a code or WBS number in the sheet; link skipped');
  });

  it('converts links to summaries to their first and last children and logs it', () => {
    const { doc, report } = importExcelSheets(sheet([
      { WBS: '1', Code: 'S', Name: 'Sub', Type: 'Summary' },
      { WBS: '1.1', Code: 'A', Name: 'A', 'Duration (days)': 2 },
      { WBS: '1.2', Code: 'B', Name: 'B', 'Duration (days)': 2, Predecessors: 'A' },
      { WBS: '2', Code: 'Z', Name: 'Z', 'Duration (days)': 2, Predecessors: 'S' },
    ]), opts);
    const codeOf = (id: string) => doc.activities.find((a) => a.id === id)!.code;
    expect(doc.links.map((l) => `${codeOf(l.from)}>${codeOf(l.to)}`).sort()).toEqual(['A>B', 'B>Z']);
    expect(report.conversions).toContain('Link out of summary S → Z moved to B');
  });

  it('reads types, defaults a missing task duration to 1 day, and resolves plain "Milestone"', () => {
    const { doc, report } = importExcelSheets(sheet([
      { Code: 'S', Name: 'Start', Type: 'Milestone' },
      { Code: 'A', Name: 'A', Predecessors: 'S' },
      { Code: 'L', Name: 'LOE', Type: 'level of effort', Predecessors: 'S SS' },
      { Code: 'F', Name: 'Finish', Type: 'milestone', Predecessors: 'A' },
      { Code: 'Q', Name: 'Weird', Type: 'Hammer', 'Duration (days)': '3d' },
    ]), opts);
    const by = (c: string) => doc.activities.find((a) => a.code === c)!;
    expect(by('S').type).toBe('start_milestone');
    expect(by('F').type).toBe('finish_milestone');
    expect(by('L').type).toBe('level_of_effort');
    expect(by('A').duration).toBe(D);
    expect(by('Q').type).toBe('task');
    expect(by('Q').duration).toBe(3 * D);
    expect(report.conversions).toContain('Row 3 (A): no duration; 1 day used (as MS Project does)');
    expect(report.conversions).toContain('Row 6 (Q): type "Hammer" not recognised; imported as Task');
  });

  it('reads constraints with dates: start constraints at the start of the working day, finish constraints at its end', () => {
    const { doc, report } = importExcelSheets(sheet([
      { Code: 'A', Name: 'A', 'Duration (days)': 2, Constraint: 'Start No Earlier Than', 'Constraint date': '01/12/2026' },
      { Code: 'B', Name: 'B', 'Duration (days)': 2, Constraint: 'FNLT', 'Constraint date': new Date(Date.UTC(2026, 11, 4)) },
      { Code: 'C', Name: 'C', 'Duration (days)': 2, Constraint: 'MSO', 'Constraint date': '3-Dec-2026 13:30' },
      { Code: 'D', Name: 'D', 'Duration (days)': 2, Constraint: 'SNET' },
      { Code: 'E', Name: 'E', 'Duration (days)': 2, Constraint: 'ASAP', 'Constraint date': 'soon' },
    ]), opts);
    const by = (c: string) => doc.activities.find((a) => a.code === c)!;
    expect([by('A').constraint, local(by('A').constraintDate)]).toEqual(['SNET', '2026-12-01T09:00']);
    expect([by('B').constraint, local(by('B').constraintDate)]).toEqual(['FNLT', '2026-12-04T18:00']);
    expect([by('C').constraint, local(by('C').constraintDate)]).toEqual(['MSO', '2026-12-03T13:30']);
    expect(by('D').constraint).toBe('ASAP');
    expect(report.conversions).toContain('Row 5 (D): SNET without a date imported as ASAP');
  });

  it('reads actuals and % complete, clamping bad values', () => {
    const { doc, report } = importExcelSheets(sheet([
      { Code: 'A', Name: 'A', 'Duration (days)': 5, 'Actual start': '2026-11-23', 'Actual finish': '2026-11-27', '% complete': 100 },
      { Code: 'B', Name: 'B', 'Duration (days)': 5, 'Actual start': '24/11/2026', '% complete': '45%', Predecessors: 'A' },
      { Code: 'C', Name: 'C', 'Duration (days)': 5, '% complete': 140, Predecessors: 'B' },
      { Code: 'X', Name: 'X', 'Duration (days)': 5, 'Actual start': '31/02/2026' },
    ]), { ...opts, dataDate: at('2026-11-30T09:00') });
    const by = (c: string) => doc.activities.find((a) => a.code === c)!;
    expect(local(by('A').actualStart)).toBe('2026-11-23T09:00');
    expect(local(by('A').actualFinish)).toBe('2026-11-27T18:00');
    expect(by('B').percentComplete).toBe(4500);
    expect(by('C').percentComplete).toBe(10000);
    expect(report.conversions).toContain('Row 4 (C): % complete 140 read as 100');
    expect(report.unmapped).toContain('Row 5 (X): Actual start "31/02/2026" is not a date; skipped');
  });

  it('maps towers and floors to ids with display names, in first-seen order', () => {
    const { doc } = importExcelSheets(sheet([
      { Code: 'A', Name: 'A', 'Duration (days)': 1, Tower: 'Tower A', Floor: 2 },
      { Code: 'B', Name: 'B', 'Duration (days)': 1, Tower: 'Tower A', Floor: 1 },
      { Code: 'C', Name: 'C', 'Duration (days)': 1, Tower: 'Tower B', Floor: 'Terrace' },
    ]), opts);
    expect(Object.values(doc.towers!)).toEqual(['Tower A', 'Tower B']);
    expect(doc.floorOrder!.map((f) => doc.floors![f])).toEqual(['Floor 2', 'Floor 1', 'Terrace']);
    expect(doc.activities[0]!.towerId).toBe(doc.activities[1]!.towerId);
  });

  it('renames duplicate codes, invents missing ones, and skips blank rows', () => {
    const { doc, report } = importExcelSheets(sheet([
      { Code: 'A', Name: 'First', 'Duration (days)': 1 },
      {},
      { Code: 'A', Name: 'Second', 'Duration (days)': 1 },
      { WBS: '4', Name: 'No code', 'Duration (days)': 1 },
    ]), opts);
    expect(doc.activities.map((a) => a.code)).toEqual(['A', 'A-2', 'WBS-4']);
    expect(report.conversions).toContain('Row 4: code A already used; renamed A-2');
  });

  it('lists unknown columns, ignores calculated ones, and accepts common header spellings', () => {
    const rows: CellValue[][] = [
      ['Task Name', 'Activity ID', 'Duration', 'Predecessors', 'Owner', 'Start'],
      ['Dig', 'A', 3, '', 'Ravi', '2026-01-01'],
    ];
    const { doc, report } = importExcelSheets([{ name: 'Sheet1', rows }], opts);
    expect(doc.activities[0]).toMatchObject({ code: 'A', name: 'Dig', duration: 3 * D });
    expect(report.unmapped).toContain('Columns not in the template, skipped: Owner');
    expect(report.conversions[0]).toMatch(/Calculated columns ignored.*Start/);
  });

  it('matches trades by name, short name or id, and adds unknown ones to the project', () => {
    const templates = [{ id: 'SLAB', name: 'Slab shuttering, rebar & pour', short: 'Slab' }, { id: 'BLK', name: 'Blockwork' }];
    const { doc, report } = importExcelSheets(sheet([
      { Code: 'A', Name: 'A', 'Duration (days)': 1, Trade: 'slab' },
      { Code: 'B', Name: 'B', 'Duration (days)': 1, Trade: 'BLOCKWORK' },
      { Code: 'C', Name: 'C', 'Duration (days)': 1, Trade: 'Waterproofing' },
      { Code: 'D', Name: 'D', 'Duration (days)': 1, Trade: 'waterproofing' },
    ], ['Trade']), { ...opts, templates });
    expect(doc.activities.map((a) => a.activityTemplateId)).toEqual(['SLAB', 'BLK', 'TR-WATERPROOFING', 'TR-WATERPROOFING']);
    expect(doc.templates!.map((x) => x.name)).toEqual(['Slab shuttering, rebar & pour', 'Blockwork', 'Waterproofing']);
    expect(report.conversions.filter((c) => c.includes('Waterproofing'))).toEqual(['Trade "Waterproofing" is new; added to the project\'s trades']);
  });

  it('uses a named calendar and reports unknown ones', () => {
    const cals = [defaultTenantCalendar('site'), { id: 'office', name: 'Office (Mon–Fri)', baseId: 'site', timeZone: TZ, hoursPerDay: 420, week: { 6: [] as [number, number][] } }];
    const { doc, report } = importExcelSheets(sheet([
      { Code: 'A', Name: 'A', 'Duration (days)': 2, Calendar: 'office (mon–fri)' },
      { Code: 'B', Name: 'B', 'Duration (days)': 2, Calendar: 'Night shift' },
    ]), { ...opts, calendars: cals, defaultCalendarId: 'site' });
    expect(doc.activities[0]).toMatchObject({ calendarId: 'office', duration: 2 * 420 });
    expect(doc.activities[1]!.calendarId).toBeUndefined();
    expect(report.unmapped).toContain('Row 3 (B): calendar "Night shift" not found; project calendar used');
  });

  it('finds the project start: Project sheet, then the option, then the earliest date, else a clear error', () => {
    const rows = [{ Code: 'A', Name: 'A', 'Duration (days)': 1, Constraint: 'SNET', 'Constraint date': '2026-12-07' }];
    expect(local(importExcelSheets(sheet(rows), opts).doc.projectStart)).toBe('2026-11-23T09:00');
    const fromSheet = importExcelSheets([...sheet(rows), { name: 'Project', rows: [['Field', 'Value'], ['Project start', '2026-11-30']] }], opts);
    expect(local(fromSheet.doc.projectStart)).toBe('2026-11-30T09:00');
    const earliest = importExcelSheets(sheet(rows));
    expect(local(earliest.doc.projectStart)).toBe('2026-12-07T09:00');
    expect(earliest.report.conversions).toContain('No project start given; the earliest date in the sheet was used');
    expect(() => importExcelSheets(sheet([{ Code: 'A', Name: 'A' }]))).toThrow(/No project start date/);
  });

  it('refuses a sheet without a recognisable header row', () => {
    expect(() => importExcelSheets([{ name: 'S', rows: [['foo', 'bar'], [1, 2]] }], opts)).toThrow(/No schedule table found/);
    expect(() => importExcelSheets(sheet([]), opts)).toThrow(/no activities/);
  });

  it('runs the engine and returns its errors and warnings in the report (dry run: nothing saved)', () => {
    const { report, result } = importExcelSheets(sheet([
      { Code: 'A', Name: 'A', 'Duration (days)': 1, Predecessors: 'B' },
      { Code: 'B', Name: 'B', 'Duration (days)': 1, Predecessors: 'A' },
    ]), opts);
    expect(result.ok).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('CYCLE');
  });

  it('reads the dates planners type', () => {
    const day = (v: CellValue) => { const r = readDateCell(v); return r && r !== 'invalid' ? r : r; };
    expect(day('2026-12-01')).toEqual({ day: 20788 });
    expect(day('01/12/2026')).toEqual({ day: 20788 });
    expect(day('1.12.26')).toEqual({ day: 20788 });
    expect(day('1-Dec-2026')).toEqual({ day: 20788 });
    expect(day('01 December 2026 14:00')).toEqual({ day: 20788, time: '14:00' });
    expect(day('2026-12-01T00:00')).toEqual({ day: 20788 });
    expect(day(new Date(Date.UTC(2026, 11, 1, 9, 30)))).toEqual({ day: 20788, time: '09:30' });
    expect(day('')).toBeNull();
    expect(day('next week')).toBe('invalid');
    expect(day(46000)).toBe('invalid');
  });
});

describe('Excel template', () => {
  it('imports cleanly as a linked schedule', () => {
    const { doc, report, result } = importExcel(excelTemplate('2026-12-01'));
    expect(report.unmapped).toEqual([]);
    expect(result.ok).toBe(true);
    expect(doc.activities).toHaveLength(6);
    expect(doc.links).toHaveLength(4);
    expect(local(doc.projectStart)).toBe('2026-12-01T09:00');
    expect(doc.activities.find((a) => a.code === 'TA')!.type).toBe('summary');
    expect(doc.activities.find((a) => a.code === 'TA-F01-SLAB')).toMatchObject({ activityTemplateId: 'TR-SLAB' });
  });
});

// Compile-time guard: the exported bytes must be usable as a BlobPart under TS 5.7+ lib typings.
it('export bytes are typed as a plain ArrayBuffer view (usable in new Blob)', () => {
  const bytes: Uint8Array<ArrayBuffer> = excelTemplate();
  expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
});
