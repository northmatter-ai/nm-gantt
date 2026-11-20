import type { CellState } from './model.js';

/** Every state carries an icon as well as a colour, so it is never colour alone. */
export function StateIcon({ state }: { state: CellState }) {
  switch (state) {
    case 'certified': return <span aria-hidden="true">✓</span>;
    case 'reported': return <span aria-hidden="true">R</span>;
    case 'late': return <span aria-hidden="true">!</span>;
    case 'in_progress': return <span aria-hidden="true">▸</span>;
    default: return null;
  }
}
