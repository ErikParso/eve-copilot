import type { RouteType } from '@/api/routes';
import type { SecurityBand } from '@/data/sde';

export type { RouteType };

/** How the result cards are ordered (applied on Search). */
export type SortOptionId =
  | 'attractivity'
  | 'danger'
  | 'income'
  | 'collateral'
  | 'cargo'
  | 'totalJumps'
  | 'jumpsToPickup'
  | 'timeRemaining'
  | 'listedAge';

/** User-editable search filters. `null` means "no limit / not set". */
export interface CourierFilters {
  /** Maximum collateral in millions of ISK. */
  maxCollateralMillions: number | null;
  /** Maximum cargo volume in m³. */
  maxCargoM3: number | null;
  routeType: RouteType;
  /** Origin solar-system id for the "jumps to pickup" calculation. */
  currentSystemId: number | null;
  /** Result ordering, applied on Search. */
  sortBy: SortOptionId;
}

export const DEFAULT_FILTERS: CourierFilters = {
  maxCollateralMillions: null,
  maxCargoM3: null,
  routeType: 'safest',
  currentSystemId: null,
  sortBy: 'attractivity',
};

/** One solar system on a route, with the data the danger index needs. */
export interface RouteSystem {
  systemId: number;
  name: string;
  security: number;
  securityBand: SecurityBand;
  /** Ship kills in this system in the last hour (0 if no recent activity). */
  shipKills: number;
}

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
  /** Systems on the current-station → pickup route (null if not applicable). */
  approachRoute: RouteSystem[] | null;
  /** Systems on the pickup → dropoff route (null if no route). */
  deliveryRoute: RouteSystem[] | null;
  /** Sum of approach + delivery jumps (the whole journey). */
  totalJumps: number | null;
  /** Reward divided by total journey jumps (reward itself when 0 jumps). */
  incomePerJump: number | null;
  /** Total listing lifetime in seconds (issued → expired). */
  activeDurationSeconds: number;
  /** Seconds since the contract was issued (how long it has been listed). */
  ageSeconds: number;
  /** Seconds until the contract expires (from now). */
  remainingSeconds: number;
  /** Days the hauler has to complete after accepting. */
  daysToComplete: number;
  /** Danger index 0–100 for the delivery route (null if no route). */
  danger: number | null;
  /** Step-by-step explanation of how `danger` was calculated. */
  dangerSteps: string[];
  /** Attractivity index 0–100, recomputed per selected method. */
  attractivity: number;
  /** Step-by-step explanation of how `attractivity` was calculated. */
  attractivitySteps: string[];
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
