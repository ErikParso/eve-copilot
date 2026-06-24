// Region market order books, crawled from ESI and held in memory as one global
// index keyed by item type. There is no "all orders" ESI endpoint, so we fan
// out over every region's paginated /markets/{region}/orders/ feed (CCP-cached
// ~5 min) and merge it.
//
// Crawl model: instead of one big all-region burst (which trips ESI's 429
// connection limit and OOMs at the peak), a scheduler ticks every 20s and
// refetches only the regions whose ESI cache has expired, a few per tick,
// priority-ordered (hubs first). Each region is re-checked ~every 5 min via
// per-page conditional requests (ETag) — unchanged pages cost a 304 with no
// body. The global by-type index is rebuilt (throttled) only when some region
// actually changed; the resolver/algorithm downstream is untouched, so once all
// regions are loaded the output is identical to a full crawl.
import { esiGet, esiGetPageConditional, mapWithConcurrency, EsiError, formatEsiErrorStats, getEsiErrorStats, type EsiErrorStats, type ConditionalPage } from './esi.js';
import { getType, getRegionName } from './sde.js';

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
 * station first, `buys` by dearest station first. This is the *hydrated* shape
 * the resolver reads — materialised on demand from the compact columnar store.
 */
export interface TypeBook {
  sells: StationOrders[];
  buys: StationOrders[];
}

// --- Columnar storage --------------------------------------------------------
// The live book is held columnar (parallel typed arrays) rather than as ~1.6M JS
// objects — ~5x less heap. Per-page caches (PageColumns) are the source of truth
// so a region refetch only re-parses changed pages; the resolver's view
// (MarketStore) is rebuilt from them, grouped type→side→station and sorted. The
// resolver reads it by hydrating ONE type at a time into the verbose
// Order/StationOrders shape (transient, GC'd per type) — so the matching
// algorithm stays byte-for-byte unchanged while the persistent store is compact.

/** A block of orders stored columnar; index i is one order. */
interface OrderColumns {
  n: number;
  price: Float64Array;
  volume: Float64Array;
  orderId: Float64Array; // fits exactly in f64 (ids < 2^53)
  locationId: Float64Array; // structure ids exceed 2^32
  systemId: Int32Array;
  typeId: Int32Array;
  rangeCode: Int8Array; // -2,-1,0, or jumps (<=127)
  isBuy: Uint8Array;
}

/** One cached page: its ETag (for conditional refetch) plus its orders, columnar. */
interface PageColumns extends OrderColumns {
  etag: string;
}

/**
 * Station groups, stored columnar (one entry per type×side×station). `start`/
 * `count` index into the order columns; a type's sells then buys occupy
 * contiguous ranges (see GroupColumns + ColumnarStore.types).
 */
interface GroupColumns {
  station: Float64Array;
  system: Int32Array;
  best: Float64Array;
  start: Int32Array;
  count: Int32Array;
}

/**
 * The resolver's read interface over the compact store: iterate type ids and
 * hydrate one type's verbose TypeBook on demand. `hydrateAll()` is for offline
 * diagnostics only (it materialises the whole book — memory-heavy).
 */
export interface MarketStore {
  readonly size: number;
  readonly orderCount: number;
  typeIds(): IterableIterator<number>;
  hydrateType(typeId: number): TypeBook | undefined;
  hydrateAll(): Map<number, TypeBook>;
}

/**
 * MarketStore backed entirely by typed arrays (kept off the V8 object heap):
 * four order columns + five station-group columns + a small per-type index
 * mapping a type id to its [sellStart, sellEnd, buyStart, buyEnd) group ranges.
 */
class ColumnarStore implements MarketStore {
  constructor(
    private readonly price: Float64Array,
    private readonly volume: Float64Array,
    private readonly orderId: Float64Array,
    private readonly range: Int8Array,
    private readonly g: GroupColumns,
    /** typeId → [sellStart, sellEnd, buyStart, buyEnd) into the group columns. */
    private readonly types: Map<number, Int32Array>,
    readonly orderCount: number,
  ) {}

