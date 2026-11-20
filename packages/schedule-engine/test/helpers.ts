import { defaultTenantCalendar, formatLocal, parseLocal, type CalendarInput } from '@northmatter-ai/calendar';
import type { ActivityInput, LinkInput, LinkType, ScheduleInput } from '../src/index.js';

export const TZ = 'Asia/Kolkata';
export const at = (s: string) => parseLocal(TZ, s);
export const fmt = (t: number | undefined) => (t === undefined ? 'undefined' : formatLocal(TZ, t));
export const H = 60;
export const DAY = 480;

export const STD: CalendarInput = defaultTenantCalendar('std');

export function task(id: string, days: number, extra: Partial<ActivityInput> = {}): ActivityInput {
  return { id, code: id, type: 'task', duration: Math.round(days * DAY), constraint: 'ASAP', ...extra };
}

export function ms(id: string, kind: 'start' | 'finish' = 'finish', extra: Partial<ActivityInput> = {}): ActivityInput {
  return { id, code: id, type: kind === 'start' ? 'start_milestone' : 'finish_milestone', duration: 0, constraint: 'ASAP', ...extra };
}

let linkSeq = 0;
export function link(from: string, to: string, type: LinkType = 'FS', lag = 0, extra: Partial<LinkInput> = {}): LinkInput {
  return { id: extra.id ?? `L${String(++linkSeq).padStart(4, '0')}-${from}-${to}`, from, to, type, lag, ...extra };
}

/** Monday 23 Nov 2026 09:00, data date at project start unless given. */
export function schedule(activities: ActivityInput[], links: LinkInput[], extra: Partial<ScheduleInput> = {}): ScheduleInput {
  const projectStart = at('2026-11-23T09:00');
  return {
    projectStart,
    dataDate: projectStart,
    defaultCalendarId: 'std',
    calendars: [STD],
    activities,
    links,
    ...extra,
  };
}
