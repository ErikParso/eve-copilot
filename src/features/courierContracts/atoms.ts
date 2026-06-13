// Global state for the courier page (jotai). Draft filters + selected method
// persist across navigation; the last search result is kept so returning to
// the page does not require re-running the search.
import { atom } from 'jotai';
import {
  DEFAULT_ATTRACTIVITY_METHOD,
  type AttractivityMethod,
} from './attractivity';
import {
  DEFAULT_FILTERS,
  EMPTY_PROGRESS,
  type CourierFilters,
  type CourierRow,
  type SearchProgress,
  type SearchStatus,
} from './types';

/** Filters bound to the form inputs (the "draft", applied on Search click). */
export const draftFiltersAtom = atom<CourierFilters>(DEFAULT_FILTERS);

/** Attractivity method drives recomputation of the index without re-fetching. */
export const attractivityMethodAtom = atom<AttractivityMethod>(DEFAULT_ATTRACTIVITY_METHOD);

export interface SearchResult {
  status: SearchStatus;
  rows: CourierRow[];
  /** Filters that produced the current rows (snapshot at Search time). */
  appliedFilters: CourierFilters | null;
  error: string | null;
}

export const searchResultAtom = atom<SearchResult>({
  status: 'idle',
  rows: [],
  appliedFilters: null,
  error: null,
});

export const searchProgressAtom = atom<SearchProgress>(EMPTY_PROGRESS);
