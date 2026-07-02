// Crawls every region's public courier contracts, enriches them (routes via the
// local engine + danger), and caches the result in memory. Refreshed on a timer
// so all clients share one crawl. Attractivity scoring stays on the client.
import { esiGet, esiGetPaged, mapWithConcurrency, EsiError } from './esi.js';
import { getGateKills } from './gateKills.js';
import { getRoute, type RouteType } from './routing.js';
import { resolveEndpoint, toRouteSystems } from './enrich.js';
import { dangerForSystems } from './danger.js';
import type { ContractOpportunity, EnrichedContract, PublicContract, GateKillData, RouteSystem } from './types.js';
import type { PinnedCourierStatusRequest } from './schemas.js';

const REFRESH_MS = 10 * 60 * 1000;

// --- ESI crawl -----------------------------------------------------------

async function fetchRegionIds(): Promise<number[]> {
  return esiGet<number[]>('/universe/regions/');
}

/**
 * Fetch one region's public contracts and split out the two kinds we care about
 * in a single pass (no extra region calls): courier contracts, and item_exchange
 * "sell" contracts (a fixed price > 0 — the package feature). Want-to-buy
 * item_exchange contracts (price 0 / asking for items) are filtered later, once
 * their item list is known.
 */
async function fetchRegionContracts(
  regionId: number,
): Promise<{ couriers: PublicContract[]; sells: PublicContract[]; lastModified: number | null }> {
  const couriers: PublicContract[] = [];
  const sells: PublicContract[] = [];
  let lastModified: number | null = null;
  try {
    const first = await esiGetPaged<PublicContract[]>(`/contracts/public/${regionId}/`, 1);
    lastModified = first.lastModified;
    const keep = (list: PublicContract[]) => {
      for (const c of list) {
        if (c.type === 'courier') couriers.push(c);
        else if (c.type === 'item_exchange' && c.price > 0) sells.push(c);
      }
    };
    keep(first.data);
    if (first.pages > 1) {
      const pages = Array.from({ length: first.pages - 1 }, (_, i) => i + 2);
      const rest = await mapWithConcurrency(pages, 4, async (page) => {
        const res = await esiGetPaged<PublicContract[]>(`/contracts/public/${regionId}/`, page);
        return res.data;
      });
      rest.forEach(keep);
    }
  } catch (err) {
    if (!(err instanceof EsiError && err.status === 404)) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[Contracts Crawl] Error fetching region ${regionId}: ${reason}`);
    }
  }
  return { couriers, sells, lastModified };
}

export async function crawlContracts(): Promise<{
  contracts: PublicContract[];
  sells: PublicContract[];
  lastModifiedAt: number | null;
}> {
  const regionIds = await fetchRegionIds();
  console.log(`[Contracts Crawl] Starting crawl for public courier + sell contracts in ${regionIds.length} regions...`);
  let regionsParsed = 0;
  let totalCouriers = 0;
  let totalSells = 0;
  const perRegion = await mapWithConcurrency(regionIds, 16, async (regionId) => {
    const res = await fetchRegionContracts(regionId);
    regionsParsed++;
    totalCouriers += res.couriers.length;
    totalSells += res.sells.length;
    if (regionsParsed % 10 === 0 || regionsParsed === regionIds.length) {
      console.log(`[Contracts Crawl] Progress: ${regionsParsed}/${regionIds.length} regions parsed (${totalCouriers} couriers, ${totalSells} sell contracts found)...`);
    }
    return res;
  });
  console.log(`[Contracts Crawl] Finished! Cached ${totalCouriers} courier + ${totalSells} sell contracts.`);
  const lms = perRegion.map((r) => r.lastModified).filter((v): v is number => v !== null);
  return {
    contracts: perRegion.flatMap((r) => r.couriers),
    sells: perRegion.flatMap((r) => r.sells),
    lastModifiedAt: lms.length ? Math.max(...lms) : null,
  };
}

// --- Enrichment ----------------------------------------------------------

/** Resolve a raw contract into the cached opportunity (endpoints + economics, no routes). */
function buildOpportunity(c: PublicContract): ContractOpportunity {
  return {
    id: c.contract_id,
    pickup: resolveEndpoint(c.start_location_id),
    dropoff: resolveEndpoint(c.end_location_id),
    volume: c.volume,
    reward: c.reward,
    collateral: c.collateral,
    issuedAt: Date.parse(c.date_issued),
    expiresAt: Date.parse(c.date_expired),
    daysToComplete: c.days_to_complete,
  };
}

/**
 * Enhance one opportunity with its two route legs: the delivery leg
 * (pickup→dropoff) plus the approach leg (current system→pickup) when an origin
 * is given. Returns null — filtering the contract out — when either leg is
 * unreachable (or an endpoint's system is unknown). getRoute memoises the search.
 */
function resolveContract(
  o: ContractOpportunity,
  type: RouteType,
  origin: number | null,
  kills: GateKillData,
): EnrichedContract | null {
  if (o.pickup.systemId === null || o.dropoff.systemId === null) return null;

  const deliveryIds = getRoute(o.pickup.systemId, o.dropoff.systemId, type);
  if (!deliveryIds) return null; // can't deliver pickup → dropoff
  const deliveryRoute = toRouteSystems(deliveryIds, kills);

  let approachRoute: EnrichedContract['approachRoute'] = null;
  if (origin !== null) {
    const approachIds = getRoute(origin, o.pickup.systemId, type);
    if (!approachIds) return null; // can't reach the pickup from here
    approachRoute = toRouteSystems(approachIds, kills);
  }

  return { ...o, approachRoute, deliveryRoute };
}

// --- Cache ---------------------------------------------------------------
//
// Two cached stages mirror the arbitrage pipeline: the raw crawl, and the
// route-free opportunities derived from it (endpoints resolved). Routes are NOT
// cached here — they're resolved per request, cheap because the graph search is
// memoised per (origin, dest, type) by routing.ts's routeCache. Listing times
// are derived on the FE from the raw timestamps, so they're always fresh.

interface RawState {
  contracts: PublicContract[];
  /** item_exchange sell contracts (price > 0) — consumed by the packages module. */
  sells: PublicContract[];
  lastModifiedAt: number | null;
  fetchedAt: number;
}

let raw: RawState | null = null;
let crawling: Promise<void> | null = null;
let opportunities: ContractOpportunity[] = [];
let opportunitiesFetchedAt = -1;

// Listeners fired after each successful crawl so the packages module can
// reconcile its contract-id set (enqueue new, evict gone) against the latest set.
const refreshListeners: Array<() => void> = [];
export function onContractsRefresh(fn: () => void): void {
  refreshListeners.push(fn);
}

/** The latest crawl's item_exchange sell contracts (price > 0), or []. */
export function getRawSellContracts(): PublicContract[] {
  return raw?.sells ?? [];
}

async function refresh(): Promise<void> {
  if (crawling) return crawling;
  crawling = (async () => {
    try {
      const result = await crawlContracts();
      raw = { ...result, fetchedAt: Date.now() };
      for (const fn of refreshListeners) {
        try {
          fn();
        } catch (err) {
          console.error('[Contracts Crawl] refresh listener failed:', err);
        }
      }
    } catch (err) {
      // A whole-crawl failure (e.g. the region-list fetch 504s during an ESI
      // outage) must NOT crash the process — keep the last good cache and let the
      // next 10-min cycle retry, mirroring the market crawler's per-region resilience.
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[Contracts Crawl] Crawl failed (keeping last cache): ${reason}`);
    }
  })().finally(() => {
    crawling = null;
  });
  return crawling;
}

