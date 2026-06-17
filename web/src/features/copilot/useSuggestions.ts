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
import type { RouteSystem } from '@/features/courierContracts/types';
import { basketAtom, effectiveStartIskAtom } from './atoms';
import { cardToBasketItem, type BasketItem } from './types';
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
  const basket = useAtomValue(basketAtom);
  const prefs = useAtomValue(preferencesAtom);
  const weights = useAtomValue(attractivityWeightsAtom);
  const rows = useAtomValue(haulingRowsAtom);
  const status = useAtomValue(characterStatusAtom);
  const effectiveStartIsk = useAtomValue(effectiveStartIskAtom);

  const origin = status?.systemId ?? null;
  const routeType = prefs.routeType;
  const capacity = prefs.cargoM3 ?? Number.POSITIVE_INFINITY;
  const startIsk = effectiveStartIsk ?? Number.POSITIVE_INFINITY;

  // Candidates: every hauling row not already in the basket, resolvable.
  const candidates = useMemo<BasketItem[]>(() => {
    const inBasket = new Set(basket.map((b) => b.key));
    return rows
      .filter((c) => !inBasket.has(c.key))
      .map(cardToBasketItem)
      .filter((it) => it.pickup.systemId !== null && it.dropoff.systemId !== null);
  }, [rows, basket]);

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
