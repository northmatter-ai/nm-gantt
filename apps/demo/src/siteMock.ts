/**
 * Stand-in for what the Site app sends (DPR reports, certifications, readiness, commitments,
 * inspections, photos). Deterministic, derived from the schedule so the demo is stable.
 */
import type { SiteData } from '@northmatter-ai/construction-views';
import type { ScheduleDoc } from '@northmatter-ai/schedule-commands';
import type { ScheduleResult } from '@northmatter-ai/schedule-engine';

const DAY = 1440;

/** Stable pseudo-random number in [0, 1) from a string. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h / 2 ** 32;
}

const CONTRACTORS: Record<string, string> = {
  structure: 'Contractor A — Structure',
  masonry: 'Contractor B — Masonry & plaster',
  mep: 'Contractor C — MEP',
  finishes: 'Contractor D — Finishes',
  facade: 'Contractor E — Facade',
  lifts: 'Lift vendor',
  general: 'In-house team',
};

function contractorFor(templateOrCode: string): string {
  if (/COL|SLAB|EXC|PCC|RAFT/.test(templateOrCode)) return 'structure';
  if (/BLK|PLS/.test(templateOrCode)) return 'masonry';
  if (/MEP/.test(templateOrCode)) return 'mep';
  if (/FLR|FIN/.test(templateOrCode)) return 'finishes';
  if (/FAC/.test(templateOrCode)) return 'facade';
  if (/LIFT/.test(templateOrCode)) return 'lifts';
  if (/^TR(\d+)/.test(templateOrCode)) return ['structure', 'masonry', 'mep', 'finishes'][Number(templateOrCode.slice(2)) % 4]!;
  return 'general';
}

function photo(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},35%,78%)"/><stop offset="1" stop-color="hsl(${hue},25%,48%)"/></linearGradient></defs>
<rect width="320" height="240" fill="url(#g)"/><g fill="hsl(${hue},15%,30%)" opacity=".55">
<rect x="40" y="70" width="70" height="170"/><rect x="125" y="40" width="80" height="200"/><rect x="220" y="95" width="60" height="145"/></g>
<text x="12" y="226" font-family="system-ui,sans-serif" font-size="14" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function mockSite(doc: ScheduleDoc, results: ScheduleResult | undefined): SiteData {
  const site: Required<SiteData> = { reported: {}, certified: {}, readiness: {}, contractorOf: {}, contractors: CONTRACTORS, commitments: {}, inspections: {}, photos: {} };
  const dd = doc.dataDate;
  for (const a of doc.activities) {
    if (a.type !== 'task') continue;
    const k = a.stableKey;
    const h = hash01(k);
    site.contractorOf[k] = contractorFor(a.activityTemplateId ?? a.code);
    const r = results?.activities[a.id];
    if (a.actualFinish !== undefined) {
      site.certified[k] = { date: a.actualFinish + DAY, certId: `CERT-${k}` };
    } else if (a.actualStart !== undefined && (a.percentComplete ?? 0) >= 5000) {
      site.reported[k] = { date: dd - DAY, dprId: `DPR-${k}` };
    }
    if (a.actualStart !== undefined) {
      const hue = Math.round(h * 360);
      site.photos[k] = [
        { url: photo(`${a.code} · day 1`, hue), caption: 'Work started', date: a.actualStart },
        { url: photo(`${a.code} · latest`, (hue + 40) % 360), caption: a.actualFinish !== undefined ? 'Completed' : 'Progress', date: a.actualFinish ?? dd - DAY },
      ];
      if (/COL|SLAB/.test(a.activityTemplateId ?? '')) {
        site.inspections[k] = [
          { id: `${k}-rebar`, name: 'Rebar inspection', status: 'passed', date: a.actualStart + DAY },
          { id: `${k}-pour`, name: 'Pre-pour check', status: a.actualFinish !== undefined ? 'passed' : h < 0.3 ? 'failed' : 'pending', ...(a.actualFinish !== undefined ? { date: a.actualFinish - DAY } : {}) },
        ];
      }
    }
    // Readiness and commitments for work around the next few weeks.
    if (r && a.actualFinish === undefined && r.es < dd + 42 * DAY) {
      const cName = CONTRACTORS[site.contractorOf[k]!]!;
      const isStructure = /COL|SLAB/.test(a.activityTemplateId ?? '');
      site.readiness[k] = {
        drawings: hash01(`${k}d`) < 0.88 ? { status: 'ready' } : { status: 'not_ready', owner: 'Design consultant', note: 'GFC revision pending' },
        material: hash01(`${k}m`) < 0.78 ? { status: 'ready' } : { status: 'not_ready', owner: 'Stores', note: 'PO raised, delivery awaited' },
        labour: hash01(`${k}l`) < 0.82 ? { status: 'ready' } : { status: 'not_ready', owner: cName },
        inspection: isStructure ? (hash01(`${k}i`) < 0.7 ? { status: 'ready' } : { status: 'not_ready', owner: 'QA/QC' }) : { status: 'na' },
      };
      if (r.es < dd + 7 * DAY) {
        const done: boolean | undefined = r.es < dd ? hash01(`${k}c`) < 0.72 : undefined;
        site.commitments[k] = { committed: `${doc.floors?.[a.floorId ?? ''] ?? ''} ${a.name}`.trim(), ...(done !== undefined ? { done } : {}) };
      }
    }
  }
  return site;
}

