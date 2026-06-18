// Computes the Copilot plan. The route legs (server-side pathfinding) are only
// re-fetched when something that changes routes moves — the basket, the current
// location, or the route type. The plan math (which depends on cargo capacity and
// the effective start ISK) is then derived reactively, so a wallet/cargo change
// re-plans without a re-fetch.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { characterStatusAtom } from '@/features/auth/atoms';
import { preferencesAtom } from '@/features/preferences/atoms';
import type { RouteSystem } from '@/features/courierContracts/types';
import { resolvedBasketAtom, effectiveStartIskAtom } from './atoms';
import { buildPlan } from './planner';
import type { Plan } from './types';

type RoutesMap = Record<string, RouteSystem[] | null>;

export type PlanState =
  | { status: 'idle'; plan: null; error: null }
  | { status: 'loading'; plan: null; error: null }
  | { status: 'ready'; plan: Plan; error: null }
  | { status: 'error'; plan: null; error: string };

export function usePlan(): PlanState {
  // Live-economics basket, minus reservations whose orders have dried up.
  // Memoised so the route-fetch effect doesn't re-run on every render.
  const resolved = useAtomValue(resolvedBasketAtom);
  const basket = useMemo(() => resolved.filter((b) => !b.stale), [resolved]);
  const prefs = useAtomValue(preferencesAtom);
  const startIsk = useAtomValue(effectiveStartIskAtom);
  const status = useAtomValue(characterStatusAtom);
  const origin = status?.systemId ?? null;
  const routeType = prefs.routeType;
  const capacity = prefs.cargoM3 ?? Number.POSITIVE_INFINITY;

  const [routes, setRoutes] = useState<RoutesMap>({});
  const [fetchStatus, setFetchStatus] = useState<PlanState['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch the route matrix when routes-affecting inputs change.
  useEffect(() => {
    abortRef.current?.abort();

    if (basket.length === 0) {
      setRoutes({});
      setError(null);
      setFetchStatus('idle');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const systems = new Set<number>();
    if (origin !== null) systems.add(origin);
    for (const it of basket) {
      if (it.pickup.systemId !== null) systems.add(it.pickup.systemId);
      if (it.dropoff.systemId !== null) systems.add(it.dropoff.systemId);
    }
    const ids = [...systems];
    const pairs: Array<[number, number]> = [];
    for (const a of ids) for (const b of ids) pairs.push([a, b]);

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
        setError(err instanceof Error ? err.message : 'Planning failed');
        setFetchStatus('error');
      }
    })();

    return () => controller.abort();
  }, [basket, origin, routeType]);

  // Re-plan reactively from the fetched routes + the current capacity/ISK.
  const plan = useMemo<Plan | null>(() => {
    if (fetchStatus !== 'ready' || basket.length === 0) return null;
    const getLeg = (from: number, to: number) => routes[`${from}:${to}`] ?? null;
    return buildPlan(basket, {
      origin,
      capacity,
      startIsk: startIsk ?? Number.POSITIVE_INFINITY,
      getLeg,
    });
  }, [fetchStatus, routes, basket, origin, capacity, startIsk]);

  if (basket.length === 0) return { status: 'idle', plan: null, error: null };
  if (fetchStatus === 'loading') return { status: 'loading', plan: null, error: null };
  if (fetchStatus === 'error') return { status: 'error', plan: null, error: error ?? 'Planning failed' };
  if (plan) return { status: 'ready', plan, error: null };
  return { status: 'idle', plan: null, error: null };
}
