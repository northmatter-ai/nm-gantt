const en = {
  not_started: 'Not started', in_progress: 'In progress', late: 'Late vs baseline', reported: 'Reported complete (DPR)', certified: 'Certified complete',
  floor: 'Floor', activity: 'Activity', start: 'Start', finish: 'Finish', lateStart: 'Late start', lateFinish: 'Late finish', totalFloat: 'Total float',
  baselineFinish: 'Baseline finish', variance: 'Variance', inspections: 'Inspections', photos: 'Latest DPR photos', none: 'None', close: 'Close',
  openInGantt: 'Open in Gantt', status: 'Status', planned: 'Planned', actual: 'Actual (certified)', rate: 'floors/week', clash: 'Clash',
  planSource: 'Plan from', liveSchedule: 'Live schedule', templates: 'Trades', showAll: 'All', showNone: 'None', floorsAxis: 'Floor',
  window: 'Window', weeks: 'weeks', from: 'From', tower: 'Tower', allTowers: 'All towers', exportPdf: 'Export PDF',
  drawings: 'Drawings', material: 'Material', labour: 'Labour', predecessor: 'Predecessor', inspection: 'Inspection',
  commitment: 'This week', ppc: 'PPC', ready: 'Ready', notReady: 'Not ready', na: 'N/A', pending: 'Pending', done: 'Done', missed: 'Missed',
  contractor: 'Contractor', noActivities: 'No activities start or are in progress in this window', lookahead: 'Look-ahead',
  printedAt: 'Printed', dataDate: 'Data date', passed: 'Passed', failed: 'Failed', tableView: 'Table', chartView: 'Chart',
  other: 'Other trades', planVsActual: 'planned {p} · actual {a}', noData: 'No floor-by-floor activities for this tower',
};
type Dict = typeof en;
const hi: Dict = {
  not_started: 'शुरू नहीं', in_progress: 'प्रगति में', late: 'बेसलाइन से देर', reported: 'रिपोर्ट पूर्ण (DPR)', certified: 'प्रमाणित पूर्ण',
  floor: 'मंज़िल', activity: 'गतिविधि', start: 'प्रारंभ', finish: 'समाप्ति', lateStart: 'देर से प्रारंभ', lateFinish: 'देर से समाप्ति', totalFloat: 'कुल फ़्लोट',
  baselineFinish: 'बेसलाइन समाप्ति', variance: 'अंतर', inspections: 'निरीक्षण', photos: 'नवीनतम DPR फ़ोटो', none: 'कोई नहीं', close: 'बंद करें',
  openInGantt: 'गैंट में खोलें', status: 'स्थिति', planned: 'नियोजित', actual: 'वास्तविक (प्रमाणित)', rate: 'मंज़िल/सप्ताह', clash: 'टकराव',
  planSource: 'योजना स्रोत', liveSchedule: 'लाइव शेड्यूल', templates: 'ट्रेड', showAll: 'सभी', showNone: 'कोई नहीं', floorsAxis: 'मंज़िल',
  window: 'अवधि', weeks: 'सप्ताह', from: 'से', tower: 'टावर', allTowers: 'सभी टावर', exportPdf: 'PDF निर्यात',
  drawings: 'ड्रॉइंग', material: 'सामग्री', labour: 'श्रमिक', predecessor: 'पूर्ववर्ती', inspection: 'निरीक्षण',
  commitment: 'इस सप्ताह', ppc: 'PPC', ready: 'तैयार', notReady: 'तैयार नहीं', na: 'लागू नहीं', pending: 'लंबित', done: 'पूर्ण', missed: 'छूटा',
  contractor: 'ठेकेदार', noActivities: 'इस अवधि में कोई गतिविधि नहीं', lookahead: 'लुक-अहेड',
  printedAt: 'मुद्रित', dataDate: 'डेटा तिथि', passed: 'पास', failed: 'फ़ेल', tableView: 'तालिका', chartView: 'चार्ट',
  other: 'अन्य ट्रेड', planVsActual: 'नियोजित {p} · वास्तविक {a}', noData: 'इस टावर के लिए मंज़िलवार गतिविधियाँ नहीं',
};
export type VKey = keyof Dict;
export type VT = (k: VKey, vars?: Record<string, string | number>) => string;
export function vt(locale: 'en' | 'hi' = 'en'): VT {
  const d = locale === 'hi' ? hi : en;
  return (k, vars) => {
    let s = d[k] ?? en[k];
    if (vars) for (const [n, v] of Object.entries(vars)) s = s.replace(`{${n}}`, String(v));
    return s;
  };
}