  get size(): number {
    return this.types.size;
  }
  typeIds(): IterableIterator<number> {
    return this.types.keys();
  }
  hydrateType(typeId: number): TypeBook | undefined {
    const r = this.types.get(typeId);
    if (!r) return undefined;
    return { sells: this.hydrateGroups(r[0], r[1]), buys: this.hydrateGroups(r[2], r[3]) };
  }
  hydrateAll(): Map<number, TypeBook> {
    const out = new Map<number, TypeBook>();
    for (const t of this.types.keys()) out.set(t, this.hydrateType(t)!);
    return out;
  }
  private hydrateGroups(gFrom: number, gTo: number): StationOrders[] {
    const out: StationOrders[] = new Array(gTo - gFrom);
    for (let gi = gFrom; gi < gTo; gi++) {
      const start = this.g.start[gi];
      const count = this.g.count[gi];
      const station = this.g.station[gi];
      const system = this.g.system[gi];
      const orders: Order[] = new Array(count);
      for (let i = 0; i < count; i++) {
        const idx = start + i;
        orders[i] = {
          id: this.orderId[idx],
          price: this.price[idx],
          volume: this.volume[idx],
          locationId: station,
          systemId: system,
          rangeCode: this.range[idx],
        };
      }
      out[gi - gFrom] = { station, system, best: this.g.best[gi], orders };
    }
    return out;
  }
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
  byType: MarketStore;
  builtAt: number;
  lastModifiedAt: number | null;
  orderCount: number;
  regions: number;
}

const TICK_MS = 20_000; // how often the scheduler checks which regions are due
const REGIONS_PER_TICK = 5; // regions dispatched per tick; real throttle is esi.ts's global gate
const PAGE_CONCURRENCY = 8; // per-region page fan-out (further bounded by esi.ts's global gate)
const RESOLVE_THROTTLE_MS = 60_000; // once ready, rebuild the by-type index at most this often
const FRESH_FALLBACK_MS = 300_000; // assume 5-min freshness when ESI sends no Expires
const EMPTY_REFRESH_MS = 30 * 60_000; // re-check market-less (404) regions rarely
const ERROR_RETRY_MS = 60_000; // retry a failed region sooner than a full window

// Trade hubs first: during contention (startup, or if we ever can't keep up) the
// regions that carry ~all the arbitrage value get refreshed ahead of the long
// tail. Pure ordering — every region is still fetched every cycle.
const PRIORITY_REGIONS = [
  10000002, // The Forge (Jita)
  10000043, // Domain (Amarr)
  10000032, // Sinq Laison (Dodixie)
  10000030, // Heimatar (Rens)
  10000042, // Metropolis (Hek)
  10000064, // Essence
  10000037, // Everyshore
  10000065, // Kor-Azor
  10000016, // Lonetrek
  10000033, // The Citadel
];
const PRIORITY_RANK = new Map(PRIORITY_REGIONS.map((id, i) => [id, i]));

function rangeCode(range: string): number {
  if (range === 'region') return RANGE_REGION;
  if (range === 'solarsystem') return RANGE_SYSTEM;
  if (range === 'station') return RANGE_STATION;
  const n = Number(range);
  return Number.isFinite(n) && n > 0 ? n : RANGE_STATION;
}

type RegionStatus = 'never' | 'loaded' | 'empty' | 'error';

/** Per-region cache: pages keyed by page number, plus freshness metadata. */
interface RegionCache {
  regionId: number;
  pages: Map<number, PageColumns>;
  pageCount: number;
  orderCount: number;
  lastModified: number | null;
  /** When this region's data should be refetched (epoch ms). 0 = due now. */
  expiresAt: number;
  /** Last successful fetch (epoch ms), 0 if never. */
  fetchedAt: number;
  status: RegionStatus;
  lastError: string | null;
}

let snapshot: Snapshot | null = null;
let status: MarketStatus = 'cold';

const regionCaches = new Map<number, RegionCache>();
const inFlight = new Set<number>();
let booksDirty = false;
let lastBuildAt = 0;
let started = false;
/** Count of regions whose refresh failed (after retries) and were kept stale/cold. */
let regionDrops = 0;

/** Short label for logs: region name if known, else its id. */
function regionLabel(regionId: number): string {
  return getRegionName(regionId) ?? `region ${regionId}`;
}

