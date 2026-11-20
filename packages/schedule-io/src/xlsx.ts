/**
 * Minimal Office Open XML spreadsheet (.xlsx) reader and writer — just what the schedule template needs:
 * text, numbers, booleans and dates in plain cells; bold frozen header; column widths; list validations.
 * Zip via fflate (MIT); XML via fast-xml-parser (MIT). Written from ECMA-376 Part 1 (SpreadsheetML).
 *
 * Dates cross the boundary as JS Dates whose UTC fields are the wall-clock date and time shown in Excel
 * (Excel has no time zones). Percent-formatted numbers are read as percentages (0.45 → 45).
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export type CellValue = string | number | boolean | Date | null;

export interface SheetData {
  name: string;
  rows: CellValue[][];
}

export interface WriteSheet extends SheetData {
  /** Bold, frozen first row. */
  header?: boolean;
  /** Character widths per column. */
  widths?: number[];
  /** Drop-down lists: zero-based column → options (applied to rows 2…maxRows). */
  lists?: { col: number; options: string[] }[];
  /** Zero-based columns written with the date format (Date values are always dated). */
  dateCols?: number[];
}

// Excel's day 0 is 1899-12-30 (it keeps Lotus's 1900 leap-year bug, which this offset absorbs for dates after Feb 1900).
const EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export const dateToSerial = (d: Date): number => (d.getTime() - EPOCH_MS) / DAY_MS;
export const serialToDate = (s: number): Date => new Date(Math.round((EPOCH_MS + s * DAY_MS) / 60_000) * 60_000);

export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s: string) => s.replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ write

const STYLE = { normal: 0, header: 1, date: 2 } as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(s: WriteSheet): string {
  const dateCols = new Set(s.dateCols ?? []);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  if (s.header) out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  if (s.widths?.length) out.push(`<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`);
  out.push('<sheetData>');
  s.rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((v, c) => {
      if (v === null || v === undefined || v === '') return;
      const ref = `${colName(c)}${r + 1}`;
      const st = s.header && r === 0 ? STYLE.header : v instanceof Date || dateCols.has(c) ? STYLE.date : STYLE.normal;
      const sAttr = st ? ` s="${st}"` : '';
      if (typeof v === 'number') { if (Number.isFinite(v)) cells.push(`<c r="${ref}"${sAttr}><v>${v}</v></c>`); }
      else if (typeof v === 'boolean') cells.push(`<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`);
      else if (v instanceof Date) cells.push(`<c r="${ref}"${sAttr}><v>${dateToSerial(v)}</v></c>`);
      else cells.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`);
    });
    out.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  });
  out.push('</sheetData>');
  if (s.lists?.length) {
    const max = Math.max(s.rows.length, 2000);
    out.push(`<dataValidations count="${s.lists.length}">`);
    for (const l of s.lists) {
      const col = colName(l.col);
      out.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${col}2:${col}${max}"><formula1>"${esc(l.options.join(','))}"</formula1></dataValidation>`);
    }
    out.push('</dataValidations>');
  }
  out.push('</worksheet>');
  return out.join('');
}

/** Build an .xlsx file. Sheet names are trimmed to Excel's 31-character limit. */
export function writeXlsx(sheets: WriteSheet[]): Uint8Array {
  const names = sheets.map((s) => s.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s)); });
  // Fixed timestamp keeps output byte-identical for the same input.
  return zipSync(files, { level: 6, mtime: new Date(Date.UTC(2020, 0, 1)) });
}

// ------------------------------------------------------------------ read

type X = Record<string, unknown>;
const list = (v: unknown): X[] => (Array.isArray(v) ? (v as X[]) : v === undefined || v === null || v === '' ? [] : [v as X]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ['sheet', 'Relationship', 'si', 'r', 'row', 'c', 'xf', 'numFmt'].includes(name),
});

