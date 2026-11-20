/**
 * Time-zone offsets using the built-in Intl API only (spec: no time-zone library).
 *
 * All instants are integer minutes since 1970-01-01T00:00Z. A "local minute" is
 * the same count on the wall clock of the zone, i.e. local = utc + offset(utc).
 */
import type { Minutes } from './types.js';
import { CalendarError } from './errors.js';

const MIN_PER_DAY = 1440;

export interface Zone {
  readonly name: string;
  /** Offset (local − UTC) in minutes in force at the given instant. */
  offsetAt(utc: Minutes): Minutes;
  /** Instant for a local wall-clock minute. In a DST gap the result moves forward. */
  localToUtc(local: Minutes): Minutes;
  /** Local wall-clock minute for an instant. */
  utcToLocal(utc: Minutes): Minutes;
}

interface UtcDayOffsets {
  a: Minutes; // offset at the start of the UTC day
  b: Minutes; // offset at the end of the UTC day
  tr: Minutes; // first instant with offset b (only meaningful when a !== b)
}

const zones = new Map<string, Zone>();

export function zone(name: string): Zone {
  const cached = zones.get(name);
  if (cached) return cached;
  const z = name === 'UTC' || name === 'Etc/UTC' ? fixedZone(name, 0) : intlZone(name);
  zones.set(name, z);
  return z;
}

function fixedZone(name: string, offset: Minutes): Zone {
  return {
    name,
    offsetAt: () => offset,
    localToUtc: (local) => local - offset,
    utcToLocal: (utc) => utc + offset,
  };
}

function intlZone(name: string): Zone {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: name,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
  } catch {
    throw new CalendarError('INVALID_TIME_ZONE', `Unknown time zone "${name}"`);
  }

  const raw = (utc: Minutes): Minutes => {
    let y = 0, mo = 0, d = 0, h = 0, mi = 0;
    for (const p of fmt.formatToParts(new Date(utc * 60_000))) {
      switch (p.type) {
        case 'year': y = Number(p.value); break;
        case 'month': mo = Number(p.value); break;
        case 'day': d = Number(p.value); break;
        case 'hour': h = Number(p.value) % 24; break;
        case 'minute': mi = Number(p.value); break;
        default: break;
      }
    }
    return Date.UTC(y, mo - 1, d, h, mi) / 60_000 - utc;
  };

  // Offsets change at most once in a UTC day, so cache start/end offsets per UTC day
  // and binary-search the transition minute when they differ.
  const days = new Map<number, UtcDayOffsets>();
  const dayOffsets = (utcDay: number): UtcDayOffsets => {
    let rec = days.get(utcDay);
    if (rec) return rec;
    const start = utcDay * MIN_PER_DAY;
    const a = raw(start);
    const b = raw(start + MIN_PER_DAY - 1);
    let tr = start;
    if (a !== b) {
      let lo = start, hi = start + MIN_PER_DAY - 1; // raw(lo) = a, raw(hi) = b
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (raw(mid) === a) lo = mid; else hi = mid;
      }
      tr = hi;
    }
    rec = { a, b, tr };
    days.set(utcDay, rec);
    return rec;
  };

  const offsetAt = (utc: Minutes): Minutes => {
    const rec = dayOffsets(Math.floor(utc / MIN_PER_DAY));
    return rec.a === rec.b || utc < rec.tr ? rec.a : rec.b;
  };

  return {
    name,
    offsetAt,
    localToUtc: (local) => {
      const guess = local - offsetAt(local);
      return local - offsetAt(guess);
    },
    utcToLocal: (utc) => utc + offsetAt(utc),
  };
}
