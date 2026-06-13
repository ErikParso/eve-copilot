import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { fetchAllCourierContracts, type CourierContractsResult } from '@/api/contracts';
import { computeAttractivity } from './attractivity';
import { enrichContracts } from './enrichContracts';
import {
  attractivityWeightsAtom,
  draftFiltersAtom,
  searchProgressAtom,
  searchResultAtom,
} from './atoms';
import { EMPTY_PROGRESS } from './types';

// The all-regions contract fetch is expensive; cache it for the session. The
// feed itself is cached by CCP (~30 min), so we keep our copy until CCP would
// serve fresh data (its `expiresAt`), with a short floor/ceiling as a fallback
// when the header is missing.
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 30 * 60 * 1000;
let contractsCache: { staleAt: number; data: CourierContractsResult } | null = null;

async function loadContracts(
  onProgress: Parameters<typeof fetchAllCourierContracts>[0],
  signal: AbortSignal,
): Promise<CourierContractsResult> {
  if (contractsCache && Date.now() < contractsCache.staleAt) {
    return contractsCache.data;
  }
  const data = await fetchAllCourierContracts(onProgress, signal);
  const now = Date.now();
  // Reuse until CCP's snapshot expires, clamped to a sane window.
  const ttl = data.expiresAt
    ? Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, data.expiresAt - now))
    : MIN_TTL_MS;
  contractsCache = { staleAt: now + ttl, data };
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
  const weights = useAtomValue(attractivityWeightsAtom);
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
    setResult({
      status: 'loading',
      rows: [],
      appliedFilters: filters,
      error: null,
      contractsAsOf: null,
      contractsExpiresAt: null,
    });

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
      const enriched = await enrichContracts(contracts.contracts, filters, {
        signal,
        onRouteProgress: (done, total) =>
          setProgress((prev) => ({ ...prev, phase: 'routing', routesDone: done, routesTotal: total })),
      });
      if (signal.aborted) return;

      const rows = computeAttractivity(enriched, weights);
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
