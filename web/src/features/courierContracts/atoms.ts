// Global hauling data + view state (jotai). The raw fetched data is shared by
// both the Hauling and Copilot tabs; the displayed cards are derived from it +
// the global preferences so changing cargo/ISK/contract-type/weights re-filters
// and re-scores instantly without a re-fetch.
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { characterStatusAtom } from '@/features/auth/atoms';
import { preferencesAtom } from '@/features/preferences/atoms';
import { DEFAULT_WEIGHTS, type AttractivityWeights } from './attractivity';
import { type ResultCard } from './combined';
import type { CourierRow, SearchStatus, SortOptionId } from './types';
import type { ScaledArbitrage, MarketMeta } from '@/features/arbitrage/types';
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

/** Server-scored courier row (attractivity computed on the BE; no breakdown). */
export type ScoredCourier = CourierBase & { attractivity: number };
/** Server-scored, already-scaled arbitrage row (attractivity from the BE). */
export type ScoredArbitrage = ScaledArbitrage & { attractivity: number };

/**
 * Hauling data from the server: courier + arbitrage scored TOGETHER on the BE
 * (one attractivity normalisation), already filtered/scaled and truncated to the
 * top-N. The FE does not re-score it. Fetched by the controller, shared app-wide.
 */
export interface HaulingData {
  status: SearchStatus;
  courier: ScoredCourier[];
  /** Already scaled to the requester's cargo/wallet + tax-repriced server-side. */
  arbitrage: ScoredArbitrage[];
  error: string | null;
  /** When the contracts snapshot was built by CCP (epoch ms), or null. */
  contractsAsOf: number | null;
  /** Market-crawl readiness + freshness from the API. */
  market: MarketMeta | null;
  /** Total candidates the server scored before keeping the shipped top-N. */
  total: number;
}

export const haulingDataAtom = atom<HaulingData>({
  status: 'idle',
  courier: [],
  arbitrage: [],
  total: 0,
  error: null,
  contractsAsOf: null,
  market: null,
});

/**
 * The displayed cards. The available courier + arbitrage rows are already
 * filtered, scaled and SCORED on the server (one combined attractivity
 * normalisation), so the FE doesn't re-score them — it just wraps them as cards
 * and overlays the (client-only) pinned items. Recomputes when the server data
 * or the pinned set changes; the page sorts the result.
 */
export const haulingRowsAtom = atom<ResultCard[]>((get) => {
  const data = get(haulingDataAtom);
  if (data.status !== 'success') return [];

  // Available rows arrive already filtered + scaled + scored from the server.
  const courierRows = data.courier;
  const arbRows = data.arbitrage;

  const prefs = get(preferencesAtom);
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

  // Wrap as cards. Available rows carry their server attractivity; pinned items
  // carry no score (shown first regardless) and no breakdown.
  const cards: ResultCard[] = [
    ...updatedPinnedCouriers.map((c) => ({
      kind: 'pinned-courier' as const,
      key: `pc:${c.id}`,
      row: { ...c, attractivity: 0, attractivitySteps: [] },
    })),
    ...updatedPinnedHauls.map((h) => ({
      kind: 'pinned-arbitrage' as const,
      key: `p:${h.id}`,
      row: { ...h, attractivity: 0, attractivitySteps: [] },
    })),
    ...filteredCourierRows.map((c) => ({
      kind: 'courier' as const,
      key: `c:${c.id}`,
      row: { ...c, attractivitySteps: [] },
    })),
    ...filteredArbRows.map((a) => ({
      kind: 'arbitrage' as const,
      key: `a:${a.id}`,
      row: { ...a, attractivitySteps: [] },
    })),
  ];
  return cards;
});
