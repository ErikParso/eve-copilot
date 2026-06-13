// Attractivity index (0–100) for courier contracts.
//
// Both methods are *relative* to the current result set: each underlying
// metric is min-max normalised across the returned contracts, then combined.
// This makes the index a good sort key for "best in the current list", which
// is how it is intended to be used.
//
// Alongside the score, each row gets a step-by-step breakdown (with the row's
// real numbers) so the UI can show exactly how the value was derived.
import { formatIsk, formatNumber } from '@/utils/format';
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
      'Blends four factors: ISK per jump (40%), a low danger index for the ' +
      'route (30%), low collateral relative to reward (20%) and ISK per m³ of ' +
      'cargo (10%). Favours contracts that pay well per jump along a safe path ' +
      'without forcing you to risk a large collateral on a big load.',
  },
];

export const DEFAULT_ATTRACTIVITY_METHOD: AttractivityMethod = 'profitPerJump';

interface Stats {
  min: number;
  max: number;
  range: number;
}

/** Min/max/range over the finite values only. */
function stats(values: number[]): Stats {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: NaN, max: NaN, range: 0 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return { min, max, range: max - min };
}

/** Normalise one value to [0,1]; equal values → 1; non-finite → 0. */
function unit(value: number, s: Stats, higherIsBetter: boolean): number {
  if (!Number.isFinite(value)) return 0;
  if (s.range === 0) return 1;
  const u = (value - s.min) / s.range;
  return higherIsBetter ? u : 1 - u;
}

function nullToNaN(v: number | null): number {
  return v === null ? NaN : v;
}

function f2(n: number): string {
  return formatNumber(n, 2);
}

// --- Per-row step builders -----------------------------------------------

function profitPerJumpSteps(row: CourierRow, ipjStats: Stats, u: number, score: number): string[] {
  if (row.incomePerJump === null) {
    return ['No route available, so income per jump can’t be computed → score 0.'];
  }

  const jumpsLabel =
    row.totalJumps === 0
      ? 'same-system haul (0 jumps), so income/jump = full reward'
      : `${formatIsk(row.reward)} ÷ ${formatNumber(row.totalJumps ?? 0, 0)} jumps = ${formatIsk(
          row.incomePerJump,
        )}`;

  const normLine =
    ipjStats.range === 0
      ? 'All results have the same income/jump → normalised = 1.00'
      : `Normalised vs all results: (${formatIsk(row.incomePerJump)} − ${formatIsk(
          ipjStats.min,
        )}) ÷ (${formatIsk(ipjStats.max)} − ${formatIsk(ipjStats.min)}) = ${f2(u)}`;

  return [
    `1. Income per jump: ${jumpsLabel}`,
    `2. ${normLine}`,
    `3. Score = ${f2(u)} × 100 = ${score}`,
  ];
}

interface RiskParts {
  eff: number;
  dangerSafety: number;
  collateralSafety: number;
  density: number;
}

function riskAdjustedSteps(
  row: CourierRow,
  parts: RiskParts,
  raw: { collateralRatio: number; iskPerM3: number },
  score: number,
): string[] {
  const effLine =
    row.incomePerJump === null
      ? 'ISK/jump: no route → 0.00'
      : `ISK/jump = ${formatIsk(row.incomePerJump)} → normalised ${f2(parts.eff)}`;

  const dangerLine =
    row.danger === null
      ? 'Danger: no route → 0.00'
      : `Danger index = ${row.danger}/100 → normalised (lower is safer) ${f2(parts.dangerSafety)}`;

  const collateralLine = `Collateral ratio = ${formatIsk(row.collateral)} ÷ ${formatIsk(
    row.reward,
  )} = ${f2(raw.collateralRatio)} → normalised (lower is safer) ${f2(parts.collateralSafety)}`;

  const densityLine = `ISK per m³ = ${formatIsk(row.reward)} ÷ ${formatNumber(
    row.volume,
    2,
  )} m³ = ${formatIsk(raw.iskPerM3)} → normalised ${f2(parts.density)}`;

  const blended =
    0.4 * parts.eff + 0.3 * parts.dangerSafety + 0.2 * parts.collateralSafety + 0.1 * parts.density;

  return [
    `1. ${effLine}  ×40%`,
    `2. ${dangerLine}  ×30%`,
    `3. ${collateralLine}  ×20%`,
    `4. ${densityLine}  ×10%`,
    `5. Blended = 0.4×${f2(parts.eff)} + 0.3×${f2(parts.dangerSafety)} + 0.2×${f2(
      parts.collateralSafety,
    )} + 0.1×${f2(parts.density)} = ${f2(blended)}`,
    `6. Score = ${f2(blended)} × 100 = ${score}`,
  ];
}

/** Returns a new array of rows with `attractivity` + `attractivitySteps` filled in. */
export function computeAttractivity(rows: CourierRow[], method: AttractivityMethod): CourierRow[] {
  if (rows.length === 0) return rows;

  const incomePerJump = rows.map((r) => nullToNaN(r.incomePerJump));
  const ipjStats = stats(incomePerJump);

  if (method === 'profitPerJump') {
    return rows.map((r, i) => {
      const u = unit(incomePerJump[i], ipjStats, true);
      const attractivity = Math.round(u * 100);
      return {
        ...r,
        attractivity,
        attractivitySteps: profitPerJumpSteps(r, ipjStats, u, attractivity),
      };
    });
  }

  // riskAdjusted
  const collateralRatio = rows.map((r) => (r.reward > 0 ? r.collateral / r.reward : Infinity));
  const iskPerM3 = rows.map((r) => (r.volume > 0 ? r.reward / r.volume : NaN));
  const dangerValue = rows.map((r) => (r.danger === null ? NaN : r.danger));
  const ratioStats = stats(collateralRatio);
  const densityStats = stats(iskPerM3);
  const dangerStats = stats(dangerValue);

  return rows.map((r, i) => {
    const eff = unit(incomePerJump[i], ipjStats, true);
    const dangerSafety = unit(dangerValue[i], dangerStats, false); // lower danger = safer
    const collateralSafety = unit(collateralRatio[i], ratioStats, false); // lower ratio = safer
    const density = unit(iskPerM3[i], densityStats, true);
    const blended = 0.4 * eff + 0.3 * dangerSafety + 0.2 * collateralSafety + 0.1 * density;
    const attractivity = Math.round(blended * 100);
    return {
      ...r,
      attractivity,
      attractivitySteps: riskAdjustedSteps(
        r,
        { eff, dangerSafety, collateralSafety, density },
        { collateralRatio: collateralRatio[i], iskPerM3: iskPerM3[i] },
        attractivity,
      ),
    };
  });
}
