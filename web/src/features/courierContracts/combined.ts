// The hauling page shows two kinds of opportunity as cards in one grid: courier
// contracts and arbitrage hauls. This unifies them behind a single discriminated
// union and provides a sort that works across both, reusing the courier sort
// options (the only filters on the page).
import { score, type AttractivityWeights } from '@/features/attractivity/scoring';
import { courierToScorable } from './attractivity';
import { arbitrageToScorable } from '@/features/arbitrage/attractivity';
import type { CourierRow, SortOptionId } from './types';
import { SORT_OPTIONS } from './sortContracts';
import type { ArbitrageRow, ScaledArbitrage } from '@/features/arbitrage/types';
import type { PinnedHaul, PinnedCourier } from '@/features/arbitrage/atoms';

export type ResultCard =
  | { kind: 'courier'; key: string; row: CourierRow }
  | { kind: 'arbitrage'; key: string; row: ArbitrageRow }
  | { kind: 'pinned-arbitrage'; key: string; row: PinnedHaul & { attractivity: number; attractivitySteps: string[] } }
  | { kind: 'pinned-courier'; key: string; row: PinnedCourier & { attractivity: number; attractivitySteps: string[] } };

/** A hydrated row before attractivity is added (the scorer fills those in). */
type CourierBase = Omit<CourierRow, 'attractivity' | 'attractivitySteps'>;

/**
 * Score courier contracts and arbitrage hauls TOGETHER in one pass, so the
 * 0–100 attractivity index is normalised across the whole mixed list (a courier
 * 90 and an arbitrage 90 are then genuinely comparable). Both kinds map onto the
 * shared Scorable shape via their own adapter; the single engine does the rest.
 */
export function scoreCombined(
  courier: CourierBase[],
  arbitrage: ScaledArbitrage[],
  pinnedArb: PinnedHaul[],
  pinnedCourier: PinnedCourier[],
  weights: AttractivityWeights,
): ResultCard[] {
  const inputs = [
    ...courier.map((row) => ({ kind: 'courier' as const, row })),
    ...arbitrage.map((row) => ({ kind: 'arbitrage' as const, row })),
    ...pinnedArb.map((row) => ({ kind: 'pinned-arbitrage' as const, row })),
    ...pinnedCourier.map((row) => ({ kind: 'pinned-courier' as const, row })),
  ];

  const scored = score(inputs, weights, (e) =>
    e.kind === 'courier' || e.kind === 'pinned-courier'
      ? courierToScorable(e.row)
      : arbitrageToScorable(e.row),
  );

  return scored.map((e) => {
    const { attractivity, attractivitySteps } = e;
    if (e.kind === 'courier') {
      return { kind: 'courier', key: `c:${e.row.id}`, row: { ...e.row, attractivity, attractivitySteps } };
    } else if (e.kind === 'pinned-courier') {
      return { kind: 'pinned-courier', key: `pc:${e.row.id}`, row: { ...e.row, attractivity, attractivitySteps } };
    } else if (e.kind === 'pinned-arbitrage') {
      return { kind: 'pinned-arbitrage', key: `p:${e.row.id}`, row: { ...e.row, attractivity, attractivitySteps } };
    } else {
      return { kind: 'arbitrage', key: `a:${e.row.id}`, row: { ...e.row, attractivity, attractivitySteps } };
    }
  });
}

/** Sort value for a card under a given option (null sorts last). */
function sortValue(card: ResultCard, sortBy: SortOptionId): number | null {
  if (card.kind === 'courier' || card.kind === 'pinned-courier') {
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
      return r.totalJumps;
    case 'jumpsToPickup':
      return r.jumpsFromCurrent; // jumps from current system to the buy station
    // No equivalent on an arbitrage haul (no expiry / listing age) → last.
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
    const aPinned = a.kind === 'pinned-arbitrage' || a.kind === 'pinned-courier';
    const bPinned = b.kind === 'pinned-arbitrage' || b.kind === 'pinned-courier';
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

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
