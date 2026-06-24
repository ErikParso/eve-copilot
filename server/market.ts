// Region market order books, crawled from ESI and held in memory as one global
// index keyed by item type. There is no "all orders" ESI endpoint, so we fan
// out over every region's paginated /markets/{region}/orders/ feed (CCP-cached
// ~5 min) and merge it. Refreshed on a timer so all clients share one crawl.
import { esiGet, esiGetPaged, mapWithConcurrency, EsiError } from './esi.js';
import { getType } from './sde.js';

/**
 * Buy-order reach, normalised so arbitrage can resolve which sell location can
 * fill a bid (see RANGE_* constants). Sell orders are always RANGE_STATION.
 */
export const RANGE_REGION = -1;
export const RANGE_SYSTEM = -2;
export const RANGE_STATION = 0;
// n > 0 = within n stargate jumps of the order's station.

/** One market order, trimmed to what arbitrage needs. */
export interface Order {
  /** ESI order_id — stable across crawls, so a pinned order can be tracked. */
  id: number;
  price: number;
  /** Units still available on this order. */
  volume: number;
  /** Station/structure the order sits at. */
  locationId: number;
  systemId: number;
  /**
   * Buy-order reach: RANGE_REGION (-1), RANGE_SYSTEM (-2), RANGE_STATION (0), or
   * n>0 jumps. Irrelevant for sell orders (always RANGE_STATION).
   */
  rangeCode: number;
}

/** All orders of one item type at one station, sorted (asks asc / bids desc). */
export interface StationOrders {
  station: number;
  system: number;
  /** Best price at this station: cheapest ask (sells) or dearest bid (buys). */
  best: number;
  orders: Order[];
}

/**
 * One item type's order book, grouped by station and pre-sorted so arbitrage
 * never has to re-scan raw orders per request: `sells` is sorted by cheapest
 * station first, `buys` by dearest station first.
 */
export interface TypeBook {
  sells: StationOrders[];
  buys: StationOrders[];
}

interface RawOrder {
  order_id: number;
  type_id: number;
  price: number;
  volume_remain: number;
  location_id: number;
  system_id: number;
  is_buy_order: boolean;
  range: string;
}

export type MarketStatus = 'cold' | 'warming' | 'ready';

interface Snapshot {
  byType: Map<number, TypeBook>;
  builtAt: number;
  lastModifiedAt: number | null;
  orderCount: number;
  regions: number;
}

// Kept above ESI's 15-minute market-order rate-limit window (12000 req/15m) so a
// scheduled refresh never overlaps the previous one inside a single window. A
// full all-region crawl is only ~1700 requests, so one crawl per window sits
// comfortably under budget; the underlying ESI feed is itself CCP-cached ~5 min,
// so the data isn't meaningfully fresher than this anyway.
const REFRESH_MS = 20 * 60 * 1000;
const REGION_CONCURRENCY = 5;
const PAGE_CONCURRENCY = 10;

let snapshot: Snapshot | null = null;
let status: MarketStatus = 'cold';
let crawling: Promise<void> | null = null;

function rangeCode(range: string): number {
  if (range === 'region') return RANGE_REGION;
  if (range === 'solarsystem') return RANGE_SYSTEM;
  if (range === 'station') return RANGE_STATION;
  const n = Number(range);
  return Number.isFinite(n) && n > 0 ? n : RANGE_STATION;
}

async function fetchRegionOrders(
  regionId: number,
  onOrders: (orders: RawOrder[]) => void
): Promise<number | null> {
  try {
    const first = await esiGetPaged<RawOrder[]>(`/markets/${regionId}/orders/`, 1);
    onOrders(first.data);
    if (first.pages > 1) {
      const pages = Array.from({ length: first.pages - 1 }, (_, i) => i + 2);
      await mapWithConcurrency(pages, PAGE_CONCURRENCY, async (page) => {
        const res = await esiGetPaged<RawOrder[]>(`/markets/${regionId}/orders/`, page);
        onOrders(res.data);
        return null;
      });
    }
    return first.lastModified;
  } catch (err) {
    if (err instanceof EsiError && err.status === 404) {
      // Regions with no market (e.g. wormhole space) 404 — skip silently.
      return null;
    }
    console.error(`[Market Crawl] Error fetching region ${regionId}:`, err);
    return null;
  }
}

/** Raw per-station accumulators for one type while crawling (Map<station, orders>). */
interface TypeBuild {
  sells: Map<number, Order[]>;
  buys: Map<number, Order[]>;
}

/** Group a station map into best-price-sorted StationOrders (asks asc / bids desc). */
function buildStations(byStation: Map<number, Order[]>, ascending: boolean): StationOrders[] {
  const stations: StationOrders[] = [];
  for (const orders of byStation.values()) {
    orders.sort((a, b) => (ascending ? a.price - b.price : b.price - a.price));
    stations.push({ station: orders[0].locationId, system: orders[0].systemId, best: orders[0].price, orders });
  }
  stations.sort((a, b) => (ascending ? a.best - b.best : b.best - a.best));
  return stations;
}

