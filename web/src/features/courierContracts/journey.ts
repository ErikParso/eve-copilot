// Derives everything that's a pure function of a journey's route legs, so the
// server only has to ship the routes themselves: jumps per leg + total, the
// per-jump rate of any value, and the danger index/explanation over the whole
// route actually flown. Used to hydrate both courier and arbitrage API rows.
import { computeDanger } from './danger';
import type { RouteSystem } from './types';

/** Jumps along a route leg (systems − 1), or null when there's no route. */
export function routeJumps(route: RouteSystem[] | null): number | null {
  return route ? Math.max(0, route.length - 1) : null;
}

/** A value spread over the journey's jumps (the value itself when 0 jumps). */
export function perJump(value: number, totalJumps: number | null): number | null {
  if (totalJumps === null) return null;
  if (totalJumps === 0) return value;
  return value / totalJumps;
}

export interface Journey {
  jumpsFromCurrent: number | null;
  jumpsToDest: number | null;
  totalJumps: number | null;
  danger: number | null;
  dangerSteps: string[];
}

/**
 * Jumps + danger for a two-leg journey. `hasOrigin` distinguishes "no current
 * system set" (totalJumps = the delivery leg alone) from "origin set but the
 * approach is unreachable" (totalJumps = null) — both leave approachRoute null,
 * so the flag is what tells them apart.
 */
export function deriveJourney(
  approachRoute: RouteSystem[] | null,
  deliveryRoute: RouteSystem[] | null,
  hasOrigin: boolean,
): Journey {
  const jumpsFromCurrent = routeJumps(approachRoute);
  const jumpsToDest = routeJumps(deliveryRoute);

  const totalJumps = !hasOrigin
    ? jumpsToDest
    : jumpsFromCurrent !== null && jumpsToDest !== null
      ? jumpsFromCurrent + jumpsToDest
      : null;

  // Danger over the route the card draws: approach + delivery (drop the shared
  // seam — approach's last system == the source), or the delivery leg alone.
  const dangerRoute =
    approachRoute && deliveryRoute ? [...approachRoute, ...deliveryRoute.slice(1)] : deliveryRoute;
  const danger = dangerRoute ? computeDanger(dangerRoute) : null;

  return {
    jumpsFromCurrent,
    jumpsToDest,
    totalJumps,
    danger: danger ? danger.index : null,
    dangerSteps: danger ? danger.steps : [],
  };
}
