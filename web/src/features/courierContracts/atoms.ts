// Global state for the courier page (jotai). The filter inputs and attractivity
// weights are persisted to localStorage so they survive reloads; the last
// search result/progress are transient (kept only for the session).
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { DEFAULT_WEIGHTS, type AttractivityWeights } from './attractivity';
import {
  DEFAULT_FILTERS,
  type CourierFilters,
  type CourierRow,
  type SearchStatus,
} from './types';

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

export interface SearchResult {
  status: SearchStatus;
  rows: CourierRow[];
  /** Filters that produced the current rows (snapshot at Search time). */
  appliedFilters: CourierFilters | null;
  error: string | null;
  /** When the contracts snapshot was built by CCP (epoch ms), or null. */
  contractsAsOf: number | null;
}

export const searchResultAtom = atom<SearchResult>({
  status: 'idle',
  rows: [],
  appliedFilters: null,
  error: null,
  contractsAsOf: null,
});