/** Text of a <t>, <si> or <is> node (plain or rich runs; phonetic runs skipped). */
function textOf(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const n = node as X;
  if ('#text' in n) return String(n['#text']);
  let s = '';
  if (n.t !== undefined) s += textOf(n.t);
  for (const run of list(n.r)) s += textOf(run.t);
  return s;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const BUILTIN_PERCENT = new Set([9, 10]);

function classifyFormat(code: string): 'date' | 'percent' | 'other' {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  if (/%/.test(bare)) return 'percent';
  if (/[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim())) return 'date';
  return 'other';
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Read every worksheet's cell values. Throws on a file that is not an .xlsx workbook. */
export function readXlsx(data: Uint8Array | ArrayBuffer): SheetData[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
  } catch {
    throw new Error('Not an Excel .xlsx file (could not open the zip container). Save it as "Excel Workbook (.xlsx)" and try again.');
  }
  const text = (path: string) => (files[path] ? strFromU8(files[path]!) : undefined);
  const xml = (path: string) => { const t = text(path); return t ? (parser.parse(t) as X) : undefined; };

  const rootRels = list(((xml('_rels/.rels')?.Relationships as X) ?? {}).Relationship);
  const wbPath = resolvePath('', String(rootRels.find((r) => String(r['@_Type']).endsWith('/officeDocument'))?.['@_Target'] ?? 'xl/workbook.xml'));
  const wb = xml(wbPath);
  if (!wb) throw new Error('Not an Excel .xlsx file (no workbook part).');
  const wbDir = wbPath.split('/').slice(0, -1).join('/');
  const relsPath = `${wbDir}/_rels/${wbPath.split('/').pop()}.rels`;
  const rels = new Map(list(((xml(relsPath)?.Relationships as X) ?? {}).Relationship).map((r) => [String(r['@_Id']), r]));
  const relTarget = (suffix: string) => {
    for (const r of rels.values()) if (String(r['@_Type']).endsWith(suffix)) return resolvePath(wbPath, String(r['@_Target']));
    return undefined;
  };

  const sstPath = relTarget('/sharedStrings');
  const shared = sstPath ? list(((xml(sstPath)?.sst as X) ?? {}).si).map(textOf) : [];

  const kindOfStyle: ('date' | 'percent' | 'other')[] = [];
  const stylesPath = relTarget('/styles');
  if (stylesPath) {
    const ss = (xml(stylesPath)?.styleSheet as X) ?? {};
    const custom = new Map(list((ss.numFmts as X | undefined)?.numFmt).map((f) => [Number(f['@_numFmtId']), String(f['@_formatCode'] ?? '')]));
    for (const xf of list((ss.cellXfs as X | undefined)?.xf)) {
      const id = Number(xf['@_numFmtId'] ?? 0);
      kindOfStyle.push(custom.has(id) ? classifyFormat(custom.get(id)!) : BUILTIN_DATE.has(id) ? 'date' : BUILTIN_PERCENT.has(id) ? 'percent' : 'other');
    }
  }
  const date1904 = String(((wb.workbook as X)?.workbookPr as X | undefined)?.['@_date1904'] ?? '') === '1';

  const out: SheetData[] = [];
  for (const sh of list(((wb.workbook as X)?.sheets as X | undefined)?.sheet)) {
    const rel = rels.get(String(sh['@_id'] ?? sh['@_r:id'] ?? ''));
    if (!rel || !String(rel['@_Type']).endsWith('/worksheet')) continue;
    const ws = xml(resolvePath(wbPath, String(rel['@_Target'])));
    const rowsNode = list(((ws?.worksheet as X)?.sheetData as X | undefined)?.row);
    const rows: CellValue[][] = [];
    let nextRow = 0;
    for (const row of rowsNode) {
      const r = row['@_r'] !== undefined ? Number(row['@_r']) - 1 : nextRow;
      nextRow = r + 1;
      const cells: CellValue[] = [];
      let nextCol = 0;
      for (const c of list(row.c)) {
        const col = c['@_r'] !== undefined ? colIndex(String(c['@_r'])) : nextCol;
        nextCol = col + 1;
        const t = String(c['@_t'] ?? 'n');
        const raw = c.v === undefined ? undefined : textOf(c.v);
        let v: CellValue = null;
        if (t === 's') v = raw === undefined ? null : shared[Number(raw)] ?? null;
        else if (t === 'inlineStr') v = textOf(c.is);
        else if (t === 'str') v = raw ?? null;
        else if (t === 'b') v = raw === '1';
        else if (t === 'e') v = null;
        else if (t === 'd') v = raw ? new Date(`${raw.slice(0, 16)}Z`) : null;
        else if (raw !== undefined && raw !== '') {
          const n = Number(raw);
          const kind = kindOfStyle[Number(c['@_s'] ?? 0)] ?? 'other';
          v = kind === 'date' ? serialToDate(date1904 ? n + 1462 : n) : kind === 'percent' ? Math.round(n * 1e6) / 1e4 : n;
        }
        cells[col] = v;
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
      rows[r] = cells;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    out.push({ name: String(sh['@_name'] ?? `Sheet${out.length + 1}`), rows });
  }
  return out;
}
