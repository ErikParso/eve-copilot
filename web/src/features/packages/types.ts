import type { ContractEndpoint, RouteSystem } from '@/features/courierContracts/types';

/** One line of a sell-contract package, with its liquidation result at the
 *  chosen destination (sold qty + gross value; unsold/BPC lines value 0). */
export interface PackageLineResult {
  typeId: number;
  itemName: string;
  quantity: number;
  /** Blueprint copies can't be sold on the market — always valued at 0. */
  isBlueprintCopy: boolean;
  /** Units the destination's reachable buy orders can absorb (≤ quantity). */
  soldQuantity: number;
  /** Gross ISK the sold units fetch (before sales tax). */
  sellValue: number;
  /** Volume of one unit (m³). */
  unitVolume: number;
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
  /** Fixed price paid for the whole package (the capital at risk). */
  price: number;
  /** Total package volume (m³). */
  totalVolume: number;
  /** Per-line breakdown at `dest`. */
  contents: PackageLineResult[];
  /** Σ gross sell value across all lines at `dest` (before tax). */
  sellValue: number;
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
