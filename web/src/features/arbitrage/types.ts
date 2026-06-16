import type { ContractEndpoint, RouteSystem } from '@/features/courierContracts/types';

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
  buyCost: number;
  profit: number;
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
  /** Sum of approach + delivery jumps. */
  totalJumps: number | null;
  /** Profit divided by total journey jumps (profit itself when 0 jumps). */
  profitPerJump: number | null;
  danger: number | null;
  dangerSteps: string[];
}

/** An arbitrage opportunity with the client-side attractivity score added. */
export interface ArbitrageRow extends ArbitrageItem {
  attractivity: number;
  attractivitySteps: string[];
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
