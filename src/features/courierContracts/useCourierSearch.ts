import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { fetchAllCourierContracts } from '@/api/contracts';
import { clearRouteCache } from '@/api/routes';
import { clearSystemKillsCache } from '@/api/systemKills';
import { computeAttractivity } from './attractivity';
import { enrichContracts } from './enrichContracts';
import { sortRows } from './sortContracts';
import {
  attractivityWeightsAtom,
  draftFiltersAtom,
  searchProgressAtom,
  searchResultAtom,
} from './atoms';
import { EMPTY_PROGRESS } from './types';

/**
 * Orchestrates a courier search: fetch contracts → filter/resolve/route →
 * score. Exposes `run()` (called on the Search button) plus reactive status,
 * rows and progress. Changing the attractivity method re-scores in place
 * without re-fetching or re-routing.
 */
export function useCourierSearch() {
  const draftFilters = useAtomValue(draftFiltersAtom);
  const weights = useAtomValue(attractivityWeightsAtom);
  const [result, setResult] = useAtom(searchResultAtom);
  const setProgress = useSetAtom(searchProgressAtom);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    // Fetch everything fresh on each search — drop the per-session caches so
    // routes and kills are re-requested (in-search de-duplication still applies).
    clearRouteCache();
    clearSystemKillsCache();

    const filters = draftFilters;
    setProgress({ ...EMPTY_PROGRESS, phase: 'contracts' });
    setResult({
      status: 'loading',
      rows: [],
      appliedFilters: filters,
      error: null,
      contractsAsOf: null,
      contractsExpiresAt: null,
    });

    try {
      // Always fetch the contracts feed fresh on each Search (no caching).
      const contracts = await fetchAllCourierContracts(
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
      const enriched = await enrichContracts(contracts.contracts, filters, {
        signal,
        onRouteProgress: (done, total) =>
          setProgress((prev) => ({ ...prev, phase: 'routing', routesDone: done, routesTotal: total })),
      });
      if (signal.aborted) return;

      const scored = computeAttractivity(enriched, weights);
      const rows = sortRows(scored, filters.sortBy);
      setProgress((prev) => ({ ...prev, phase: 'done' }));
      setResult({
        status: 'success',
        rows,
        appliedFilters: filters,
        error: null,
        contractsAsOf: contracts.lastModifiedAt,
        contractsExpiresAt: contracts.expiresAt,
      });
    } catch (err) {
      if (signal.aborted) return;
      setResult({
        status: 'error',
        rows: [],
        appliedFilters: filters,
        error: err instanceof Error ? err.message : 'Search failed',
        contractsAsOf: null,
        contractsExpiresAt: null,
      });
    }
  }, [draftFilters, weights, setProgress, setResult]);

  // The attractivity method (like the other filters) is applied only on the
  // next Search — `run` reads the current method when invoked.

  // Abort any in-flight search on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { run, ...result };
}
