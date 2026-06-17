// Global hauling data + view state (jotai). The raw fetched data is shared by
// both the Hauling and Copilot tabs; the displayed cards are derived from it +
// the global preferences so changing cargo/ISK/contract-type/weights re-filters
// and re-scores instantly without a re-fetch.
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { preferencesAtom } from '@/features/preferences/atoms';
import { DEFAULT_WEIGHTS, type AttractivityWeights } from './attractivity';
import { scoreCombined, type ResultCard } from './combined';
import type { CourierRow, SearchStatus, SortOptionId } from './types';
import type { ArbitrageItem, MarketMeta } from '@/features/arbitrage/types';

/** Contextual Hauling-page view state (the grid's sort order). */
export interface HaulingView {
  sortBy: SortOptionId;
}

export const haulingViewAtom = atomWithStorage<HaulingView>(
  'eve-multitool.haulingView.v2',
  { sortBy: 'attractivity' },
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

/** A hydrated courier row before scoring (attractivity is added by the scorer). */
export type CourierBase = Omit<CourierRow, 'attractivity' | 'attractivitySteps'>;

/**
 * Raw hydrated hauling data from the server (route-resolved, but unfiltered and
 * unscored). Fetched once by the search controller and shared app-wide.
 */
export interface HaulingData {
  status: SearchStatus;
  courier: CourierBase[];
  arbitrage: ArbitrageItem[];
  error: string | null;
  /** When the contracts snapshot was built by CCP (epoch ms), or null. */
  contractsAsOf: number | null;
  /** Market-crawl readiness + freshness from the arbitrage API. */
  market: MarketMeta | null;
}

export const haulingDataAtom = atom<HaulingData>({
  status: 'idle',
  courier: [],
  arbitrage: [],
  error: null,
  contractsAsOf: null,
  market: null,
});

const MILLION = 1_000_000;

/**
 * The displayed cards: filter the raw data by the global cargo/ISK/contract-type
 * preferences and score by the weights. Recomputes reactively when either the
 * data or the preferences change — no re-fetch needed.
 */
export const haulingRowsAtom = atom<ResultCard[]>((get) => {
  const data = get(haulingDataAtom);
  if (data.status !== 'success') return [];

  const prefs = get(preferencesAtom);
  const weights = get(attractivityWeightsAtom);

  const maxCollateral =
    prefs.availableIskMillions !== null ? prefs.availableIskMillions * MILLION : Infinity;
  const maxCargo = prefs.cargoM3 ?? Infinity;
  const types = prefs.contractTypes;
  const showCourier = types.length === 0 || types.includes('courier');
  const showArbitrage = types.length === 0 || types.includes('arbitrage');

  const courierRows = showCourier
    ? data.courier.filter((c) => c.collateral <= maxCollateral && c.volume <= maxCargo)
    : [];
  const arbRows = showArbitrage
    ? data.arbitrage.filter((a) => a.buyCost <= maxCollateral && a.totalVolume <= maxCargo)
    : [];

  return scoreCombined(courierRows, arbRows, weights);
});
