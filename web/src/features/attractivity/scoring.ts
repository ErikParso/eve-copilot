// Single source of truth for the attractivity index (0–100), shared by courier
// contracts and arbitrage hauls.
//
// A row is scored as a weighted average of normalised factors. Each factor is
// min-max normalised across the current result set (flipped for "lower is
// better"), multiplied by its weight (0–10, 0 disables it), then averaged by
// total weight and scaled to 0–100 — so the score is relative to the current
// results, a good "best in this list" sort key.
//
// Both card types share ONE weights object and ONE factor registry. The factors
// are exactly the ones common to both: each feature adapts its row to the
// neutral `Scorable` shape below, so income↔profit etc. score identically.
import { formatIsk, formatNumber } from '@/utils/format';

export type FactorDirection = 'higher' | 'lower';

/**
 * How a factor's values are normalised. `log` is for heavy-tailed quantities
 * (ISK, m³) that span orders of magnitude — it normalises over log1p(value) so
 * ratios matter and one outlier can't flatten the rest to ~0.
 */
export type FactorScale = 'linear' | 'log';

export type FactorId = 'income' | 'totalJumps' | 'danger';

/**
 * Neutral metrics a result exposes for scoring — only what courier contracts and
 * arbitrage hauls have in common. Each feature maps its own row onto this.
 */
export interface Scorable {
  /** Absolute ISK upside: courier reward / arbitrage profit. */
  income: number | null;
  /** Total jumps for the whole journey. */
  totalJumps: number | null;
  /** Route danger index 0–100 (chance of getting caught). */
  danger: number | null;
}

export interface FactorDef {
  id: FactorId;
  label: string;
  direction: FactorDirection;
  /** Normalisation scale (default linear). */
  scale: FactorScale;
  /**
   * When true, the factor is scored on its fixed 0–100 scale (danger) rather than
   * min-maxed across the batch — so a genuinely safe route always scores well.
   * (The scoring engine that honours this lives on the server; kept here for parity.)
   */
  absolute?: boolean;
  /** What it means / why it matters. */
  description: string;
  /** Raw value for a row, or null when not applicable. */
  value: (s: Scorable) => number | null;
  /** Format the raw value for the explanation tooltip. */
  format: (value: number) => string;
}

const jumps = (v: number) => `${formatNumber(v, 0)} jumps`;
const outOf100 = (v: number) => `${formatNumber(v, 0)}/100`;

export const FACTORS: FactorDef[] = [
  {
    id: 'income',
    label: 'Income',
    direction: 'higher',
    scale: 'log',
    description: 'Absolute ISK upside — contract reward, or net arbitrage profit. Higher pays more.',
    value: (s) => s.income,
    format: formatIsk,
  },
  {
    id: 'totalJumps',
    label: 'Jumps',
    direction: 'lower',
    scale: 'linear',
    description: 'Total jumps for the journey. Fewer is quicker.',
    value: (s) => s.totalJumps,
    format: jumps,
  },
  {
    id: 'danger',
    label: 'Danger',
    direction: 'lower',
    scale: 'linear',
    absolute: true,
    description: 'Chance of getting caught on the route (0–100%). Scored on its absolute value — a safe route always scores well. Lower is safer.',
    value: (s) => s.danger,
    format: outOf100,
  },
];

const FACTOR_BY_ID = new Map(FACTORS.map((f) => [f.id, f]));

export type AttractivityWeights = Record<FactorId, number>;

function makeWeights(partial: Partial<AttractivityWeights>): AttractivityWeights {
  const base = Object.fromEntries(FACTORS.map((f) => [f.id, 0])) as AttractivityWeights;
  return { ...base, ...partial };
}

export interface AttractivityPreset {
  id: string;
  label: string;
  description: string;
  weights: AttractivityWeights;
}

export const ATTRACTIVITY_PRESETS: AttractivityPreset[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'A sensible all-round mix of profit, effort and safety.',
    weights: makeWeights({ income: 5, totalJumps: 5, danger: 5 }),
  },
  {
    id: 'maxIskPerHour',
    label: 'Max ISK / hour',
    description: 'Chase the biggest payoff for the flying time — high income with as few jumps as possible.',
    weights: makeWeights({ income: 8, totalJumps: 8, danger: 2 }),
  },
  {
    id: 'safe',
    label: 'Safe & steady',
    description: 'Minimise risk: avoid dangerous routes, with a modest pull toward income.',
    weights: makeWeights({ danger: 10, income: 3, totalJumps: 3 }),
  },
  {
    id: 'maxIncome',
    label: 'Max income',
    description: 'Chase the biggest payouts, with mild caution on effort and danger.',
    weights: makeWeights({ income: 10, totalJumps: 3, danger: 3 }),
  },
];

export const DEFAULT_WEIGHTS: AttractivityWeights = ATTRACTIVITY_PRESETS[0].weights;

/** Human label for a factor id (used by the weights UI). */
export function factorLabel(id: FactorId): string {
  return FACTOR_BY_ID.get(id)?.label ?? id;
}

// The scoring engine itself now lives on the server (server/arbitrageScore.ts);
// this module keeps only the shared factor registry, presets, weights + types
// that the weights UI uses.
