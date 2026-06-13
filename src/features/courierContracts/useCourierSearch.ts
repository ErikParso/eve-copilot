import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { fetchAllCourierContracts, type PublicContract } from '@/api/contracts';
import { computeAttractivity } from './attractivity';
import { enrichContracts } from './enrichContracts';
import {
  attractivityMethodAtom,
  draftFiltersAtom,
  searchProgressAtom,
  searchResultAtom,
} from './atoms';
import { EMPTY_PROGRESS } from './types';

// The all-regions contract fetch is expensive; cache it for the session so
// re-running a search with different filters reuses the data.
const CONTRACTS_TTL_MS = 5 * 60 * 1000;
let contractsCache: { fetchedAt: number; data: PublicContract[] } | null = null;

async function loadContracts(
  onProgress: Parameters<typeof fetchAllCourierContracts>[0],
  signal: AbortSignal,
): Promise<PublicContract[]> {
  if (contractsCache && Date.now() - contractsCache.fetchedAt < CONTRACTS_TTL_MS) {
    return contractsCache.data;
  }
  const data = await fetchAllCourierContracts(onProgress, signal);
  contractsCache = { fetchedAt: Date.now(), data };
  return data;
}

/**
 * Orchestrates a courier search: fetch contracts → filter/resolve/route →
 * score. Exposes `run()` (called on the Search button) plus reactive status,
 * rows and progress. Changing the attractivity method re-scores in place
 * without re-fetching or re-routing.
 */
export function useCourierSearch() {
  const draftFilters = useAtomValue(draftFiltersAtom);
  const method = useAtomValue(attractivityMethodAtom);
  const [result, setResult] = useAtom(searchResultAtom);
  const setProgress = useSetAtom(searchProgressAtom);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const filters = draftFilters;
    setProgress({ ...EMPTY_PROGRESS, phase: 'contracts' });
    setResult({ status: 'loading', rows: [], appliedFilters: filters, error: null });

    try {
      const contracts = await loadContracts(
        (p) =>
          setProgress((prev) => ({
            ...prev,
            phase: 'contracts',
            regionsDone: p.regionsDone,
            regionsTotal: p.regionsTotal,
          })),
        signal,
      );
      if (signal.aborted) return;

      setProgress((prev) => ({ ...prev, phase: 'routing', routesDone: 0, routesTotal: 0 }));
      const enriched = await enrichContracts(contracts, filters, {
        signal,
        onRouteProgress: (done, total) =>
          setProgress((prev) => ({ ...prev, phase: 'routing', routesDone: done, routesTotal: total })),
      });
      if (signal.aborted) return;

      const rows = computeAttractivity(enriched, method);
      setProgress((prev) => ({ ...prev, phase: 'done' }));
      setResult({ status: 'success', rows, appliedFilters: filters, error: null });
    } catch (err) {
      if (signal.aborted) return;
      setResult({
        status: 'error',
        rows: [],
        appliedFilters: filters,
        error: err instanceof Error ? err.message : 'Search failed',
      });
    }
    // `method` intentionally excluded: re-scoring is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftFilters, setProgress, setResult]);

  // Re-score existing rows when the attractivity method changes (no re-fetch).
  useEffect(() => {
    setResult((prev) => {
      if (prev.status !== 'success' || prev.rows.length === 0) return prev;
      return { ...prev, rows: computeAttractivity(prev.rows, method) };
    });
  }, [method, setResult]);

  // Abort any in-flight search on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { run, ...result };
}
