// Arbitrage = buy-here/sell-there hauling, discovered from the live order books.
//
// Pipeline (mirrors the courier pipeline; route resolution is the only
// per-request work):
//   1. Resolve arbitrage WITHOUT routes — for every item type, emit one
//      opportunity per profitable sell-station → buy-station pair (the full
//      profitable order-book depth between them). No station pre-selection, no
//      "single best per type", no reachability filter.
//   2. Cache the route-free opportunities against the 10-min market snapshot.
//   3. On request, resolve routes into items (delivery leg by route type, plus
//      the approach leg from the current system when an origin is given). Jumps
//      and danger are derived from the routes on the FE. Unreachable hauls are
//      filtered out — they aren't returned to the client.
//
// ALL user filtering (collateral, cargo, tax, …) stays on the client.
import { getShipKills } from './kills.js';
import { getRoute, type RouteType } from './routing.js';
import { resolveEndpoint, toRouteSystems } from './enrich.js';
import { getType } from './sde.js';
import { getMarketPrice } from './prices.js';
import { getMarketMeta, getSnapshot, type MarketMeta, type Order, type TypeBook } from './market.js';
import type {
  ArbitrageItem,
  ArbitrageOpportunity,
  ArbitrageRung,
  PinnedHaulStatusRequest,
  PinnedHaulStatusResponse,
} from './types.js';

// Sales tax assumed when scoring profit (mid Accounting skill). Baked in, not a
// filter — the client can't realistically influence it without a backend skill
// lookup, and there's no tax input on the page.
const DEFAULT_SALES_TAX = 0.045;

// Perf guards. Books are pre-sorted (sells cheapest-first, buys dearest-first),
// so the first N stations on each side ARE the most profitable — these caps are
// generous enough to be a no-op for normal items while keeping a hot item like
// Tritanium (thousands of stations) from emitting a combinatorial blow-up.
const MAX_SOURCES_PER_TYPE = 40;
const MAX_DESTS_PER_TYPE = 40;
// Keep at most this many pairs per item type (most profitable first) so a single
// deep item can't crowd everything else out of the global set.
const MAX_PAIRS_PER_TYPE = 12;
// Global ceiling on the cached set (most profitable first). Bounds both the JSON
// we ship and the number of routes we resolve per request.
const MAX_OPPORTUNITIES = 1500;
// Most ladder rungs we keep per opportunity. Generous enough that normal items
// ship their full depth; pathologically deep items (Tritanium &c.) keep only the
// most-profitable top — the client reconciles any uncaptured tail against the
// full aggregates, which always reflect the complete walk.
const MAX_LADDER_RUNGS = 80;

/**
 * Walk asks (asc) against bids (desc) over the FULL profitable depth (no caps on
 * the aggregates). Also records the matched batches as a ladder (capped) so the
 * client can re-price the units that fit a limited hold/wallet.
 */
function walkDepth(
  asks: Order[],
  bids: Order[],
): { quantity: number; buyCost: number; sellRevenueGross: number; ladder: ArbitrageRung[] } {
  const tax = DEFAULT_SALES_TAX;
  let ai = 0;
  let bi = 0;
  let askRem = asks[0]?.volume ?? 0;
  let bidRem = bids[0]?.volume ?? 0;
  let quantity = 0;
  let buyCost = 0;
  let sellRevenueGross = 0;
  const ladder: ArbitrageRung[] = [];

  while (ai < asks.length && bi < bids.length) {
    const ask = asks[ai].price;
    const bid = bids[bi].price;
    if (bid * (1 - tax) <= ask) break; // marginal unit no longer profitable
    const batch = Math.min(askRem, bidRem);
    if (batch <= 0) break;
    quantity += batch;
    buyCost += batch * ask;
    sellRevenueGross += batch * bid;
    // Keep aggregates over the full depth, but record only the top rungs.
    if (ladder.length < MAX_LADDER_RUNGS) ladder.push({ units: batch, buy: ask, sell: bid });
    askRem -= batch;
    bidRem -= batch;
    if (askRem === 0) askRem = asks[++ai]?.volume ?? 0;
    if (bidRem === 0) bidRem = bids[++bi]?.volume ?? 0;
  }
  return { quantity, buyCost, sellRevenueGross, ladder };
}

// --- Step 1: route-free opportunities ----------------------------------------

