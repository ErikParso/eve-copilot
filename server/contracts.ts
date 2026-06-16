// Crawls every region's public courier contracts, enriches them (routes via the
// local engine + danger), and caches the result in memory. Refreshed on a timer
// so all clients share one crawl. Attractivity scoring stays on the client.
import { esiGet, esiGetPaged, mapWithConcurrency } from './esi.js';
import { getShipKills } from './kills.js';
import { getRoute, type RouteType } from './routing.js';
import { resolveEndpoint, toRouteSystems } from './enrich.js';
import type { EnrichedContract, PublicContract } from './types.js';

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
  } catch {
    // Region with no contracts returns 404 — ignore.
  }
  return { contracts: collected, lastModified };
}

async function crawlContracts(): Promise<{ contracts: PublicContract[]; lastModifiedAt: number | null }> {
  const regionIds = await fetchRegionIds();
  const perRegion = await mapWithConcurrency(regionIds, 16, fetchRegionCouriers);
  const lms = perRegion.map((r) => r.lastModified).filter((v): v is number => v !== null);
  return {
    contracts: perRegion.flatMap((r) => r.contracts),
    lastModifiedAt: lms.length ? Math.max(...lms) : null,
  };
}

// --- Enrichment ----------------------------------------------------------

/**
 * Resolve one contract into a client row by adding its endpoints, the two route
 * legs (delivery pickup→dropoff, plus approach current system→pickup when an
 * origin is given) and freshly-computed listing times. Jumps, income/jump and
 * danger are derived from the routes on the FE. getRoute memoises the search.
 */
function resolveContract(
  c: PublicContract,
  type: RouteType,
  origin: number | null,
  kills: Map<number, number>,
): EnrichedContract {
  const pickup = resolveEndpoint(c.start_location_id);
  const dropoff = resolveEndpoint(c.end_location_id);

  const deliveryIds =
    pickup.systemId !== null && dropoff.systemId !== null
      ? getRoute(pickup.systemId, dropoff.systemId, type)
      : null;
  const deliveryRoute = deliveryIds ? toRouteSystems(deliveryIds, kills) : null;

  let approachRoute: EnrichedContract['approachRoute'] = null;
  if (origin !== null && pickup.systemId !== null) {
    const approachIds = getRoute(origin, pickup.systemId, type);
    approachRoute = approachIds ? toRouteSystems(approachIds, kills) : null;
  }

  const issued = Date.parse(c.date_issued);
  const expired = Date.parse(c.date_expired);
  const now = Date.now();

  return {
    id: c.contract_id,
    pickup,
    dropoff,
    volume: c.volume,
    reward: c.reward,
    collateral: c.collateral,
    approachRoute,
    deliveryRoute,
    activeDurationSeconds: (expired - issued) / 1000,
    ageSeconds: (now - issued) / 1000,
    remainingSeconds: (expired - now) / 1000,
    daysToComplete: c.days_to_complete,
  };
}

// --- Cache ---------------------------------------------------------------
//
// Only the raw crawl is cached. Routes are resolved on every request, which is
// cheap because the graph search is memoised per (origin, dest, type) by
// routing.ts's routeCache; a request only re-runs the light endpoint / route /
// danger mapping (and so the listing times are always fresh).

interface RawState {
  contracts: PublicContract[];
  lastModifiedAt: number | null;
  fetchedAt: number;
}

let raw: RawState | null = null;
let crawling: Promise<void> | null = null;

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

/** Enriched contracts for a route type, optionally with approach legs from an origin system. */
export async function getEnrichedContracts(
  type: RouteType,
  origin: number | null,
): Promise<ContractsResponse> {
  if (!raw) await refresh();
  if (!raw) return { contracts: [], lastModifiedAt: null, total: 0 };

  const kills = await getShipKills();
  const contracts = raw.contracts.map((c) => resolveContract(c, type, origin, kills));
  return { contracts, lastModifiedAt: raw.lastModifiedAt, total: contracts.length };
}
