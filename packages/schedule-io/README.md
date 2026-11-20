# @nm/schedule-io

## MS Project XML (MSPDI)

- `importMspdi(xml, { timeZone })` returns `{ doc, result, report }`. Import is always a new draft. The report lists conversions (summary links, milestone kinds, % lags), skipped items (resources, assignments, custom fields), and engine errors and warnings. Use it as the dry-run preview.
- `exportMspdi(doc, result)` writes tasks, links and calendars with computed Start, Finish, Early/Late dates and TotalSlack.

See DECISIONS D-017 for codes still to verify against the schema.

## Excel (.xlsx)

One template for import and export, the spec's 14 columns:
WBS, Code, Name, Type, Duration (days), Calendar, Predecessors, Constraint, Constraint date, Tower, Floor, Actual start, Actual finish, % complete.

- `importExcel(bytes, { calendars, defaultCalendarId, projectStart, name, timeZone })` returns the same `{ doc, result, report }` as MSPDI. Nothing is saved; the report is the dry run.
  - The hierarchy comes from WBS numbers. A row with rows under it becomes a summary.
  - Predecessors read MS Project's text form (`12FS+2d; 15SS`), resolving each reference to a code first, then a WBS number.
  - Links to summaries are converted the same way as for MSPDI.
- `exportExcel(doc, result)` writes three sheets:
  - **Schedule**: the template, plus "Remaining (days)" when needed and four calculated columns for reading.
  - **Project**: name, start, data date and time zone.
  - **Instructions**.

  A round trip reproduces the same dates.
- `excelTemplate()` writes a blank template with example rows.
- `readXlsx` / `writeXlsx` are the small .xlsx reader and writer underneath. They use `fflate` (MIT) for the zip container and `fast-xml-parser` (MIT) for the XML.

Interpretations: DECISIONS D-028 to D-030.
