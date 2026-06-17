import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useStore } from 'jotai';
import { preferencesAtom } from '@/features/preferences/atoms';
import { attractivityWeightsAtom, combinedResultAtom, haulingViewAtom } from './atoms';
import { scoreCombined } from './combined';
import { deriveJourney, perJump } from './journey';
import type { ContractEndpoint, CourierRow, RouteSystem } from './types';
import type { ArbitrageItem, MarketMeta } from '@/features/arbitrage/types';

const MILLION = 1_000_000;

// The server ships only the cached opportunity (endpoints + economics + raw
// timestamps) plus the resolved route legs; jumps, per-jump rate, danger and the
// listing times are derived here. Unreachable items are dropped server-side, so
// deliveryRoute is always present and approachRoute is null only with no origin.
interface ApiContract {
  id: number;
  pickup: ContractEndpoint;
  dropoff: ContractEndpoint;
  volume: number;
  reward: number;
  collateral: number;
  issuedAt: number;
  expiresAt: number;
  daysToComplete: number;
  approachRoute: RouteSystem[] | null;
  deliveryRoute: RouteSystem[];
}
type ApiArbitrageItem = Pick<
  ArbitrageItem,
  | 'id'
  | 'typeId'
  | 'itemName'
  | 'quantity'
  | 'unitVolume'
  | 'totalVolume'
  | 'buyPrice'
  | 'sellPrice'
  | 'marketPrice'
  | 'buyCost'
  | 'profit'
  | 'marginPct'
  | 'source'
  | 'dest'
  | 'approachRoute'
> & { deliveryRoute: RouteSystem[] };
interface ContractsResponse {
  contracts: ApiContract[];
  lastModifiedAt: number | null;
  total: number;
}
interface ArbitrageResponse {
  items: ApiArbitrageItem[];
  meta: MarketMeta;
}

/** Add the route-derived fields (jumps, per-jump rate, danger) + listing times. */
function hydrateContract(c: ApiContract): Omit<CourierRow, 'attractivity' | 'attractivitySteps'> {
  const j = deriveJourney(c.approachRoute, c.deliveryRoute);
  const now = Date.now();
  return {
    ...c,
    jumpsFromCurrent: j.jumpsFromCurrent,
    jumpsToDropoff: j.jumpsToDest,
    totalJumps: j.totalJumps,
    incomePerJump: perJump(c.reward, j.totalJumps),
    activeDurationSeconds: (c.expiresAt - c.issuedAt) / 1000,
    ageSeconds: (now - c.issuedAt) / 1000,
    remainingSeconds: (c.expiresAt - now) / 1000,
    danger: j.danger,
    dangerSteps: j.dangerSteps,
  };
}

function hydrateArbitrage(a: ApiArbitrageItem): ArbitrageItem {
  const j = deriveJourney(a.approachRoute, a.deliveryRoute);
  return {
    ...a,
    jumpsFromCurrent: j.jumpsFromCurrent,
    jumpsToDest: j.jumpsToDest,
    totalJumps: j.totalJumps,
    profitPerJump: perJump(a.profit, j.totalJumps),
    danger: j.danger,
    dangerSteps: j.dangerSteps,
  };
}

/**
 * Runs the hauling search: fetches courier contracts and arbitrage hauls in
 * parallel (heavy crawl/matching is server-side, shared + cached), scores each
 * by its own attractivity, merges them into one card list and sorts by the
 * chosen option. The arbitrage query is driven entirely by the courier filters
 * (current system → source, max collateral → capital, max cargo → cargo) — the
 * page has no arbitrage-specific inputs.
 */
export function useCombinedSearch() {
  const store = useStore();
  const [result, setResult] = useAtom(combinedResultAtom);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const prefs = store.get(preferencesAtom);
    const view = store.get(haulingViewAtom);
    const weights = store.get(attractivityWeightsAtom);

    setResult({ status: 'loading', rows: [], error: null, contractsAsOf: null, market: null });

    try {
      // Both endpoints take only routeType + origin (for route resolution); all
      // user filtering happens here on the client.
      const params = new URLSearchParams({ routeType: prefs.routeType });
      if (view.currentSystemId !== null) params.set('origin', String(view.currentSystemId));

      const [contractRes, arbRes] = await Promise.all([
        fetch(`/api/contracts?${params.toString()}`, { signal }),
        fetch(`/api/arbitrage?${params.toString()}`, { signal }),
      ]);
      if (!contractRes.ok) throw new Error(`Contracts API returned ${contractRes.status}`);
      if (!arbRes.ok) throw new Error(`Arbitrage API returned ${arbRes.status}`);
      const contractData = (await contractRes.json()) as ContractsResponse;
      const arbData = (await arbRes.json()) as ArbitrageResponse;
      if (signal.aborted) return;

      const maxCollateral =
        prefs.availableIskMillions !== null ? prefs.availableIskMillions * MILLION : Infinity;
      const maxCargo = prefs.cargoM3 !== null ? prefs.cargoM3 : Infinity;

      // Contract-type filter: empty selection means "no filter" (show both).
      const types = prefs.contractTypes;
      const showCourier = types.length === 0 || types.includes('courier');
      const showArbitrage = types.length === 0 || types.includes('arbitrage');

      const courierRows = showCourier
        ? contractData.contracts
            .map((c) => hydrateContract(c))
            .filter((c) => c.collateral <= maxCollateral && c.volume <= maxCargo)
        : [];
      // Same filters mapped to arbitrage: capital tied up ↔ collateral, haul
      // size ↔ cargo.
      const arbRows = showArbitrage
        ? arbData.items
            .map((a) => hydrateArbitrage(a))
            .filter((a) => a.buyCost <= maxCollateral && a.totalVolume <= maxCargo)
        : [];

      // Score both kinds in one pass so attractivity is comparable across the
      // mixed list we render. Ordering is applied live in the page (sort control
      // above the grid), so we store the scored cards unsorted.
      const cards = scoreCombined(courierRows, arbRows, weights);

      setResult({
        status: 'success',
        rows: cards,
        error: null,
        contractsAsOf: contractData.lastModifiedAt,
        market: arbData.meta,
      });
    } catch (err) {
      if (signal.aborted) return;
      setResult({
        status: 'error',
        rows: [],
        error: err instanceof Error ? err.message : 'Search failed',
        contractsAsOf: null,
        market: null,
      });
    }
  }, [store, setResult]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { run, ...result };
}
