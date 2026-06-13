import type { RouteType } from '@/api/routes';
import type { SecurityBand } from '@/data/sde';

export type { RouteType };

/** User-editable search filters. `null` means "no limit / not set". */
export interface CourierFilters {
  /** Maximum collateral in millions of ISK. */
  maxCollateralMillions: number | null;
  /** Maximum cargo volume in m³. */
  maxCargoM3: number | null;
  routeType: RouteType;
  /** Origin station id for the "jumps from current station" column. */
  currentStationId: number | null;
}

export const DEFAULT_FILTERS: CourierFilters = {
  maxCollateralMillions: null,
  maxCargoM3: null,
  routeType: 'safest',
  currentStationId: null,
};

/** A resolved contract endpoint (station or unresolvable structure). */
export interface ContractEndpoint {
  locationId: number;
  /** Station/structure name, or a fallback label for unresolved structures. */
  name: string;
  systemName: string | null;
  systemId: number | null;
  security: number | null;
  securityBand: SecurityBand | null;
  /** True when this is an NPC station we could resolve from the SDE. */
  resolved: boolean;
}

/** A courier contract enriched with locations, jumps and attractivity. */
export interface CourierRow {
  id: number;
  pickup: ContractEndpoint;
  dropoff: ContractEndpoint;
  volume: number;
  reward: number;
  collateral: number;
  /** Jumps from current station to pickup; null if no station / no route. */
  jumpsFromCurrent: number | null;
  /** Jumps from pickup to dropoff; null if no route. */
  jumpsToDropoff: number | null;
  /** Sum of approach + delivery jumps used for income-per-jump. */
  totalJumps: number | null;
  /** Reward divided by total jumps (reward itself when totalJumps is 0). */
  incomePerJump: number | null;
  /** Total listing lifetime in seconds (issued → expired). */
  activeDurationSeconds: number;
  /** Seconds until the contract expires (from now). */
  remainingSeconds: number;
  /** Days the hauler has to complete after accepting. */
  daysToComplete: number;
  /** Attractivity index 0–100, recomputed per selected method. */
  attractivity: number;
}

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface SearchProgress {
  phase: 'contracts' | 'routing' | 'done';
  regionsDone: number;
  regionsTotal: number;
  routesDone: number;
  routesTotal: number;
}

export const EMPTY_PROGRESS: SearchProgress = {
  phase: 'contracts',
  regionsDone: 0,
  regionsTotal: 0,
  routesDone: 0,
  routesTotal: 0,
};
