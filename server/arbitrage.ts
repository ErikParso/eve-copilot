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
import { getMarketMeta, getSnapshot, type MarketMeta, type Order, type StationOrders, type TypeBook } from './market.js';
import type {
  ArbitrageCommitment,
  ArbitrageItem,
  ArbitrageOpportunity,
  ArbitrageRung,
  CommittedEconomics,
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

// --- Plan-aware resolution: subtract the Copilot's reservations ---------------
//
// The full menu above treats every opportunity in isolation, so overlapping
// hauls (same item at the same station) double-count the shared orders. The
// Copilot sends what it has reserved; we consume that depth from a clone of the
// book, then report each reservation's CURRENT worth + recompute the remaining
// opportunities for the (few) affected item types. Untouched types reuse the
// cached menu. Route-free by design — the client routes via /api/routes.

/** Per-station mutable order pools for one item type, cloned from the snapshot. */
interface TypePools {
  sells: Map<number, Order[]>;
  buys: Map<number, Order[]>;
}

/** Clone a type's station orders so we can decrement volumes without touching the snapshot. */
function clonePools(book: TypeBook): TypePools {
  const sells = new Map<number, Order[]>();
  for (const s of book.sells) sells.set(s.station, s.orders.map((o) => ({ ...o })));
  const buys = new Map<number, Order[]>();
  for (const b of book.buys) buys.set(b.station, b.orders.map((o) => ({ ...o })));
  return { sells, buys };
}

/** Rebuild best-price-sorted StationOrders from a mutated pool, dropping emptied orders. */
function stationsFromPool(pool: Map<number, Order[]>, ascending: boolean): StationOrders[] {
  const stations: StationOrders[] = [];
  for (const orders of pool.values()) {
    const live = orders.filter((o) => o.volume > 0);
    if (live.length === 0) continue;
    live.sort((a, b) => (ascending ? a.price - b.price : b.price - a.price));
    stations.push({ station: live[0].locationId, system: live[0].systemId, best: live[0].price, orders: live });
  }
  stations.sort((a, b) => (ascending ? a.best - b.best : b.best - a.best));
  return stations;
}

/**
 * Like walkDepth but for ONE source station vs ONE dest station, capped at
 * `maxUnits` and MUTATING the order volumes in place (so later reservations and
 * the remaining-opportunity recompute see the consumed depth).
 */
function consumeWalk(
  asks: Order[],
  bids: Order[],
  maxUnits: number,
): { quantity: number; buyCost: number; sellRevenueGross: number; ladder: ArbitrageRung[] } {
  const tax = DEFAULT_SALES_TAX;
  let ai = 0;
  let bi = 0;
  let quantity = 0;
  let buyCost = 0;
  let sellRevenueGross = 0;
  const ladder: ArbitrageRung[] = [];

  while (ai < asks.length && bi < bids.length && quantity < maxUnits) {
    if (asks[ai].volume <= 0) { ai++; continue; }
    if (bids[bi].volume <= 0) { bi++; continue; }
    const ask = asks[ai].price;
    const bid = bids[bi].price;
    if (bid * (1 - tax) <= ask) break; // marginal unit no longer profitable
    const batch = Math.min(asks[ai].volume, bids[bi].volume, maxUnits - quantity);
    if (batch <= 0) break;
    quantity += batch;
    buyCost += batch * ask;
    sellRevenueGross += batch * bid;
    if (ladder.length < MAX_LADDER_RUNGS) ladder.push({ units: batch, buy: ask, sell: bid });
    asks[ai].volume -= batch;
    bids[bi].volume -= batch;
  }
  return { quantity, buyCost, sellRevenueGross, ladder };
}

export interface ArbitragePlan {
  available: ArbitrageOpportunity[];
  committed: CommittedEconomics[];
  meta: MarketMeta;
}

/**
 * Resolve the Copilot's reservations against the live book: returns each
 * reservation's current economics (route-free) plus the opportunities still
 * available after the reservations took their depth.
 */
export function resolveArbitragePlan(commitments: ArbitrageCommitment[]): ArbitragePlan {
  const meta = getMarketMeta();
  const snap = getSnapshot();
  if (!snap) return { available: [], committed: [], meta };
  const tax = DEFAULT_SALES_TAX;

  // Clone pools lazily, once per affected type, and keep consuming from them.
  const poolsByType = new Map<number, TypePools>();
  const getPools = (typeId: number): TypePools => {
    let p = poolsByType.get(typeId);
    if (!p) {
      const book = snap.byType.get(typeId);
      p = book ? clonePools(book) : { sells: new Map(), buys: new Map() };
      poolsByType.set(typeId, p);
    }
    return p;
  };

  // Process reservations in basket order — earlier ones get the cheaper depth.
  const committed: CommittedEconomics[] = [];
  for (const c of commitments) {
    const pools = getPools(c.typeId);
    const asks = pools.sells.get(c.source) ?? [];
    const bids = pools.buys.get(c.dest) ?? [];
    const { quantity, buyCost, sellRevenueGross, ladder } = consumeWalk(asks, bids, c.quantity);
    const unitVolume = getType(c.typeId)?.volume ?? 0;
    const profit = quantity > 0 ? sellRevenueGross * (1 - tax) - buyCost : 0;
    committed.push({
      id: c.id,
      requested: c.quantity,
      quantity,
      totalVolume: quantity * unitVolume,
      buyCost,
      profit,
      marginPct: buyCost > 0 ? (profit / buyCost) * 100 : 0,
      buyPrice: quantity > 0 ? buyCost / quantity : 0,
      sellPrice: quantity > 0 ? sellRevenueGross / quantity : 0,
      ladder,
      shortfall: quantity < c.quantity,
    });
  }

  // Available = cached menu for untouched types + a fresh walk over the reduced
  // pools for the touched ones, re-sorted and re-capped.
  const cached = getOpportunities();
  const available = cached.filter((o) => !poolsByType.has(o.typeId));
  for (const [typeId, pools] of poolsByType) {
    const type = getType(typeId);
    if (!type) continue;
    const reduced: TypeBook = {
      sells: stationsFromPool(pools.sells, true),
      buys: stationsFromPool(pools.buys, false),
    };
    available.push(...opportunitiesForType(typeId, type.name, type.volume, reduced));
  }
  available.sort((a, b) => b.profit - a.profit);

  return {
    available: available.length > MAX_OPPORTUNITIES ? available.slice(0, MAX_OPPORTUNITIES) : available,
    committed,
    meta,
  };
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
