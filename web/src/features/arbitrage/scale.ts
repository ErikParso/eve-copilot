// Arbitrage profit is non-linear in quantity: the walk buys the cheapest asks
// and sells into the dearest bids first, so the first units you carry are the
// most profitable. When your hold or wallet can't take the whole opportunity,
// linearly scaling the average price understates what you'd actually make. This
// re-walks the matched ladder (most profitable rungs first) and prices exactly
// the units that fit — the same walk the server runs, stopped at your limits.
import type { ArbitrageItem } from './types';

/** The economic fields the scaler reads — shared by ArbitrageItem and the route-free opportunity. */
export type ScalableArbitrage = Pick<
  ArbitrageItem,
  | 'quantity'
  | 'unitVolume'
  | 'totalVolume'
  | 'buyPrice'
  | 'sellPrice'
  | 'buyCost'
  | 'profit'
  | 'marginPct'
  | 'ladder'
  | 'salesTax'
>;

/** What the scaler adds: the fitting economics overwrite in place; full-depth + flag are appended. */
export type Scaled<T> = T & { fullQuantity: number; fullTotalVolume: number; limited: boolean };

/**
 * Re-price an opportunity's profit at a different sales tax than the server
 * baked in (e.g. the user's Accounting-skill rate). Recovers gross sell revenue
 * from the server's profit/tax, then re-applies `taxFraction`. The ladder's
 * per-unit prices are tax-independent, so scaling still works on the result.
 */
export function repriceForTax<T extends Pick<ArbitrageItem, 'profit' | 'buyCost' | 'salesTax' | 'marginPct'>>(
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

/**
 * Scale an opportunity to the units that fit within `maxVolume` m³ of cargo and
 * `maxIsk` of spend. Returns the full opportunity (limited = false) when neither
 * constraint binds. Returns null when not even one unit fits (drop it). Generic
 * over the row shape so it serves both the Hauling card (ArbitrageItem) and the
 * Copilot's route-free `available` opportunities.
 */
export function scaleArbitrage<T extends ScalableArbitrage>(
  item: T,
  maxVolume: number,
  maxIsk: number,
): Scaled<T> | null {
  const base = {
    ...item,
    fullQuantity: item.quantity,
    fullTotalVolume: item.totalVolume,
  };

  // Fast path: the whole haul fits → nothing to recompute.
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
    if (volRem <= 0 || iskRem <= 0) continue; // keep summing ladderUnits for the tail check
    // How many of this rung's units fit under each remaining constraint.
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

  // Capped-ladder tail: if we consumed the whole (truncated) ladder and still
  // have room, price the remaining full-depth units at the remainder's average.
  if (units === ladderUnits && ladderUnits < item.quantity && volRem > 0 && iskRem > 0) {
    const remUnits = item.quantity - ladderUnits;
    const sellGrossFull = (item.profit + item.buyCost) / (1 - tax);
    const ladderBuyCost = buyCost;
    const ladderSellGross = sellGross;
    const remBuyAvg = (item.buyCost - ladderBuyCost) / remUnits;
    const remSellAvg = (sellGrossFull - ladderSellGross) / remUnits;
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
