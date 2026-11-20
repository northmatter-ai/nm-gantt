/**
 * Text forms used in grid cells and the Excel template:
 *   durations   "5d", "3w", "16h", "90m", "2.5d" (a bare number = days)
 *   predecessors "12FS+2d; 15SS; KAV-T1-F05-SLAB FF-1d" (MS Project style, by code or row number)
 */
import type { Minutes } from '@nm/calendar';
import type { LinkType } from '@nm/schedule-engine';

const UNIT: Record<string, number> = { m: 1, min: 1, h: 60, hr: 60, d: 0, day: 0, days: 0, w: -1, wk: -1, mo: -2 };

/** Parse a duration into working minutes. `hoursPerDay` is in minutes (480 = 8 h). */
export function parseDuration(text: string, hoursPerDay: Minutes = 480): Minutes | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const u = (m[2] || 'd').toLowerCase();
  if (!(u in UNIT)) return null;
  const f = UNIT[u]!;
  const perUnit = f > 0 ? f : f === 0 ? hoursPerDay : f === -1 ? hoursPerDay * 5 : hoursPerDay * 20;
  return Math.round(n * perUnit);
}

/** Working minutes as days (or hours below one day), e.g. "5d", "2.5d", "4h". */
export function formatDuration(minutes: Minutes, hoursPerDay: Minutes = 480): string {
  if (minutes === 0) return '0d';
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  if (abs < hoursPerDay && abs % 60 === 0) return `${sign}${abs / 60}h`;
  if (abs < 60) return `${sign}${abs}m`;
  const d = abs / hoursPerDay;
  return `${sign}${Number.isInteger(d) ? d : d.toFixed(2).replace(/0$/, '')}d`;
}

export interface PredecessorRef {
  ref: string;
  type: LinkType;
  lag: Minutes;
}

/** Parse "12FS+2d; 15SS" → refs (by code or row number). Returns an error message on bad input. */
export function parsePredecessors(text: string, hoursPerDay: Minutes = 480): PredecessorRef[] | { error: string } {
  const out: PredecessorRef[] = [];
  for (const raw of text.split(/[;,]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(.+?)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?\s*[a-z]*))?$/i.exec(part);
    if (!m) return { error: `Cannot read "${part}"` };
    let ref = m[1]!.trim();
    let type = (m[2]?.toUpperCase() as LinkType | undefined) ?? 'FS';
    // "KAV-T1-SLABFS" without a space: the regex is lazy, so it already split; codes ending in FS etc. need a space.
    if (!m[2]) {
      const tail = /^(.*?)(FS|SS|FF|SF)$/i.exec(ref);
      if (tail && tail[1]) { ref = tail[1]; type = tail[2]!.toUpperCase() as LinkType; }
    }
    let lag = 0;
    if (m[3] && m[4]) {
      const v = parseDuration(m[4], hoursPerDay);
      if (v === null) return { error: `Cannot read lag "${m[4]}"` };
      lag = m[3] === '-' ? -v : v;
    }
    out.push({ ref, type, lag });
  }
  return out;
}

export function formatPredecessor(ref: string, type: LinkType, lag: Minutes, hoursPerDay: Minutes = 480): string {
  const lagText = lag === 0 ? '' : `${lag > 0 ? '+' : '-'}${formatDuration(Math.abs(lag), hoursPerDay)}`;
  return `${ref}${type === 'FS' && !lagText ? '' : type}${lagText}`;
}
