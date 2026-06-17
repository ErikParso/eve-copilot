// Arbitrage hauls plug into the same shared attractivity scorer as courier
// contracts: map an ArbitrageItem onto the neutral Scorable shape. Scoring runs
// over the COMBINED courier+arbitrage set so the 0–100 index is comparable
// across both kinds — see combined.ts `scoreCombined`.
import type { Scorable } from '@/features/attractivity/scoring';
import type { ArbitrageItem } from './types';

/** A haul's metrics in the shared scoring vocabulary. */
export function arbitrageToScorable(
  r: Pick<ArbitrageItem, 'profit' | 'totalJumps' | 'danger'>,
): Scorable {
  return {
    income: r.profit,
    totalJumps: r.totalJumps,
    danger: r.danger,
  };
}
