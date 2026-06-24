// Crawls every region's public courier contracts, enriches them (routes via the
// local engine + danger), and caches the result in memory. Refreshed on a timer
// so all clients share one crawl. Attractivity scoring stays on the client.
import { esiGet, esiGetPaged, mapWithConcurrency, EsiError } from './esi.js';
import { getShipKills } from './kills.js';
import { getRoute, type RouteType } from './routing.js';
import { resolveEndpoint, toRouteSystems } from './enrich.js';
import type { ContractOpportunity, EnrichedContract, PublicContract } from './types.js';

const REFRESH_MS = 10 * 60 * 1000;

// --- ESI crawl -----------------------------------------------------------

async function fetchRegionIds(): Promise<number[]> {
  return esiGet<number[]>('/universe/regions/');
}

async function fetchRegionCouriers(
  regionId: number,
): Promise<{ contracts: PublicContract[]; lastModified: number | null }> {
  const collected: PublicContract[] = [];
  let lastModified: number | null = null;
  try {
    const first = await esiGetPaged<PublicContract[]>(`/contracts/public/${regionId}/`, 1);
    lastModified = first.lastModified;
    const keep = (list: PublicContract[]) => {
      for (const c of list) if (c.type === 'courier') collected.push(c);
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
      console.error(`[Contracts Crawl] Error fetching region ${regionId}:`, err);
    }
  }
  return { contracts: collected, lastModified };
}

async function crawlContracts(): Promise<{ contracts: PublicContract[]; lastModifiedAt: number | null }> {
  const regionIds = await fetchRegionIds();
  console.log(`[Contracts Crawl] Starting crawl for public courier contracts in ${regionIds.length} regions...`);
  let regionsParsed = 0;
  let totalCouriers = 0;
  const perRegion = await mapWithConcurrency(regionIds, 16, async (regionId) => {
    const res = await fetchRegionCouriers(regionId);
    regionsParsed++;
    totalCouriers += res.contracts.length;
    if (regionsParsed % 10 === 0 || regionsParsed === regionIds.length) {
      console.log(`[Contracts Crawl] Progress: ${regionsParsed}/${regionIds.length} regions parsed (${totalCouriers} couriers found)...`);
    }
    return res;
  });
  console.log(`[Contracts Crawl] Finished! Cached ${totalCouriers} courier contracts.`);
  const lms = perRegion.map((r) => r.lastModified).filter((v): v is number => v !== null);
  return {
    contracts: perRegion.flatMap((r) => r.contracts),
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
  kills: Map<number, number>,
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
  lastModifiedAt: number | null;
  fetchedAt: number;
}

let raw: RawState | null = null;
let crawling: Promise<void> | null = null;
let opportunities: ContractOpportunity[] = [];
let opportunitiesFetchedAt = -1;

async function refresh(): Promise<void> {
  if (crawling) return crawling;
  crawling = (async () => {
    const result = await crawlContracts();
    raw = { ...result, fetchedAt: Date.now() };
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
  if (!raw) await refresh();
  if (!raw) return { contracts: [], lastModifiedAt: null, total: 0 };

  const kills = await getShipKills();
  const contracts: EnrichedContract[] = [];
  for (const o of getOpportunities()) {
    const enriched = resolveContract(o, type, origin, kills);
    if (enriched) contracts.push(enriched);
  }
  return { contracts, lastModifiedAt: raw.lastModifiedAt, total: contracts.length };
}
