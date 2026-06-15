// Global state for the arbitrage page (jotai). Filters persist to localStorage;
// the last search result is transient (kept only for the session).
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import {
  DEFAULT_ARBITRAGE_FILTERS,
  type ArbitrageFilters,
  type ArbitrageRow,
  type MarketMeta,
  type SearchStatus,
} from './types';

/** Filters bound to the form inputs (the "draft", applied on Search click). */
export const arbitrageDraftFiltersAtom = atomWithStorage<ArbitrageFilters>(
  'eve-multitool.arbitrageFilters.v1',
  DEFAULT_ARBITRAGE_FILTERS,
  undefined,
  { getOnInit: true },
);

export interface ArbitrageResult {
  status: SearchStatus;
  rows: ArbitrageRow[];
  error: string | null;
  /** Market-crawl readiness + freshness from the API. */
  market: MarketMeta | null;
}

export const arbitrageResultAtom = atom<ArbitrageResult>({
  status: 'idle',
  rows: [],
  error: null,
  market: null,
});
