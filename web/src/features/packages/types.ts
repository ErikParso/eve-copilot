import type { ContractEndpoint, RouteSystem } from '@/features/courierContracts/types';

/** One line of a sell-contract package, fitted to the cargo hold: what you carry
 *  & sell at the destination, and what's left in station (valued at market). A
 *  type can straddle the cargo line — part hauled, part left. */
export interface PackageLineResult {
  typeId: number;
  itemName: string;
  quantity: number;
  /** Blueprint copies can't be sold on the market — always valued at 0. */
  isBlueprintCopy: boolean;
  /** Volume of one unit (m³). */
  unitVolume: number;
  /** CCP reference value per unit (ISK), or null. */
  marketPrice: number | null;
  /** Units carried to the destination and sold there. */
  soldQuantity: number;
  /** Gross ISK those hauled units fetch at the destination (before tax). */
  sellValue: number;
  /** Units left in station (don't fit the hold, or can't sell at the dest). */
  leftQuantity: number;
  /** Nominal market value of the left-behind units. */
  leftMarketValue: number;
}

/**
 * One sell-contract opportunity, hydrated and ready to render. The server sends
 * the fixed price/content, the best destination and the route legs; jumps /
 * per-jump / danger are derived on the FE from the routes (see hydratePackage).
 */
export interface PackageItem {
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
  /** Per-line fitted breakdown (hauled vs left) at `dest`. */
  contents: PackageLineResult[];
  /** Σ gross dest revenue of the hauled units (before tax). */
  sellValue: number;
  /** Σ nominal market value of the units left in station. */
  leftMarketValue: number;
  /** True when cargo forced part of the bundle to be left behind. */
  limited: boolean;
  /** Net profit after sales tax: sellValue·(1−tax) − price. */
  profit: number;
  /** profit ÷ price × 100. */
  marginPct: number;
  /** Sales tax baked into `profit`. */
  salesTax: number;
  issuedAt: number;
  expiresAt: number;
  /** Jumps from the current system to the source station (null if no origin). */
  jumpsFromCurrent: number | null;
  /** Jumps from the source to the dest station (null if no route). */
  jumpsToDest: number | null;
  /** Systems on the current-system → source route (null if not applicable). */
  approachRoute: RouteSystem[] | null;
  /** Systems on the source → dest route (null if no route). */
  deliveryRoute: RouteSystem[] | null;
  /** Sum of approach + delivery jumps. */
  totalJumps: number | null;
  /** Profit divided by total journey jumps (profit itself when 0 jumps). */
  profitPerJump: number | null;
  danger: number | null;
  dangerSteps: string[];
}

/** A package opportunity with the server attractivity score added. */
export interface PackageRow extends PackageItem {
  attractivity: number;
  attractivitySteps: string[];
}
