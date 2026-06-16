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
 * A courier contract resolved into an opportunity, BEFORE routing: endpoints +
 * economics + raw timestamps, no routes. This is the cached middle stage. Times
 * are shipped raw (epoch ms) so the FE derives age/remaining fresh per render.
 */
export interface ContractOpportunity {
  id: number;
  pickup: ContractEndpoint;
  dropoff: ContractEndpoint;
  volume: number;
  reward: number;
  collateral: number;
  /** Contract listed-at, epoch ms. */
  issuedAt: number;
  /** Contract expiry, epoch ms. */
  expiresAt: number;
  daysToComplete: number;
}

/**
 * A contract opportunity enhanced with its route legs (the per-request,
 * authoritative stage). Unreachable contracts are filtered out before this is
 * built, so `deliveryRoute` is always present and `approachRoute` is null only
 * when no origin was given. Jumps, income/jump, danger and the listing times are
 * all derived from these fields on the FE.
 */
export interface EnrichedContract extends ContractOpportunity {
  /** Systems on the current-station → pickup route (null when no origin). */
  approachRoute: RouteSystem[] | null;
  /** Systems on the pickup → dropoff route (always reachable). */
  deliveryRoute: RouteSystem[];
}

/**
 * One buy-here/sell-there opportunity for a single item type, BEFORE routing:
 * the full profitable haul (entire profitable order-book depth) at a default
 * sales tax, with endpoints + economics only. This is the cached middle stage.
 */
export interface ArbitrageOpportunity {
  id: string;
  typeId: number;
  itemName: string;
  /** Units to move (the full profitable order-book depth, uncapped). */
  quantity: number;
  /** Volume of one unit (m³). */
  unitVolume: number;
  /** quantity × unitVolume (m³). */
  totalVolume: number;
  /** Volume-weighted buy price (what you pay per unit at the source). */
  buyPrice: number;
  /** Volume-weighted sell price (what you receive per unit at the dest). */
  sellPrice: number;
  /**
   * CCP's reference value per unit (ISK), or null if unknown. Lets the client
   * flag a destination buy order priced far above fair value (bait).
   */
  marketPrice: number | null;
  /** Total ISK spent buying the stock (the capital at risk). */
  buyCost: number;
  /** Net profit after the default sales tax. */
  profit: number;
  /** profit ÷ buyCost × 100. */
  marginPct: number;
  source: ContractEndpoint;
  dest: ContractEndpoint;
}

/**
 * An arbitrage opportunity enhanced with its route legs (the per-request,
 * authoritative stage). Unreachable hauls are filtered out before this is built,
 * so `deliveryRoute` is always present and `approachRoute` is null only when no
 * origin was given. Jumps, profit/jump and danger are derived on the FE.
 */
export interface ArbitrageItem extends ArbitrageOpportunity {
  /** Systems on the current-system → buy route (null when no origin). */
  approachRoute: RouteSystem[] | null;
  /** Systems on the buy → sell route (always reachable). */
  deliveryRoute: RouteSystem[];
}
