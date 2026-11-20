import type { CompiledCalendar } from '@nm/calendar';
import type { ScheduleResult, Variance } from './types.js';

export interface CompareOptions {
  /** Calendar used to measure variance (the schedule's default calendar). */
  calendar: CompiledCalendar;
  /** Key of a baseline activity id; defaults to the `keyOf` used for the current version. */
  baselineKeyOf?: (id: string) => string;
}

/**
 * Variance per activity, matched by stable key. Positive = later (or longer) than baseline.
 * Sorted by key so the output never depends on input order.
 */
export function compare(
  current: ScheduleResult,
  baseline: ScheduleResult,
  keyOf: (id: string) => string,
  options: CompareOptions,
): Variance[] {
  const cal = options.calendar;
  const baseKeyOf = options.baselineKeyOf ?? keyOf;
  const base = new Map(Object.values(baseline.activities).map((r) => [baseKeyOf(r.id), r]));
  const cur = new Map(Object.values(current.activities).map((r) => [keyOf(r.id), r]));
  const out: Variance[] = [];
  for (const [key, c] of cur) {
    const b = base.get(key);
    if (!b) { out.push({ key, status: 'added' }); continue; }
    out.push({
      key,
      status: 'matched',
      startVariance: cal.workBetween(b.es, c.es),
      finishVariance: cal.workBetween(b.ef, c.ef),
      durationVariance: cal.workBetween(c.es, c.ef) - cal.workBetween(b.es, b.ef),
    });
  }
  for (const key of base.keys()) if (!cur.has(key)) out.push({ key, status: 'removed' });
  return out.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}
