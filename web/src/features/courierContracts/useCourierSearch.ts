import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useStore } from 'jotai';
import { computeAttractivity } from './attractivity';
import { sortRows } from './sortContracts';
import { attractivityWeightsAtom, draftFiltersAtom, searchResultAtom } from './atoms';
import type { CourierRow } from './types';

const MILLION = 1_000_000;

// The API returns enriched contracts minus the attractivity fields (those are
// scored client-side from the user's weights).
type ApiContract = Omit<CourierRow, 'attractivity' | 'attractivitySteps'>;

interface ContractsResponse {
  contracts: ApiContract[];
  lastModifiedAt: number | null;
  total: number;
}

/**
 * Runs a courier search: fetches enriched contracts from the API (the heavy
 * crawl/routing happens server-side, shared + cached), then applies the cheap
 * collateral/cargo filters, scores by the user's attractivity weights, and
 * sorts — all on the client.
 */
export function useCourierSearch() {
  // Read filters/weights imperatively so typing doesn't re-render the results.
  const store = useStore();
  const [result, setResult] = useAtom(searchResultAtom);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const filters = store.get(draftFiltersAtom);
    const weights = store.get(attractivityWeightsAtom);

    setResult({ status: 'loading', rows: [], appliedFilters: filters, error: null, contractsAsOf: null });

    try {
      const params = new URLSearchParams({ routeType: filters.routeType });
      if (filters.currentSystemId !== null) params.set('origin', String(filters.currentSystemId));

      const res = await fetch(`/api/contracts?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`Contracts API returned ${res.status}`);
      const data = (await res.json()) as ContractsResponse;
      if (signal.aborted) return;

      const maxCollateral =
        filters.maxCollateralMillions !== null ? filters.maxCollateralMillions * MILLION : Infinity;
      const maxCargo = filters.maxCargoM3 !== null ? filters.maxCargoM3 : Infinity;

      const rows: CourierRow[] = data.contracts
        .filter((c) => c.collateral <= maxCollateral && c.volume <= maxCargo)
        .map((c) => ({ ...c, attractivity: 0, attractivitySteps: [] }));

      const scored = computeAttractivity(rows, weights);
      const sorted = sortRows(scored, filters.sortBy);

      setResult({
        status: 'success',
        rows: sorted,
        appliedFilters: filters,
        error: null,
        contractsAsOf: data.lastModifiedAt,
      });
    } catch (err) {
      if (signal.aborted) return;
      setResult({
        status: 'error',
        rows: [],
        appliedFilters: filters,
        error: err instanceof Error ? err.message : 'Search failed',
        contractsAsOf: null,
      });
    }
  }, [store, setResult]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { run, ...result };
}
