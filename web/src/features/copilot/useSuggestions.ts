// Auto-updating Phase-2 suggestions. Recomputes in the background whenever its
// inputs change: the shared hauling list (candidates), the basket (current plan),
// or the preferences/weights. The route matrix is only re-fetched when something
// that changes server-resolved routes moves (candidates, basket, origin, route
// type); weight / cargo / ISK changes just re-rank the already-fetched routes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { characterStatusAtom } from '@/features/auth/atoms';
import { preferencesAtom } from '@/features/preferences/atoms';
import { attractivityWeightsAtom, haulingRowsAtom } from '@/features/courierContracts/atoms';
import { scaleArbitrage } from '@/features/arbitrage/scale';
import type { RouteSystem } from '@/features/courierContracts/types';
import { copilotPlanDataAtom, effectiveStartIskAtom, resolvedBasketAtom } from './atoms';
import { arbitrageRowToBasketItem, cardToBasketItem, type BasketItem } from './types';
import { rankSuggestions, type Suggestion } from './suggestions';

type RoutesMap = Record<string, RouteSystem[] | null>;

export interface SuggestionsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  suggestions: Suggestion[];
  error: string | null;
  /** Number of candidates considered. */
  considered: number;
}

export function useSuggestions(): SuggestionsState {
  const prefs = useAtomValue(preferencesAtom);
  const weights = useAtomValue(attractivityWeightsAtom);
  const rows = useAtomValue(haulingRowsAtom);
  const planData = useAtomValue(copilotPlanDataAtom);
  const resolvedBasket = useAtomValue(resolvedBasketAtom);
  const status = useAtomValue(characterStatusAtom);
  const effectiveStartIsk = useAtomValue(effectiveStartIskAtom);

  const origin = status?.systemId ?? null;
  const routeType = prefs.routeType;
  const capacity = prefs.cargoM3 ?? Number.POSITIVE_INFINITY;
  const startIsk = effectiveStartIsk ?? Number.POSITIVE_INFINITY;

  // The plan's basket, minus reservations whose orders have dried up.
  const basket = useMemo(() => resolvedBasket.filter((b) => !b.stale), [resolvedBasket]);

  // Candidates, resolvable and not already basketed. Courier comes from the
  // hauling list; arbitrage comes from `available` — opportunities NET of the
  // basket's reservations — scaled to what fits, so a haul whose depth the plan
  // already consumes shrinks (or disappears) here automatically.
  // Respect the contract-type preference (empty = both). Courier comes from the
  // hauling list, which already applies it; gate the arbitrage side here.
  const types = prefs.contractTypes;
  const showArbitrage = types.length === 0 || types.includes('arbitrage');

  const candidates = useMemo<BasketItem[]>(() => {
    const inBasket = new Set(basket.map((b) => b.key));
    const courier = rows.filter((c) => c.kind === 'courier').map(cardToBasketItem);
    const arbitrage = showArbitrage
      ? planData.available
          .map((o) => scaleArbitrage(o, capacity, startIsk))
          .filter((o): o is NonNullable<typeof o> => o !== null)
          .map(arbitrageRowToBasketItem)
      : [];
    return [...courier, ...arbitrage]
      .filter((it) => !inBasket.has(it.key))
      .filter((it) => it.pickup.systemId !== null && it.dropoff.systemId !== null);
  }, [rows, planData.available, basket, capacity, startIsk, showArbitrage]);

  const [routes, setRoutes] = useState<RoutesMap>({});
  const [fetchStatus, setFetchStatus] = useState<SuggestionsState['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch the route matrix when something that affects routes changes.
  useEffect(() => {
    abortRef.current?.abort();

    if (candidates.length === 0) {
      setRoutes({});
      setError(null);
      setFetchStatus('ready');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    // Base systems (current location + basket stops) ↔ each candidate's two
    // systems, both directions; skip candidate×candidate pairs.
    const base = new Set<number>();
    if (origin !== null) base.add(origin);
    for (const it of basket) {
      if (it.pickup.systemId !== null) base.add(it.pickup.systemId);
      if (it.dropoff.systemId !== null) base.add(it.dropoff.systemId);
    }
    const baseIds = [...base];
    const seen = new Set<string>();
    const pairs: Array<[number, number]> = [];
    const addPair = (a: number, b: number) => {
      const k = `${a}:${b}`;
      if (seen.has(k)) return;
      seen.add(k);
      pairs.push([a, b]);
    };
    for (const a of baseIds) for (const b of baseIds) addPair(a, b);
    for (const it of candidates) {
      const xs = [it.pickup.systemId!, it.dropoff.systemId!];
      for (const x of xs) {
        for (const b of baseIds) {
          addPair(x, b);
          addPair(b, x);
        }
        for (const y of xs) addPair(x, y);
      }
    }

    setFetchStatus('loading');
    (async () => {
      try {
        const res = await fetch('/api/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routeType, pairs }),
          signal,
        });
        if (!res.ok) throw new Error(`Routes API returned ${res.status}`);
        const data = (await res.json()) as { routes: RoutesMap };
        if (signal.aborted) return;
        setRoutes(data.routes);
        setError(null);
        setFetchStatus('ready');
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not compute suggestions');
        setFetchStatus('error');
      }
    })();

    return () => controller.abort();
  }, [candidates, basket, origin, routeType]);

  // Rank reactively from the fetched routes — re-runs on weight / cargo / ISK
  // changes without a re-fetch.
  const suggestions = useMemo<Suggestion[]>(() => {
    if (fetchStatus !== 'ready' || candidates.length === 0) return [];
    const getLeg = (from: number, to: number) => routes[`${from}:${to}`] ?? null;
    return rankSuggestions(basket, candidates, { origin, capacity, startIsk, getLeg }, weights);
  }, [fetchStatus, routes, basket, candidates, origin, capacity, startIsk, weights]);

  return { status: fetchStatus, suggestions, error, considered: candidates.length };
}
