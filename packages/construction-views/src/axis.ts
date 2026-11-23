/** Where to draw time-axis labels inside a plot `plotW` px wide. */
export interface AxisTick { key: string; x: number; label: string }
export interface AxisLabel { key: string; x: number; label: string }

/**
 * Places time-axis labels in the plot, dropping any that won't fit:
 * - `pin`: a unit that began before the plot (x < 0) keeps its label at the left edge, as the month
 *   tier does. Without `pin`, it is dropped, since "23 Nov" at the edge would name the wrong day.
 * - A label that would run into the next tick, or past the right edge, is dropped.
 *   Width is estimated as `charW` px per character, plus `pad`.
 */
export function axisLabels(ticks: AxisTick[], plotW: number, opts: { pin?: boolean; charW?: number; pad?: number } = {}): AxisLabel[] {
  const { pin = false, charW = 6.5, pad = 4 } = opts;
  const out: AxisLabel[] = [];
  ticks.forEach((tk, i) => {
    if (tk.x < 0 && !pin) return;
    const x = Math.max(0, tk.x);
    if (x >= plotW) return;
    const next = ticks[i + 1];
    const limit = next ? Math.min(next.x, plotW) : plotW;
    if (limit - x < pad + tk.label.length * charW) return;
    out.push({ key: tk.key, x: x + pad, label: tk.label });
  });
  return out;
}
