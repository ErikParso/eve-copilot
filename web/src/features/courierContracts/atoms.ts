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
import type { PackageRow } from '@/features/packages/types';
import { pinnedHaulsAtom, pinnedCouriersAtom, pinnedRoutesAtom } from '@/features/arbitrage/atoms';
import { pinnedPackagesAtom } from '@/features/packages/atoms';

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
  // v5: removed the value-at-risk factor, so reset old (4-factor) saves.
  'eve-multitool.attractivityWeights.v5',
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
/** Server-scored sell-contract (package) row (attractivity from the BE). */
export type ScoredPackage = PackageRow;

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
  /** Sell contracts (packages) that fit the requester's hold/wallet, server-scored. */
  packages: ScoredPackage[];
  error: string | null;
  /** When the contracts snapshot was built by CCP (epoch ms), or null. */
  contractsAsOf: number | null;
  /** Market-crawl readiness + freshness from the API. */
  market: MarketMeta | null;
  /** Total candidates the server scored before paging (for the pager + count). */
  total: number;
  /** 1-based page the shipped opportunities belong to. */
  page: number;
  /** Items per page the server used (for sizing the pager). */
  pageSize: number;
}

export const haulingDataAtom = atom<HaulingData>({
  status: 'idle',
  courier: [],
  arbitrage: [],
  packages: [],
  total: 0,
  page: 1,
  pageSize: 48,
  error: null,
  contractsAsOf: null,
  market: null,
});

/**
 * 1-based current page of the opportunity grid. Server-side paging: changing this
 * re-fetches that page (the controller reads it). Reset to 1 whenever a user
 * action re-ranks the set (weights/route/cargo/tax/filter); background refreshes
 * keep the current page. Pinned items are NOT paged — they render in their own
 * always-visible section — so this only governs the available-opportunity grid.
 */
export const haulingPageAtom = atom<number>(1);

/**
 * Pinned cards (courier + arbitrage + package), hydrated with live transit/secured
 * routes from the cache. These are the user's ACTIVE hauls and are shown in their
 * own always-visible section (unpaged, above the opportunity grid), so they're
 * split out from the server-paged available rows below. Carry no attractivity
 * (they're not ranked against the menu). Empty until we have a successful load.
 */
export const pinnedRowsAtom = atom<ResultCard[]>((get) => {
  // Pins are the user's ACTIVE work and come from client-side storage, so they
  // render regardless of the fetch status — including during a user-invoked
  // reload. They live in their own section above the grid (not among the
  // skeletons), so there's no stale-next-to-skeleton concern that blanks them.
  const origin = get(characterStatusAtom)?.systemId ?? null;
  const routeType = get(preferencesAtom).routeType;
  const routesCache = get(pinnedRoutesAtom);

  const pinnedCouriers = get(pinnedCouriersAtom);
  const updatedPinnedCouriers = pinnedCouriers.map((c) => {
    // Only `transit` (cargo loaded) uses the delivery-only override; secured still
    // shows the full origin→pickup→dropoff route from the server revalidation.
    const isTransit = c.status === 'transit';
    // `unavailable` is now set by the same-cycle server revalidation against the
    // FULL contract feed (updatePinnedCourierStatusesAtom), not derived from the
    // paged/filtered opportunity grid — so filters/weights/paging can't false-flag it.
    let item = { ...c };
    if (isTransit && origin !== null && c.dropoff?.systemId) {
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

  const pinnedPackages = get(pinnedPackagesAtom);
  const updatedPinnedPackages = pinnedPackages.map((p) => {
    const isTransit = p.status === 'transit';
    let item = { ...p };
    if (isTransit && origin !== null && p.dest?.systemId) {
      const cacheKey = `${origin}-${p.dest.systemId}-${routeType}`;
      const cached = routesCache[cacheKey];
      if (cached) {
        item = {
          ...item,
          approachRoute: null,
          deliveryRoute: cached.route,
          jumpsFromCurrent: null,
          jumpsToDest: cached.jumps,
          totalJumps: cached.jumps,
          profitPerJump: cached.jumps !== null && cached.jumps > 0 ? (p.profit ?? 0) / cached.jumps : (p.profit ?? 0),
        };
      }
    }
    return item;
  });

  return [
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
    ...updatedPinnedPackages.map((p) => ({
      kind: 'pinned-package' as const,
      key: `pp:${p.id}`,
      row: { ...p, attractivity: 0, attractivitySteps: [] },
    })),
  ];
});

/**
 * Available opportunity cards for the CURRENT server page. These arrive already
 * filtered, scaled and SCORED on the server, so the FE just wraps them as cards
 * (no re-score). Pinned ids are excluded so an active haul doesn't also appear in
 * the ranked grid. The server handles paging, so this is exactly one page's worth.
 */
export const availableRowsAtom = atom<ResultCard[]>((get) => {
  const data = get(haulingDataAtom);
  // Only render cards once we have a successful result. While loading (a user
  // action cleared us to 'loading') the page shows a full skeleton grid INSTEAD
  // of any cards, so nothing stale lingers next to the skeletons. Automatic
  // reloads keep status 'success', so they never blank.
  if (data.status !== 'success') return [];

  const pinnedCourierIds = new Set(get(pinnedCouriersAtom).map((c) => c.id));
  const pinnedIds = new Set(get(pinnedHaulsAtom).map((h) => h.id));
  const pinnedPackageIds = new Set(get(pinnedPackagesAtom).map((p) => p.id));

  return [
    ...data.courier
      .filter((c) => !pinnedCourierIds.has(c.id))
      .map((c) => ({ kind: 'courier' as const, key: `c:${c.id}`, row: { ...c, attractivitySteps: [] } })),
    ...data.arbitrage
      .filter((a) => !pinnedIds.has(a.id))
      .map((a) => ({ kind: 'arbitrage' as const, key: `a:${a.id}`, row: { ...a, attractivitySteps: [] } })),
    ...data.packages
      .filter((p) => !pinnedPackageIds.has(p.id))
      .map((p) => ({ kind: 'package' as const, key: `pkg:${p.id}`, row: { ...p, attractivitySteps: [] } })),
  ];
});
