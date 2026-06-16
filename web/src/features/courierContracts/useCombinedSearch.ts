import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useStore } from 'jotai';
import { computeAttractivity } from './attractivity';
import { computeArbitrageAttractivity } from '@/features/arbitrage/attractivity';
import { attractivityWeightsAtom, combinedResultAtom, draftFiltersAtom } from './atoms';
import { sortCombined, type ResultCard } from './combined';
import { deriveJourney, perJump } from './journey';
import type { CourierRow } from './types';
import type { ArbitrageItem, MarketMeta } from '@/features/arbitrage/types';

const MILLION = 1_000_000;

// The server ships only endpoints, economics and the route legs; jumps,
// income/profit-per-jump and danger are derived here from the routes.
type ApiContract = Pick<
  CourierRow,
  | 'id'
  | 'pickup'
  | 'dropoff'
  | 'volume'
  | 'reward'
  | 'collateral'
  | 'approachRoute'
  | 'deliveryRoute'
  | 'activeDurationSeconds'
  | 'ageSeconds'
  | 'remainingSeconds'
  | 'daysToComplete'
>;
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
  | 'buyCost'
  | 'profit'
  | 'marginPct'
  | 'source'
  | 'dest'
  | 'approachRoute'
  | 'deliveryRoute'
>;
interface ContractsResponse {
  contracts: ApiContract[];
  lastModifiedAt: number | null;
  total: number;
}
interface ArbitrageResponse {
  items: ApiArbitrageItem[];
  meta: MarketMeta;
}

/** Add the route-derived fields (jumps, per-jump rate, danger) to an API row. */
function hydrateContract(c: ApiContract, hasOrigin: boolean): Omit<CourierRow, 'attractivity' | 'attractivitySteps'> {
  const j = deriveJourney(c.approachRoute, c.deliveryRoute, hasOrigin);
  return {
    ...c,
    jumpsFromCurrent: j.jumpsFromCurrent,
    jumpsToDropoff: j.jumpsToDest,
    totalJumps: j.totalJumps,
    incomePerJump: perJump(c.reward, j.totalJumps),
    danger: j.danger,
    dangerSteps: j.dangerSteps,
  };
}

function hydrateArbitrage(a: ApiArbitrageItem, hasOrigin: boolean): ArbitrageItem {
  const j = deriveJourney(a.approachRoute, a.deliveryRoute, hasOrigin);
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

    const filters = store.get(draftFiltersAtom);
    const weights = store.get(attractivityWeightsAtom);

    setResult({ status: 'loading', rows: [], error: null, contractsAsOf: null, market: null });

    try {
      // Both endpoints take only routeType + origin (for route resolution); all
      // user filtering happens here on the client.
      const params = new URLSearchParams({ routeType: filters.routeType });
      if (filters.currentSystemId !== null) params.set('origin', String(filters.currentSystemId));

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
        filters.maxCollateralMillions !== null ? filters.maxCollateralMillions * MILLION : Infinity;
      const maxCargo = filters.maxCargoM3 !== null ? filters.maxCargoM3 : Infinity;
      const hasOrigin = filters.currentSystemId !== null;

      const courierRows = computeAttractivity(
        contractData.contracts
          .map((c) => hydrateContract(c, hasOrigin))
          .filter((c) => c.collateral <= maxCollateral && c.volume <= maxCargo)
          .map((c) => ({ ...c, attractivity: 0, attractivitySteps: [] })),
        weights,
      );
      // Same filters mapped to arbitrage: capital tied up ↔ collateral, haul
      // size ↔ cargo.
      const arbRows = computeArbitrageAttractivity(
        arbData.items
          .map((a) => hydrateArbitrage(a, hasOrigin))
          .filter((a) => a.buyCost <= maxCollateral && a.totalVolume <= maxCargo),
      );

      const cards: ResultCard[] = [
        ...courierRows.map((row) => ({ kind: 'courier' as const, key: `c:${row.id}`, row })),
        ...arbRows.map((row) => ({ kind: 'arbitrage' as const, key: `a:${row.id}`, row })),
      ];

      setResult({
        status: 'success',
        rows: sortCombined(cards, filters.sortBy),
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
