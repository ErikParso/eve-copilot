// Crawls every region's public courier contracts, enriches them (routes via the
// local engine + danger), and caches the result in memory. Refreshed on a timer
// so all clients share one crawl. Attractivity scoring stays on the client.
import { esiGet, esiGetPaged, mapWithConcurrency, EsiError } from './esi.js';
import { getGateKills } from './gateKills.js';
import { getRoute, type RouteType } from './routing.js';
import { resolveEndpoint, toRouteSystems } from './enrich.js';
import type { ContractOpportunity, EnrichedContract, PublicContract, GateKillData } from './types.js';

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
