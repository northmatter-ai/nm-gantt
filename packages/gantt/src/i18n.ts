import type { ColumnKey, Locale } from './types.js';

const en = {
  col_wbs: 'WBS', col_code: 'Code', col_name: 'Activity', col_duration: 'Dur.', col_start: 'Start', col_finish: 'Finish',
  col_totalFloat: 'TF', col_freeFloat: 'FF', col_predecessors: 'Predecessors', col_percent: '%', col_constraint: 'Constraint',
  col_calendar: 'Calendar', col_tower: 'Tower', col_floor: 'Floor', col_status: 'Status',
  critical: 'critical', notCritical: 'not critical', totalFloat: 'total float', days: 'd',
  today: 'Today', dataDate: 'Data date',
  insertBelow: 'Insert activity below', delete: 'Delete', indent: 'Indent', outdent: 'Outdent', edit: 'Edit…',
  traceBack: 'Trace predecessors', traceForward: 'Trace successors', clearTrace: 'Clear trace',
  confirmDeleteLinks: 'Deleting will also remove {n} link(s). Continue?',
  readOnlyComplete: 'Completed activities cannot be dragged', readOnlyView: 'Read-only view',
  newActivity: 'New activity', save: 'Save', cancel: 'Cancel', close: 'Close',
  general: 'General', predecessors: 'Predecessors', successors: 'Successors', constraints: 'Constraints', progress: 'Progress', notes: 'Notes',
  name: 'Name', code: 'Code', type: 'Type', duration: 'Duration', calendar: 'Calendar', tower: 'Tower', floor: 'Floor',
  constraint: 'Constraint', constraintDate: 'Constraint date', deadline: 'Deadline',
  actualStart: 'Actual start', actualFinish: 'Actual finish', percentComplete: '% complete', remaining: 'Remaining',
  lag: 'Lag', linkType: 'Type', add: 'Add', remove: 'Remove', activity: 'Activity',
  task: 'Task', start_milestone: 'Start milestone', finish_milestone: 'Finish milestone', summary: 'Summary', level_of_effort: 'Level of effort',
  not_started: 'Not started', in_progress: 'In progress', complete: 'Complete',
  legendTask: 'Task', legendCritical: 'Critical', legendProgress: 'Progress', legendSummary: 'Summary', legendMilestone: 'Milestone',
  legendBaseline: 'Baseline', legendLoe: 'Level of effort', legendFloat: 'Float',
  recalculating: 'Recalculating…', saving: 'Saving…', saved: 'Saved', error: 'Error',
  editLink: 'Edit link', deleteLink: 'Delete link', scheduleErrors: 'The schedule cannot be calculated',
  undo: 'Undo', redo: 'Redo', newStart: 'Start', newFinish: 'Finish',
  noRows: 'No activities match', defaultCal: 'Schedule default',
  startedFixed: 'This activity has started, so its start is fixed — drag the right end to change the remaining work',
  nothingToMove: 'Nothing in this summary can move (all started or complete)',
  emptySummary: 'This summary is empty. Select the row below it and press Tab to put activities inside it',
  dragStart: 'Drag to change the start', dragFinish: 'Drag to change the finish', finishBeforeStart: 'must be after the start',
  phTools: 'Schedule view', phScope: 'Show', phLookahead: 'Look-ahead', phLookaheadWeeks: 'Next {n} weeks', phAll: 'Whole project',
  phFind: 'Find activity', phCount: '{n} activities', phHideDone: 'Hide done', phZoomIn: 'Zoom in', phZoomOut: 'Zoom out', phFit: 'Fit',
  phListLabel: 'Activities', phInProgress: 'In progress', phThisWeek: 'Starting this week', phNextWeek: 'Starting next week',
  phWeekOf: 'Week of {d}', phProject: 'Project', phDone: 'Done', phLate: '{n} late', phStatus: 'Status', phPlanned: 'Dates', phFloat: 'Total float',
  phVsBaseline: 'Against baseline', phOnTime: 'On time', phDaysLate: '{n} days late', phDaysEarly: '{n} days early',
  phReadOnly: 'View only. Changes are made in the planning app on a computer.',
  trade: 'Trade', addTower: '+ Add tower…', addFloor: '+ Add floor…', addTrade: '+ Add trade…', tradeExample: 'Slab casting',
  lookupNewName: 'New {what} name', lookupNameNeeded: 'Type a name for the new {what}',
  lookupHint: 'Tower, floor and trade put the activity on the Tower × floor grid and line of balance.',
  setupTitle: 'Towers, floors & trades', setupOpen: 'Towers, floors & trades…', towersList: 'Towers', floorsList: 'Floors, bottom to top',
  tradesList: 'Trades, in construction order', moveUp: 'Move up', moveDown: 'Move down', usedBy: '{n} activities', inUseNoRemove: 'In use, so it cannot be removed',
  addFloorsRange: 'Add floors', fromN: 'from', toN: 'to', nameCol: 'Name', shortCol: 'Short name', newEntry: 'New', setupEmpty: 'None yet',
};

