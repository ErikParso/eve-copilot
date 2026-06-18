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
 * A haul the Copilot has reserved, sent back to the plan endpoint so the server
 * can subtract its order-book depth before computing what's still available. The
 * `id` is the basket key, echoed back on the matching CommittedEconomics. Source
 * and dest are STATION ids; quantity is the units the plan wants to move.
 */
export interface ArbitrageCommitment {
  id: string;
  typeId: number;
  source: number;
  dest: number;
  quantity: number;
}

/**
 * One commitment's economics re-derived over the CURRENT book (after the
 * higher-priority commitments ahead of it in the list took their depth). Lean by
 * design — the client already holds the endpoints/routes; only the volatile
 * numbers come back. `shortfall` is true when the live book can no longer supply
 * the full `requested` depth (orders filled/cancelled, or no longer profitable).
 */
export interface CommittedEconomics {
  id: string;
  /** Units the basket asked for. */
  requested: number;
  /** Units actually available now (≤ requested). */
  quantity: number;
  totalVolume: number;
  buyCost: number;
  profit: number;
  marginPct: number;
  buyPrice: number;
  sellPrice: number;
  ladder: ArbitrageRung[];
  shortfall: boolean;
}

/**
 * One stack of cargo the Copilot's ship is carrying, sent to the sell-candidates
 * endpoint so the server can find buyers for it. `typeId` + `qty` only — the
 * server prices it against the live buy book; cost basis stays on the client.
 */
export interface SellHolding {
  typeId: number;
  qty: number;
}

/**
 * One place to sell a held stack, BEFORE routing: a single buy-order station and
 * the revenue its bids yield for up to the held quantity, at the default sales
 * tax. Route-free (the client routes via /api/routes) — the sell-run mirror of
 * ArbitrageOpportunity, but disposal-only (no buy leg, no cost basis).
 */
export interface SellOpportunity {
  /** `${typeId}:${station}`. */
  id: string;
  typeId: number;
  itemName: string;
  /** Units this station's bids can absorb, capped at the held quantity. */
  quantity: number;
  /** Units the holding offered (held qty). */
  requested: number;
  /** Volume of one unit (m³). */
  unitVolume: number;
  /** quantity × unitVolume (m³). */
  totalVolume: number;
  /** Volume-weighted gross bid price per unit. */
  sellPrice: number;
  /** Gross revenue before tax (Σ bid × units). */
  grossRevenue: number;
  /** Revenue after the default sales tax — what actually lands in the wallet. */
  netRevenue: number;
  /** CCP's reference value per unit (ISK), or null — lets the client show demand vs fair value. */
  marketPrice: number | null;
  /** Sales tax baked into netRevenue. */
  salesTax: number;
  /** Where you sell — the buy-order station. */
  dest: ContractEndpoint;
}

/**
 * One place to BUY a cheap stack, BEFORE routing: the cheapest ask station for an
 * item whose asks sit below CCP's reference value, plus context to judge resale
 * (demand and the best-paying bid). Route-free; the client routes via /api/routes
 * and ranks. The buy-run mirror of SellOpportunity — acquisition-only.
 */
export interface BuyOpportunity {
  /** `${typeId}:${station}`. */
  id: string;
  typeId: number;
  itemName: string;
  /** Units available at this station priced under market (the cheap stock). */
  quantity: number;
  /** Volume of one unit (m³). */
  unitVolume: number;
  /** quantity × unitVolume (m³). */
  totalVolume: number;
  /** Volume-weighted ask price per unit (what you pay). */
  askPrice: number;
  /** quantity × askPrice (the capital this candidate ties up). */
  buyCost: number;
  /** CCP's reference value per unit (ISK), or null when unknown. */
  marketPrice: number | null;
  /** How far under market the ask sits: (marketPrice − askPrice) / marketPrice × 100; null when no reference. */
  discountPct: number | null;
  /** Best (dearest) bid for this item anywhere, net of sales tax — the likely resale price. */
  bestResaleNet: number;
  /** Margin if resold into the best bid: (bestResaleNet − askPrice) / askPrice × 100. */
  resaleMarginPct: number;
  /** Where that best bid sits, so the user knows where to take it. */
  bestResaleStation: ContractEndpoint;
  /** Total units bid for across the book — a demand proxy. */
  demandUnits: number;
  /** Where you buy — the cheap ask's station. */
  source: ContractEndpoint;
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
