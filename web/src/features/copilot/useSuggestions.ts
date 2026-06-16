// On-demand engine for Phase-2 suggestions. Candidates come from the last Hauling
// search (combinedResultAtom) minus what's already in the basket; we pre-filter to
// the ones nearest the current location (cheap, using the jumps already computed
// for the Hauling cards), fetch the route legs covering basket + candidates, then
// rank by the attractivity of the plan each would produce. Triggered by a button,
// not auto-run, to keep the route-matrix request bounded.
import { useCallback, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { characterStatusAtom } from '@/features/auth/atoms';
import {
  attractivityWeightsAtom,
  combinedResultAtom,
  draftFiltersAtom,
} from '@/features/courierContracts/atoms';
import type { RouteSystem } from '@/features/courierContracts/types';
import { basketAtom } from './atoms';
import { cardToBasketItem } from './types';
import { rankSuggestions, type Suggestion } from './suggestions';

type RoutesResponse = { routes: Record<string, RouteSystem[] | null> };

// Keep candidates near the current location and bounded, so the route matrix
// (and the per-candidate re-planning) stays responsive.
const NEAR_JUMPS = 15;
const MAX_CANDIDATES = 12;

export interface SuggestionsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  suggestions: Suggestion[];
  error: string | null;
  /** Number of candidates considered (after pre-filtering). */
  considered: number;
}

const EMPTY: SuggestionsState = { status: 'idle', suggestions: [], error: null, considered: 0 };

export function useSuggestions() {
  const basket = useAtomValue(basketAtom);
  const filters = useAtomValue(draftFiltersAtom);
  const weights = useAtomValue(attractivityWeightsAtom);
  const combined = useAtomValue(combinedResultAtom);
  const status = useAtomValue(characterStatusAtom);
  const origin = status?.systemId ?? filters.currentSystemId;
  const [state, setState] = useState<SuggestionsState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const capacity = filters.maxCargoM3 ?? Number.POSITIVE_INFINITY;
    const startIsk =
      filters.maxCollateralMillions !== null
        ? filters.maxCollateralMillions * 1_000_000
        : Number.POSITIVE_INFINITY;

    // Candidate pool: last Hauling results, not already in the basket, with
    // resolvable endpoints, nearest-first and capped.
    const inBasket = new Set(basket.map((b) => b.key));
    const candidates = combined.rows
      .filter((c) => !inBasket.has(c.key))
      .filter((c) => {
        const j = c.row.jumpsFromCurrent;
        return j === null || j <= NEAR_JUMPS;
      })
      .sort((a, b) => (a.row.jumpsFromCurrent ?? Infinity) - (b.row.jumpsFromCurrent ?? Infinity))
      .slice(0, MAX_CANDIDATES)
      .map(cardToBasketItem)
      .filter((it) => it.pickup.systemId !== null && it.dropoff.systemId !== null);

    if (candidates.length === 0) {
      setState({ status: 'ready', suggestions: [], error: null, considered: 0 });
      return;
    }

    // Distinct systems across the basket, candidates and current location.
    const systems = new Set<number>();
    if (origin !== null) systems.add(origin);
    for (const it of [...basket, ...candidates]) {
      if (it.pickup.systemId !== null) systems.add(it.pickup.systemId);
      if (it.dropoff.systemId !== null) systems.add(it.dropoff.systemId);
    }
    const ids = [...systems];
    const pairs: Array<[number, number]> = [];
    for (const a of ids) for (const b of ids) pairs.push([a, b]);

    setState({ status: 'loading', suggestions: [], error: null, considered: candidates.length });

    try {
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeType: filters.routeType, pairs }),
        signal,
      });
      if (!res.ok) throw new Error(`Routes API returned ${res.status}`);
      const data = (await res.json()) as RoutesResponse;
      if (signal.aborted) return;

      const getLeg = (from: number, to: number) => data.routes[`${from}:${to}`] ?? null;
      const suggestions = rankSuggestions(
        basket,
        candidates,
        { origin, capacity, startIsk, getLeg },
        weights,
      );
      setState({ status: 'ready', suggestions, error: null, considered: candidates.length });
    } catch (err) {
      if (signal.aborted) return;
      setState({
        status: 'error',
        suggestions: [],
        error: err instanceof Error ? err.message : 'Could not compute suggestions',
        considered: candidates.length,
      });
    }
  }, [basket, filters, weights, combined, origin]);

  return { ...state, run };
}
