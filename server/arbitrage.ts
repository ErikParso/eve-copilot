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
import { getType, getRegion, getStation } from './sde.js';
import { getMarketPrice } from './prices.js';
import {
  getMarketMeta,
  getSnapshot,
  RANGE_REGION,
  RANGE_SYSTEM,
  type MarketMeta,
  type Order,
  type StationOrders,
  type TypeBook,
} from './market.js';
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
export const DEFAULT_SALES_TAX = 0.045;

// Perf guards. Books are pre-sorted (sells cheapest-first, buys dearest-first),
// so the first N stations on each side ARE the most profitable — these caps are
// generous enough to be a no-op for normal items while keeping a hot item like
// Tritanium (thousands of stations) from emitting a combinatorial blow-up.
export const MAX_SOURCES_PER_TYPE = 40;
export const MAX_DESTS_PER_TYPE = 40;
// Keep at most this many pairs per item type (most profitable first) so a single
// deep item can't crowd everything else out of the global set.
export const MAX_PAIRS_PER_TYPE = 12;
// Global ceiling on the cached set (most profitable first). Bounds both the JSON
// we ship and the number of routes we resolve per request.
export const MAX_OPPORTUNITIES = 1500;
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
export function walkDepth(
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

/**
 * Whether a buy `order` can be filled by a seller standing at the drop station
 * `dropStation` (in `dropSystem` / `dropRegion`), per the order's range. Lets a
 * drop point pool every reachable bid, not just the ones physically at it:
 *   - region: any bid in the same region;
 *   - solar-system / n-jumps: any bid in the same system (a buy order's own
 *     system is always within an n≥1 jump range, so this is conservative — it
 *     ignores the extra cross-system reach of jump-range orders);
 *   - station: only bids physically at the drop station.
 */
function bidReaches(order: Order, dropStation: number, dropSystem: number, dropRegion: number | null): boolean {
  if (order.rangeCode === RANGE_REGION) {
    return dropRegion !== null && getRegion(order.systemId) === dropRegion;
  }
  if (order.rangeCode === RANGE_SYSTEM || order.rangeCode > 0) {
    return order.systemId === dropSystem;
  }
  // RANGE_STATION
  return order.locationId === dropStation;
}

/**
 * Pool every bid (from the candidate dest stations) that can be filled from
 * `drop`, sorted dearest-first. This is the range-aware destination book: a
 * region- or system-range buy order resting at another station is fillable from
 * `drop` and so adds to the sellable depth there.
 */
function poolBidsForDrop(dests: StationOrders[], drop: StationOrders): Order[] {
  const dropRegion = getRegion(drop.system);
  const pooled: Order[] = [];
  for (const station of dests) {
    for (const order of station.orders) {
      if (bidReaches(order, drop.station, drop.system, dropRegion)) pooled.push(order);
    }
  }
  pooled.sort((a, b) => b.price - a.price);
  return pooled;
}

/** Every profitable source→dest pair for one item type (most profitable first). */
function opportunitiesForType(
  typeId: number,
  name: string,
  unitVolume: number,
  book: TypeBook,
  maxPairs: number = MAX_PAIRS_PER_TYPE,
): ArbitrageOpportunity[] {
  const tax = DEFAULT_SALES_TAX;
  const dearestBuy = book.buys[0]?.best ?? -Infinity;
  // Quick reject: if the dearest buy can't beat the cheapest sell, nothing here.
  if (book.sells.length === 0 || dearestBuy * (1 - tax) <= (book.sells[0]?.best ?? Infinity)) return [];

  const sources = book.sells.slice(0, MAX_SOURCES_PER_TYPE);
  const dests = book.buys.slice(0, MAX_DESTS_PER_TYPE);
  // Range-aware destination books are pooled once per drop station (independent
  // of source), then reused for every source.
  const pooledByDrop = dests.map((drop) => ({ drop, bids: poolBidsForDrop(dests, drop) }));
  const marketPrice = getMarketPrice(typeId);
  const out: ArbitrageOpportunity[] = [];

  for (const source of sources) {
    // Sells ascending: once the cheapest remaining source can't be beaten by the
    // dearest buy anywhere, no dearer source can be either.
    if (dearestBuy * (1 - tax) <= source.best) break;
    // One opportunity per destination *system*, represented by the drop station
    // that yields the MOST profit for this source — not merely the one with the
    // dearest single bid. Two stations in a system see the same system/region
    // depth, but each also has its own station-range demand (fillable only at it),
    // so the best drop can be the one holding a large station-range order rather
    // than the dearest-quoted one.
    const bestBySystem = new Map<number, { drop: StationOrders; quantity: number; buyCost: number; sellRevenueGross: number; profit: number; ladder: ArbitrageRung[] }>();
    for (const { drop, bids } of pooledByDrop) {
      if (drop.station === source.station) continue;
      // Effective best bid at this drop is the dearest pooled order (may exceed
      // the drop's own best when a dearer region/system order reaches it).
      const bestBid = bids[0]?.price ?? -Infinity;
      if (bestBid * (1 - tax) <= source.best) continue;
      const { quantity, buyCost, sellRevenueGross, ladder } = walkDepth(source.orders, bids);
      if (quantity <= 0) continue;
      const profit = sellRevenueGross * (1 - tax) - buyCost;
      if (profit <= 0) continue;
      const existing = bestBySystem.get(drop.system);
      if (!existing || profit > existing.profit) {
        bestBySystem.set(drop.system, { drop, quantity, buyCost, sellRevenueGross, profit, ladder });
      }
    }

    for (const { drop, quantity, buyCost, sellRevenueGross, profit, ladder } of bestBySystem.values()) {
      out.push({
        id: `${typeId}:${source.station}:${drop.station}`,
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
        dest: resolveEndpoint(drop.station, drop.system),
      });
    }
  }

  out.sort((a, b) => b.profit - a.profit);
  return out.length > maxPairs ? out.slice(0, maxPairs) : out;
}

/**
 * Resolve every profitable haul in the current snapshot (no routes). The caps
 * default to the production limits; the diagnostic comparison passes Infinity to
 * see the full discovery set (so it can tell a cap-truncated lane from one the
 * discovery logic genuinely misses).
 */
export function resolveOpportunities(
  byType: Map<number, TypeBook>,
  maxPairs: number = MAX_PAIRS_PER_TYPE,
  maxTotal: number = MAX_OPPORTUNITIES,
): ArbitrageOpportunity[] {
  const all: ArbitrageOpportunity[] = [];
  for (const [typeId, book] of byType) {
    const type = getType(typeId);
    if (!type) continue;
    all.push(...opportunitiesForType(typeId, type.name, type.volume, book, maxPairs));
  }
  all.sort((a, b) => b.profit - a.profit);
  return all.length > maxTotal ? all.slice(0, maxTotal) : all;
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

/**
 * Recheck pinned hauls against the live book, NETTING shared depth: hauls are
 * walked in pin order against one shared pool of remaining order volume (keyed by
 * ESI order id), so two hauls leaning on the same cheap asks/dearest bids don't
 * both claim them — the first reserves the cheap depth, the next prices up the
 * ladder. Each haul also reports the live order IDs backing it, so identity-based
 * staleness (specific orders gone) can be flagged against the IDs last seen.
 */
export function resolvePinnedHaulsStatus(hauls: PinnedHaulStatusRequest[]): PinnedHaulStatusResponse[] {
  const snap = getSnapshot();
  if (!snap) return [];
  const tax = DEFAULT_SALES_TAX;

  // Shared remaining-volume ledger across all hauls in this request (order id →
  // units left). Lazily seeded from the snapshot the first time an order is hit.
  const remaining = new Map<number, number>();
  const remOf = (o: Order): number => {
    let v = remaining.get(o.id);
    if (v === undefined) {
      v = o.volume;
      remaining.set(o.id, v);
    }
    return v;
  };
  const consume = (o: Order, n: number) => remaining.set(o.id, remOf(o) - n);

  const out: PinnedHaulStatusResponse[] = [];

  for (const h of hauls) {
    const book = snap.byType.get(h.typeId);
    const asks = book?.sells.find((s) => s.station === h.source)?.orders ?? [];
    // Range-aware destination depth: every bid reachable from the drop station,
    // not just those physically resting at it.
    const dropSystem = book?.buys.find((b) => b.station === h.dest)?.system ?? getStation(h.dest)?.systemId ?? null;
    // Pool from the full buy book (not the MAX_DESTS perf-guard slice): there are
    // only a handful of pinned hauls, so accuracy beats the bound here.
    const bids =
      book && dropSystem !== null
        ? poolBidsForDrop(book.buys, { station: h.dest, system: dropSystem, best: -Infinity, orders: [] })
        : [];

    const target = h.quantity;
    let quantity = 0;
    let buyCost = 0;
    let sellRevenueGross = 0;
    const ladder: ArbitrageRung[] = [];
    const srcIds = new Set<number>();
    const dstIds = new Set<number>();

    if (h.status === 'planning') {
      let ai = 0;
      let bi = 0;
      while (ai < asks.length && bi < bids.length && quantity < target) {
        const ask = asks[ai];
        const bid = bids[bi];
        if (bid.price * (1 - tax) <= ask.price) break; // marginal unit unprofitable
        const askA = remOf(ask);
        const bidA = remOf(bid);
        if (askA <= 0) {
          ai++;
          continue;
        }
        if (bidA <= 0) {
          bi++;
          continue;
        }
        const batch = Math.min(askA, bidA, target - quantity);
        if (batch <= 0) break;
        quantity += batch;
        buyCost += batch * ask.price;
        sellRevenueGross += batch * bid.price;
        if (ladder.length < MAX_LADDER_RUNGS) ladder.push({ units: batch, buy: ask.price, sell: bid.price });
        srcIds.add(ask.id);
        dstIds.add(bid.id);
        consume(ask, batch);
        consume(bid, batch);
        if (remOf(ask) <= 0) ai++;
        if (remOf(bid) <= 0) bi++;
      }
    } else {
      // Transit: already bought, so only sell into the (shared) remaining bids.
      const boughtPrice = h.boughtPrice ?? 0;
      let bi = 0;
      while (bi < bids.length && quantity < target) {
        const bid = bids[bi];
        const bidA = remOf(bid);
        if (bidA <= 0) {
          bi++;
          continue;
        }
        const batch = Math.min(bidA, target - quantity);
        if (batch <= 0) break;
        quantity += batch;
        sellRevenueGross += batch * bid.price;
        if (ladder.length < MAX_LADDER_RUNGS) ladder.push({ units: batch, buy: boughtPrice, sell: bid.price });
        dstIds.add(bid.id);
        consume(bid, batch);
        if (remOf(bid) <= 0) bi++;
      }
      buyCost = quantity * boughtPrice;
    }

    const profit = quantity > 0 ? sellRevenueGross * (1 - tax) - buyCost : 0;
    const buyPrice = h.status === 'planning' ? (quantity > 0 ? buyCost / quantity : 0) : (h.boughtPrice ?? 0);
    const sellPrice = quantity > 0 ? sellRevenueGross / quantity : 0;
    const marginPct = buyCost > 0 ? (profit / buyCost) * 100 : 0;

    const sourceOrderIds = [...srcIds];
    const destOrderIds = [...dstIds];
    // Source orders only matter while planning (a transit haul is already bought,
    // so its empty source set must not be diffed against the planning-era ids).
    const srcChanged =
      h.status === 'planning' && h.knownSourceOrderIds !== undefined && !sameIds(h.knownSourceOrderIds, sourceOrderIds);
    const dstChanged = h.knownDestOrderIds !== undefined && !sameIds(h.knownDestOrderIds, destOrderIds);
    const stale = srcChanged || dstChanged;

    out.push({
      id: h.id,
      quantity,
      buyPrice,
      sellPrice,
      profit,
      marginPct,
      shortfall: quantity < target,
      buyerGone: bids.length === 0,
      supplyGone: h.status === 'planning' && asks.length === 0,
      stale,
      ladder,
      sourceOrderIds,
      destOrderIds,
    });
  }

  return out;
}

/** Order-id set equality (order-independent). */
function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
