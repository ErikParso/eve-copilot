import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useSetAtom, useStore } from 'jotai';
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
  // Read filters/weights imperatively from the store (only when Search runs),
  // so typing in the filters does NOT re-render this hook's consumers (the
  // results grid). Subscribing here would re-render every card on each keystroke.
  const store = useStore();
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

    const filters = store.get(draftFiltersAtom);
    const weights = store.get(attractivityWeightsAtom);
    setProgress({ ...EMPTY_PROGRESS, phase: 'contracts' });
    setResult({
      status: 'loading',
      rows: [],
      appliedFilters: filters,
      error: null,
      contractsAsOf: null,
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
  }, [store, setProgress, setResult]);

  // Abort any in-flight search on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { run, ...result };
}
