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
// neutral `Scorable` shape below, so income↔profit, collateral↔investment, etc.
// score identically.
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
  /** Route danger index 0–100. */
  danger: number | null;
}

export interface FactorDef {
  id: FactorId;
  label: string;
  direction: FactorDirection;
  /** Normalisation scale (default linear). */
  scale: FactorScale;
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
    description: 'Route danger (low/null-sec + recent kills). Lower is safer.',
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
    description: 'Minimise risk: avoid dangerous routes, with a modest pull toward decent income on short routes.',
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

// --- Scoring engine ----------------------------------------------------------

interface Stats {
  min: number;
  max: number;
  range: number;
}

function stats(values: number[]): Stats {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: NaN, max: NaN, range: 0 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return { min, max, range: max - min };
}

function unit(value: number, s: Stats, higherIsBetter: boolean): number {
  if (!Number.isFinite(value)) return 0;
  if (s.range === 0) return 1;
  const u = (value - s.min) / s.range;
  return higherIsBetter ? u : 1 - u;
}

function f2(n: number): string {
  return formatNumber(n, 2);
}

function transformFor(scale: FactorScale): (x: number) => number {
  return scale === 'log' ? (x) => Math.log1p(x) : (x) => x;
}

interface ActiveFactor {
  def: FactorDef;
  weight: number;
  /** Raw values (for display in the tooltip). */
  raw: number[];
  /** Values after the scale transform (used for normalisation). */
  scaled: number[];
  stats: Stats;
}

/** Result of scoring one row. */
export interface AttractivityScore {
  attractivity: number;
  attractivitySteps: string[];
}

/**
 * Score every row 0–100 against the shared factor weights. Generic over the row
 * type: the caller supplies a `toScorable` adapter, and gets each row back with
 * `attractivity` + `attractivitySteps` merged in. This is the only place the
 * scoring maths lives.
 */
export function score<Row>(
  rows: Row[],
  weights: AttractivityWeights,
  toScorable: (row: Row) => Scorable,
): Array<Row & AttractivityScore> {
  if (rows.length === 0) return [];

  const scorables = rows.map(toScorable);

  // Keep only weighted factors that actually have data in this result set.
  const active: ActiveFactor[] = [];
  for (const def of FACTORS) {
    const weight = weights[def.id] ?? 0;
    if (weight <= 0) continue;
    const raw = scorables.map((s) => {
      const v = def.value(s);
      return v === null ? NaN : v;
    });
    const transform = transformFor(def.scale);
    const scaled = raw.map((v) => (Number.isFinite(v) ? transform(v) : NaN));
    const s = stats(scaled);
    if (!Number.isFinite(s.min)) continue; // no usable data → skip entirely
    active.push({ def, weight, raw, scaled, stats: s });
  }

  const totalWeight = active.reduce((sum, a) => sum + a.weight, 0);

  if (totalWeight === 0) {
    const steps = ['No factors are weighted. Open “Attractivity weights” to configure scoring.'];
    return rows.map((row) => ({ ...row, attractivity: 0, attractivitySteps: steps }));
  }

  return rows.map((row, i) => {
    const contribs: number[] = [];
    const lines: string[] = [];
    for (const a of active) {
      const norm = unit(a.scaled[i], a.stats, a.def.direction === 'higher');
      const contrib = a.weight * norm;
      contribs.push(contrib);
      const raw = Number.isFinite(a.raw[i]) ? a.def.format(a.raw[i]) : '—';
      const arrow = a.def.direction === 'higher' ? '↑' : '↓';
      const scaleTag = a.def.scale === 'log' ? ' (log)' : '';
      lines.push(
        `• ${a.def.label} ${arrow}${scaleTag}: ${raw} → norm ${f2(norm)} × weight ${a.weight} = ${f2(contrib)}`,
      );
    }
    const contribSum = contribs.reduce((s, c) => s + c, 0);
    const attractivity = Math.round((contribSum / totalWeight) * 100);

    const steps = [
      'Each factor → normalised 0–1 across results (↑ higher-better, ↓ lower-better, log = log-scaled), then × its weight:',
      ...lines,
      `Sum of sub-scores = ${contribs.map(f2).join(' + ')} = ${f2(contribSum)}`,
      `Attractivity = ${f2(contribSum)} ÷ ${formatNumber(totalWeight, 0)} (total weight) × 100 = ${attractivity}`,
    ];

    return { ...row, attractivity, attractivitySteps: steps };
  });
}
