// Result ordering for the arbitrage cards. One dropdown picks one option; each
// bakes in its natural direction. Applied on Search, not live.
import type { ArbitrageRow, ArbitrageSortId } from './types';

interface SortOption {
  id: ArbitrageSortId;
  label: string;
  get: (row: ArbitrageRow) => number | null;
  direction: 'asc' | 'desc';
}

export const ARBITRAGE_SORT_OPTIONS: SortOption[] = [
  { id: 'attractivity', label: 'Attractivity (best first)', get: (r) => r.attractivity, direction: 'desc' },
  { id: 'profit', label: 'Profit (highest first)', get: (r) => r.profit, direction: 'desc' },
  { id: 'margin', label: 'Margin (highest first)', get: (r) => r.marginPct, direction: 'desc' },
  { id: 'profitPerJump', label: 'Profit / jump (highest first)', get: (r) => r.profitPerJump, direction: 'desc' },
  { id: 'jumps', label: 'Jumps (fewest first)', get: (r) => r.jumps, direction: 'asc' },
  { id: 'danger', label: 'Danger (safest first)', get: (r) => r.danger, direction: 'asc' },
  { id: 'investment', label: 'Investment (lowest first)', get: (r) => r.buyCost, direction: 'asc' },
];

const OPTION_BY_ID = new Map(ARBITRAGE_SORT_OPTIONS.map((o) => [o.id, o]));

/** Returns a new, sorted array. Null values always sort last. */
export function sortArbitrageRows(rows: ArbitrageRow[], sortBy: ArbitrageSortId): ArbitrageRow[] {
  const option = OPTION_BY_ID.get(sortBy) ?? ARBITRAGE_SORT_OPTIONS[0];
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
