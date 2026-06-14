// Result ordering for the contract cards. A single dropdown picks one option;
// each option bakes in its natural direction (e.g. income high→low, danger
// safe→risky). Applied on Search, not live.
import type { CourierRow, SortOptionId } from './types';

interface SortOption {
  id: SortOptionId;
  label: string;
  get: (row: CourierRow) => number | null;
  direction: 'asc' | 'desc';
}

export const SORT_OPTIONS: SortOption[] = [
  { id: 'attractivity', label: 'Attractivity (best first)', get: (r) => r.attractivity, direction: 'desc' },
  { id: 'danger', label: 'Danger (safest first)', get: (r) => r.danger, direction: 'asc' },
  { id: 'income', label: 'Income (highest first)', get: (r) => r.reward, direction: 'desc' },
  { id: 'collateral', label: 'Collateral (lowest first)', get: (r) => r.collateral, direction: 'asc' },
  { id: 'cargo', label: 'Cargo (smallest first)', get: (r) => r.volume, direction: 'asc' },
  { id: 'totalJumps', label: 'Total jumps (fewest first)', get: (r) => r.totalJumps, direction: 'asc' },
  { id: 'jumpsToPickup', label: 'Jumps to pickup (closest first)', get: (r) => r.jumpsFromCurrent, direction: 'asc' },
  { id: 'timeRemaining', label: 'Time remaining (most first)', get: (r) => r.remainingSeconds, direction: 'desc' },
  { id: 'listedAge', label: 'Listed age (oldest first)', get: (r) => r.ageSeconds, direction: 'desc' },
];

const OPTION_BY_ID = new Map(SORT_OPTIONS.map((o) => [o.id, o]));

/** Returns a new, sorted array. Null values always sort last. */
export function sortRows(rows: CourierRow[], sortBy: SortOptionId): CourierRow[] {
  const option = OPTION_BY_ID.get(sortBy) ?? SORT_OPTIONS[0];
  const factor = option.direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const va = option.get(a);
    const vb = option.get(b);
    const aNull = va === null || va === undefined;
    const bNull = vb === null || vb === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    return factor * (va - vb);
  });
}
