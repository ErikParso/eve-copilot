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
import { getRoute, type RouteType } from './routing.js';
import { resolveEndpoint, toRouteSystems } from './enrich.js';
import { getType, getRegion, getStation, getSystem, securityBand } from './sde.js';
import { getMarketPrice } from './prices.js';
import { dangerForSystems } from './danger.js';
import { scaleArbitrage, repriceForTax, scoreAttractivity, type Scaled, type AttractivityWeights } from './arbitrageScore.js';
import type { ContractEndpoint } from './types.js';
import {
  getSnapshot,
  RANGE_REGION,
  RANGE_SYSTEM,
  type Order,
  type StationOrders,
  type TypeBook,
} from './market.js';
import type {
  ArbitrageOpportunity,
  ArbitrageRung,
  ScaledArbitrageItem,
  PinnedHaulStatusRequest,
  PinnedHaulStatusResponse,
  RouteSystem,
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
// Drop any haul whose full-depth profit is below this — nobody bothers with sub-
// 100k-ISK deals, and it removes ~60% of candidate pairs (a noise tail worth
// ~0.6% of total profit) before the expensive route resolution. Route-free, so
// it lives in the cached discovery stage. See `npm run floor` for the evidence.
export const MIN_PROFIT = 100_000;
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
export function poolBidsForDrop(dests: StationOrders[], drop: StationOrders): Order[] {
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

/** Tunable discovery limits (perf guards). Defaults are the production values. */
export interface DiscoveryLimits {
  maxSources: number;
  maxDests: number;
  maxPairs: number;
  maxTotal: number;
  /** Minimum full-depth profit (ISK) to keep a haul. Diagnostics pass 0. */
  minProfit: number;
}
export const DEFAULT_LIMITS: DiscoveryLimits = {
  maxSources: MAX_SOURCES_PER_TYPE,
  maxDests: MAX_DESTS_PER_TYPE,
  maxPairs: MAX_PAIRS_PER_TYPE,
  maxTotal: MAX_OPPORTUNITIES,
  minProfit: MIN_PROFIT,
};

/** Every profitable source→dest pair for one item type (most profitable first). */
function opportunitiesForType(
  typeId: number,
  name: string,
  unitVolume: number,
  book: TypeBook,
  limits: DiscoveryLimits = DEFAULT_LIMITS,
): ArbitrageOpportunity[] {
  const tax = DEFAULT_SALES_TAX;
  const dearestBuy = book.buys[0]?.best ?? -Infinity;
  // Quick reject: if the dearest buy can't beat the cheapest sell, nothing here.
  if (book.sells.length === 0 || dearestBuy * (1 - tax) <= (book.sells[0]?.best ?? Infinity)) return [];

  const sources = book.sells.slice(0, limits.maxSources);
  const dests = book.buys.slice(0, limits.maxDests);
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
      if (profit <= 0 || profit < limits.minProfit) continue;
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
  return out.length > limits.maxPairs ? out.slice(0, limits.maxPairs) : out;
}

/**
 * Resolve every profitable haul in the current snapshot (no routes). The limits
 * default to the production values; the diagnostic comparison overrides them
 * (e.g. uncapped, or a cap-sensitivity sweep) to see the full discovery set.
 */
export function resolveOpportunities(
  byType: Map<number, TypeBook>,
  limits: Partial<DiscoveryLimits> = {},
): ArbitrageOpportunity[] {
  const lim: DiscoveryLimits = { ...DEFAULT_LIMITS, ...limits };
  const all: ArbitrageOpportunity[] = [];
  for (const [typeId, book] of byType) {
    const type = getType(typeId);
    if (!type) continue;
    all.push(...opportunitiesForType(typeId, type.name, type.volume, book, lim));
  }
  all.sort((a, b) => b.profit - a.profit);
  return all.length > lim.maxTotal ? all.slice(0, lim.maxTotal) : all;
}

// --- Step 2: cache the resolved opportunities (keyed by the market snapshot) --
//
// Only the route-free opportunities are cached. Routes are NOT cached here —
// they're resolved on every request, which is cheap because the actual graph
// search is memoised per (source, dest, type) by routing.ts's routeCache; a
// request only re-runs the light toRouteSystems mapping.

let opportunitiesSnapshotAt = -1;
let opportunities: ArbitrageOpportunity[] = [];

/**
 * Cached route-free opportunities, rebuilt only when the snapshot changes.
 * Production is **uncapped by count** (only the 100k profit floor applies) — the
 * route + attractivity stage in getEnrichedArbitrage truncates to the shipped
 * top-N. The MAX_PAIRS/MAX_OPPORTUNITIES caps remain available for the offline
 * diagnostics but are not applied here.
 */
function getOpportunities(): ArbitrageOpportunity[] {
  const snap = getSnapshot();
  if (!snap) return [];
  if (snap.builtAt !== opportunitiesSnapshotAt) {
    opportunities = resolveOpportunities(snap.byType, { maxPairs: Infinity, maxTotal: Infinity });
    opportunitiesSnapshotAt = snap.builtAt;
  }
  return opportunities;
}

/**
 * Pre-warm the route cache for the snapshot's delivery legs (source→dest system),
 * which are origin-independent and shared by every request/user. Run in the
 * background after each crawl so the first request never pays the ~6–14s of cold
 * graph searches synchronously. Yields to the event loop periodically so it never
 * blocks request handling. Approach legs (origin→source) stay lazy (per-origin).
 */
export async function prewarmDeliveryRoutes(): Promise<void> {
  const seen = new Set<string>();
  const pairs: [number, number][] = [];
  for (const o of getOpportunities()) {
    const s = o.source.systemId;
    const d = o.dest.systemId;
    if (s === null || d === null) continue;
    const k = `${s}-${d}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pairs.push([s, d]);
  }
  let i = 0;
  for (const [s, d] of pairs) {
    getRoute(s, d, 'shortest');
    getRoute(s, d, 'safest');
    if (++i % 500 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// --- Step 3: per-request candidates (scale + route + jumps/danger) ------------
// The combined courier+arbitrage scoring/truncation lives in hauling.ts; here we
// just produce the arbitrage candidate set it ranks.

export interface CandidateParams {
  routeType: RouteType;
  /** Current system, or null (no approach leg). */
  origin: number | null;
  /** Usable cargo m³ (Infinity = unconstrained). */
  capacity: number;
  /** Wallet ISK ceiling (Infinity = unconstrained). */
  balance: number;
  /** Sales tax percent (e.g. 4.5) to re-price profit to. */
  taxPct: number;
}

/** A floored opportunity scaled to the requester, routed, with jumps/danger as
 *  numbers and the route ids (full RouteSystem[] is materialised later, only for
 *  shipped items). */
export interface ArbitrageCandidate {
  opp: Scaled<ArbitrageOpportunity>;
  deliveryIds: number[];
  approachIds: number[] | null;
  totalJumps: number;
  danger: number;
  dangerSteps: string[];
}

/**
 * Every floored opportunity re-priced to the user's tax, scaled to their
 * cargo/wallet, and routed (jumps + danger from cached paths). Drops anything
 * that doesn't fit the hold/wallet or isn't reachable. No RouteSystem[] built
 * here — that's only for the shipped top-N (see materializeArbitrageItem).
 */
export function buildArbitrageCandidates(params: CandidateParams, kills: Map<number, number>): ArbitrageCandidate[] {
  if (!getSnapshot()) return [];
  const taxFraction = params.taxPct / 100;
  const out: ArbitrageCandidate[] = [];
  for (const raw of getOpportunities()) {
    const scaled = scaleArbitrage(repriceForTax(raw, taxFraction), params.capacity, params.balance);
    if (!scaled) continue; // nothing fits the hold/wallet
    const srcSys = scaled.source.systemId;
    const dstSys = scaled.dest.systemId;
    if (srcSys === null || dstSys === null) continue;

    const deliveryIds = getRoute(srcSys, dstSys, params.routeType);
    if (!deliveryIds) continue; // can't haul source → dest
    let approachIds: number[] | null = null;
    if (params.origin !== null) {
      approachIds = getRoute(params.origin, srcSys, params.routeType);
      if (!approachIds) continue; // can't reach the buy station from here
    }

    const totalJumps =
      Math.max(0, deliveryIds.length - 1) + (approachIds ? Math.max(0, approachIds.length - 1) : 0);
    // Danger over the route actually flown (approach + delivery, shared seam dropped).
    const dangerRoute = approachIds ? [...approachIds, ...deliveryIds.slice(1)] : deliveryIds;
    const { index: danger, steps: dangerSteps } = dangerForSystems(dangerRoute, kills);

    out.push({ opp: scaled, deliveryIds, approachIds, totalJumps, danger, dangerSteps });
  }
  return out;
}

/** Materialise a candidate's full RouteSystem[] legs into a shippable item. */
export function materializeArbitrageItem(c: ArbitrageCandidate, kills: Map<number, number>): ScaledArbitrageItem {
  return {
    ...c.opp,
    approachRoute: c.approachIds ? toRouteSystems(c.approachIds, kills) : null,
    deliveryRoute: toRouteSystems(c.deliveryIds, kills),
  };
}

/**
 * Recheck pinned hauls against the live book, NETTING shared depth: hauls are
 * walked in pin order against one shared pool of remaining order volume (keyed by
 * ESI order id), so two hauls leaning on the same cheap asks/dearest bids don't
 * both claim them — the first reserves the cheap depth, the next prices up the
 * ladder. Each haul also reports the live order IDs backing it, so identity-based
 * staleness (specific orders gone) can be flagged against the IDs last seen.
 *
 * A PLANNING haul is re-optimized to the max-income quantity that fits the
 * requester's CURRENT cargo (`capacity` m³) and wallet (`balance` ISK) against
 * the live book — same item/source/dest, only the orders and those settings
 * change. Cargo/wallet are applied per-haul (as the grid scales each opportunity
 * independently); the netting ledger only prevents two hauls double-claiming the
 * same order. A TRANSIT haul is already bought, so it keeps its fixed quantity
 * and only re-prices the sell side.
 */
export function resolvePinnedHaulsStatus(
  hauls: PinnedHaulStatusRequest[],
  opts: {
    capacity?: number;
    balance?: number;
    taxFraction?: number;
    origin: number | null;
    routeType: 'safest' | 'shortest';
    kills: Map<number, number>;
  },
): PinnedHaulStatusResponse[] {
  const snap = getSnapshot();
  if (!snap) return [];
  const tax = opts.taxFraction ?? DEFAULT_SALES_TAX;
  const capacity = opts.capacity ?? Infinity;
  const balance = opts.balance ?? Infinity;

  const out: PinnedHaulStatusResponse[] = [];

  for (const h of hauls) {
    // Per-haul remaining-volume ledger — each pinned haul evaluates the order
    // book independently so pins don't consume each other's orders.
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
    const book = snap.byType.get(h.typeId);
    const asks = book?.sells.find((s) => s.station === h.source)?.orders ?? [];
    // Range-aware destination depth: every bid reachable from the drop station,
    // not just those physically resting at it.
    const destSystem = book?.buys.find((b) => b.station === h.dest)?.system ?? getStation(h.dest)?.systemId ?? null;
    const buySystem = book?.sells.find((s) => s.station === h.source)?.system ?? getStation(h.source)?.systemId ?? null;
    // Pool from the full buy book (not the MAX_DESTS perf-guard slice): there are
    // only a handful of pinned hauls, so accuracy beats the bound here.
    const bids =
      book && destSystem !== null
        ? poolBidsForDrop(book.buys, { station: h.dest, system: destSystem, best: -Infinity, orders: [] })
        : [];

    const target = h.quantity;
    let quantity = 0;
    let buyCost = 0;
    let sellRevenueGross = 0;
    const ladder: ArbitrageRung[] = [];
    const srcIds = new Set<number>();
    const dstIds = new Set<number>();

    if (h.status === 'planning') {
      // Max-income walk: keep taking profitable units until the marginal unit
      // stops being profitable OR the cargo hold / wallet runs out. No fixed
      // target — the quantity is re-derived from the current market + settings.
      const uVol = h.unitVolume && h.unitVolume > 0 ? h.unitVolume : 0;
      const cargoUnitCap = capacity === Infinity || uVol === 0 ? Infinity : Math.floor(capacity / uVol);
      let walletRem = balance;
      let ai = 0;
      let bi = 0;
      while (ai < asks.length && bi < bids.length) {
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
        const cargoRoom = cargoUnitCap === Infinity ? Infinity : cargoUnitCap - quantity;
        if (cargoRoom <= 0) break; // hold full
        const walletRoom = walletRem === Infinity ? Infinity : ask.price > 0 ? Math.floor(walletRem / ask.price) : Infinity;
        if (walletRoom <= 0) break; // can't afford the next unit
        const batch = Math.min(askA, bidA, cargoRoom, walletRoom);
        if (batch <= 0) break;
        quantity += batch;
        buyCost += batch * ask.price;
        sellRevenueGross += batch * bid.price;
        if (walletRem !== Infinity) walletRem -= batch * ask.price;
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

    const buyerGone = bids.length === 0;
    const supplyGone = h.status === 'planning' && asks.length === 0;

    // --- Recalculate routes and metrics on the back-end ---
    let approachRoute: RouteSystem[] | null = null;
    let deliveryRoute: RouteSystem[] = [];
    let jumpsFromCurrent: number | null = null;
    let jumpsToDest: number | null = null;
    let totalJumps: number | null = null;
    let profitPerJump: number | null = null;
    let danger = 0;
    let dangerSteps: string[] = [];

    if (buySystem !== null && destSystem !== null) {
      let approachIds: number[] | null = null;
      let deliveryIds: number[] | null = null;

      if (h.status === 'planning') {
        deliveryIds = getRoute(buySystem, destSystem, opts.routeType);
        if (opts.origin !== null) {
          approachIds = getRoute(opts.origin, buySystem, opts.routeType);
        }
      } else {
        // transit: items are in ship, route starts from current origin -> dest
        if (opts.origin !== null) {
          deliveryIds = getRoute(opts.origin, destSystem, opts.routeType);
        } else {
          deliveryIds = getRoute(buySystem, destSystem, opts.routeType);
        }
      }

      if (deliveryIds) {
        deliveryRoute = toRouteSystems(deliveryIds, opts.kills);
        jumpsToDest = Math.max(0, deliveryIds.length - 1);
      }
      if (approachIds) {
        approachRoute = toRouteSystems(approachIds, opts.kills);
        jumpsFromCurrent = Math.max(0, approachIds.length - 1);
      }

      totalJumps = (jumpsFromCurrent ?? 0) + (jumpsToDest ?? 0);
      profitPerJump = totalJumps > 0 ? profit / totalJumps : null;

      const dangerRoute = approachIds ? [...approachIds, ...(deliveryIds ? deliveryIds.slice(1) : [])] : (deliveryIds ?? []);
      const { index, steps } = dangerForSystems(dangerRoute, opts.kills);
      danger = index;
      dangerSteps = steps;
    }

    // --- Visual comparisons against baseline ---
    const baselineIncome = h.originalProfit !== undefined ? h.originalProfit : profit;
    let statusKind: 'up' | 'down' | 'zero' | null = null;
    let borderColor = 'primary.main';
    let statusMessage = '';

    if (profit <= 0) {
      statusKind = 'zero';
      borderColor = 'error.main';
      const why = buyerGone
        ? ' (bids at the destination are gone)'
        : supplyGone
          ? ' (sell orders at the source are gone)'
          : '';
      if (h.status === 'transit') {
        statusMessage = `Income is negative: ${formatIskMillions(baselineIncome)} → ${formatIskMillions(profit)}${why}. You can sell at a loss or find an alternative destination.`;
      } else {
        statusMessage = `Income dropped to zero: ${formatIskMillions(baselineIncome)} → ${formatIskMillions(profit)}${why}. You can still confirm the buy/price you actually paid.`;
      }
    } else if (profit > baselineIncome * 1.03) {
      statusKind = 'up';
      borderColor = 'success.main';
      const staleNote = stale ? 'Orders changed — ' : '';
      statusMessage = `${staleNote}Income up: ${formatIskMillions(baselineIncome)} → ${formatIskMillions(profit)} (${formatNumber(quantity, 0)} units).`;
    } else if (profit < baselineIncome * 0.97) {
      statusKind = 'down';
      borderColor = 'warning.main';
      const staleNote = stale ? 'Orders changed — ' : '';
      statusMessage = `${staleNote}Income down: ${formatIskMillions(baselineIncome)} → ${formatIskMillions(profit)} (${formatNumber(quantity, 0)} units).`;
    }

    out.push({
      id: h.id,
      quantity,
      buyPrice,
      sellPrice,
      profit,
      marginPct,
      // Planning is re-optimized (no fixed target), so "shortfall" only applies
      // to transit: cargo already bought that the live bids can't fully absorb.
      shortfall: h.status === 'transit' && quantity < target,
      buyerGone,
      supplyGone,
      stale,
      ladder,
      sourceOrderIds,
      destOrderIds,
      approachRoute,
      deliveryRoute,
      jumpsFromCurrent,
      jumpsToDest,
      totalJumps,
      profitPerJump,
      danger,
      dangerSteps,
      statusKind,
      statusMessage,
      borderColor,
    });
  }

  return out;
}

function formatNumber(value: number, maxFractionDigits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const negative = value < 0;
  const abs = Math.abs(value);
  const factor = 10 ** maxFractionDigits;
  const rounded = Math.round(abs * factor) / factor;
  const [intPart, fracPart] = rounded.toFixed(maxFractionDigits).split('.');
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmedFrac = fracPart ? fracPart.replace(/0+$/, '') : '';
  const body = trimmedFrac ? `${groupedInt}.${trimmedFrac}` : groupedInt;
  return negative ? `-${body}` : body;
}

function formatIskMillions(value: number): string {
  return `${formatNumber(value / 1_000_000, 2)} M ISK`;
}

/** Order-id set equality (order-independent). */
function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

// --- Sell-destination search (liquidate cargo carried in transit) -------------

export interface SellDestinationParams {
  /** Item carried in the ship. */
  typeId: number;
  /** Units in the hold (the most you could offload). */
  quantity: number;
  /** What you paid per unit (sunk cost — same everywhere, so it only sets P/L). */
  boughtPrice: number;
  /** Current system — every route/jumps/danger figure is measured from here. */
  origin: number;
  routeType: RouteType;
  taxPct: number;
  weights: AttractivityWeights;
  /** Max cards returned (UX cap; the search itself isn't capped). */
  limit?: number;
}

/** A routed, attractivity-scored place to sell the carried cargo. Shaped like a
 *  shipped arbitrage item so the client reuses the arbitrage card to render it. */
export type SellDestinationItem = ScaledArbitrageItem & {
  danger: number;
  dangerSteps: string[];
  attractivity: number;
};

/** How many destinations we route per request. Routing from the current location
 *  isn't pre-warmed (unlike the opportunity delivery legs), so we price every
 *  market but only route the strongest by raw income — the long tail of low-income
 *  markets can't win under income-weighted scoring anyway. */
const SELL_DEST_ROUTE_BUDGET = 50;
const DEFAULT_SELL_DEST_LIMIT = 24;

/** A synthetic "your ship" endpoint for the buy side (the cargo is already aboard;
 *  the card renders this as "In ship"). */
function shipEndpoint(systemId: number): ContractEndpoint {
  const system = getSystem(systemId);
  return {
    locationId: 0,
    name: 'Your ship',
    systemName: system?.name ?? null,
    systemId,
    security: system?.security ?? null,
    securityBand: system ? securityBand(system.security) : null,
    resolved: false,
  };
}

/**
 * Find where the cargo carried in transit can be sold, ranked by the same
 * attractivity weights as the hauling list. For each destination SYSTEM we take
 * the drop station that liquidates the most value (range-aware bid pool), sell up
 * to the held quantity best-bid-first (no profitability break — dumping owned
 * stock), route it from the current location, score danger, and rank. "Best
 * available" — loss-making destinations are included (they just rank low under an
 * income weight); the client colours non-positive income red.
 */
export function resolveSellDestinations(params: SellDestinationParams, kills: Map<number, number>): SellDestinationItem[] {
  const snap = getSnapshot();
  if (!snap) return [];
  const book = snap.byType.get(params.typeId);
  if (!book || book.buys.length === 0) return [];

  const type = getType(params.typeId);
  const unitVolume = type?.volume ?? 0;
  const name = type?.name ?? `Type ${params.typeId}`;
  const marketPrice = getMarketPrice(params.typeId);
  const tax = params.taxPct / 100;
  const Q = params.quantity;
  const X = params.boughtPrice;

  // Best liquidation per destination system (the drop station yielding the most
  // gross revenue for up to Q units).
  interface Liq {
    drop: StationOrders;
    sellableQty: number;
    revenueGross: number;
    ladder: ArbitrageRung[];
  }
  const bestBySystem = new Map<number, Liq>();
  for (const drop of book.buys) {
    const bids = poolBidsForDrop(book.buys, drop);
    let qty = 0;
    let revenueGross = 0;
    const ladder: ArbitrageRung[] = [];
    for (let bi = 0; bi < bids.length && qty < Q; bi++) {
      const bid = bids[bi];
      const take = Math.min(bid.volume, Q - qty);
      if (take <= 0) continue;
      qty += take;
      revenueGross += take * bid.price;
      if (ladder.length < MAX_LADDER_RUNGS) ladder.push({ units: take, buy: X, sell: bid.price });
    }
    if (qty <= 0) continue;
    const existing = bestBySystem.get(drop.system);
    if (!existing || revenueGross > existing.revenueGross) {
      bestBySystem.set(drop.system, { drop, sellableQty: qty, revenueGross, ladder });
    }
  }

  // Route only the strongest candidates by raw income (routing bound, not a
  // results cap — see SELL_DEST_ROUTE_BUDGET).
  const ranked = [...bestBySystem.values()].sort((a, b) => b.revenueGross - a.revenueGross).slice(0, SELL_DEST_ROUTE_BUDGET);

  const items: SellDestinationItem[] = [];
  for (const liq of ranked) {
    const destSys = liq.drop.system;
    const deliveryIds = getRoute(params.origin, destSys, params.routeType);
    if (!deliveryIds) continue; // unreachable from here

    const { index: danger, steps: dangerSteps } = dangerForSystems(deliveryIds, kills);

    const sellableQty = liq.sellableQty;
    const buyCost = X * sellableQty;
    const profit = liq.revenueGross * (1 - tax) - buyCost; // realized on what sells

    items.push({
      id: `sell:${params.typeId}:${liq.drop.station}`,
      typeId: params.typeId,
      itemName: name,
      quantity: sellableQty,
      unitVolume,
      totalVolume: sellableQty * unitVolume,
      buyPrice: X,
      sellPrice: sellableQty > 0 ? liq.revenueGross / sellableQty : 0,
      marketPrice,
      buyCost,
      profit,
      marginPct: buyCost > 0 ? (profit / buyCost) * 100 : 0,
      ladder: liq.ladder,
      salesTax: tax,
      source: shipEndpoint(params.origin),
      dest: resolveEndpoint(liq.drop.station, destSys),
      approachRoute: null,
      deliveryRoute: toRouteSystems(deliveryIds, kills),
      fullQuantity: sellableQty,
      fullTotalVolume: sellableQty * unitVolume,
      limited: sellableQty < Q,
      // Attached below once the whole set is scored together.
      danger,
      dangerSteps,
      attractivity: 0,
    });
  }

  // Score the routed set together (one normalisation), like the hauling list.
  const scores = scoreAttractivity(
    items.map((it) => ({ income: it.profit, totalJumps: it.deliveryRoute.length - 1, danger: it.danger })),
    params.weights,
  );
  items.forEach((it, i) => (it.attractivity = scores[i]));
  items.sort((a, b) => b.attractivity - a.attractivity);

  return items.slice(0, params.limit ?? DEFAULT_SELL_DEST_LIMIT);
}
