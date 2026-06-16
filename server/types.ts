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

/**
 * One buy-here/sell-there opportunity for a single item type — the full
 * profitable haul (entire profitable order-book depth) at a default sales tax.
 * Mirrors the courier card shape (source/dest endpoints, approach + delivery
 * routes, danger). All user filtering (collateral/cargo/etc.) happens on the
 * client; the server resolves every item and caches the lot.
 */
export interface ArbitrageItem {
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
  /** Total ISK spent buying the stock (the capital at risk). */
  buyCost: number;
  /** Net profit after the default sales tax. */
  profit: number;
  /** profit ÷ buyCost × 100. */
  marginPct: number;
  source: ContractEndpoint;
  dest: ContractEndpoint;
  /** Jumps from the current system to the buy station (null if no origin). */
  jumpsFromCurrent: number | null;
  /** Jumps from the buy station to the sell station (null if no route). */
  jumpsToDest: number | null;
  /** Systems on the current-system → buy route (null if not applicable). */
  approachRoute: RouteSystem[] | null;
  /** Systems on the buy → sell route (null if no route). */
  deliveryRoute: RouteSystem[] | null;
  /** Sum of approach + delivery jumps (the whole journey). */
  totalJumps: number | null;
  /** Profit divided by total journey jumps (profit itself when 0 jumps). */
  profitPerJump: number | null;
  danger: number | null;
  dangerSteps: string[];
}