/** Allocate empty order columns of length n. */
function allocColumns(n: number): OrderColumns {
  return {
    n,
    price: new Float64Array(n),
    volume: new Float64Array(n),
    orderId: new Float64Array(n),
    locationId: new Float64Array(n),
    systemId: new Int32Array(n),
    typeId: new Int32Array(n),
    rangeCode: new Int8Array(n),
    isBuy: new Uint8Array(n),
  };
}

/** Parse a raw ESI page into compact columns (drops unknown/unpublished types). */
function parsePage(raw: RawOrder[]): PageColumns {
  let n = 0;
  for (const o of raw) if (getType(o.type_id)) n++;
  const c = allocColumns(n);
  let w = 0;
  for (const o of raw) {
    if (!getType(o.type_id)) continue; // unpublished / zero-volume — arbitrage never looks it up
    c.price[w] = o.price;
    c.volume[w] = o.volume_remain;
    c.orderId[w] = o.order_id;
    c.locationId[w] = o.location_id;
    c.systemId[w] = o.system_id;
    c.typeId[w] = o.type_id;
    c.rangeCode[w] = o.is_buy_order ? rangeCode(o.range) : RANGE_STATION;
    c.isBuy[w] = o.is_buy_order ? 1 : 0;
    w++;
  }
  return { ...c, etag: '' };
}

/** Concatenate every loaded region's page columns into one block for rebuilding. */
function concatLoadedColumns(): OrderColumns {
  let total = 0;
  for (const rc of regionCaches.values()) {
    if (rc.status !== 'loaded') continue;
    for (const pc of rc.pages.values()) total += pc.n;
  }
  const c = allocColumns(total);
  let w = 0;
  for (const rc of regionCaches.values()) {
    if (rc.status !== 'loaded') continue;
    for (const pc of rc.pages.values()) {
      if (pc.n === 0) continue;
      c.price.set(pc.price, w);
      c.volume.set(pc.volume, w);
      c.orderId.set(pc.orderId, w);
      c.locationId.set(pc.locationId, w);
      c.systemId.set(pc.systemId, w);
      c.typeId.set(pc.typeId, w);
      c.rangeCode.set(pc.rangeCode, w);
      c.isBuy.set(pc.isBuy, w);
      w += pc.n;
    }
  }
  return c;
}

/**
 * Build the compact store from an order-columns block. Everything heavy here is a
 * typed array (off the V8 object heap): a single order-index sort groups orders
 * by type→side→station and sorts each station's depth (price, ties by id); a
 * second group-index sort orders each side's stations by best price (ties by
 * station). The result is the columnar equivalent of the old buildStations.
 */
