// Attractivity index (0–100) for arbitrage opportunities. Same idea as the
// courier scorer: each factor is min-max normalised across the current result
// set (flipped for "lower is better"), weighted, averaged by total weight and
// scaled to 0–100 — so it's a "best in this list" ranking. Weights are fixed
// for now (no UI), tuned to favour absolute profit and margin while nudging
// away from danger and long hauls.
import { formatIsk, formatNumber, formatVolume } from '@/utils/format';
import type { ArbitrageItem, ArbitrageRow } from './types';

type Direction = 'higher' | 'lower';
type Scale = 'linear' | 'log';

interface Factor {
  label: string;
  direction: Direction;
  scale: Scale;
  weight: number;
  value: (r: ArbitrageItem) => number | null;
  format: (v: number) => string;
}

const pct = (v: number) => `${formatNumber(v, 1)}%`;
const jumps = (v: number) => `${formatNumber(v, 0)} jumps`;

// Heavy-tailed ISK/volume factors are log-scaled so one whale order can't
// flatten everything else to ~0.
const FACTORS: Factor[] = [
  { label: 'Profit', direction: 'higher', scale: 'log', weight: 6, value: (r) => r.profit, format: formatIsk },
  { label: 'Margin', direction: 'higher', scale: 'linear', weight: 4, value: (r) => r.marginPct, format: pct },
  { label: 'Profit / jump', direction: 'higher', scale: 'log', weight: 5, value: (r) => r.profitPerJump, format: formatIsk },
  { label: 'Danger', direction: 'lower', scale: 'linear', weight: 3, value: (r) => r.danger, format: (v) => `${formatNumber(v, 0)}/100` },
  { label: 'Jumps', direction: 'lower', scale: 'linear', weight: 3, value: (r) => r.jumps, format: jumps },
  { label: 'Investment', direction: 'lower', scale: 'log', weight: 2, value: (r) => r.buyCost, format: formatIsk },
  { label: 'Cargo volume', direction: 'lower', scale: 'log', weight: 1, value: (r) => r.totalVolume, format: formatVolume },
];

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

const transform = (scale: Scale) => (scale === 'log' ? (x: number) => Math.log1p(x) : (x: number) => x);
const f2 = (n: number) => formatNumber(n, 2);

interface ActiveFactor {
  def: Factor;
  raw: number[];
  scaled: number[];
  stats: Stats;
}

/** Returns rows with `attractivity` + `attractivitySteps` filled in. */
export function computeArbitrageAttractivity(items: ArbitrageItem[]): ArbitrageRow[] {
  if (items.length === 0) return items.map((r) => ({ ...r, attractivity: 0, attractivitySteps: [] }));

  const active: ActiveFactor[] = [];
  for (const def of FACTORS) {
    if (def.weight <= 0) continue;
    const raw = items.map((r) => {
      const v = def.value(r);
      return v === null ? NaN : v;
    });
    const t = transform(def.scale);
    const scaled = raw.map((v) => (Number.isFinite(v) ? t(v) : NaN));
    const s = stats(scaled);
    if (!Number.isFinite(s.min)) continue;
    active.push({ def, raw, scaled, stats: s });
  }

  const totalWeight = active.reduce((sum, a) => sum + a.def.weight, 0);

  return items.map((row, i) => {
    const contribs: number[] = [];
    const lines: string[] = [];
    for (const a of active) {
      const norm = unit(a.scaled[i], a.stats, a.def.direction === 'higher');
      const contrib = a.def.weight * norm;
      contribs.push(contrib);
      const raw = Number.isFinite(a.raw[i]) ? a.def.format(a.raw[i]) : '—';
      const arrow = a.def.direction === 'higher' ? '↑' : '↓';
      const scaleTag = a.def.scale === 'log' ? ' (log)' : '';
      lines.push(
        `• ${a.def.label} ${arrow}${scaleTag}: ${raw} → norm ${f2(norm)} × weight ${a.def.weight} = ${f2(contrib)}`,
      );
    }
    const contribSum = contribs.reduce((s, c) => s + c, 0);
    const attractivity = totalWeight === 0 ? 0 : Math.round((contribSum / totalWeight) * 100);

    const steps = [
      'Each factor → normalised 0–1 across results (↑ higher-better, ↓ lower-better, log = log-scaled), then × its weight:',
      ...lines,
      `Sum of sub-scores = ${contribs.map(f2).join(' + ')} = ${f2(contribSum)}`,
      `Attractivity = ${f2(contribSum)} ÷ ${formatNumber(totalWeight, 0)} (total weight) × 100 = ${attractivity}`,
    ];

    return { ...row, attractivity, attractivitySteps: steps };
  });
}
