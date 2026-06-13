// Turns raw public courier contracts into fully enriched table rows:
// applies the cheap collateral/cargo filters first, resolves pickup/dropoff
// locations from the bundled SDE, then computes route jumps via ESI.
import type { PublicContract } from '@/api/contracts';
import { getJumps } from '@/api/routes';
import { getStation, getSystem, securityBand } from '@/data/sde';
import { mapWithConcurrency } from '@/utils/concurrency';
import type { ContractEndpoint, CourierFilters, CourierRow } from './types';

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

  const currentStation =
    filters.currentStationId !== null ? getStation(filters.currentStationId) : undefined;
  const currentSystemId = currentStation?.systemId ?? null;

  const now = Date.now();

  const rows = await mapWithConcurrency(
    filtered,
    ROUTE_CONCURRENCY,
    async (c): Promise<CourierRow> => {
      const pickup = resolveEndpoint(c.start_location_id);
      const dropoff = resolveEndpoint(c.end_location_id);

      const jumpsToDropoff =
        pickup.systemId !== null && dropoff.systemId !== null
          ? await getJumps(pickup.systemId, dropoff.systemId, filters.routeType, signal)
          : null;

      const jumpsFromCurrent =
        currentSystemId !== null && pickup.systemId !== null
          ? await getJumps(currentSystemId, pickup.systemId, filters.routeType, signal)
          : null;

      const totalJumps = computeTotalJumps(
        currentSystemId !== null,
        jumpsFromCurrent,
        jumpsToDropoff,
      );

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
        totalJumps,
        incomePerJump: incomePerJump(c.reward, totalJumps),
        activeDurationSeconds: (expired - issued) / 1000,
        remainingSeconds: (expired - now) / 1000,
        daysToComplete: c.days_to_complete,
        attractivity: 0, // filled in by computeAttractivity
        attractivitySteps: [],
      };
    },
    onRouteProgress,
  );

  return rows;
}
