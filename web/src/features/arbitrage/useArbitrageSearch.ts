import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useStore } from 'jotai';
import { computeArbitrageAttractivity } from './attractivity';
import { sortArbitrageRows } from './sortArbitrage';
import { arbitrageDraftFiltersAtom, arbitrageResultAtom } from './atoms';
import type { ArbitrageItem, MarketMeta } from './types';

const MILLION = 1_000_000;

interface ArbitrageResponse {
  items: ArbitrageItem[];
  meta: MarketMeta;
}

/**
 * Runs an arbitrage search: the API does the heavy all-region order-book crawl,
 * matching and route/danger enrichment (shared + cached); the client scores the
 * results by attractivity and sorts them. Filters are read imperatively so
 * typing in the form doesn't re-render the loaded cards.
 */
export function useArbitrageSearch() {
  const store = useStore();
  const [result, setResult] = useAtom(arbitrageResultAtom);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const filters = store.get(arbitrageDraftFiltersAtom);
    setResult({ status: 'loading', rows: [], error: null, market: null });

    try {
      const params = new URLSearchParams({
        routeType: filters.routeType,
        salesTaxRate: String(filters.salesTaxPercent / 100),
      });
      if (filters.fromSystemId !== null) params.set('fromSystemId', String(filters.fromSystemId));
      if (filters.toSystemId !== null) params.set('toSystemId', String(filters.toSystemId));
      if (filters.maxInvestmentMillions !== null)
        params.set('maxInvestment', String(filters.maxInvestmentMillions * MILLION));
      if (filters.maxCargoM3 !== null) params.set('maxCargo', String(filters.maxCargoM3));
      if (filters.maxJumps !== null) params.set('maxJumps', String(filters.maxJumps));

      const res = await fetch(`/api/arbitrage?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`Arbitrage API returned ${res.status}`);
      const data = (await res.json()) as ArbitrageResponse;
      if (signal.aborted) return;

      const scored = computeArbitrageAttractivity(data.items);
      const sorted = sortArbitrageRows(scored, filters.sortBy);

      setResult({ status: 'success', rows: sorted, error: null, market: data.meta });
    } catch (err) {
      if (signal.aborted) return;
      setResult({
        status: 'error',
        rows: [],
        error: err instanceof Error ? err.message : 'Search failed',
        market: null,
      });
    }
  }, [store, setResult]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { run, ...result };
}
