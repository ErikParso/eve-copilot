// Advanced, user-weighted attractivity index (0–100).
//
// Every contract is scored as a weighted average of normalised factors the
// user chooses. Each factor is min-max normalised across the current result
// set (and flipped for "lower is better" factors), multiplied by its weight
// (0–10, where 0 disables it), then averaged by total weight and scaled to
// 0–100. The score is therefore relative to the current results — a good sort
// key for "best in this list".
import { formatDuration, formatIsk, formatNumber, formatVolume } from '@/utils/format';
import type { CourierRow } from './types';

export type FactorDirection = 'higher' | 'lower';

/**
 * How a factor's values are normalised. `log` is for heavy-tailed quantities
 * (ISK, m³) that span orders of magnitude — it normalises over log1p(value) so
 * ratios matter and one outlier can't flatten the rest to ~0.
 */
export type FactorScale = 'linear' | 'log';

export type FactorId =
  | 'totalIncome'
  | 'danger'
  | 'totalJumps'
  | 'jumpsToPickup'
  | 'collateral'
  | 'cargo'
  | 'timeActive'
  | 'timeRemaining'
  | 'daysToComplete';

export interface FactorDef {
  id: FactorId;
  label: string;
  direction: FactorDirection;
  /** Normalisation scale (default linear). */
  scale: FactorScale;
  /** What it means / why it matters. */
  description: string;
  /** Raw value for a row, or null when not applicable. */
  value: (row: CourierRow) => number | null;
  /** Format the raw value for the explanation tooltip. */
  format: (value: number) => string;
}

const days = (n: number) => `${formatNumber(n, 0)} day${n === 1 ? '' : 's'}`;

export const FACTORS: FactorDef[] = [
  {
    id: 'totalIncome',
    label: 'Total income',
    direction: 'higher',
    scale: 'log',
    description: 'The contract reward. Higher pays more in absolute ISK.',
    value: (r) => r.reward,
    format: formatIsk,
  },
  {
    id: 'danger',
    label: 'Danger index',
    direction: 'lower',
    scale: 'linear',
    description: 'Route danger (low/null-sec + recent kills). Lower is safer.',
    value: (r) => r.danger,
    format: (v) => `${formatNumber(v, 0)}/100`,
  },
  {
    id: 'totalJumps',
    label: 'Total jumps',
    direction: 'lower',
    scale: 'linear',
    description: 'Total jumps for the journey. Fewer is quicker.',
    value: (r) => r.totalJumps,
    format: (v) => `${formatNumber(v, 0)} jumps`,
  },
  {
    id: 'jumpsToPickup',
    label: 'Jumps to pickup',
    direction: 'lower',
    scale: 'linear',
    description:
      'Jumps from your current system to the pickup. Closer pickups are less ' +
      'likely to be taken by others before you arrive. (Needs a current system.)',
    value: (r) => r.jumpsFromCurrent,
    format: (v) => `${formatNumber(v, 0)} jumps`,
  },
  {
    id: 'collateral',
    label: 'Collateral',
    direction: 'lower',
    scale: 'log',
    description: 'ISK you must put up. Lower means less at risk if it goes wrong.',
    value: (r) => r.collateral,
    format: formatIsk,
  },
  {
    id: 'cargo',
    label: 'Cargo volume',
    direction: 'lower',
    scale: 'log',
    description: 'Cargo size in m³. Lower fits more ships and is easier to move.',
    value: (r) => r.volume,
    format: formatVolume,
  },
  {
    id: 'timeActive',
    label: 'Listed age',
    direction: 'higher',
    scale: 'linear',
    description:
      'How long ago the contract was posted. Older contracts are less likely ' +
      'to be snapped up by others while you travel to pick them up.',
    value: (r) => r.ageSeconds,
    format: formatDuration,
  },
  {
    id: 'timeRemaining',
    label: 'Time remaining',
    direction: 'higher',
    scale: 'linear',
    description:
      'Time until the contract expires. More buffer means it is less likely to ' +
      'disappear before you can accept and deliver it.',
    value: (r) => r.remainingSeconds,
    format: formatDuration,
  },
  {
    id: 'daysToComplete',
    label: 'Days to complete',
    direction: 'higher',
    scale: 'linear',
    description:
      'Time allowed to deliver after accepting. More is safer for long hauls.',
    value: (r) => r.daysToComplete,
    format: days,
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
    weights: makeWeights({ totalIncome: 5, danger: 5, totalJumps: 5 }),
  },
  {
    id: 'maxIskPerHour',
    label: 'Max ISK / hour',
    description:
      'Chase profit for the flying time — high income with as few jumps as possible.',
    weights: makeWeights({ totalIncome: 8, totalJumps: 8, danger: 2 }),
  },
  {
    id: 'safe',
    label: 'Safe & steady',
    description:
      'Minimise risk: avoid dangerous routes and large collateral, with a modest pull toward decent income on short routes.',
    weights: makeWeights({ danger: 10, collateral: 8, totalIncome: 3, totalJumps: 3, timeRemaining: 3 }),
  },
  {
    id: 'grabNearby',
    label: 'Grab nearby first',
    description:
      'Prioritise contracts whose pickup is close and that have been listed a while — least likely to be taken before you arrive. Set your current system for this.',
    weights: makeWeights({ jumpsToPickup: 10, timeActive: 6, totalIncome: 4, totalJumps: 4 }),
  },
  {
    id: 'bigBulk',
    label: 'Big bulk runs',
    description: 'Go for the largest payouts (favouring smaller cargo for value density), with mild caution on collateral and danger.',
    weights: makeWeights({ totalIncome: 10, cargo: 5, collateral: 4, danger: 3 }),
  },
];

export const DEFAULT_WEIGHTS: AttractivityWeights = ATTRACTIVITY_PRESETS[0].weights;

// --- Scoring -------------------------------------------------------------

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

interface ActiveFactor {
  def: FactorDef;
  weight: number;
  /** Raw values (for display in the tooltip). */
  raw: number[];
  /** Values after the scale transform (used for normalisation). */
  scaled: number[];
  stats: Stats;
}

function transformFor(scale: FactorScale): (x: number) => number {
  return scale === 'log' ? (x) => Math.log1p(x) : (x) => x;
}

/** Returns a new array of rows with `attractivity` + `attractivitySteps` filled in. */
export function computeAttractivity(rows: CourierRow[], weights: AttractivityWeights): CourierRow[] {
  if (rows.length === 0) return rows;

  // Keep only weighted factors that actually have data in this result set.
  const active: ActiveFactor[] = [];
  for (const def of FACTORS) {
    const weight = weights[def.id] ?? 0;
    if (weight <= 0) continue;
    const raw = rows.map((r) => {
      const v = def.value(r);
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
    return rows.map((r) => ({ ...r, attractivity: 0, attractivitySteps: steps }));
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
      // subindex = normalised value (0–1) × weight
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

/** Human label for a factor id (used by the weights UI). */
export function factorLabel(id: FactorId): string {
  return FACTOR_BY_ID.get(id)?.label ?? id;
}
