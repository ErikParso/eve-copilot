import type { SecurityBand } from '@/data/sde';

/** Route preference, mapped server-side to the routing algorithm. */
export type RouteType = 'safest' | 'shortest';

/** Which kinds of opportunity to show. Empty = no filter (show all). */
export type ContractType = 'arbitrage' | 'courier';

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

/** One solar system on a route, with the data the danger index needs. */
export interface RouteSystem {
  systemId: number;
  name: string;
  security: number;
  securityBand: SecurityBand;
  /** Ship kills in this system in the last hour (0 if no recent activity). */
  shipKills: number;
  /** Gank/camp hotspot flag (server-computed) — drives the skull markers. */
  gank: boolean;
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
