import type { ContractEndpoint, RouteSystem, RouteType } from '@/features/courierContracts/types';

export type { RouteType };

/** How the arbitrage cards are ordered (applied on Search). */
export type ArbitrageSortId =
  | 'attractivity'
  | 'profit'
  | 'margin'
  | 'profitPerJump'
  | 'jumps'
  | 'danger'
  | 'investment';

/** User-editable arbitrage filters. `null` means "Any / no limit". */
export interface ArbitrageFilters {
  /** Buy only from this source system (null = anywhere). */
  fromSystemId: number | null;
  /** Sell only into this destination system (null = anywhere). */
  toSystemId: number | null;
  /** Max ISK (in millions) to spend buying one item's stock. */
  maxInvestmentMillions: number | null;
  /** Max cargo volume in m³. */
  maxCargoM3: number | null;
  routeType: RouteType;
  /** Drop hauls longer than this many jumps (null = no cap). */
  maxJumps: number | null;
  /** Sales-tax percentage applied to sell proceeds (e.g. 4.5). */
  salesTaxPercent: number;
  sortBy: ArbitrageSortId;
}

export const DEFAULT_ARBITRAGE_FILTERS: ArbitrageFilters = {
  fromSystemId: null,
  toSystemId: null,
  maxInvestmentMillions: null,
  maxCargoM3: null,
  routeType: 'safest',
  maxJumps: null,
  salesTaxPercent: 4.5,
  sortBy: 'attractivity',
};

/** One arbitrage opportunity from the API, before client-side scoring. */
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
  jumps: number | null;
  route: RouteSystem[] | null;
  profitPerJump: number | null;
  danger: number | null;
  dangerSteps: string[];
}

/** An arbitrage opportunity with the client-side attractivity score added. */
export interface ArbitrageRow extends ArbitrageItem {
  attractivity: number;
  attractivitySteps: string[];
}

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

/** Market-crawl readiness reported by the API. */
export type MarketStatus = 'cold' | 'warming' | 'ready';

export interface MarketMeta {
  status: MarketStatus;
  builtAt: number | null;
  lastModifiedAt: number | null;
  orderCount: number;
  regions: number;
}