/** Cached route-free opportunities, rebuilt only when the crawl refreshes. */
function getOpportunities(): ContractOpportunity[] {
  if (!raw) return [];
  if (raw.fetchedAt !== opportunitiesFetchedAt) {
    opportunities = raw.contracts.map(buildOpportunity);
    opportunitiesFetchedAt = raw.fetchedAt;
  }
  return opportunities;
}

/** Start the periodic crawl (and do the first one now). */
export function startContractsRefresh(): void {
  void refresh();
  setInterval(() => void refresh(), REFRESH_MS).unref();
}

export interface ContractsResponse {
  contracts: EnrichedContract[];
  lastModifiedAt: number | null;
  total: number;
}

/**
 * Every reachable contract for a route type, with routes resolved for this
 * request (delivery leg, plus the approach leg from `origin` when given).
 * Unreachable contracts are dropped.
 */
export async function getEnrichedContracts(
  type: RouteType,
  origin: number | null,
): Promise<ContractsResponse> {
  if (process.env.OFFLINE === 'true') {
    if (raw && raw.contracts.length > 0) {
      const kills = await getGateKills();
      const contracts: EnrichedContract[] = [];
      for (const o of getOpportunities()) {
        const enriched = resolveContract(o, type, origin, kills);
        if (enriched) contracts.push(enriched);
      }
      return { contracts, lastModifiedAt: raw.lastModifiedAt, total: contracts.length };
    }
    return { contracts: [], lastModifiedAt: Date.now(), total: 0 };
  }
  if (!raw) await refresh();
  if (!raw) return { contracts: [], lastModifiedAt: null, total: 0 };

  const kills = await getGateKills();
  const contracts: EnrichedContract[] = [];
  for (const o of getOpportunities()) {
    const enriched = resolveContract(o, type, origin, kills);
    if (enriched) contracts.push(enriched);
  }
  return { contracts, lastModifiedAt: raw.lastModifiedAt, total: contracts.length };
}