type Dict = typeof en;

const hi: Dict = {
  col_wbs: 'WBS', col_code: 'कोड', col_name: 'गतिविधि', col_duration: 'अवधि', col_start: 'प्रारंभ', col_finish: 'समाप्ति',
  col_totalFloat: 'कुल फ़्लोट', col_freeFloat: 'मुक्त फ़्लोट', col_predecessors: 'पूर्ववर्ती', col_percent: '%', col_constraint: 'बाध्यता',
  col_calendar: 'कैलेंडर', col_tower: 'टावर', col_floor: 'मंज़िल', col_status: 'स्थिति',
  critical: 'क्रिटिकल', notCritical: 'क्रिटिकल नहीं', totalFloat: 'कुल फ़्लोट', days: 'दि',
  today: 'आज', dataDate: 'डेटा तिथि',
  insertBelow: 'नीचे गतिविधि जोड़ें', delete: 'हटाएँ', indent: 'इंडेंट', outdent: 'आउटडेंट', edit: 'संपादित करें…',
  traceBack: 'पूर्ववर्ती दिखाएँ', traceForward: 'उत्तरवर्ती दिखाएँ', clearTrace: 'ट्रेस हटाएँ',
  confirmDeleteLinks: 'हटाने से {n} लिंक भी हट जाएँगे। जारी रखें?',
  readOnlyComplete: 'पूर्ण गतिविधियाँ खिसकाई नहीं जा सकतीं', readOnlyView: 'केवल पढ़ने के लिए',
  newActivity: 'नई गतिविधि', save: 'सहेजें', cancel: 'रद्द करें', close: 'बंद करें',
  general: 'सामान्य', predecessors: 'पूर्ववर्ती', successors: 'उत्तरवर्ती', constraints: 'बाध्यताएँ', progress: 'प्रगति', notes: 'टिप्पणियाँ',
  name: 'नाम', code: 'कोड', type: 'प्रकार', duration: 'अवधि', calendar: 'कैलेंडर', tower: 'टावर', floor: 'मंज़िल',
  constraint: 'बाध्यता', constraintDate: 'बाध्यता तिथि', deadline: 'अंतिम तिथि',
  actualStart: 'वास्तविक प्रारंभ', actualFinish: 'वास्तविक समाप्ति', percentComplete: '% पूर्ण', remaining: 'शेष',
  lag: 'लैग', linkType: 'प्रकार', add: 'जोड़ें', remove: 'हटाएँ', activity: 'गतिविधि',
  task: 'कार्य', start_milestone: 'प्रारंभ माइलस्टोन', finish_milestone: 'समाप्ति माइलस्टोन', summary: 'सारांश', level_of_effort: 'लेवल ऑफ़ एफ़र्ट',
  not_started: 'शुरू नहीं', in_progress: 'प्रगति में', complete: 'पूर्ण',
  legendTask: 'कार्य', legendCritical: 'क्रिटिकल', legendProgress: 'प्रगति', legendSummary: 'सारांश', legendMilestone: 'माइलस्टोन',
  legendBaseline: 'बेसलाइन', legendLoe: 'लेवल ऑफ़ एफ़र्ट', legendFloat: 'फ़्लोट',
  recalculating: 'पुनर्गणना…', saving: 'सहेजा जा रहा है…', saved: 'सहेजा गया', error: 'त्रुटि',
  editLink: 'लिंक संपादित करें', deleteLink: 'लिंक हटाएँ', scheduleErrors: 'शेड्यूल की गणना नहीं हो सकती',
  undo: 'पूर्ववत', redo: 'फिर से करें', newStart: 'प्रारंभ', newFinish: 'समाप्ति',
  noRows: 'कोई गतिविधि मेल नहीं खाती', defaultCal: 'शेड्यूल डिफ़ॉल्ट',
  startedFixed: 'यह गतिविधि शुरू हो चुकी है, प्रारंभ तय है — शेष काम बदलने के लिए दायाँ सिरा खींचें',
  nothingToMove: 'इस सारांश में कुछ भी खिसकाया नहीं जा सकता',
  emptySummary: 'यह सारांश खाली है। गतिविधियाँ इसके अंदर रखने के लिए नीचे की पंक्ति चुनकर Tab दबाएँ',
  dragStart: 'प्रारंभ बदलने के लिए खींचें', dragFinish: 'समाप्ति बदलने के लिए खींचें', finishBeforeStart: 'प्रारंभ के बाद होनी चाहिए',
  phTools: 'शेड्यूल दृश्य', phScope: 'दिखाएँ', phLookahead: 'आगे की योजना', phLookaheadWeeks: 'अगले {n} सप्ताह', phAll: 'पूरा प्रोजेक्ट',
  phFind: 'गतिविधि खोजें', phCount: '{n} गतिविधियाँ', phHideDone: 'पूर्ण छिपाएँ', phZoomIn: 'ज़ूम इन', phZoomOut: 'ज़ूम आउट', phFit: 'पूरा दिखाएँ',
  phListLabel: 'गतिविधियाँ', phInProgress: 'प्रगति में', phThisWeek: 'इस सप्ताह शुरू', phNextWeek: 'अगले सप्ताह शुरू',
  phWeekOf: '{d} का सप्ताह', phProject: 'प्रोजेक्ट', phDone: 'पूर्ण', phLate: '{n} देरी', phStatus: 'स्थिति', phPlanned: 'तिथियाँ', phFloat: 'कुल फ़्लोट',
  phVsBaseline: 'बेसलाइन की तुलना में', phOnTime: 'समय पर', phDaysLate: '{n} दिन देरी', phDaysEarly: '{n} दिन पहले',
  phReadOnly: 'केवल देखने के लिए। बदलाव कंप्यूटर पर प्लानिंग ऐप में करें।',
  trade: 'ट्रेड', addTower: '+ टावर जोड़ें…', addFloor: '+ मंज़िल जोड़ें…', addTrade: '+ ट्रेड जोड़ें…', tradeExample: 'स्लैब ढलाई',
  lookupNewName: 'नए {what} का नाम', lookupNameNeeded: 'नए {what} का नाम लिखें',
  lookupHint: 'टावर, मंज़िल और ट्रेड से गतिविधि टावर × मंज़िल ग्रिड और लाइन ऑफ़ बैलेंस पर दिखती है।',
  setupTitle: 'टावर, मंज़िलें और ट्रेड', setupOpen: 'टावर, मंज़िलें और ट्रेड…', towersList: 'टावर', floorsList: 'मंज़िलें, नीचे से ऊपर',
  tradesList: 'ट्रेड, निर्माण क्रम में', moveUp: 'ऊपर ले जाएँ', moveDown: 'नीचे ले जाएँ', usedBy: '{n} गतिविधियाँ', inUseNoRemove: 'उपयोग में है, हटाया नहीं जा सकता',
  addFloorsRange: 'मंज़िलें जोड़ें', fromN: 'से', toN: 'तक', nameCol: 'नाम', shortCol: 'छोटा नाम', newEntry: 'नया', setupEmpty: 'अभी कोई नहीं',
};

const dicts: Record<Locale, Dict> = { en, hi };

export type TKey = keyof Dict;
export type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

export function translator(locale: Locale = 'en'): Translate {
  const d = dicts[locale] ?? en;
  return (key, vars) => {
    let s = d[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}

export const columnTitle = (t: Translate, key: ColumnKey) => t(`col_${key}` as TKey);
