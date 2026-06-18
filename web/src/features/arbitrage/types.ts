import type { ContractEndpoint, RouteSystem } from '@/features/courierContracts/types';

/**
 * One matched batch of the profitable walk: `units` bought at `buy` ISK/unit and
 * sold at `sell` ISK/unit. Most profitable first — see scaleArbitrage, which
 * re-walks these to price the units that fit your hold/wallet.
 */
export interface ArbitrageRung {
  units: number;
  buy: number;
  sell: number;
}

/**
 * One arbitrage opportunity, hydrated and ready to render (before client-side
 * scoring). The server sends only endpoints, economics and the route legs; the
 * jumps/per-jump/danger fields below are derived on the FE from the routes (see
 * hydrateArbitrage). All filtering is client-side.
 */
export interface ArbitrageItem {
  id: string;
  typeId: number;
  itemName: string;
  quantity: number;
  unitVolume: number;
  totalVolume: number;
  buyPrice: number;
  sellPrice: number;
  /** CCP's reference value per unit (ISK), or null if unknown. */
  marketPrice: number | null;
  buyCost: number;
  profit: number;
  marginPct: number;
  /** Matched batches (most profitable first), capped; used to scale to your hold/wallet. */
  ladder: ArbitrageRung[];
  /** Sales tax baked into `profit`, so the FE can recompute it when scaling. */
  salesTax: number;
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
  /** Sum of approach + delivery jumps. */
  totalJumps: number | null;
  /** Profit divided by total journey jumps (profit itself when 0 jumps). */
  profitPerJump: number | null;
  danger: number | null;
  dangerSteps: string[];
}

/**
 * An arbitrage opportunity scaled to the units that fit your hold + wallet. The
 * economic fields (quantity, totalVolume, buyCost, profit, buyPrice, sellPrice,
 * marginPct) describe the *fitting* portion; the `full*` fields preserve the
 * complete-depth opportunity for display. When nothing constrains you these are
 * equal and `limited` is false. See scaleArbitrage.
 */
export interface ScaledArbitrage extends ArbitrageItem {
  /** Full-depth units of the opportunity (what you'd move with no constraints). */
  fullQuantity: number;
  /** Full-depth volume (m³). */
  fullTotalVolume: number;
  /** True when cargo or wallet stopped you short of the full depth. */
  limited: boolean;
}

/** A scaled arbitrage opportunity with the client-side attractivity score added. */
export interface ArbitrageRow extends ScaledArbitrage {
  attractivity: number;
  attractivitySteps: string[];
}

/**
 * The route-free opportunity shape returned by the Copilot plan endpoint's
 * `available` list (economics + endpoints + ladder, no jumps/danger/routes — the
 * Copilot derives those itself via its route matrix).
 */
export type ArbitrageOpportunity = Omit<
  ArbitrageItem,
  | 'jumpsFromCurrent'
  | 'jumpsToDest'
  | 'approachRoute'
  | 'deliveryRoute'
  | 'totalJumps'
  | 'profitPerJump'
  | 'danger'
  | 'dangerSteps'
>;

/** Lean economics for one basket reservation, re-derived over the live book server-side. */
export interface CommittedEconomics {
  id: string;
  requested: number;
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

/** Market-crawl readiness reported by the API. */
export type MarketStatus = 'cold' | 'warming' | 'ready';

export interface MarketMeta {
  status: MarketStatus;
  builtAt: number | null;
  lastModifiedAt: number | null;
  orderCount: number;
  regions: number;
}