function buildColumnarStore(c: OrderColumns): ColumnarStore {
  const n = c.n;

  // 1. Sort order indices by (typeId, side[sell<buy], station, price[asc sell/
  //    desc buy], orderId). One typed-array sort — no per-group JS arrays.
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => {
    if (c.typeId[a] !== c.typeId[b]) return c.typeId[a] - c.typeId[b];
    if (c.isBuy[a] !== c.isBuy[b]) return c.isBuy[a] - c.isBuy[b];
    if (c.locationId[a] !== c.locationId[b]) return c.locationId[a] < c.locationId[b] ? -1 : 1;
    if (c.price[a] !== c.price[b]) return c.isBuy[a] ? c.price[b] - c.price[a] : c.price[a] - c.price[b];
    return c.orderId[a] < c.orderId[b] ? -1 : c.orderId[a] > c.orderId[b] ? 1 : 0;
  });

  // 2. Lay out the final order columns in sorted order.
  const price = new Float64Array(n);
  const volume = new Float64Array(n);
  const orderId = new Float64Array(n);
  const range = new Int8Array(n);
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    price[k] = c.price[i];
    volume[k] = c.volume[i];
    orderId[k] = c.orderId[i];
    range[k] = c.rangeCode[i];
  }

  // 3. Scan contiguous runs (same type+side+station) into station-group columns.
  const isBoundary = (k: number): boolean =>
    k === 0 ||
    c.typeId[idx[k]] !== c.typeId[idx[k - 1]] ||
    c.isBuy[idx[k]] !== c.isBuy[idx[k - 1]] ||
    c.locationId[idx[k]] !== c.locationId[idx[k - 1]];
  let groupCount = 0;
  for (let k = 0; k < n; k++) if (isBoundary(k)) groupCount++;

  const tStation = new Float64Array(groupCount);
  const tSystem = new Int32Array(groupCount);
  const tBest = new Float64Array(groupCount);
  const tStart = new Int32Array(groupCount);
  const tCount = new Int32Array(groupCount);
  const tType = new Int32Array(groupCount);
  const tIsBuy = new Uint8Array(groupCount);
  let gi = -1;
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    if (isBoundary(k)) {
      gi++;
      tStation[gi] = c.locationId[i];
      tSystem[gi] = c.systemId[i];
      tBest[gi] = price[k]; // first of the run = best (depth already price-sorted)
      tStart[gi] = k;
      tCount[gi] = 0;
      tType[gi] = c.typeId[i];
      tIsBuy[gi] = c.isBuy[i];
    }
    tCount[gi]++;
  }

  // 4. Order the groups by (type, side, best[asc sell/desc buy], station).
  const gOrder = new Uint32Array(groupCount);
  for (let j = 0; j < groupCount; j++) gOrder[j] = j;
  gOrder.sort((a, b) => {
    if (tType[a] !== tType[b]) return tType[a] - tType[b];
    if (tIsBuy[a] !== tIsBuy[b]) return tIsBuy[a] - tIsBuy[b];
    if (tBest[a] !== tBest[b]) return tIsBuy[a] ? tBest[b] - tBest[a] : tBest[a] - tBest[b];
    return tStation[a] < tStation[b] ? -1 : tStation[a] > tStation[b] ? 1 : 0;
  });

  // 5. Emit the final group columns in that order; record per-type group ranges.
  const g: GroupColumns = {
    station: new Float64Array(groupCount),
    system: new Int32Array(groupCount),
    best: new Float64Array(groupCount),
    start: new Int32Array(groupCount),
    count: new Int32Array(groupCount),
  };
  const types = new Map<number, Int32Array>();
  let pos = 0;
  const emit = (src: number, dst: number) => {
    g.station[dst] = tStation[src];
    g.system[dst] = tSystem[src];
    g.best[dst] = tBest[src];
    g.start[dst] = tStart[src];
    g.count[dst] = tCount[src];
  };
  while (pos < groupCount) {
    const t = tType[gOrder[pos]];
    const sellStart = pos;
    while (pos < groupCount && tType[gOrder[pos]] === t && tIsBuy[gOrder[pos]] === 0) emit(gOrder[pos], pos++);
    const sellEnd = pos;
    const buyStart = pos;
    while (pos < groupCount && tType[gOrder[pos]] === t && tIsBuy[gOrder[pos]] === 1) emit(gOrder[pos], pos++);
    const buyEnd = pos;
    types.set(t, Int32Array.of(sellStart, sellEnd, buyStart, buyEnd));
  }

  return new ColumnarStore(price, volume, orderId, range, g, types, n);
}

/** Build compact columns from the verbose serialized shape (offline fixture load). */
function columnsFromVerbose(entries: Array<[number, TypeBook]>): OrderColumns {
  let total = 0;
  for (const [, tb] of entries) {
    for (const so of tb.sells) total += so.orders.length;
    for (const so of tb.buys) total += so.orders.length;
  }
  const c = allocColumns(total);
  let w = 0;
  const fill = (typeId: number, side: StationOrders[], isBuy: number) => {
    for (const so of side) {
      for (const o of so.orders) {
        c.price[w] = o.price;
        c.volume[w] = o.volume;
        c.orderId[w] = o.id;
        c.locationId[w] = o.locationId;
        c.systemId[w] = o.systemId;
        c.typeId[w] = typeId;
        c.rangeCode[w] = o.rangeCode;
        c.isBuy[w] = isBuy;
        w++;
      }
    }
  };
  for (const [typeId, tb] of entries) {
    fill(typeId, tb.sells, 0);
    fill(typeId, tb.buys, 1);
  }
  return c;
}

