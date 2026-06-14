// Turns raw public courier contracts into fully enriched table rows:
// applies the cheap collateral/cargo filters first, resolves pickup/dropoff
// locations from the bundled SDE, then computes route jumps, the per-system
// route breakdown and the danger index via ESI.
import type { PublicContract } from '@/api/contracts';
import { getRoute, jumpsFromRoute } from '@/api/routes';
import { loadSystemKills, type SystemKills } from '@/api/systemKills';
import { getStation, getSystem, securityBand } from '@/data/sde';
import { mapWithConcurrency } from '@/utils/concurrency';
import { computeDanger } from './danger';
import type { ContractEndpoint, CourierFilters, CourierRow, RouteSystem } from './types';

const MILLION = 1_000_000;
const ROUTE_CONCURRENCY = 16;

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
  // Player structure (citadel) or unknown — needs authenticated ESI to resolve.
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

function computeTotalJumps(
  hasCurrentStation: boolean,
  jumpsFromCurrent: number | null,
  jumpsToDropoff: number | null,
): number | null {
  if (hasCurrentStation) {
    if (jumpsFromCurrent === null || jumpsToDropoff === null) return null;
    return jumpsFromCurrent + jumpsToDropoff;
  }
  return jumpsToDropoff;
}

function incomePerJump(reward: number, totalJumps: number | null): number | null {
  if (totalJumps === null) return null;
  if (totalJumps === 0) return reward; // same-system haul
  return reward / totalJumps;
}

export interface EnrichOptions {
  signal?: AbortSignal;
  onRouteProgress?: (done: number, total: number) => void;
}

/** Resolve a list of route system ids into the data the danger index needs. */
function toRouteSystems(
  systemIds: number[],
  kills: Map<number, SystemKills>,
): RouteSystem[] {
  return systemIds.map((id) => {
    const system = getSystem(id);
    const security = system?.security ?? 0;
    return {
      systemId: id,
      name: system?.name ?? `System ${id}`,
      security,
      securityBand: securityBand(security),
      shipKills: kills.get(id)?.shipKills ?? 0,
    };
  });
}

export async function enrichContracts(
  contracts: PublicContract[],
  filters: CourierFilters,
  options: EnrichOptions = {},
): Promise<CourierRow[]> {
  const { signal, onRouteProgress } = options;

  const maxCollateral =
    filters.maxCollateralMillions !== null ? filters.maxCollateralMillions * MILLION : Infinity;
  const maxCargo = filters.maxCargoM3 !== null ? filters.maxCargoM3 : Infinity;

  // Cheap filters first — avoids routing contracts we will discard.
  const filtered = contracts.filter(
    (c) => c.collateral <= maxCollateral && c.volume <= maxCargo,
  );

  const currentSystemId = filters.currentSystemId;

  // Single call for cluster-wide recent kills, used by the danger index.
  const kills = await loadSystemKills(signal);

  const now = Date.now();

  const rows = await mapWithConcurrency(
    filtered,
    ROUTE_CONCURRENCY,
    async (c): Promise<CourierRow> => {
      const pickup = resolveEndpoint(c.start_location_id);
      const dropoff = resolveEndpoint(c.end_location_id);

      const deliveryRouteIds =
        pickup.systemId !== null && dropoff.systemId !== null
          ? await getRoute(pickup.systemId, dropoff.systemId, filters.routeType, signal)
          : null;

      const approachRouteIds =
        currentSystemId !== null && pickup.systemId !== null
          ? await getRoute(currentSystemId, pickup.systemId, filters.routeType, signal)
          : null;

      const deliveryRoute = deliveryRouteIds ? toRouteSystems(deliveryRouteIds, kills) : null;
      const approachRoute = approachRouteIds ? toRouteSystems(approachRouteIds, kills) : null;

      const jumpsToDropoff = jumpsFromRoute(deliveryRouteIds);
      const jumpsFromCurrent = jumpsFromRoute(approachRouteIds);

      const totalJumps = computeTotalJumps(
        currentSystemId !== null,
        jumpsFromCurrent,
        jumpsToDropoff,
      );

      const danger = deliveryRoute ? computeDanger(deliveryRoute) : null;

      const issued = Date.parse(c.date_issued);
      const expired = Date.parse(c.date_expired);

      return {
        id: c.contract_id,
        pickup,
        dropoff,
        volume: c.volume,
        reward: c.reward,
        collateral: c.collateral,
        jumpsFromCurrent,
        jumpsToDropoff,
        approachRoute,
        deliveryRoute,
        totalJumps,
        // Income per jump over the whole journey (approach + delivery).
        incomePerJump: incomePerJump(c.reward, totalJumps),
        activeDurationSeconds: (expired - issued) / 1000,
        ageSeconds: (now - issued) / 1000,
        remainingSeconds: (expired - now) / 1000,
        daysToComplete: c.days_to_complete,
        danger: danger ? danger.index : null,
        dangerSteps: danger ? danger.steps : [],
        attractivity: 0, // filled in by computeAttractivity
        attractivitySteps: [],
      };
    },
    onRouteProgress,
  );

  return rows;
}
