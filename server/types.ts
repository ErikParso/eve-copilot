import type { SecurityBand } from './sde.js';

/** Raw public contract fields from ESI we consume. */
export interface PublicContract {
  contract_id: number;
  type: string;
  start_location_id: number;
  end_location_id: number;
  volume: number;
  reward: number;
  collateral: number;
  price: number;
  days_to_complete: number;
  date_issued: string;
  date_expired: string;
}

export interface RouteSystem {
  systemId: number;
  name: string;
  security: number;
  securityBand: SecurityBand;
  shipKills: number;
}

export interface ContractEndpoint {
  locationId: number;
  name: string;
  systemName: string | null;
  systemId: number | null;
  security: number | null;
  securityBand: SecurityBand | null;
  resolved: boolean;
}

/**
 * Enriched contract sent to the client. Matches the client's CourierRow minus
 * the attractivity fields (those are computed on the FE from user weights).
 */
export interface EnrichedContract {
  id: number;
  pickup: ContractEndpoint;
  dropoff: ContractEndpoint;
  volume: number;
  reward: number;
  collateral: number;
  jumpsFromCurrent: number | null;
  jumpsToDropoff: number | null;
  approachRoute: RouteSystem[] | null;
  deliveryRoute: RouteSystem[] | null;
  totalJumps: number | null;
  incomePerJump: number | null;
  activeDurationSeconds: number;
  ageSeconds: number;
  remainingSeconds: number;
  daysToComplete: number;
  danger: number | null;
  dangerSteps: string[];
}
