// Region market order books, crawled from ESI and held in memory as one global
// index keyed by item type. There is no "all orders" ESI endpoint, so we fan
// out over every region's paginated /markets/{region}/orders/ feed (CCP-cached
// ~5 min) and merge it.
//
// Crawl model: instead of one big all-region burst (which trips ESI's 429
// connection limit and OOMs at the peak), a single continuous worker refetches
// regions one at a time — pick the most-overdue region (hubs first), fetch it to
// completion, commit, repeat; sleep until the next region expires when nothing's
// due. One region in flight means each gets the FULL ESI request budget, so the
// big hubs (Jita's 426 pages) finish in ~60s instead of starving for minutes
// behind ~30 parallel fetches that split the ~7 req/s pipe. Each region is
// re-checked ~every 5 min via per-page conditional requests (ETag) — unchanged
// pages cost a 304 with no body. The global by-type index is rebuilt (throttled)
// only when some region actually changed; the resolver/algorithm downstream is
// untouched, so once all regions are loaded the output is identical to a full crawl.
import { esiGet, esiGetPageConditional, mapWithConcurrency, EsiError, getEsiErrorStats, type ConditionalPage } from './esi.js';
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

const WORKER_IDLE_SLEEP_MS = 5_000; // when no region is due, re-check (rebuild/watchdog) at least this often
const PAGE_CONCURRENCY = 8; // per-region page fan-out (bounded by esi.ts's global rate limiter)
const RESOLVE_THROTTLE_MS = 60_000; // once ready, rebuild the by-type index at most this often
const WARMING_REBUILD_MS = 15_000; // while warming, rebuild at most this often (the worker commits regions back-to-back)
const BACKLOG_LOG_MS = 30_000; // throttle the "N regions due" backlog log
const FRESH_FALLBACK_MS = 300_000; // assume 5-min freshness when ESI sends no Expires
const REFETCH_JITTER_MS = 45_000; // spread re-fetches so co-loaded regions desync (avoid bursts)
const STALE_WARN_MS = 12 * 60_000; // warn if a loaded region hasn't refreshed in this long (≈2× window)
const STALL_WARN_MS = 90_000; // warn if one region's fetch runs longer than this (likely hung)
const EMPTY_REFRESH_MS = 30 * 60_000; // re-check market-less (404) regions rarely
const ERROR_RETRY_MS = 60_000; // retry a failed region sooner than a full window

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/** Raw per-station accumulators for one type while rebuilding (Map<station, orders>). */
interface TypeBuild {
  sells: Map<number, Order[]>;
  buys: Map<number, Order[]>;
}

/** A market order plus the bits needed to regroup it after a per-page refresh. */
interface CrawlOrder extends Order {
  typeId: number;
  isBuy: boolean;
}

/** One cached page of a region: its ETag (for conditional refetch) and parsed orders. */
interface PageCache {
  etag: string;
  orders: CrawlOrder[];
}

type RegionStatus = 'never' | 'loaded' | 'empty' | 'error';

