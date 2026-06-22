// Global hauling data + view state (jotai). The raw fetched data is shared by
// both the Hauling and Copilot tabs; the displayed cards are derived from it +
// the global preferences so changing cargo/ISK/contract-type/weights re-filters
// and re-scores instantly without a re-fetch.
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { characterStatusAtom, characterWalletAtom } from '@/features/auth/atoms';
import { preferencesAtom } from '@/features/preferences/atoms';
import { DEFAULT_WEIGHTS, type AttractivityWeights } from './attractivity';
import { scoreCombined, type ResultCard } from './combined';
import { scaleArbitrage } from '@/features/arbitrage/scale';
import type { CourierRow, SearchStatus, SortOptionId } from './types';
import type { ArbitrageItem, MarketMeta } from '@/features/arbitrage/types';
import { pinnedHaulsAtom, pinnedCouriersAtom, pinnedRoutesAtom } from '@/features/arbitrage/atoms';

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
  // v3: dropped cargo/investment factors, so reset old saves.
  'eve-multitool.attractivityWeights.v3',
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

  // ISK ceiling = your live wallet (hide what you can't cover); no wallet = no cap.
  const maxCollateral = get(characterWalletAtom)?.balance ?? Infinity;
  const maxCargo = prefs.cargoM3 ?? Infinity;

  const courierRows = data.courier.filter((c) => c.collateral <= maxCollateral && c.volume <= maxCargo);
  const arbRows = data.arbitrage
      .map((a) => scaleArbitrage(a, maxCargo, maxCollateral))
      .filter((a): a is NonNullable<typeof a> => a !== null);

  const origin = get(characterStatusAtom)?.systemId ?? null;
  const routeType = prefs.routeType;
  const routesCache = get(pinnedRoutesAtom);

  const pinnedCouriers = get(pinnedCouriersAtom);
  const liveCourierIds = new Set(data.courier.map((c) => c.id));
  const updatedPinnedCouriers = pinnedCouriers.map((c) => {
    const isSecured = c.status === 'secured';
    const isUnavailable = c.status === 'planned' && !liveCourierIds.has(c.id);
    let item = {
      ...c,
      unavailable: isUnavailable,
    };
    if (isSecured && origin !== null && c.dropoff?.systemId) {
      const cacheKey = `${origin}-${c.dropoff.systemId}-${routeType}`;
      const cached = routesCache[cacheKey];
      if (cached) {
        item = {
          ...item,
          approachRoute: null,
          deliveryRoute: cached.route,
          jumpsFromCurrent: null,
          jumpsToDropoff: cached.jumps,
          totalJumps: cached.jumps,
          incomePerJump: cached.jumps !== null && cached.jumps > 0 ? c.reward / cached.jumps : c.reward,
        };
      }
    }
    return item;
  });
  const pinnedCourierIds = new Set(pinnedCouriers.map((c) => c.id));
  const filteredCourierRows = courierRows.filter((c) => !pinnedCourierIds.has(c.id));

  const pinnedHauls = get(pinnedHaulsAtom);
  const updatedPinnedHauls = pinnedHauls.map((h) => {
    const isTransit = h.status === 'transit';
    let item = { ...h };
    if (isTransit && origin !== null && h.dest?.systemId) {
      const cacheKey = `${origin}-${h.dest.systemId}-${routeType}`;
      const cached = routesCache[cacheKey];
      if (cached) {
        item = {
          ...item,
          approachRoute: null,
          deliveryRoute: cached.route,
          jumpsFromCurrent: null,
          jumpsToDest: cached.jumps,
          totalJumps: cached.jumps,
          profitPerJump: cached.jumps !== null && cached.jumps > 0 ? (h.profit ?? 0) / cached.jumps : (h.profit ?? 0),
        };
      }
    }
    return item;
  });
  const pinnedIds = new Set(pinnedHauls.map((h) => h.id));
  const filteredArbRows = arbRows.filter((a) => !pinnedIds.has(a.id));

  return scoreCombined(filteredCourierRows, filteredArbRows, updatedPinnedHauls, updatedPinnedCouriers, weights);
});
