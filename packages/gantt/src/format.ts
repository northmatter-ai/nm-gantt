import { formatLocal, instantToLocal, parseLocal, type Minutes } from '@northmatter-ai/calendar';
import { formatDuration } from '@northmatter-ai/schedule-commands';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "23 Nov 26" (+ " 18:00" with time) on the schedule's local clock. */
export function fmtDate(tz: string, t: Minutes | undefined, withTime = false): string {
  if (t === undefined) return '';
  const p = instantToLocal(tz, t);
  const d = `${pad(p.day)} ${MONTHS[p.month - 1]} ${String(p.year).slice(2)}`;
  return withTime ? `${d} ${pad(p.hour)}:${pad(p.minute)}` : d;
}

/** Value for <input type="datetime-local">. */
export const toInputValue = (tz: string, t: Minutes | undefined) => (t === undefined ? '' : formatLocal(tz, t));
export const fromInputValue = (tz: string, v: string): Minutes | undefined => (v ? parseLocal(tz, v) : undefined);

export function fmtFloat(minutes: Minutes, hoursPerDay: Minutes): string {
  return formatDuration(minutes, hoursPerDay);
}

export { formatDuration };