/** Per-region cache: pages keyed by page number, plus freshness metadata. */
interface RegionCache {
  regionId: number;
  pages: Map<number, PageCache>;
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
/** regionId → dispatch time, to detect fetches that hang. */
const inFlightSince = new Map<number, number>();
/** Rate-limits the health watchdog so it warns at most once a minute. */
let lastHealthWarnAt = 0;
let booksDirty = false;
let lastBuildAt = 0;
let started = false;
/** Count of regions whose refresh failed (after retries) and were kept stale/cold. */
let regionDrops = 0;
// Cumulative counts as of the previous rebuild, so each log line can report just
// what happened in that interval (a running total keeps re-printing a frozen
// number, which reads like errors are still occurring when they're long over).
let lastErrByStatus: Record<number, number> = {};
let lastNetworkErr = 0;
let lastRegionDrops = 0;

/** ESI failures that occurred since the last rebuild, e.g. "429×12" or "none". */
function esiFailuresThisInterval(): string {
  const s = getEsiErrorStats();
  const parts: string[] = [];
  for (const [statusStr, count] of Object.entries(s.byStatus)) {
    const status = Number(statusStr);
    const delta = count - (lastErrByStatus[status] ?? 0);
    if (delta > 0) parts.push(`${status}×${delta}`);
  }
  const netDelta = s.network - lastNetworkErr;
  if (netDelta > 0) parts.push(`network×${netDelta}`);
  lastErrByStatus = { ...s.byStatus };
  lastNetworkErr = s.network;
  return parts.length ? parts.join(', ') : 'none';
}

/** Short label for logs: region name if known, else its id. */
function regionLabel(regionId: number): string {
  return getRegionName(regionId) ?? `region ${regionId}`;
}

/** Parse a raw ESI page into compact, filtered CrawlOrders (drops unknown/unpublished types). */
function parsePage(raw: RawOrder[]): CrawlOrder[] {
  const out: CrawlOrder[] = [];
  for (const o of raw) {
    if (!getType(o.type_id)) continue; // unpublished / zero-volume — arbitrage never looks it up
    out.push({
      id: o.order_id,
      price: o.price,
      volume: o.volume_remain,
      locationId: o.location_id,
      systemId: o.system_id,
      rangeCode: o.is_buy_order ? rangeCode(o.range) : RANGE_STATION,
      typeId: o.type_id,
      isBuy: o.is_buy_order,
    });
  }
  return out;
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
    const pages = new Map<number, PageCache>();
    let orderCount = 0;
    for (const [page, res] of results) {
      if (res.status === 200) {
        const orders = parsePage(res.data ?? []);
        pages.set(page, { etag: res.etag ?? '', orders });
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
      orderCount += pages.get(page)?.orders.length ?? 0;
    }

    rc.pages = pages;
    rc.pageCount = pageCount;
    rc.orderCount = orderCount;
    rc.lastModified = p1.lastModified;
    // Spread re-fetches with a little jitter so regions whose ESI caches expire
    // together (they're roughly synchronized) don't all come due at the same
    // instant and pile into one long back-to-back run; staggering them lets the
    // worker interleave them and keeps each region nearer its 5-min target.
    rc.expiresAt = (p1.expiresAt ?? Date.now() + FRESH_FALLBACK_MS) + Math.floor(Math.random() * REFETCH_JITTER_MS);
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

/** Group a station map into best-price-sorted StationOrders, with deterministic tiebreaks. */
function buildStations(byStation: Map<number, Order[]>, ascending: boolean): StationOrders[] {
  const stations: StationOrders[] = [];
  for (const orders of byStation.values()) {
    // Price order, ties broken by order id, so the result is independent of the
    // order regions happened to load in (needed now that the book is assembled
    // incrementally rather than in one fixed-order crawl).
    orders.sort((a, b) => (ascending ? a.price - b.price : b.price - a.price) || a.id - b.id);
    stations.push({ station: orders[0].locationId, system: orders[0].systemId, best: orders[0].price, orders });
  }
  stations.sort((a, b) => (ascending ? a.best - b.best : b.best - a.best) || a.station - b.station);
  return stations;
}

/** Rebuild the global by-type index from every loaded region's cached pages. */
function rebuildSnapshot(): void {
  const building = new Map<number, TypeBuild>();
  const buildFor = (typeId: number): TypeBuild => {
    let b = building.get(typeId);
    if (!b) {
      b = { sells: new Map(), buys: new Map() };
      building.set(typeId, b);
    }
    return b;
  };

  let orderCount = 0;
  let lastModifiedAt: number | null = null;
  let regions = 0;
  for (const rc of regionCaches.values()) {
    if (rc.status !== 'loaded' || rc.orderCount === 0) continue;
    regions++;
    if (rc.lastModified !== null && (lastModifiedAt === null || rc.lastModified < lastModifiedAt)) {
      lastModifiedAt = rc.lastModified; // oldest region = honest "data as of"
    }
    for (const page of rc.pages.values()) {
      for (const o of page.orders) {
        const tb = buildFor(o.typeId);
        const byStation = o.isBuy ? tb.buys : tb.sells;
        const arr = byStation.get(o.locationId);
        if (arr) arr.push(o);
        else byStation.set(o.locationId, [o]);
        orderCount++;
      }
    }
  }

  const byType = new Map<number, TypeBook>();
  for (const [typeId, b] of building) {
    byType.set(typeId, { sells: buildStations(b.sells, true), buys: buildStations(b.buys, false) });
  }

  snapshot = { byType, builtAt: Date.now(), lastModifiedAt, orderCount, regions };
  const allSeen = [...regionCaches.values()].every((rc) => rc.status !== 'never');
  status = allSeen ? 'ready' : 'warming';
  fireListeners();
  const loaded = [...regionCaches.values()].filter((rc) => rc.status === 'loaded').length;
  const dropsThisInterval = regionDrops - lastRegionDrops;
  lastRegionDrops = regionDrops;
  console.log(
    `[Market] Rebuilt index: ${orderCount.toLocaleString()} orders, ${byType.size} types, ` +
      `${regions} active regions (${loaded}/${regionCaches.size} fetched, status: ${status}). ` +
      `ESI failures: ${esiFailuresThisInterval()}; region drops: ${dropsThisInterval}.`,
  );
}

/**
 * Rebuild if something changed, throttled. The first build (no snapshot yet) runs
 * immediately so the UI sees data ASAP; after that we coalesce — gently while
 * warming (the worker commits regions back-to-back, so without this it would
 * rebuild the whole growing index per region), and more lazily once ready.
 */
function maybeRebuild(): void {
  if (!booksDirty) return;
  const now = Date.now();
  const throttle = status === 'ready' ? RESOLVE_THROTTLE_MS : WARMING_REBUILD_MS;
  if (snapshot && now - lastBuildAt < throttle) return;
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

/** Due regions (ESI cache expired, not in flight), most-overdue first but hubs ahead of the tail. */
function dueRegions(now: number): RegionCache[] {
  return [...regionCaches.values()]
    .filter((rc) => !inFlight.has(rc.regionId) && now >= rc.expiresAt)
    .sort((a, b) => priorityRank(a) - priorityRank(b) || a.expiresAt - b.expiresAt);
}

/** Soonest epoch-ms any region next comes due, or +∞ if none scheduled. */
function soonestDueAt(): number {
  let soonest = Infinity;
  for (const rc of regionCaches.values()) {
    if (!inFlight.has(rc.regionId) && rc.expiresAt < soonest) soonest = rc.expiresAt;
  }
  return soonest;
}

let lastBacklogLogAt = 0;

/**
 * The single continuous crawl worker. Each pass: pick the most-overdue region
 * (hubs first), fetch it to completion, commit, rebuild if needed. With only one
 * region in flight it gets the full ~7 req/s, so a hub's hundreds of pages finish
 * in ~60s rather than starving behind dozens of parallel fetches; the log reads as
 * a clean sequence with no overlapping runs. When nothing is due, rebuild any
 * pending change and sleep until the next region expires (capped, so the watchdog
 * still runs). Never throws — a failed fetch keeps stale data (see fetchRegion) and
 * the loop carries on; transient ESI outages become stale data, never a crash.
 */
async function runWorker(): Promise<void> {
  for (;;) {
    try {
      const now = Date.now();
      const due = dueRegions(now);

      if (due.length === 0) {
        maybeRebuild();
        runHealthWatchdog(now);
        const wait = Math.min(Math.max(soonestDueAt() - now, 0), WORKER_IDLE_SLEEP_MS);
        await sleep(wait);
        continue;
      }

      // Surface a backlog (throttled): many regions overdue at once means the worker
      // is behind its 5-min window — normal during the synchronized expiry burst,
      // worth noticing if it persists.
      if (due.length > 1 && now - lastBacklogLogAt >= BACKLOG_LOG_MS) {
        lastBacklogLogAt = now;
        console.log(`[Market] ${due.length} regions due — refreshing most-overdue first (hubs prioritized).`);
      }

      const rc = due[0];
      inFlight.add(rc.regionId);
      inFlightSince.set(rc.regionId, Date.now());
      try {
        if (await fetchRegion(rc)) booksDirty = true;
      } finally {
        inFlight.delete(rc.regionId);
        inFlightSince.delete(rc.regionId);
      }

      maybeRebuild();
      runHealthWatchdog(Date.now());
    } catch (err) {
      // fetchRegion swallows its own errors, so this is belt-and-braces: never let
      // an unexpected throw kill the crawl loop.
      console.error('[Market] worker loop error (continuing)', err);
      await sleep(WORKER_IDLE_SLEEP_MS);
    }
  }
}

/**
 * Periodic (≤ once/min) health check that surfaces the two silent failure modes
 * the per-region logs miss: a fetch that hangs, and a region that has fallen well
 * behind its refresh window (so its data is going stale unnoticed).
 */
function runHealthWatchdog(now: number): void {
  if (now - lastHealthWarnAt < 60_000) return;
  let warned = false;

  const stuck = [...inFlightSince.entries()].filter(([, t]) => now - t > STALL_WARN_MS);
  if (stuck.length > 0) {
    const list = stuck.map(([id, t]) => `${regionLabel(id)} (${Math.round((now - t) / 1000)}s)`).join(', ');
    console.warn(`[Market] ⚠ ${stuck.length} region fetch(es) running unusually long: ${list}`);
    warned = true;
  }

  let stalest: RegionCache | null = null;
  for (const rc of regionCaches.values()) {
    if (rc.status !== 'loaded' || rc.fetchedAt === 0) continue;
    if (!stalest || rc.fetchedAt < stalest.fetchedAt) stalest = rc;
  }
  if (stalest && now - stalest.fetchedAt > STALE_WARN_MS) {
    console.warn(
      `[Market] ⚠ Falling behind: stalest region ${regionLabel(stalest.regionId)} last refreshed ` +
        `${Math.round((now - stalest.fetchedAt) / 60_000)}m ago (target ~5m).`,
    );
    warned = true;
  }

  if (warned) lastHealthWarnAt = now;
}

/** Start the incremental market crawler: load the region list, then run the worker forever. */
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
  console.log(`[Market] Crawl worker started for ${regionIds.length} regions (sequential, most-overdue first; hubs prioritized).`);
  void runWorker();
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
    regions,
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
