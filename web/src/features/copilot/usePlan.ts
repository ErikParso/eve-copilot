// Computes the Copilot plan: collects the distinct solar systems of the basket's
// stops (plus the current location), asks the server for the route legs between
// every pair (pathfinding lives server-side), then runs the local planner. Re-runs
// whenever the basket, the manual inputs, or the character's location changes.
import { useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { characterStatusAtom } from '@/features/auth/atoms';
import { draftFiltersAtom } from '@/features/courierContracts/atoms';
import type { RouteSystem } from '@/features/courierContracts/types';
import { basketAtom } from './atoms';
import { buildPlan } from './planner';
import type { Plan } from './types';

type RoutesResponse = { routes: Record<string, RouteSystem[] | null> };

export type PlanState =
  | { status: 'idle'; plan: null; error: null }
  | { status: 'loading'; plan: null; error: null }
  | { status: 'ready'; plan: Plan; error: null }
  | { status: 'error'; plan: null; error: string };

const EMPTY: PlanState = { status: 'idle', plan: null, error: null };

export function usePlan(): PlanState {
  const basket = useAtomValue(basketAtom);
  // Constraints come from the shared Hauling filters; live location (when logged
  // in) overrides the filter's current system for the plan's starting point.
  const filters = useAtomValue(draftFiltersAtom);
  const status = useAtomValue(characterStatusAtom);
  const origin = status?.systemId ?? filters.currentSystemId;
  const [state, setState] = useState<PlanState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    if (basket.length === 0) {
      setState(EMPTY);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const capacity = filters.maxCargoM3 ?? Number.POSITIVE_INFINITY;
    const startIsk =
      filters.maxCollateralMillions !== null
        ? filters.maxCollateralMillions * 1_000_000
        : Number.POSITIVE_INFINITY;

    // Distinct systems involved: every resolvable stop, plus the current system.
    const systems = new Set<number>();
    if (origin !== null) systems.add(origin);
    for (const it of basket) {
      if (it.pickup.systemId !== null) systems.add(it.pickup.systemId);
      if (it.dropoff.systemId !== null) systems.add(it.dropoff.systemId);
    }
    const ids = [...systems];
    const pairs: Array<[number, number]> = [];
    for (const a of ids) for (const b of ids) pairs.push([a, b]);

    setState({ status: 'loading', plan: null, error: null });

    (async () => {
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
        const plan = buildPlan(basket, { origin, capacity, startIsk, getLeg });
        setState({ status: 'ready', plan, error: null });
      } catch (err) {
        if (signal.aborted) return;
        setState({ status: 'error', plan: null, error: err instanceof Error ? err.message : 'Planning failed' });
      }
    })();

    return () => controller.abort();
  }, [basket, filters, origin]);

  return state;
}
