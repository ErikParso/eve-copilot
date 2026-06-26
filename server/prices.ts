// CCP's global reference prices per item type, from ESI's /markets/prices/.
// This is the canonical "what is this actually worth" number (a rolling average
// of trades market-wide), independent of any single station's order book. We use
// it to sanity-check arbitrage: a destination buy order priced far above the
// reference is the classic bait — fillable now, but cancellable before you haul
// there. One cheap call returns every type, refreshed daily-ish on a timer.
import { esiGet } from './esi.js';

interface RawMarketPrice {
  type_id: number;
  /** Rolling market-wide average of recent trades (the fair value). */
  average_price?: number;
  /** CCP's adjusted price (used for industry costs); a fallback. */
  adjusted_price?: number;
}

const REFRESH_MS = 60 * 60 * 1000;

let prices = new Map<number, number>();

async function refresh(): Promise<void> {
  if (process.env.OFFLINE === 'true') return;
  try {
    const rows = await esiGet<RawMarketPrice[]>('/markets/prices/');
    const next = new Map<number, number>();
    for (const r of rows) {
      const value = r.average_price ?? r.adjusted_price;
      if (typeof value === 'number' && value > 0) next.set(r.type_id, value);
    }
    prices = next;
  } catch (err) {
    console.error('Market prices refresh failed', err);
  }
}

/** Start the periodic reference-price refresh (and the first one now). */
export function startPricesRefresh(): void {
  void refresh();
  setInterval(() => void refresh(), REFRESH_MS).unref();
}

/** CCP's reference value for one item type (ISK/unit), or null if unknown. */
export function getMarketPrice(typeId: number): number | null {
  return prices.get(typeId) ?? null;
}
