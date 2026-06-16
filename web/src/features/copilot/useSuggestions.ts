// On-demand engine for Phase-2 suggestions. Candidates are the last Hauling
// search (combinedResultAtom) minus what's already in the basket — ALL of them,
// regardless of distance. For each we build the plan-with-that-item-added and
// rank by its attractivity. We fetch only the route legs the planner can need
// (basket internal, plus each candidate against the basket + current location),
// avoiding the candidate×candidate blow-up. Triggered by a button, not auto-run.
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

    // Candidate pool: every last-Hauling result not already in the basket, with
    // resolvable endpoints. No distance filter — we consider them all.
    const inBasket = new Set(basket.map((b) => b.key));
    const candidates = combined.rows
      .filter((c) => !inBasket.has(c.key))
      .map(cardToBasketItem)
      .filter((it) => it.pickup.systemId !== null && it.dropoff.systemId !== null);

    if (candidates.length === 0) {
      setState({ status: 'ready', suggestions: [], error: null, considered: 0 });
      return;
    }

    // Base systems the planner moves between regardless of candidate: the current
    // location + the basket's stops.
    const base = new Set<number>();
    if (origin !== null) base.add(origin);
    for (const it of basket) {
      if (it.pickup.systemId !== null) base.add(it.pickup.systemId);
      if (it.dropoff.systemId !== null) base.add(it.dropoff.systemId);
    }
    const baseIds = [...base];

    // Minimal pair set: base×base, plus each candidate's two systems against the
    // base and each other (both directions). Skips candidate×candidate pairs the
    // planner never needs (each plan adds only one candidate), keeping the
    // request bounded even with hundreds of candidates.
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
