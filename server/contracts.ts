// Crawls every region's public courier contracts, enriches them (routes via the
// local engine + danger), and caches the result in memory. Refreshed on a timer
// so all clients share one crawl. Attractivity scoring stays on the client.
import { esiGet, esiGetPaged, mapWithConcurrency } from './esi.js';
import { getShipKills } from './kills.js';
import { getRoute, jumpsFromRoute, type RouteType } from './routing.js';
import { getStation, getSystem, securityBand } from './sde.js';
import { computeDanger } from './danger.js';
import type { ContractEndpoint, EnrichedContract, PublicContract, RouteSystem } from './types.js';

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

function resolveEndpoint(locationId: number): ContractEndpoint {
  const station = getStation(locationId);
  if (station) {
    const system = getSystem(station.systemId);
    return {
      locationId,
      name: station.name,
      systemName: system?.name ?? null,
      systemId: station.systemId,
      security: system?.security ?? null,
      securityBand: system ? securityBand(system.security) : null,
      resolved: true,
    };
  }
  return {
    locationId,
    name: `Structure #${locationId}`,
    systemName: null,
    systemId: null,
    security: null,
    securityBand: null,
    resolved: false,
  };
}

function toRouteSystems(systemIds: number[], kills: Map<number, number>): RouteSystem[] {
  return systemIds.map((id) => {
    const system = getSystem(id);
    const security = system?.security ?? 0;
    return {
      systemId: id,
      name: system?.name ?? `System ${id}`,
      security,
      securityBand: securityBand(security),
      shipKills: kills.get(id) ?? 0,
    };
  });
}

function incomePerJump(reward: number, totalJumps: number | null): number | null {
  if (totalJumps === null) return null;
  if (totalJumps === 0) return reward;
  return reward / totalJumps;
}

/** Enrich one contract for a route type (delivery leg only; no origin yet). */
function enrichOne(c: PublicContract, type: RouteType, kills: Map<number, number>): EnrichedContract {
  const pickup = resolveEndpoint(c.start_location_id);
  const dropoff = resolveEndpoint(c.end_location_id);

  const deliveryIds =
    pickup.systemId !== null && dropoff.systemId !== null
      ? getRoute(pickup.systemId, dropoff.systemId, type)
      : null;
  const deliveryRoute = deliveryIds ? toRouteSystems(deliveryIds, kills) : null;
  const jumpsToDropoff = jumpsFromRoute(deliveryIds);
  const danger = deliveryRoute ? computeDanger(deliveryRoute) : null;

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
    jumpsFromCurrent: null,
    jumpsToDropoff,
    approachRoute: null,
    deliveryRoute,
    totalJumps: jumpsToDropoff,
    incomePerJump: incomePerJump(c.reward, jumpsToDropoff),
    activeDurationSeconds: (expired - issued) / 1000,
    ageSeconds: (now - issued) / 1000,
    remainingSeconds: (expired - now) / 1000,
    daysToComplete: c.days_to_complete,
    danger: danger ? danger.index : null,
    dangerSteps: danger ? danger.steps : [],
  };
}

// --- Cache ---------------------------------------------------------------

interface RawState {
  contracts: PublicContract[];
  lastModifiedAt: number | null;
  fetchedAt: number;
}

let raw: RawState | null = null;
let crawling: Promise<void> | null = null;
const enrichedByType = new Map<RouteType, EnrichedContract[]>();

async function refresh(): Promise<void> {
  if (crawling) return crawling;
  crawling = (async () => {
    const result = await crawlContracts();
    raw = { ...result, fetchedAt: Date.now() };
    enrichedByType.clear(); // recompute lazily against fresh data
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

  let rows = enrichedByType.get(type);
  if (!rows) {
    const kills = await getShipKills();
    rows = raw.contracts.map((c) => enrichOne(c, type, kills));
    enrichedByType.set(type, rows);
  }

  if (origin !== null) {
    const kills = await getShipKills();
    rows = rows.map((row) => {
      if (row.pickup.systemId === null) return row;
      const approachIds = getRoute(origin, row.pickup.systemId, type);
      const jumpsFromCurrent = jumpsFromRoute(approachIds);
      const totalJumps =
        jumpsFromCurrent !== null && row.jumpsToDropoff !== null
          ? jumpsFromCurrent + row.jumpsToDropoff
          : null;
      const approachRoute = approachIds ? toRouteSystems(approachIds, kills) : null;

      // Danger reflects the WHOLE journey you'll fly (approach + delivery),
      // matching the route shown. The approach last system == delivery first
      // (the pickup), so drop the seam.
      let danger = row.danger;
      let dangerSteps = row.dangerSteps;
      if (approachRoute && row.deliveryRoute) {
        const full = [...approachRoute, ...row.deliveryRoute.slice(1)];
        const d = computeDanger(full);
        danger = d.index;
        dangerSteps = d.steps;
      }

      return {
        ...row,
        jumpsFromCurrent,
        approachRoute,
        totalJumps,
        incomePerJump: incomePerJump(row.reward, totalJumps),
        danger,
        dangerSteps,
      };
    });
  }

  return { contracts: rows, lastModifiedAt: raw.lastModifiedAt, total: rows.length };
}
