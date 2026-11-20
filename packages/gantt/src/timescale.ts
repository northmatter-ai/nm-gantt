/**
 * The time scale: one function maps an instant to x, x = (t − viewStart) × pixelsPerMinute.
 * Header ticks are generated only for the visible range.
 */
import { dayStartInstant, dayToYmd, instantToDay, weekdayOfDay, ymdToDay, type Minutes } from '@northmatter-ai/calendar';
import type { Zoom } from './types.js';

/** Pixels per calendar day at each zoom level. */
export const PX_PER_DAY: Record<Zoom, number> = { day: 48, week: 18, month: 5, quarter: 1.6, year: 0.6 };
export const ZOOMS: Zoom[] = ['day', 'week', 'month', 'quarter', 'year'];

export interface Scale {
  viewStart: Minutes;
  viewEnd: Minutes;
  ppm: number;
  width: number;
  x(t: Minutes): number;
  t(x: number): Minutes;
}

export function makeScale(viewStart: Minutes, viewEnd: Minutes, zoom: Zoom): Scale {
  const ppm = PX_PER_DAY[zoom] / 1440;
  return {
    viewStart, viewEnd, ppm,
    width: Math.ceil((viewEnd - viewStart) * ppm),
    x: (t) => (t - viewStart) * ppm,
    t: (x) => Math.round(viewStart + x / ppm),
  };
}

export interface Tick { t: Minutes; x: number; w: number; label: string; key: string }

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_HI = ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुल', 'अग', 'सित', 'अक्टू', 'नव', 'दिस'];
const DOW_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year';

const TIERS: Record<Zoom, [Unit, Unit]> = {
  day: ['month', 'day'],
  week: ['month', 'week'],
  month: ['quarter', 'month'],
  quarter: ['year', 'quarter'],
  year: ['year', 'quarter'],
};

/** Start of the unit containing local day d. */
function unitStartDay(unit: Unit, d: number): number {
  if (unit === 'day') return d;
  if (unit === 'week') return d - ((weekdayOfDay(d) + 6) % 7); // Monday
  const { year, month } = dayToYmd(d);
  if (unit === 'month') return ymdToDay(year, month);
  if (unit === 'quarter') return ymdToDay(year, Math.floor((month - 1) / 3) * 3 + 1);
  return ymdToDay(year, 1);
}

function nextUnitDay(unit: Unit, d: number): number {
  if (unit === 'day') return d + 1;
  if (unit === 'week') return d + 7;
  const { year, month } = dayToYmd(d);
  if (unit === 'month') return month === 12 ? ymdToDay(year + 1, 1) : ymdToDay(year, month + 1);
  if (unit === 'quarter') return month >= 10 ? ymdToDay(year + 1, 1) : ymdToDay(year, month + 3);
  return ymdToDay(year + 1, 1);
}

function label(unit: Unit, d: number, wide: boolean, locale: string): string {
  const { year, month, day } = dayToYmd(d);
  const months = locale === 'hi' ? MONTHS_HI : MONTHS_EN;
  switch (unit) {
    case 'day': return wide ? `${DOW_EN[weekdayOfDay(d)]} ${day}` : String(day);
    case 'week': return `${day} ${months[month - 1]}`;
    case 'month': return wide ? `${months[month - 1]} ${year}` : months[month - 1]!;
    case 'quarter': return wide ? `Q${Math.floor((month - 1) / 3) + 1} ${year}` : `Q${Math.floor((month - 1) / 3) + 1}`;
    case 'year': return String(year);
  }
}

export function ticks(scale: Scale, zoom: Zoom, tz: string, from: Minutes, to: Minutes, locale = 'en'): { top: Tick[]; bottom: Tick[] } {
  const [topUnit, bottomUnit] = TIERS[zoom];
  const build = (unit: Unit, wide: boolean): Tick[] => {
    const out: Tick[] = [];
    let d = unitStartDay(unit, instantToDay(tz, Math.max(from, scale.viewStart)));
    const endDay = instantToDay(tz, Math.min(to, scale.viewEnd));
    for (let guard = 0; d <= endDay && guard < 5000; guard++) {
      const n = nextUnitDay(unit, d);
      const t = dayStartInstant(tz, d);
      const x = scale.x(t);
      out.push({ t, x, w: scale.x(dayStartInstant(tz, n)) - x, label: label(unit, d, wide, locale), key: `${unit}-${d}` });
      d = n;
    }
    return out;
  };
  return { top: build(topUnit, true), bottom: build(bottomUnit, zoom !== 'day') };
}

/** Snap an instant to the zoom's unit: days at day/week/month zoom, weeks beyond. */
export function snapDay(t: Minutes, zoom: Zoom, tz: string): Minutes {
  const unit: Unit = zoom === 'quarter' || zoom === 'year' ? 'week' : 'day';
  const d = instantToDay(tz, t);
  const start = unitStartDay(unit, d);
  const next = nextUnitDay(unit, start);
  const a = dayStartInstant(tz, start), b = dayStartInstant(tz, next);
  return t - a < b - t ? a : b;
}
