// Buy-here/sell-there arbitrage finder. For each item type it considers the few
// cheapest sell stations against the few dearest buy stations (within any
// from/to system filter), walks each candidate pair's order books to size a
// haul — capped by depth, cargo and capital — and applies the jump/route filter
// *during* selection so a usable nearby haul isn't lost to a far-off best-price
// pair. It keeps the most profitable valid pair per item. Routing + danger reuse
// the shared engine; attractivity scoring stays on the client.
import { getShipKills } from './kills.js';
import { getRoute, jumpsFromRoute } from './routing.js';
import { resolveEndpoint, toRouteSystems } from './enrich.js';
import { computeDanger } from './danger.js';
import { getType } from './sde.js';
import { getMarketMeta, getSnapshot, type MarketMeta, type Order, type StationOrders, type TypeBook } from './market.js';
import type { ArbitrageFilters, ArbitrageItem } from './types.js';

// Rows returned to the client. Larger than a page so the client's margin /
// profit-per-jump sorts operate on a representative set, not just the top
// absolute-profit hauls.
const MAX_RESULTS = 150;
// Per item, how many cheapest-sell and dearest-buy stations to pair up (K×K
// candidates). Higher catches deep-but-not-cheapest stations and nearer hauls
// at the cost of more per-item work.
const K = 5;

interface RawOpportunity {
  typeId: number;
  quantity: number;
  buyCost: number;
  sellRevenueGross: number;
  profit: number;
  source: StationOrders;
  dest: StationOrders;
  routeIds: number[];
  jumps: number | null;
}

/** Best-priced station passing the system filter (stations are pre-sorted). */
function firstPassing(stations: StationOrders[], systemFilter: number | null): StationOrders | null {
  if (systemFilter === null) return stations[0] ?? null;
  for (const s of stations) if (s.system === systemFilter) return s;
  return null;
}

/**
 * The K best-priced stations for one leg. Stations are already grouped and
 * sorted by best price in the snapshot, so this is just a filtered top-K.
 */
function topStations(stations: StationOrders[], systemFilter: number | null): StationOrders[] {
  if (systemFilter === null) return stations.slice(0, K);
  const out: StationOrders[] = [];
  for (const s of stations) {
    if (s.system !== systemFilter) continue;
    out.push(s);
    if (out.length === K) break;
  }
  return out;
}

/** Size one haul by walking asks (ascending) against bids (descending). */
function walkDepth(
  asks: Order[],
  bids: Order[],
  unitVolume: number,
  filters: ArbitrageFilters,
): { quantity: number; buyCost: number; sellRevenueGross: number } {
  const tax = filters.salesTaxRate;
  const maxInvest = filters.maxInvestment ?? Infinity;
  let cargoUnitsLeft = filters.maxCargo !== null ? Math.floor(filters.maxCargo / unitVolume) : Infinity;
  let budgetLeft = maxInvest;

  let ai = 0;
  let bi = 0;
  let askRem = asks[0]?.volume ?? 0;
  let bidRem = bids[0]?.volume ?? 0;
  let quantity = 0;
  let buyCost = 0;
  let sellRevenueGross = 0;

  while (ai < asks.length && bi < bids.length && cargoUnitsLeft > 0 && budgetLeft > 0) {
    const ask = asks[ai].price;
    const bid = bids[bi].price;
    if (bid * (1 - tax) <= ask) break; // marginal unit no longer profitable
    const affordable = Math.floor(budgetLeft / ask);
    if (affordable <= 0) break;

    const batch = Math.min(askRem, bidRem, cargoUnitsLeft, affordable);
    if (batch <= 0) break;

    quantity += batch;
    buyCost += batch * ask;
    sellRevenueGross += batch * bid;
    budgetLeft -= batch * ask;
    cargoUnitsLeft -= batch;
    askRem -= batch;
    bidRem -= batch;
    if (askRem === 0) askRem = asks[++ai]?.volume ?? 0;
    if (bidRem === 0) bidRem = bids[++bi]?.volume ?? 0;
  }

  return { quantity, buyCost, sellRevenueGross };
}

