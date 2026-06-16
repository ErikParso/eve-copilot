// Global state for the courier page (jotai). The filter inputs and attractivity
// weights are persisted to localStorage so they survive reloads; the last
// search result/progress are transient (kept only for the session).
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { DEFAULT_WEIGHTS, type AttractivityWeights } from './attractivity';
import { DEFAULT_FILTERS, type CourierFilters, type SearchStatus } from './types';
import type { ResultCard } from './combined';
import type { MarketMeta } from '@/features/arbitrage/types';

/**
 * Filters bound to the form inputs (the "draft", applied on Search click).
 * Persisted to localStorage so the user doesn't have to re-enter them.
 */
export const draftFiltersAtom = atomWithStorage<CourierFilters>(
  'eve-multitool.courierFilters.v2',
  DEFAULT_FILTERS,
  undefined,
  { getOnInit: true },
);

/** User-chosen factor weights (0–10 each), persisted to localStorage. */
export const attractivityWeightsAtom = atomWithStorage<AttractivityWeights>(
  'eve-multitool.attractivityWeights',
  DEFAULT_WEIGHTS,
  undefined,
  { getOnInit: true },
);

/** Combined courier + arbitrage results for the hauling page. */
export interface CombinedResult {
  status: SearchStatus;
  rows: ResultCard[];
  error: string | null;
  /** When the contracts snapshot was built by CCP (epoch ms), or null. */
  contractsAsOf: number | null;
  /** Market-crawl readiness + freshness from the arbitrage API. */
  market: MarketMeta | null;
}

export const combinedResultAtom = atom<CombinedResult>({
  status: 'idle',
  rows: [],
  error: null,
  contractsAsOf: null,
  market: null,
});

