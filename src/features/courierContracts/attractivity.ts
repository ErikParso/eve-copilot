// Attractivity index (0–100) for courier contracts.
//
// Both methods are *relative* to the current result set: each underlying
// metric is min-max normalised across the returned contracts, then combined.
// This makes the index a good sort key for "best in the current list", which
// is how it is intended to be used.
import type { CourierRow } from './types';

export type AttractivityMethod = 'profitPerJump' | 'riskAdjusted';

export interface AttractivityMethodInfo {
  id: AttractivityMethod;
  label: string;
  description: string;
}

export const ATTRACTIVITY_METHODS: AttractivityMethodInfo[] = [
  {
    id: 'profitPerJump',
    label: 'Profit per jump',
    description:
      'Ranks purely by reward earned per jump (approach + delivery jumps summed). ' +
      'The contract with the best ISK/jump in the current results scores 100. ' +
      'Best when your only concern is maximising income for the flying time. ' +
      'Contracts with no computable route score 0.',
  },
  {
    id: 'riskAdjusted',
    label: 'Risk-adjusted value',
    description:
      'Blends three factors: ISK per jump (50%), low collateral relative to ' +
      'reward (30%) and ISK per m³ of cargo (20%). Rewards efficient, ' +
      'low-risk, high-value-density hauls — favouring contracts that pay well ' +
      'without forcing you to risk a large collateral on a big load.',
  },
];

export const DEFAULT_ATTRACTIVITY_METHOD: AttractivityMethod = 'profitPerJump';

/** Min-max normalise to [0,1]; equal values map to 1; non-finite map to 0. */
function normalize(values: number[], higherIsBetter: boolean): number[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return values.map(() => 0);

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min;

  return values.map((v) => {
    if (!Number.isFinite(v)) return 0;
    if (range === 0) return 1;
    const unit = (v - min) / range;
    return higherIsBetter ? unit : 1 - unit;
  });
}

function nullToNaN(v: number | null): number {
  return v === null ? NaN : v;
}

/** Returns a new array of rows with `attractivity` filled in. */
export function computeAttractivity(rows: CourierRow[], method: AttractivityMethod): CourierRow[] {
  if (rows.length === 0) return rows;

  const incomePerJump = rows.map((r) => nullToNaN(r.incomePerJump));

  if (method === 'profitPerJump') {
    const scores = normalize(incomePerJump, true);
    return rows.map((r, i) => ({ ...r, attractivity: Math.round(scores[i] * 100) }));
  }

  // riskAdjusted
  const collateralRatio = rows.map((r) => (r.reward > 0 ? r.collateral / r.reward : Infinity));
  const iskPerM3 = rows.map((r) => (r.volume > 0 ? r.reward / r.volume : NaN));

  const effScore = normalize(incomePerJump, true);
  const safetyScore = normalize(collateralRatio, false); // lower collateral ratio = safer
  const densityScore = normalize(iskPerM3, true);

  return rows.map((r, i) => {
    const blended = 0.5 * effScore[i] + 0.3 * safetyScore[i] + 0.2 * densityScore[i];
    return { ...r, attractivity: Math.round(blended * 100) };
  });
}