interface Candidate {
  quantity: number;
  buyCost: number;
  sellRevenueGross: number;
  profit: number;
  source: StationOrders;
  dest: StationOrders;
}

/**
 * The most profitable valid pair for one item: among profitable candidate pairs
 * (highest profit first), the first that is reachable and within the jump cap.
 * Routing the candidates in profit order means we usually route just once.
 */
function bestPairForType(book: TypeBook, unitVolume: number, filters: ArbitrageFilters): RawOpportunity | null {
  const tax = filters.salesTaxRate;

  // Cheap reject: the best possible price gap (within the filter) can't profit.
  const bestSell = firstPassing(book.sells, filters.fromSystemId);
  const bestBuy = firstPassing(book.buys, filters.toSystemId);
  if (!bestSell || !bestBuy || bestBuy.best * (1 - tax) <= bestSell.best) return null;

  const sources = topStations(book.sells, filters.fromSystemId);
  const dests = topStations(book.buys, filters.toSystemId);

  const candidates: Candidate[] = [];
  for (const source of sources) {
    for (const dest of dests) {
      if (source.station === dest.station) continue;
      if (dest.best * (1 - tax) <= source.best) continue; // this pair can't profit
      const { quantity, buyCost, sellRevenueGross } = walkDepth(source.orders, dest.orders, unitVolume, filters);
      if (quantity <= 0) continue;
      const profit = sellRevenueGross * (1 - tax) - buyCost;
      if (profit <= 0) continue;
      candidates.push({ quantity, buyCost, sellRevenueGross, profit, source, dest });
    }
  }

  candidates.sort((a, b) => b.profit - a.profit);

  for (const c of candidates) {
    const routeIds = getRoute(c.source.system, c.dest.system, filters.routeType);
    if (!routeIds) continue; // unreachable — not a haul
    const jumps = jumpsFromRoute(routeIds);
    if (filters.maxJumps !== null && jumps !== null && jumps > filters.maxJumps) continue;
    return { typeId: 0, ...c, routeIds, jumps };
  }
  return null;
}

export interface ArbitrageResponse {
  items: ArbitrageItem[];
  meta: MarketMeta;
}

export async function findArbitrage(filters: ArbitrageFilters): Promise<ArbitrageResponse> {
  const meta = getMarketMeta();
  const snap = getSnapshot();
  if (!snap) return { items: [], meta };

  const opportunities: RawOpportunity[] = [];
  for (const [typeId, book] of snap.byType) {
    const type = getType(typeId);
    if (!type || book.sells.length === 0 || book.buys.length === 0) continue;
    const best = bestPairForType(book, type.volume, filters);
    if (best) opportunities.push({ ...best, typeId });
  }

  opportunities.sort((a, b) => b.profit - a.profit);

  const kills = await getShipKills();
  const items: ArbitrageItem[] = opportunities.slice(0, MAX_RESULTS).map((op) => {
    const route = toRouteSystems(op.routeIds, kills);
    const danger = computeDanger(route);
    const type = getType(op.typeId)!;
    return {
      id: `${op.typeId}:${op.source.station}:${op.dest.station}`,
      typeId: op.typeId,
      itemName: type.name,
      quantity: op.quantity,
      unitVolume: type.volume,
      totalVolume: op.quantity * type.volume,
      buyPrice: op.buyCost / op.quantity,
      sellPrice: op.sellRevenueGross / op.quantity,
      buyCost: op.buyCost,
      profit: op.profit,
      marginPct: (op.profit / op.buyCost) * 100,
      source: resolveEndpoint(op.source.station, op.source.system),
      dest: resolveEndpoint(op.dest.station, op.dest.system),
      jumps: op.jumps,
      route,
      profitPerJump: op.jumps === null ? null : op.jumps === 0 ? op.profit : op.profit / op.jumps,
      danger: danger.index,
      dangerSteps: danger.steps,
    };
  });

  return { items, meta };
}