/**
 * Refetch one region with per-page conditional requests, committing atomically.
 *
 * All pages are fetched first; only if every page succeeds is the region's cache
 * updated — a partial failure leaves the previous (stale) data intact rather than
 * a half-populated region. Returns whether the region's orders actually changed.
 */
async function fetchRegion(rc: RegionCache): Promise<boolean> {
  const path = `/markets/${rc.regionId}/orders/`;
  const startedAt = Date.now();
  const firstLoad = rc.status === 'never';
  try {
    const p1 = await esiGetPageConditional<RawOrder[]>(path, 1, rc.pages.get(1)?.etag ?? null);
    const pageCount = p1.pages;
    const results = new Map<number, ConditionalPage<RawOrder[]>>([[1, p1]]);
    if (pageCount > 1) {
      const rest = Array.from({ length: pageCount - 1 }, (_, i) => i + 2);
      const fetched = await mapWithConcurrency(rest, PAGE_CONCURRENCY, async (page) => ({
        page,
        res: await esiGetPageConditional<RawOrder[]>(path, page, rc.pages.get(page)?.etag ?? null),
      }));
      for (const { page, res } of fetched) results.set(page, res);
    }

    // All pages in hand → commit atomically.
    let changed = pageCount !== rc.pageCount;
    let fresh = 0; // pages with a new body (200)
    let reused = 0; // pages unchanged (304)
    const pages = new Map<number, PageColumns>();
    let orderCount = 0;
    for (const [page, res] of results) {
      if (res.status === 200) {
        const pc = parsePage(res.data ?? []);
        pc.etag = res.etag ?? '';
        pages.set(page, pc);
        changed = true;
        fresh++;
      } else {
        // 304 — body unchanged; reuse the previously parsed page (must exist, since
        // we only sent If-None-Match when we already had its ETag).
        const prev = rc.pages.get(page);
        if (prev) pages.set(page, prev);
        else changed = true; // shouldn't happen; force a rebuild to be safe
        reused++;
      }
      orderCount += pages.get(page)?.n ?? 0;
    }

    rc.pages = pages;
    rc.pageCount = pageCount;
    rc.orderCount = orderCount;
    rc.lastModified = p1.lastModified;
    rc.expiresAt = p1.expiresAt ?? Date.now() + FRESH_FALLBACK_MS;
    rc.fetchedAt = Date.now();
    rc.status = orderCount > 0 ? 'loaded' : 'empty';
    rc.lastError = null;

    const ms = Date.now() - startedAt;
    // Log first loads and real changes for regions that actually have a market;
    // stay quiet for the common "all 304" no-op and for the ~40 market-less regions.
    if ((firstLoad || changed) && orderCount > 0) {
      const verb = firstLoad ? 'loaded' : 'updated';
      console.log(
        `[Market] ${verb} ${regionLabel(rc.regionId)}: ${orderCount.toLocaleString()} orders ` +
          `(${pageCount}p: ${fresh} fresh, ${reused} unchanged, ${ms}ms)`,
      );
    }
    return changed;
  } catch (err) {
    if (err instanceof EsiError && err.status === 404) {
      // Region has no market (wormhole / special space). Mark empty, back off.
      const hadOrders = rc.orderCount > 0;
      rc.pages = new Map();
      rc.pageCount = 0;
      rc.orderCount = 0;
      rc.lastModified = null;
      rc.expiresAt = Date.now() + EMPTY_REFRESH_MS;
      rc.fetchedAt = Date.now();
      rc.status = 'empty';
      rc.lastError = null;
      return hadOrders;
    }
    // Keep whatever we had (stale beats empty); retry sooner than a full window.
    regionDrops++;
    const kept = rc.pages.size > 0 ? 'kept stale data' : 'no prior data';
    const reason = err instanceof EsiError ? `HTTP ${err.status}` : err instanceof Error ? err.message : String(err);
    console.error(`[Market] ✗ ${regionLabel(rc.regionId)} refresh failed after retries (${reason}; ${kept})`);
    rc.status = rc.pages.size > 0 ? 'loaded' : 'error';
    rc.lastError = reason;
    rc.expiresAt = Date.now() + ERROR_RETRY_MS;
    return false;
  }
}