/** One pinned courier's revalidation against the live feed. */
export interface PinnedCourierStatus {
  id: number;
  /** Still present in the public contract feed? (false = accepted/cancelled/expired). */
  exists: boolean;
  /** Fresh route legs from the current origin (null if unreachable or gone). */
  approachRoute: RouteSystem[] | null;
  deliveryRoute: RouteSystem[] | null;
  /** Fresh route danger (index + breakdown) for the still-live contract. */
  danger: number;
  dangerSteps: string[];
}

/**
 * Revalidate pinned couriers against the FULL contract feed (not the paged/filtered
 * opportunity grid): does each contract still exist, and — if so — its fresh route
 * + danger from the current origin. This is the courier analogue of
 * resolvePinnedHaulsStatus; availability no longer depends on which opportunities
 * happened to be shipped, so filters/weights/paging can't false-flag a live pin.
 */
export function resolvePinnedCouriersStatus(
  couriers: PinnedCourierStatusRequest[],
  opts: { origin: number | null; routeType: RouteType; kills: GateKillData },
): PinnedCourierStatus[] {
  if (couriers.length === 0) return [];
  // Distinguish "feed never loaded" (cold start / crawl failed → `raw` null) from
  // "feed loaded but this contract is absent" (a real "gone"). Only the former
  // keeps pins available; an empty-but-loaded feed legitimately means gone.
  if (raw === null) {
    return couriers.map((c) => ({ id: c.id, exists: true, approachRoute: null, deliveryRoute: null, danger: 0, dangerSteps: [] }));
  }
  // One pass over the (large) opportunity set, keeping only the pinned ids.
  const wanted = new Set(couriers.map((c) => c.id));
  const found = new Map<number, ContractOpportunity>();
  for (const o of getOpportunities()) {
    if (wanted.has(o.id)) found.set(o.id, o);
  }

  const gone = (id: number): PinnedCourierStatus => ({
    id,
    exists: false,
    approachRoute: null,
    deliveryRoute: null,
    danger: 0,
    dangerSteps: [],
  });

  return couriers.map((c) => {
    const o = found.get(c.id);
    if (!o) return gone(c.id);
    const enriched = resolveContract(o, opts.routeType, opts.origin, opts.kills);
    // Contract still exists but is unreachable from here → keep it available (it's
    // a routing/origin issue, not a "contract gone"), just without a fresh route.
    if (!enriched) return { id: c.id, exists: true, approachRoute: null, deliveryRoute: null, danger: 0, dangerSteps: [] };

    const deliveryIds = enriched.deliveryRoute.map((s) => s.systemId);
    const approachIds = enriched.approachRoute ? enriched.approachRoute.map((s) => s.systemId) : null;
    const dangerRoute = approachIds ? [...approachIds, ...deliveryIds.slice(1)] : deliveryIds;
    const { index, steps } = dangerForSystems(dangerRoute, opts.kills);
    return {
      id: c.id,
      exists: true,
      approachRoute: enriched.approachRoute,
      deliveryRoute: enriched.deliveryRoute,
      danger: index,
      dangerSteps: steps,
    };
  });
}

export function loadContractsSnapshot(data: { couriers: PublicContract[]; sells: PublicContract[]; lastModifiedAt: number | null }): void {
  raw = {
    contracts: data.couriers,
    sells: data.sells,
    lastModifiedAt: data.lastModifiedAt,
    fetchedAt: Date.now(),
  };
  opportunities = raw.contracts.map(buildOpportunity);
  opportunitiesFetchedAt = raw.fetchedAt;

  for (const fn of refreshListeners) {
    try {
      fn();
    } catch (err) {
      console.error('[Contracts Crawl] load snapshot listener failed:', err);
    }
  }
}
