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
 * One matched batch of the profitable order-book walk: `units` bought at `buy`
 * ISK/unit (a single ask price) and sold at `sell` ISK/unit (a single bid
 * price). The ladder lists these most-profitable-first, so a client with a
 * limited hold or wallet can re-walk the top rungs and price exactly the units
 * it can actually carry, instead of linearly scaling the (non-linear) average.
 */
export interface ArbitrageRung {
  units: number;
  buy: number;
  sell: number;
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
  /**
   * The matched batches of the profitable walk (most profitable first), capped
   * for payload. Lets the client price the exact units that fit its hold/wallet.
   * Truncated ladders are reconciled against the full aggregates above (the tail
   * beyond the cap is priced at the remainder's average).
   */
  ladder: ArbitrageRung[];
  /** Sales tax baked into `profit` — so the client can recompute it when scaling. */
  salesTax: number;
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

/**
 * What the server actually ships: a route-enhanced haul whose economics are
 * already SCALED to the requester's cargo/wallet (full-depth values preserved in
 * `full*`), picked as part of the attractivity-ranked top-N. The FE re-derives
 * jumps/danger from the routes and re-scores it in the combined courier+arbitrage
 * set, so no score is shipped.
 */
export interface ScaledArbitrageItem extends ArbitrageItem {
  /** Full-depth units before the cargo/wallet limit. */
  fullQuantity: number;
  /** Full-depth volume (m³) before the limit. */
  fullTotalVolume: number;
  /** True when cargo or wallet capped the haul below its full depth. */
  limited: boolean;
}

export interface PinnedHaulStatusRequest {
  id: string;
  typeId: number;
  source: number;
  dest: number;
  quantity: number;
  status: 'planning' | 'transit';
  boughtPrice?: number;
  /**
   * The order IDs that backed this haul on the previous check (echoed back from
   * the last response). When present, the server flags `stale` if the live set
   * of backing orders has changed since — i.e. specific orders filled/cancelled.
   */
  knownSourceOrderIds?: number[];
  knownDestOrderIds?: number[];
}

export interface PinnedHaulStatusResponse {
  id: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  marginPct: number;
  /** Live depth can't supply the full requested quantity. */
  shortfall: boolean;
  /** No bids reach the destination any more (demand gone). */
  buyerGone: boolean;
  /** No asks left at the source any more (supply gone; planning hauls only). */
  supplyGone: boolean;
  /** The specific orders backing this haul changed since the last check. */
  stale: boolean;
  ladder: ArbitrageRung[];
  /** Live order IDs currently backing the haul — echo back next check for `stale`. */
  sourceOrderIds: number[];
  destOrderIds: number[];
}