/** Rebuild the compact by-type store from every loaded region's cached pages. */
function rebuildSnapshot(): void {
  let lastModifiedAt: number | null = null;
  let regions = 0;
  for (const rc of regionCaches.values()) {
    if (rc.status !== 'loaded' || rc.orderCount === 0) continue;
    regions++;
    if (rc.lastModified !== null && (lastModifiedAt === null || rc.lastModified < lastModifiedAt)) {
      lastModifiedAt = rc.lastModified; // oldest region = honest "data as of"
    }
  }

  // Concatenate all pages into one columns block, then group/sort into the store.
  // The concat + grouping are transient (typed arrays + index lists), GC'd after.
  const store = buildColumnarStore(concatLoadedColumns());

  snapshot = { byType: store, builtAt: Date.now(), lastModifiedAt, orderCount: store.orderCount, regions };
  const allSeen = [...regionCaches.values()].every((rc) => rc.status !== 'never');
  status = allSeen ? 'ready' : 'warming';
  fireListeners();
  const loaded = [...regionCaches.values()].filter((rc) => rc.status === 'loaded').length;
  console.log(
    `[Market] Rebuilt index: ${store.orderCount.toLocaleString()} orders, ${store.size} types, ` +
      `${regions} active regions (${loaded}/${regionCaches.size} fetched, status: ${status}). ` +
      `ESI failures: ${formatEsiErrorStats()}; region drops: ${regionDrops}.`,
  );
}

/** Rebuild if something changed — eagerly while warming, throttled once ready. */
function maybeRebuild(): void {
  if (!booksDirty) return;
  const now = Date.now();
  const warming = status !== 'ready';
  if (snapshot && !warming && now - lastBuildAt < RESOLVE_THROTTLE_MS) return;
  booksDirty = false;
  lastBuildAt = now;
  rebuildSnapshot();
}

/** Callbacks fired (best-effort) after each rebuild — e.g. route pre-warm + resolve. */
const refreshListeners: Array<() => void> = [];
export function onMarketRefresh(fn: () => void): void {
  refreshListeners.push(fn);
}
function fireListeners(): void {
  for (const fn of refreshListeners) {
    try {
      fn();
    } catch (err) {
      console.error('Market refresh listener failed', err);
    }
  }
}

function priorityRank(rc: RegionCache): number {
  return PRIORITY_RANK.get(rc.regionId) ?? 1000;
}

/** One scheduler tick: commit any finished fetches, then dispatch the next due regions. */
function tick(): void {
  maybeRebuild();
  const now = Date.now();
  const due = [...regionCaches.values()]
    .filter((rc) => !inFlight.has(rc.regionId) && now >= rc.expiresAt)
    .sort((a, b) => priorityRank(a) - priorityRank(b) || a.expiresAt - b.expiresAt)
    .slice(0, REGIONS_PER_TICK);

  if (due.length > 0) {
    const names = due.map((rc) => regionLabel(rc.regionId)).join(', ');
    console.log(`[Market] Tick: refreshing ${due.length} region(s) [${inFlight.size} already in flight]: ${names}`);
  }

  for (const rc of due) {
    inFlight.add(rc.regionId);
    void fetchRegion(rc)
      .then((changed) => {
        if (changed) booksDirty = true;
      })
      .catch((err) => console.error('[Market] fetchRegion crashed', err))
      .finally(() => inFlight.delete(rc.regionId));
  }
}

