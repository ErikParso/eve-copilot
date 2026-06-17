// Global state for the courier page (jotai). The filter inputs and attractivity
// weights are persisted to localStorage so they survive reloads; the last
// search result/progress are transient (kept only for the session).
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { DEFAULT_WEIGHTS, type AttractivityWeights } from './attractivity';
import type { SearchStatus, SortOptionId } from './types';
import type { ResultCard } from './combined';
import type { MarketMeta } from '@/features/arbitrage/types';

/**
 * Contextual Hauling-page state (NOT global preferences): the origin system and
 * the grid's sort order. Capacity/ISK/route/contract-type/weights live in the
 * global Preferences (see features/preferences). Persisted to localStorage.
 */
export interface HaulingView {
  /** Origin solar-system id (live from the character, or manual when logged out). */
  currentSystemId: number | null;
  /** Result ordering for the Hauling grid. */
  sortBy: SortOptionId;
}

export const DEFAULT_HAULING_VIEW: HaulingView = { currentSystemId: null, sortBy: 'attractivity' };

export const haulingViewAtom = atomWithStorage<HaulingView>(
  'eve-multitool.haulingView.v1',
  DEFAULT_HAULING_VIEW,
  undefined,
  { getOnInit: true },
);

/** User-chosen factor weights (0–10 each), persisted to localStorage. */
export const attractivityWeightsAtom = atomWithStorage<AttractivityWeights>(
  // v2: unified courier+arbitrage factor set (ids changed), so reset old saves.
  'eve-multitool.attractivityWeights.v2',
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

