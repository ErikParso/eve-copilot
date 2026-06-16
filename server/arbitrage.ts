// Resolves every profitable buy-here/sell-there opportunity (one best haul per
// item type) from the cached market snapshot, enriches each with routes +
// danger, and caches the lot per route type — recomputed only when the 10-min
// market snapshot changes. Mirrors the courier pipeline: the only request
// inputs are routeType (route resolution) and origin (the approach leg from the
// current system). ALL user filtering (collateral, cargo, tax, …) is on the
// client.
import { getShipKills } from './kills.js';
import { getRoute, jumpsFromRoute, type RouteType } from './routing.js';
import { resolveEndpoint, toRouteSystems } from './enrich.js';
import { computeDanger } from './danger.js';
import { getType } from './sde.js';
import { getMarketMeta, getSnapshot, type MarketMeta, type Order, type StationOrders, type TypeBook } from './market.js';
import type { ArbitrageItem } from './types.js';

// Sales tax assumed when scoring profit (mid Accounting skill). Baked in, not a
// filter — the client can't realistically influence it without a backend skill
// lookup, and there's no tax input on the page.
const DEFAULT_SALES_TAX = 0.045;
// Per item, how many cheapest-sell × dearest-buy stations to pair up.
const K = 5;

function profitPerJump(profit: number, totalJumps: number | null): number | null {
  if (totalJumps === null) return null;
  if (totalJumps === 0) return profit;
  return profit / totalJumps;
}

/** Walk asks (asc) against bids (desc) over the FULL profitable depth (no caps). */
function walkDepth(asks: Order[], bids: Order[]): { quantity: number; buyCost: number; sellRevenueGross: number } {
  const tax = DEFAULT_SALES_TAX;
  let ai = 0;
  let bi = 0;
  let askRem = asks[0]?.volume ?? 0;
  let bidRem = bids[0]?.volume ?? 0;
  let quantity = 0;
  let buyCost = 0;
  let sellRevenueGross = 0;

  while (ai < asks.length && bi < bids.length) {
    const ask = asks[ai].price;
    const bid = bids[bi].price;
    if (bid * (1 - tax) <= ask) break; // marginal unit no longer profitable
    const batch = Math.min(askRem, bidRem);
    if (batch <= 0) break;
    quantity += batch;
    buyCost += batch * ask;
    sellRevenueGross += batch * bid;
    askRem -= batch;
    bidRem -= batch;
    if (askRem === 0) askRem = asks[++ai]?.volume ?? 0;
    if (bidRem === 0) bidRem = bids[++bi]?.volume ?? 0;
  }
  return { quantity, buyCost, sellRevenueGross };
}

interface BestPair {
  quantity: number;
  buyCost: number;
  sellRevenueGross: number;
  profit: number;
  source: StationOrders;
  dest: StationOrders;
  deliveryRouteIds: number[];
  jumpsToDest: number | null;
}

/**
 * The most profitable reachable haul for one item: among the K cheapest sell
 * stations × K dearest buy stations, the highest-profit pair that has a route.
 */
function bestPairForType(book: TypeBook, routeType: RouteType): BestPair | null {
  const tax = DEFAULT_SALES_TAX;
  const bestSell = book.sells[0];
  const bestBuy = book.buys[0];
  if (!bestSell || !bestBuy || bestBuy.best * (1 - tax) <= bestSell.best) return null;

  const sources = book.sells.slice(0, K);
  const dests = book.buys.slice(0, K);

  const candidates: Omit<BestPair, 'deliveryRouteIds' | 'jumpsToDest'>[] = [];
  for (const source of sources) {
    for (const dest of dests) {
      if (source.station === dest.station) continue;
      if (dest.best * (1 - tax) <= source.best) continue;
      const { quantity, buyCost, sellRevenueGross } = walkDepth(source.orders, dest.orders);
      if (quantity <= 0) continue;
      const profit = sellRevenueGross * (1 - tax) - buyCost;
      if (profit <= 0) continue;
      candidates.push({ quantity, buyCost, sellRevenueGross, profit, source, dest });
    }
  }

  candidates.sort((a, b) => b.profit - a.profit);

  for (const c of candidates) {
    const routeIds = getRoute(c.source.system, c.dest.system, routeType);
    if (!routeIds) continue; // unreachable — not a haul
    return { ...c, deliveryRouteIds: routeIds, jumpsToDest: jumpsFromRoute(routeIds) };
  }
  return null;
}