/** Every profitable source→dest pair for one item type (most profitable first). */
function opportunitiesForType(typeId: number, name: string, unitVolume: number, book: TypeBook): ArbitrageOpportunity[] {
  const tax = DEFAULT_SALES_TAX;
  const dearestBuy = book.buys[0]?.best ?? -Infinity;
  // Quick reject: if the dearest buy can't beat the cheapest sell, nothing here.
  if (book.sells.length === 0 || dearestBuy * (1 - tax) <= (book.sells[0]?.best ?? Infinity)) return [];

  const sources = book.sells.slice(0, MAX_SOURCES_PER_TYPE);
  const dests = book.buys.slice(0, MAX_DESTS_PER_TYPE);
  const marketPrice = getMarketPrice(typeId);
  const out: ArbitrageOpportunity[] = [];

  for (const source of sources) {
    // Sells ascending: once the cheapest remaining source can't be beaten by the
    // dearest buy, no dearer source can be either.
    if (dearestBuy * (1 - tax) <= source.best) break;
    for (const dest of dests) {
      if (dest.station === source.station) continue;
      // Buys descending: once this dest can't beat the source, none after it can.
      if (dest.best * (1 - tax) <= source.best) break;
      const { quantity, buyCost, sellRevenueGross, ladder } = walkDepth(source.orders, dest.orders);
      if (quantity <= 0) continue;
      const profit = sellRevenueGross * (1 - tax) - buyCost;
      if (profit <= 0) continue;

      out.push({
        id: `${typeId}:${source.station}:${dest.station}`,
        typeId,
        itemName: name,
        quantity,
        unitVolume,
        totalVolume: quantity * unitVolume,
        buyPrice: buyCost / quantity,
        sellPrice: sellRevenueGross / quantity,
        marketPrice,
        buyCost,
        profit,
        marginPct: (profit / buyCost) * 100,
        ladder,
        salesTax: tax,
        source: resolveEndpoint(source.station, source.system),
        dest: resolveEndpoint(dest.station, dest.system),
      });
    }
  }

  out.sort((a, b) => b.profit - a.profit);
  return out.length > MAX_PAIRS_PER_TYPE ? out.slice(0, MAX_PAIRS_PER_TYPE) : out;
}

/** Resolve every profitable haul in the current snapshot (no routes). */
function resolveOpportunities(byType: Map<number, TypeBook>): ArbitrageOpportunity[] {
  const all: ArbitrageOpportunity[] = [];
  for (const [typeId, book] of byType) {
    const type = getType(typeId);
    if (!type) continue;
    all.push(...opportunitiesForType(typeId, type.name, type.volume, book));
  }
  all.sort((a, b) => b.profit - a.profit);
  return all.length > MAX_OPPORTUNITIES ? all.slice(0, MAX_OPPORTUNITIES) : all;
}

// --- Step 2: cache the resolved opportunities (keyed by the market snapshot) --
//
// Only the route-free opportunities are cached. Routes are NOT cached here —
// they're resolved on every request, which is cheap because the actual graph
// search is memoised per (source, dest, type) by routing.ts's routeCache; a
// request only re-runs the light toRouteSystems mapping.

let opportunitiesSnapshotAt = -1;
let opportunities: ArbitrageOpportunity[] = [];

/** Cached route-free opportunities, rebuilt only when the snapshot changes. */
function getOpportunities(): ArbitrageOpportunity[] {
  const snap = getSnapshot();
  if (!snap) return [];
  if (snap.builtAt !== opportunitiesSnapshotAt) {
    opportunities = resolveOpportunities(snap.byType);
    opportunitiesSnapshotAt = snap.builtAt;
  }
  return opportunities;
}


// --- Step 3: resolve routes into items (every request) ------------------------

/**
 * Resolve one opportunity into a client item by adding its two route legs: the
 * delivery leg (source→dest) plus the approach leg (current system→source) when
 * an origin is given. Returns null — filtering the haul out — when either leg is
 * unreachable (or an endpoint's system is unknown). getRoute memoises the search.
 */
function resolveItem(
  opp: ArbitrageOpportunity,
  routeType: RouteType,
  origin: number | null,
  kills: Map<number, number>,
): ArbitrageItem | null {
  const srcSys = opp.source.systemId;
  const dstSys = opp.dest.systemId;
  if (srcSys === null || dstSys === null) return null;

  const deliveryIds = getRoute(srcSys, dstSys, routeType);
  if (!deliveryIds) return null; // can't haul source → dest
  const deliveryRoute = toRouteSystems(deliveryIds, kills);

  let approachRoute: ArbitrageItem['approachRoute'] = null;
  if (origin !== null) {
    const approachIds = getRoute(origin, srcSys, routeType);
    if (!approachIds) return null; // can't reach the buy station from here
    approachRoute = toRouteSystems(approachIds, kills);
  }

  return { ...opp, approachRoute, deliveryRoute };
}

export interface ArbitrageResponse {
  items: ArbitrageItem[];
  meta: MarketMeta;
}

/**
 * Every reachable arbitrage opportunity, with routes resolved for this request
 * (delivery leg by route type, plus the approach leg from `origin` when given).
 * The route-free opportunities are cached against the market snapshot; the route
 * resolution is per request (memoised by routing.ts), and unreachable hauls are
 * dropped.
 */