/** Start the incremental market scheduler: load the region list, then tick forever. */
export async function startMarketScheduler(): Promise<void> {
  if (started) return;
  started = true;
  if (status === 'cold') status = 'warming';
  const regionIds = await esiGet<number[]>('/universe/regions/');
  for (const id of regionIds) {
    regionCaches.set(id, {
      regionId: id,
      pages: new Map(),
      pageCount: 0,
      orderCount: 0,
      lastModified: null,
      expiresAt: 0,
      fetchedAt: 0,
      status: 'never',
      lastError: null,
    });
  }
  console.log(`[Market] Scheduler started for ${regionIds.length} regions (tick ${TICK_MS / 1000}s, ${REGIONS_PER_TICK} regions/tick).`);
  tick();
  setInterval(tick, TICK_MS).unref();
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

/** Per-region freshness, for the UI panel that shows how current each region is. */
export interface RegionFreshness {
  regionId: number;
  name: string | null;
  status: RegionStatus;
  /** Seconds since last successful fetch, or null if never fetched. */
  ageSeconds: number | null;
  /** Seconds until this region is next due for a refetch (may be negative = overdue). */
  dueInSeconds: number | null;
  orderCount: number;
  priority: boolean;
  lastError: string | null;
}

export interface MarketFreshness {
  status: MarketStatus;
  regionsTotal: number;
  regionsLoaded: number;
  orderCount: number;
  builtAt: number | null;
  lastModifiedAt: number | null;
  /** Cumulative ESI request failures by reason, plus region drops, since startup. */
  esiErrors: EsiErrorStats;
  regionDrops: number;
  regions: RegionFreshness[];
}

/** Snapshot of how fresh each region's market data is right now. */
export function getMarketFreshness(): MarketFreshness {
  const now = Date.now();
  const regions: RegionFreshness[] = [];
  let loaded = 0;
  for (const rc of regionCaches.values()) {
    if (rc.status === 'loaded') loaded++;
    regions.push({
      regionId: rc.regionId,
      name: getRegionName(rc.regionId),
      status: rc.status,
      ageSeconds: rc.fetchedAt > 0 ? Math.round((now - rc.fetchedAt) / 1000) : null,
      dueInSeconds: rc.fetchedAt > 0 ? Math.round((rc.expiresAt - now) / 1000) : null,
      orderCount: rc.orderCount,
      priority: PRIORITY_RANK.has(rc.regionId),
      lastError: rc.lastError,
    });
  }
  // Priority hubs first, then loaded by freshest, with the long tail after.
  regions.sort((a, b) => Number(b.priority) - Number(a.priority) || (a.ageSeconds ?? Infinity) - (b.ageSeconds ?? Infinity));
  return {
    status,
    regionsTotal: regionCaches.size,
    regionsLoaded: loaded,
    orderCount: snapshot?.orderCount ?? 0,
    builtAt: snapshot?.builtAt ?? null,
    lastModifiedAt: snapshot?.lastModifiedAt ?? null,
    esiErrors: getEsiErrorStats(),
    regionDrops,
    regions,
  };
}

/** The current order-book snapshot, or null if the first crawl isn't done. */
export function getSnapshot(): Snapshot | null {
  return snapshot;
}

/** Build a MarketStore from verbose type→book entries (offline diagnostics only). */
export function storeFromVerboseEntries(entries: Array<[number, TypeBook]>): MarketStore {
  return buildColumnarStore(columnsFromVerbose(entries));
}

/** JSON-serializable form of the current snapshot (Map flattened to entries). */
export interface SerializedSnapshot {
  builtAt: number;
  lastModifiedAt: number | null;
  orderCount: number;
  regions: number;
  byType: Array<[number, TypeBook]>;
}

/** Flatten the live snapshot to the verbose serialized shape (offline tools only). */
export function dumpSnapshot(): SerializedSnapshot | null {
  if (!snapshot) return null;
  return {
    builtAt: snapshot.builtAt,
    lastModifiedAt: snapshot.lastModifiedAt,
    orderCount: snapshot.orderCount,
    regions: snapshot.regions,
    byType: [...snapshot.byType.hydrateAll().entries()],
  };
}

/**
 * Install a snapshot loaded from disk as the live one (for deterministic,
 * offline algorithm tests). Builds the compact columnar store from the verbose
 * serialized shape, so the existing fixture loads unchanged.
 */
export function loadSnapshot(data: SerializedSnapshot): void {
  const store = buildColumnarStore(columnsFromVerbose(data.byType));
  snapshot = {
    builtAt: data.builtAt,
    lastModifiedAt: data.lastModifiedAt,
    orderCount: store.orderCount,
    regions: data.regions,
    byType: store,
  };
  status = 'ready';
}
