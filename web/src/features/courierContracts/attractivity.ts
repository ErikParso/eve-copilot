// Courier contracts plug into the shared attractivity scorer by mapping a
// CourierRow onto the neutral Scorable shape; the engine, factor registry,
// presets and weights all live in the shared module (re-exported here so the
// existing weights UI / atoms imports keep working). Scoring itself runs over
// the COMBINED courier+arbitrage set — see combined.ts `scoreCombined`.
import type { Scorable } from '@/features/attractivity/scoring';
import type { CourierRow } from './types';

export {
  FACTORS,
  ATTRACTIVITY_PRESETS,
  DEFAULT_WEIGHTS,
  factorLabel,
} from '@/features/attractivity/scoring';
export type { AttractivityWeights, FactorId, FactorDef } from '@/features/attractivity/scoring';

/** A contract's metrics in the shared scoring vocabulary. */
export function courierToScorable(
  r: Pick<CourierRow, 'reward' | 'totalJumps' | 'danger' | 'volume' | 'collateral'>,
): Scorable {
  return {
    income: r.reward,
    totalJumps: r.totalJumps,
    danger: r.danger,
    cargo: r.volume,
    investment: r.collateral,
  };
}
