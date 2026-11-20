/** Orthogonal link routing from the correct bar end to the correct bar end for the link type. */
import type { LinkType } from '@northmatter-ai/schedule-engine';

const STUB = 8;

/**
 * x1/y1: the predecessor end (start for SS/SF, finish for FS/FF);
 * x2/y2: the successor end (start for FS/SS, finish for FF/SF).
 * Returns an SVG path.
 */
export function routeLink(type: LinkType, x1: number, y1: number, x2: number, y2: number, rowHeight: number): string {
  const outDir = type === 'FS' || type === 'FF' ? 1 : -1; // leave the finish to the right, the start to the left
  const inDir = type === 'FS' || type === 'SS' ? -1 : 1; // enter the start from the left, the finish from the right
  const p1x = x1 + outDir * STUB;
  const p3x = x2 + inDir * STUB;
  const pts: [number, number][] = [[x1, y1]];
  if (y1 === y2) {
    pts.push([x2, y2]);
  } else if (outDir === 1 && inDir === -1 && p1x <= x2 - 2) {
    pts.push([p1x, y1], [p1x, y2], [x2, y2]);
  } else if (outDir === inDir * -1 && outDir === -1 && p1x >= x2 + 2) {
    // SF going right-to-left with room
    pts.push([p1x, y1], [p1x, y2], [x2, y2]);
  } else if (outDir === inDir) {
    const xm = outDir === 1 ? Math.max(p1x, p3x) : Math.min(p1x, p3x);
    pts.push([xm, y1], [xm, y2], [x2, y2]);
  } else {
    const ymid = y2 + (y2 > y1 ? -rowHeight / 2 : rowHeight / 2);
    pts.push([p1x, y1], [p1x, ymid], [p3x, ymid], [p3x, y2], [x2, y2]);
  }
  return `M${pts.map(([x, y]) => `${round(x)},${round(y)}`).join(' L')}`;
}

const round = (n: number) => Math.round(n * 10) / 10;