/** Build the base (delivery-only, no origin) opportunity for every item. */
function computeBase(routeType: RouteType, kills: Map<number, number>): ArbitrageItem[] {
  const snap = getSnapshot();
  if (!snap) return [];

  const items: ArbitrageItem[] = [];
  for (const [typeId, book] of snap.byType) {
    const type = getType(typeId);
    if (!type || book.sells.length === 0 || book.buys.length === 0) continue;

    const pair = bestPairForType(book, routeType);
    if (!pair) continue;

    const deliveryRoute = toRouteSystems(pair.deliveryRouteIds, kills);
    const danger = computeDanger(deliveryRoute);

    items.push({
      id: `${typeId}:${pair.source.station}:${pair.dest.station}`,
      typeId,
      itemName: type.name,
      quantity: pair.quantity,
      unitVolume: type.volume,
      totalVolume: pair.quantity * type.volume,
      buyPrice: pair.buyCost / pair.quantity,
      sellPrice: pair.sellRevenueGross / pair.quantity,
      buyCost: pair.buyCost,
      profit: pair.profit,
      marginPct: (pair.profit / pair.buyCost) * 100,
      source: resolveEndpoint(pair.source.station, pair.source.system),
      dest: resolveEndpoint(pair.dest.station, pair.dest.system),
      jumpsFromCurrent: null,
      jumpsToDest: pair.jumpsToDest,
      approachRoute: null,
      deliveryRoute,
      totalJumps: pair.jumpsToDest,
      profitPerJump: profitPerJump(pair.profit, pair.jumpsToDest),
      danger: danger.index,
      dangerSteps: danger.steps,
    });
  }
  return items;
}

// --- Cache (recomputed per route type when the market snapshot changes) ------

let cacheSnapshotAt = -1;
const byRouteType = new Map<RouteType, ArbitrageItem[]>();

export interface ArbitrageResponse {
  items: ArbitrageItem[];
  meta: MarketMeta;
}

/**
 * Every arbitrage opportunity for a route type, optionally with approach legs
 * (current system → buy station) when an origin is given. Cached per route type
 * against the current market snapshot; the origin augmentation is per request,
 * exactly like the courier pipeline.
 */
export async function getEnrichedArbitrage(routeType: RouteType, origin: number | null): Promise<ArbitrageResponse> {
  const meta = getMarketMeta();
  const snap = getSnapshot();
  if (!snap) return { items: [], meta };

  if (snap.builtAt !== cacheSnapshotAt) {
    byRouteType.clear();
    cacheSnapshotAt = snap.builtAt;
  }

  let rows = byRouteType.get(routeType);
  if (!rows) {
    const kills = await getShipKills();
    rows = computeBase(routeType, kills);
    byRouteType.set(routeType, rows);
  }

  if (origin !== null) {
    const kills = await getShipKills();
    rows = rows.map((row) => {
      if (row.source.systemId === null) return row;
      const approachIds = getRoute(origin, row.source.systemId, routeType);
      const jumpsFromCurrent = jumpsFromRoute(approachIds);
      const totalJumps =
        jumpsFromCurrent !== null && row.jumpsToDest !== null ? jumpsFromCurrent + row.jumpsToDest : null;
      const approachRoute = approachIds ? toRouteSystems(approachIds, kills) : null;

      // Danger over the whole journey (approach + delivery), matching the route
      // the card draws; the approach's last system == the buy station, drop the seam.
      let danger = row.danger;
      let dangerSteps = row.dangerSteps;
      if (approachRoute && row.deliveryRoute) {
        const full = [...approachRoute, ...row.deliveryRoute.slice(1)];
        const d = computeDanger(full);
        danger = d.index;
        dangerSteps = d.steps;
      }

      return {
        ...row,
        jumpsFromCurrent,
        approachRoute,
        totalJumps,
        profitPerJump: profitPerJump(row.profit, totalJumps),
        danger,
        dangerSteps,
      };
    });
  }

  return { items: rows, meta };
}