async function crawl(): Promise<Snapshot> {
  const regionIds = await esiGet<number[]>('/universe/regions/');
  console.log(`[Market Crawl] Starting crawl for ${regionIds.length} regions...`);
  const building = new Map<number, TypeBuild>();
  let orderCount = 0;
  let lastModifiedAt: number | null = null;
  let regions = 0;
  let regionsParsed = 0;

  const buildFor = (typeId: number): TypeBuild => {
    let b = building.get(typeId);
    if (!b) {
      b = { sells: new Map(), buys: new Map() };
      building.set(typeId, b);
    }
    return b;
  };

  await mapWithConcurrency(regionIds, REGION_CONCURRENCY, async (regionId) => {
    let regionHasOrders = false;
    const lastModified = await fetchRegionOrders(regionId, (chunk) => {
      if (chunk.length === 0) return;
      regionHasOrders = true;
      for (const o of chunk) {
        // Skip orders for unpublished or zero-volume items to save massive heap overhead
        const typeInfo = getType(o.type_id);
        if (!typeInfo) continue;

        const entry: Order = {
          id: o.order_id,
          price: o.price,
          volume: o.volume_remain,
          locationId: o.location_id,
          systemId: o.system_id,
          rangeCode: o.is_buy_order ? rangeCode(o.range) : RANGE_STATION,
        };
        const byStation = (o.is_buy_order ? buildFor(o.type_id).buys : buildFor(o.type_id).sells);
        const arr = byStation.get(o.location_id);
        if (arr) arr.push(entry);
        else byStation.set(o.location_id, [entry]);
        orderCount++;
      }
    });

    regionsParsed++;
    if (regionHasOrders) {
      regions++;
      if (lastModified !== null && (lastModifiedAt === null || lastModified < lastModifiedAt)) {
        // Oldest region snapshot is the honest "data as of" — the list is only as
        // fresh as its stalest part.
        lastModifiedAt = lastModified;
      }
    }
    if (regionsParsed % 10 === 0 || regionsParsed === regionIds.length) {
      console.log(`[Market Crawl] Progress: ${regionsParsed}/${regionIds.length} regions parsed (${orderCount.toLocaleString()} orders found)...`);
    }
  });

  // Group each type's orders by station and pre-sort, once, here — so requests
  // never re-scan raw orders.
  console.log(`[Market Crawl] Grouping and sorting order books...`);
  const byType = new Map<number, TypeBook>();
  for (const [typeId, b] of building) {
    byType.set(typeId, { sells: buildStations(b.sells, true), buys: buildStations(b.buys, false) });
  }
  console.log(`[Market Crawl] Finished! Cached ${orderCount.toLocaleString()} orders across ${byType.size} types in ${regions} active regions.`);

  return { byType, builtAt: Date.now(), lastModifiedAt, orderCount, regions };
}

/** Callbacks fired (best-effort) after each successful crawl — e.g. route pre-warm. */
const refreshListeners: Array<() => void> = [];
export function onMarketRefresh(fn: () => void): void {
  refreshListeners.push(fn);
}

async function refresh(): Promise<void> {
  if (crawling) return crawling;
  if (status === 'cold') status = 'warming';
  crawling = crawl()
    .then((next) => {
      snapshot = next;
      status = 'ready';
      for (const fn of refreshListeners) {
        try {
          fn();
        } catch (err) {
          console.error('Market refresh listener failed', err);
        }
      }
    })
    .catch((err) => {
      console.error('Market crawl failed', err);
      if (!snapshot) status = 'cold';
    })
    .finally(() => {
      crawling = null;
    });
  return crawling;
}

/** Start the periodic market crawl (and the first one now). */
export function startMarketRefresh(): void {
  void refresh();
  setInterval(() => void refresh(), REFRESH_MS).unref();
}

export interface MarketMeta {
  status: MarketStatus;
  builtAt: number | null;
  lastModifiedAt: number | null;
  orderCount: number;
  regions: number;
}

export function getMarketMeta(): MarketMeta {
  return {
    status,
    builtAt: snapshot?.builtAt ?? null,
    lastModifiedAt: snapshot?.lastModifiedAt ?? null,
    orderCount: snapshot?.orderCount ?? 0,
    regions: snapshot?.regions ?? 0,
  };
}

/** The current order-book snapshot, or null if the first crawl isn't done. */
export function getSnapshot(): Snapshot | null {
  return snapshot;
}

/** JSON-serializable form of the current snapshot (Map flattened to entries). */
export interface SerializedSnapshot {
  builtAt: number;
  lastModifiedAt: number | null;
  orderCount: number;
  regions: number;
  byType: Array<[number, TypeBook]>;
}

/** Flatten the live snapshot for persisting to disk, or null if not ready. */
export function dumpSnapshot(): SerializedSnapshot | null {
  if (!snapshot) return null;
  return {
    builtAt: snapshot.builtAt,
    lastModifiedAt: snapshot.lastModifiedAt,
    orderCount: snapshot.orderCount,
    regions: snapshot.regions,
    byType: [...snapshot.byType.entries()],
  };
}

/**
 * Install a snapshot loaded from disk as the live one (for deterministic,
 * offline algorithm tests). Marks the market ready and stops it looking cold.
 */
export function loadSnapshot(data: SerializedSnapshot): void {
  snapshot = {
    builtAt: data.builtAt,
    lastModifiedAt: data.lastModifiedAt,
    orderCount: data.orderCount,
    regions: data.regions,
    byType: new Map(data.byType),
  };
  status = 'ready';
}
