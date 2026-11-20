/**
 * Local-date helpers. Day numbers count days since 1970-01-01 (a Thursday) on a
 * calendar's local wall clock. This package is the only place that does Date arithmetic.
 */
import type { Minutes, Weekday } from './types.js';
import { CalendarError } from './errors.js';
import { zone } from './zone.js';

export const MIN_PER_DAY = 1440;
const MS_PER_DAY = 86_400_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export function isoToDay(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new CalendarError('INVALID_DATE', `Not an ISO date: "${iso}"`);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new CalendarError('INVALID_DATE', `Not a real date: "${iso}"`);
  }
  return ms / MS_PER_DAY;
}

export function dayToIso(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function weekdayOfDay(day: number): Weekday {
  return ((((day % 7) + 7) + 4) % 7) as Weekday;
}

export interface Ymd { year: number; month: number; day: number }

export function dayToYmd(day: number): Ymd {
  const d = new Date(day * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function ymdToDay(year: number, month: number, day = 1): number {
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/** Local day number containing instant t in zone tz. */
export function instantToDay(tz: string, t: Minutes): number {
  return Math.floor(zone(tz).utcToLocal(t) / MIN_PER_DAY);
}

/** Instant at which a local day starts in zone tz. */
export function dayStartInstant(tz: string, day: number): Minutes {
  return zone(tz).localToUtc(day * MIN_PER_DAY);
}

export interface LocalParts extends Ymd {
  hour: number;
  minute: number;
  weekday: Weekday;
  dayNumber: number;
  minuteOfDay: number;
}

export function instantToLocal(tz: string, t: Minutes): LocalParts {
  const local = zone(tz).utcToLocal(t);
  const dayNumber = Math.floor(local / MIN_PER_DAY);
  const minuteOfDay = local - dayNumber * MIN_PER_DAY;
  return {
    ...dayToYmd(dayNumber),
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    weekday: weekdayOfDay(dayNumber),
    dayNumber,
    minuteOfDay,
  };
}

/** Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss]" as local wall-clock time in tz. */
export function parseLocal(tz: string, text: string): Minutes {
  const m = ISO_LOCAL.exec(text.trim());
  if (!m) throw new CalendarError('INVALID_DATE', `Not a local date-time: "${text}"`);
  const day = isoToDay(`${m[1]}-${m[2]}-${m[3]}`);
  const minuteOfDay = m[4] ? Number(m[4]) * 60 + Number(m[5]) : 0;
  return zone(tz).localToUtc(day * MIN_PER_DAY + minuteOfDay);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DDTHH:mm" on the local wall clock of tz. */
export function formatLocal(tz: string, t: Minutes): string {
  const p = instantToLocal(tz, t);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Instant for a JS Date (rounded down to the minute). For UI "today" lines. */
export function instantFromEpochMs(ms: number): Minutes {
  return Math.floor(ms / 60_000);
}
