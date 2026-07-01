// Server-side port of the FE arbitrage scaling + tax repricing + attractivity
// scoring, used to filter/scale/rank the full candidate set before truncating to
// the shipped top-N. KEEP IN SYNC with:
//   web/src/features/arbitrage/scale.ts        (scaleArbitrage, repriceForTax)
//   web/src/features/attractivity/scoring.ts   (score engine, FACTORS, log income)
//   web/src/features/arbitrage/attractivity.ts (income↔profit mapping)
// There is no shared package between web/ and server/, so this is duplicated
// deliberately; the FE still re-scores the shipped set for the combined
// (courier+arbitrage) index, so any drift shows up only in which top-N is picked.
import type { ArbitrageRung } from './types.js';

// --- scaling + tax (port of web scale.ts) ------------------------------------

export interface ScalableArbitrage {
  quantity: number;
  unitVolume: number;
  totalVolume: number;
  buyPrice: number;
  sellPrice: number;
  buyCost: number;
  profit: number;
  marginPct: number;
  ladder: ArbitrageRung[];
  salesTax: number;
}
export type Scaled<T> = T & { fullQuantity: number; fullTotalVolume: number; limited: boolean };

/** Re-price profit at a different sales tax than the baked-in rate. */
export function repriceForTax<T extends { profit: number; buyCost: number; salesTax: number; marginPct: number }>(
  item: T,
  taxFraction: number,
): T {
  if (taxFraction === item.salesTax) return item;
  const gross = (item.profit + item.buyCost) / (1 - item.salesTax);
  const profit = gross * (1 - taxFraction) - item.buyCost;
  return {
    ...item,
    profit,
    marginPct: item.buyCost > 0 ? (profit / item.buyCost) * 100 : 0,
    salesTax: taxFraction,
  };
}

/** Scale an opportunity to the units that fit `maxVolume` m³ + `maxIsk`; null if none fit. */
export function scaleArbitrage<T extends ScalableArbitrage>(item: T, maxVolume: number, maxIsk: number): Scaled<T> | null {
  const base = { ...item, fullQuantity: item.quantity, fullTotalVolume: item.totalVolume };
  if (item.totalVolume <= maxVolume && item.buyCost <= maxIsk) {
    return { ...base, limited: false };
  }

  const tax = item.salesTax;
  const uVol = item.unitVolume;
  let volRem = maxVolume;
  let iskRem = maxIsk;
  let units = 0;
  let buyCost = 0;
  let sellGross = 0;
  let ladderUnits = 0;

  for (const rung of item.ladder) {
    ladderUnits += rung.units;
    if (volRem <= 0 || iskRem <= 0) continue;
    const byVol = uVol > 0 ? Math.floor(volRem / uVol) : Infinity;
    const byIsk = rung.buy > 0 ? Math.floor(iskRem / rung.buy) : Infinity;
    const take = Math.min(rung.units, byVol, byIsk);
    if (take <= 0) continue;
    units += take;
    buyCost += take * rung.buy;
    sellGross += take * rung.sell;
    volRem -= take * uVol;
    iskRem -= take * rung.buy;
  }

  if (units === ladderUnits && ladderUnits < item.quantity && volRem > 0 && iskRem > 0) {
    const remUnits = item.quantity - ladderUnits;
    const sellGrossFull = (item.profit + item.buyCost) / (1 - tax);
    const remBuyAvg = (item.buyCost - buyCost) / remUnits;
    const remSellAvg = (sellGrossFull - sellGross) / remUnits;
    const byVol = uVol > 0 ? Math.floor(volRem / uVol) : Infinity;
    const byIsk = remBuyAvg > 0 ? Math.floor(iskRem / remBuyAvg) : Infinity;
    const take = Math.min(remUnits, byVol, byIsk);
    if (take > 0) {
      units += take;
      buyCost += take * remBuyAvg;
      sellGross += take * remSellAvg;
    }
  }

  if (units <= 0) return null;

  const profit = sellGross * (1 - tax) - buyCost;
  return {
    ...base,
    quantity: units,
    totalVolume: units * uVol,
    buyCost,
    profit,
    buyPrice: buyCost / units,
    sellPrice: sellGross / units,
    marginPct: (profit / buyCost) * 100,
    limited: units < item.quantity,
  };
}

// --- attractivity scoring (port of web scoring.ts, arbitrage-only) ------------
// Three factors, identical to the FE: income (profit, higher, LOG-scaled),
// totalJumps (lower, linear), danger (lower, linear). Used only to rank the
// candidate set so we ship the most attractive top-N; the FE recomputes the
// displayed index over the combined courier+arbitrage set.

export interface AttractivityWeights {
  income: number;
  totalJumps: number;
  danger: number;
  valueAtRisk: number;
}

interface Scorable {
  income: number;
  totalJumps: number | null;
  danger: number | null;
  /** ISK you'd lose if this haul dies: courier collateral / arbitrage buyCost / package price. */
  valueAtRisk: number | null;
}

interface FactorDef {
  id: keyof AttractivityWeights;
  higher: boolean;
  log: boolean;
  value: (s: Scorable) => number | null;
  /**
   * When true, the factor is on a fixed 0–100 scale (danger) and is normalised
   * against that scale, NOT min-maxed across the batch — so a genuinely safe route
   * always scores well regardless of what else is in the results.
   */
  absolute?: boolean;
}
const FACTORS: FactorDef[] = [
  { id: 'income', higher: true, log: true, value: (s) => s.income },
  { id: 'totalJumps', higher: false, log: false, value: (s) => s.totalJumps },
  { id: 'danger', higher: false, log: false, value: (s) => s.danger, absolute: true },
  { id: 'valueAtRisk', higher: false, log: true, value: (s) => s.valueAtRisk },
];

/** Attractivity 0–100 for each item, min-max normalised across the set. */
export function scoreAttractivity<T extends Scorable>(items: T[], weights: AttractivityWeights): number[] {
  if (items.length === 0) return [];

  interface Active {
    weight: number;
    higher: boolean;
    scaled: number[];
    min: number;
    range: number;
  }
  const active: Active[] = [];
  for (const f of FACTORS) {
    const weight = weights[f.id] ?? 0;
    if (weight <= 0) continue;
    const scaled = items.map((it) => {
      const v = f.value(it);
      if (v === null || !Number.isFinite(v)) return NaN;
      return f.log ? Math.log1p(v) : v;
    });
    const finite = scaled.filter((v) => Number.isFinite(v));
    if (finite.length === 0) continue;
    if (f.absolute) {
      // Absolute 0–100 factor (danger): normalise against the fixed scale, not the
      // batch — so its meaning (and the danger weight's strength) is batch-independent.
      active.push({ weight, higher: f.higher, scaled: scaled.map((v) => v / 100), min: 0, range: 1 });
    } else {
      const min = Math.min(...finite);
      const max = Math.max(...finite);
      active.push({ weight, higher: f.higher, scaled, min, range: max - min });
    }
  }

  const totalWeight = active.reduce((s, a) => s + a.weight, 0);
  if (totalWeight === 0) return items.map(() => 0);

  return items.map((_, i) => {
    let contrib = 0;
    for (const a of active) {
      const v = a.scaled[i];
      let u: number;
      if (!Number.isFinite(v)) u = 0;
      else if (a.range === 0) u = 1;
      else {
        const t = (v - a.min) / a.range;
        u = a.higher ? t : 1 - t;
      }
      contrib += a.weight * u;
    }
    return Math.round((contrib / totalWeight) * 100);
  });
}
