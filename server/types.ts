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
  /** Gank/camp hotspot flag (danger ≥ skull threshold) — for the FE's skull markers. */
  gank: boolean;
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

// --- Sell contracts (packages) ----------------------------------------------
//
// A "package" is a public item_exchange contract sold whole for a fixed price,
// containing multiple item types. The play mirrors arbitrage: buy the bundle at
// the contract's station, haul it, and liquidate every type against destination
// buy orders. Profit = Σ(per-type sell revenue after tax) − the fixed price;
// types that can't be sold there (no bids, or blueprint copies) contribute 0.

/** One line of a sell-contract package (an item type + how many). */
export interface PackageLine {
  typeId: number;
  itemName: string;
  quantity: number;
  /** Blueprint copies can't be sold on the market — always valued at 0. */
  isBlueprintCopy: boolean;
}

/** One matched rung of a line's destination bid ladder: `units` sellable at
 *  `sell` ISK each (dearest first). Cached so the per-request cargo knapsack can
 *  fill the hold by ISK-per-m³ without re-walking the live book. Server-internal. */
export interface PackageRung {
  units: number;
  sell: number;
}

/**
 * Per-line outcome once the bundle is fitted to a cargo hold: what you carry &
 * sell at the destination, and what's left in station (valued at nominal market
 * price). A type can straddle the cargo line — part hauled, part left.
 * In the cached (capacity-unbounded) stage, `soldQuantity` is the full sellable
 * depth and `leftQuantity` is only the unsellable units; the per-request knapsack
 * recomputes both for the requester's hold.
 */
export interface PackageLineResult extends PackageLine {
  /** Volume of one unit (m³). */
  unitVolume: number;
  /** CCP reference value per unit (ISK), or null — values the units left behind. */
  marketPrice: number | null;
  /** Units carried to the destination and sold there (≤ quantity). */
  soldQuantity: number;
  /** Gross ISK those hauled units fetch at the destination (before tax). */
  sellValue: number;
  /** Units left in station (don't fit the hold, or can't sell at the dest). */
  leftQuantity: number;
  /** Nominal market value of the left-behind units (leftQuantity × marketPrice). */
  leftMarketValue: number;
  /** Dest bid ladder (dearest first), capped. Server-internal — present on the
   *  cached opportunity, stripped from shipped items. */
  rungs?: PackageRung[];
}

/**
 * A sell contract resolved into the route-free cached stage: fixed price + the
 * destination that liquidates the FULL bundle best, each line carrying its dest
 * bid ladder. The per-request step (buildPackageCandidates) fits this to the
 * requester's cargo via a knapsack and prices the realized profit. The economic
 * fields below describe the capacity-UNBOUNDED fit; they're recomputed per hold.
 */
export interface PackageOpportunity {
  /** Stable id — the ESI contract_id as a string (matches the card key shape). */
  id: string;
  contractId: number;
  /** Where the package sits — you buy it whole here for `price`. */
  source: ContractEndpoint;
  /** The station that liquidates the bundle for the most profit. */
  dest: ContractEndpoint;
  /** Fixed price paid for the whole package (capital at risk, regardless of fit). */
  price: number;
  /** Full bundle volume (m³). */
  totalVolume: number;
  /** Volume actually carried to the destination (m³) — the fitted subset. */
  hauledVolume: number;
  /** Per-line breakdown (hauled vs left) at `dest`. */
  contents: PackageLineResult[];
  /** Σ gross dest revenue of the hauled units (before tax). */
  sellValue: number;
  /** Σ gross sell value of the FULL bundle at `dest` (capacity-unbounded), for
   *  the discovery profit prune. */
  fullSellValue: number;
  /** Σ nominal market value of the units left in station. */
  leftMarketValue: number;
  /** True when cargo forced part of the bundle to be left behind. */
  limited: boolean;
  /** Net profit after sales tax: sellValue·(1−tax) − price. */
  profit: number;
  /** profit ÷ price × 100. */
  marginPct: number;
  /** Sales tax baked into `profit`, so it can be re-priced when the user's differs. */
  salesTax: number;
  /** Contract listed-at, epoch ms. */
  issuedAt: number;
  /** Contract expiry, epoch ms. */
  expiresAt: number;
}

/**
 * A package opportunity enhanced with its route legs (the per-request stage).
 * Unreachable packages are filtered out before this is built, so `deliveryRoute`
 * is always present and `approachRoute` is null only when no origin was given.
 */
export interface PackageItem extends PackageOpportunity {
  /** Systems on the current-system → source route (null when no origin). */
  approachRoute: RouteSystem[] | null;
  /** Systems on the source → dest route (always reachable). */
  deliveryRoute: RouteSystem[];
}

/** Minimal line for re-pricing a pinned package against the live book — the FE
 *  carries the full content, so the server needs no cache lookup. */
export interface PackageStatusLine {
  typeId: number;
  quantity: number;
  isBlueprintCopy: boolean;
  /** Transit only: units of this type actually loaded in the ship (the frozen
   *  subset). Absent for planning (the server re-knapsacks to the current hold). */
  hauledQuantity?: number;
}

export interface PinnedPackageStatusRequest {
  id: string;
  contractId: number;
  status: 'planning' | 'transit';
  /** Fixed package price (the sunk/at-risk cost). */
  price: number;
  lines: PackageStatusLine[];
  /** Source (contract) system, for routing. */
  sourceSystem: number | null;
  /** Currently-targeted dest station + system (re-priced here; reroute = sell elsewhere). */
  dest: number;
  destSystem: number | null;
  originalProfit?: number;
}

export interface PinnedPackageStatusResponse {
  id: string;
  /** Σ gross dest revenue of the hauled units (before tax). */
  sellValue: number;
  /** Volume carried to the dest (m³) — the fitted subset. */
  hauledVolume: number;
  /** Σ nominal market value of the units left in station. */
  leftMarketValue: number;
  /** True when cargo forced part of the bundle to be left behind. */
  limited: boolean;
  /** Net profit after tax at the targeted dest. */
  profit: number;
  marginPct: number;
  /** Re-priced per-line breakdown at the targeted dest. */
  contents: PackageLineResult[];
  /** Planning only: the contract is no longer in the live public set (bought/expired). */
  contractGone: boolean;
  /** No bids at the dest can absorb any of the bundle any more. */
  buyerGone: boolean;

  approachRoute: RouteSystem[] | null;
  deliveryRoute: RouteSystem[];
  jumpsFromCurrent: number | null;
  jumpsToDest: number | null;
  totalJumps: number | null;
  profitPerJump: number | null;
  danger: number;
  dangerSteps: string[];

  statusKind: 'up' | 'down' | 'zero' | null;
  statusMessage: string;
  borderColor: string;
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
   * Per-unit cargo volume (m³). Used to re-optimize a planning haul to the
   * max-income quantity that fits the requester's current cargo hold.
   */
  unitVolume?: number;
  originalProfit?: number;
  originalQuantity?: number;
  originalBuyPrice?: number;
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
  
  // Dynamic route & metrics resolved on back-end
  approachRoute: RouteSystem[] | null;
  deliveryRoute: RouteSystem[];
  jumpsFromCurrent: number | null;
  jumpsToDest: number | null;
  totalJumps: number | null;
  profitPerJump: number | null;
  danger: number;
  dangerSteps: string[];
  
  // Visual comparisons against original baseline
  statusKind: 'up' | 'down' | 'zero' | null;
  statusMessage: string;
  borderColor: string;
}
