import type { SecurityBand } from './sde.js';
import type { RouteType } from './routing.js';

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

/** Search inputs for the arbitrage finder (null = "Any / no limit"). */
export interface ArbitrageFilters {
  /** Buy only from this source system (null = anywhere). */
  fromSystemId: number | null;
  /** Sell only into this destination system (null = anywhere). */
  toSystemId: number | null;
  /** Max ISK to spend buying one item's stock (null = no cap). */
  maxInvestment: number | null;
  /** Max cargo volume in m³ the haul may occupy (null = no cap). */
  maxCargo: number | null;
  routeType: RouteType;
  /** Drop opportunities whose haul exceeds this many jumps (null = no cap). */
  maxJumps: number | null;
  /** Sales-tax fraction applied to sell proceeds (e.g. 0.045). */
  salesTaxRate: number;
}

/**
 * One buy-here/sell-there opportunity for a single item type, sent to the
 * client. Mirrors the courier card shape (source/dest endpoints, route, danger)
 * with arbitrage-specific fields (quantity, prices, margin) added.
 */
export interface ArbitrageItem {
  id: string;
  typeId: number;
  itemName: string;
  /** Units to move (capped by order depth, cargo and budget). */
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
  /** Net profit after sales tax. */
  profit: number;
  /** profit ÷ buyCost × 100. */
  marginPct: number;
  source: ContractEndpoint;
  dest: ContractEndpoint;
  jumps: number | null;
  route: RouteSystem[] | null;
  profitPerJump: number | null;
  danger: number | null;
  dangerSteps: string[];
}