export async function getEnrichedArbitrage(routeType: RouteType, origin: number | null): Promise<ArbitrageResponse> {
  const meta = getMarketMeta();
  if (!getSnapshot()) return { items: [], meta };

  const kills = await getShipKills();
  const items: ArbitrageItem[] = [];
  for (const opp of getOpportunities()) {
    const item = resolveItem(opp, routeType, origin, kills);
    if (item) items.push(item);
  }
  return { items, meta };
}

function walkPlanning(
  asks: Order[],
  bids: Order[],
  targetQty: number
): { quantity: number; buyCost: number; sellRevenueGross: number; ladder: ArbitrageRung[] } {
  const tax = DEFAULT_SALES_TAX;
  let ai = 0;
  let bi = 0;
  let askRem = asks[0]?.volume ?? 0;
  let bidRem = bids[0]?.volume ?? 0;
  let quantity = 0;
  let buyCost = 0;
  let sellRevenueGross = 0;
  const ladder: ArbitrageRung[] = [];

  while (ai < asks.length && bi < bids.length && quantity < targetQty) {
    const ask = asks[ai].price;
    const bid = bids[bi].price;
    if (bid * (1 - tax) <= ask) break;
    const batch = Math.min(askRem, bidRem, targetQty - quantity);
    if (batch <= 0) break;
    quantity += batch;
    buyCost += batch * ask;
    sellRevenueGross += batch * bid;
    if (ladder.length < MAX_LADDER_RUNGS) ladder.push({ units: batch, buy: ask, sell: bid });
    askRem -= batch;
    bidRem -= batch;
    if (askRem === 0) askRem = asks[++ai]?.volume ?? 0;
    if (bidRem === 0) bidRem = bids[++bi]?.volume ?? 0;
  }
  return { quantity, buyCost, sellRevenueGross, ladder };
}

function walkTransit(
  bids: Order[],
  boughtPrice: number,
  targetQty: number
): { quantity: number; buyCost: number; sellRevenueGross: number; ladder: ArbitrageRung[] } {
  let bi = 0;
  let bidRem = bids[0]?.volume ?? 0;
  let quantity = 0;
  let sellRevenueGross = 0;
  const ladder: ArbitrageRung[] = [];

  while (bi < bids.length && quantity < targetQty) {
    const bid = bids[bi].price;
    const batch = Math.min(bidRem, targetQty - quantity);
    if (batch <= 0) break;
    quantity += batch;
    sellRevenueGross += batch * bid;
    if (ladder.length < MAX_LADDER_RUNGS) ladder.push({ units: batch, buy: boughtPrice, sell: bid });
    bidRem -= batch;
    if (bidRem === 0) bidRem = bids[++bi]?.volume ?? 0;
  }
  const buyCost = quantity * boughtPrice;
  return { quantity, buyCost, sellRevenueGross, ladder };
}

export function resolvePinnedHaulsStatus(hauls: PinnedHaulStatusRequest[]): PinnedHaulStatusResponse[] {
  const snap = getSnapshot();
  if (!snap) return [];
  const tax = DEFAULT_SALES_TAX;
  const out: PinnedHaulStatusResponse[] = [];

  for (const h of hauls) {
    const book = snap.byType.get(h.typeId);
    const sourceStation = book?.sells.find((s) => s.station === h.source);
    const destStation = book?.buys.find((b) => b.station === h.dest);
    const asks = sourceStation?.orders ?? [];
    const bids = destStation?.orders ?? [];

    let quantity = 0;
    let buyCost = 0;
    let sellRevenueGross = 0;
    let ladder: ArbitrageRung[] = [];

    if (h.status === 'planning') {
      const walk = walkPlanning(asks, bids, h.quantity);
      quantity = walk.quantity;
      buyCost = walk.buyCost;
      sellRevenueGross = walk.sellRevenueGross;
      ladder = walk.ladder;
    } else {
      const bp = h.boughtPrice ?? 0;
      const walk = walkTransit(bids, bp, h.quantity);
      quantity = walk.quantity;
      buyCost = walk.buyCost;
      sellRevenueGross = walk.sellRevenueGross;
      ladder = walk.ladder;
    }

    const profit = quantity > 0 ? sellRevenueGross * (1 - tax) - buyCost : 0;
    const buyPrice = h.status === 'planning' ? (quantity > 0 ? buyCost / quantity : 0) : (h.boughtPrice ?? 0);
    const sellPrice = quantity > 0 ? sellRevenueGross / quantity : 0;
    const marginPct = buyCost > 0 ? (profit / buyCost) * 100 : 0;

    out.push({
      id: h.id,
      quantity,
      buyPrice,
      sellPrice,
      profit,
      marginPct,
      shortfall: quantity < h.quantity,
      buyerGone: quantity === 0,
      ladder,
    });
  }

  return out;
}
