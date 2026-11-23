import { describe, expect, it } from 'vitest';
import { axisLabels } from '../src/axis.js';

const tk = (key: string, x: number, label: string) => ({ key, x, label });

describe('axisLabels', () => {
  it('drops a pinned month label that would run into the next month (was "Nov 2026Dec 2026")', () => {
    // November began before the plot; December starts 20 px in.
    const out = axisLabels([tk('nov', -300, 'Nov 2026'), tk('dec', 20, 'Dec 2026'), tk('jan', 400, 'Jan 2027')], 1000, { pin: true, charW: 7 });
    expect(out.map((l) => l.label)).toEqual(['Dec 2026', 'Jan 2027']);
  });

  it('keeps a pinned month label at the left edge when there is room', () => {
    const out = axisLabels([tk('nov', -300, 'Nov 2026'), tk('dec', 200, 'Dec 2026')], 1000, { pin: true, charW: 7 });
    expect(out[0]).toEqual({ key: 'nov', x: 4, label: 'Nov 2026' });
  });

  it('never draws an unpinned tick that began before the plot (was "23 Nov" over the Floor column)', () => {
    const out = axisLabels([tk('w1', -40, '23 Nov'), tk('w2', 64, '30 Nov'), tk('w3', 168, '7 Dec')], 1000);
    expect(out.map((l) => l.label)).toEqual(['30 Nov', '7 Dec']);
  });

  it('drops labels that do not fit before the next tick or the right edge', () => {
    const out = axisLabels([tk('a', 0, '1 Jan'), tk('b', 20, '2 Jan'), tk('c', 980, '3 Jan')], 1000);
    expect(out.map((l) => l.label)).toEqual(['2 Jan']);
  });

  it('labels never overlap each other', () => {
    const ticks = Array.from({ length: 60 }, (_, i) => tk(`t${i}`, i * 17 - 50, `${i + 1} Dec`));
    const out = axisLabels(ticks, 900);
    for (let i = 1; i < out.length; i++) expect(out[i].x - out[i - 1].x).toBeGreaterThanOrEqual(4 + out[i - 1].label.length * 6.5);
    expect(out.every((l) => l.x >= 0 && l.x < 900)).toBe(true);
  });
});
