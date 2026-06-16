// The hauling page shows two kinds of opportunity as cards in one grid: courier
// contracts and arbitrage hauls. This unifies them behind a single discriminated
// union and provides a sort that works across both, reusing the courier sort
// options (the only filters on the page).
import type { CourierRow, SortOptionId } from './types';
import { SORT_OPTIONS } from './sortContracts';
import type { ArbitrageRow } from '@/features/arbitrage/types';

export type ResultCard =
  | { kind: 'courier'; key: string; row: CourierRow }
  | { kind: 'arbitrage'; key: string; row: ArbitrageRow };

/** Sort value for a card under a given option (null sorts last). */
function sortValue(card: ResultCard, sortBy: SortOptionId): number | null {
  if (card.kind === 'courier') {
    const opt = SORT_OPTIONS.find((o) => o.id === sortBy);
    return opt ? opt.get(card.row) : card.row.attractivity;
  }
  // Map the courier sort options onto arbitrage fields where they make sense.
  const r = card.row;
  switch (sortBy) {
    case 'attractivity':
      return r.attractivity;
    case 'danger':
      return r.danger;
    case 'income':
      return r.profit; // a haul's "income" is its profit
    case 'collateral':
      return r.buyCost; // capital tied up
    case 'cargo':
      return r.totalVolume;
    case 'totalJumps':
      return r.jumps;
    // No equivalent on an arbitrage haul (no approach leg / no expiry) → last.
    case 'jumpsToPickup':
    case 'timeRemaining':
    case 'listedAge':
      return null;
    default:
      return r.attractivity;
  }
}

const DIRECTION = new Map(SORT_OPTIONS.map((o) => [o.id, o.direction]));

/** Returns a new, sorted array. Null values always sort last. */
export function sortCombined(cards: ResultCard[], sortBy: SortOptionId): ResultCard[] {
  const factor = (DIRECTION.get(sortBy) ?? 'desc') === 'asc' ? 1 : -1;
  return [...cards].sort((a, b) => {
    const va = sortValue(a, sortBy);
    const vb = sortValue(b, sortBy);
    const aNull = va === null || va === undefined;
    const bNull = vb === null || vb === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    return factor * (va - vb);
  });
}
