// Derives everything that's a pure function of a journey's route legs, so the
// server only has to ship the routes themselves: jumps per leg + total, the
// per-jump rate of any value, and the danger index/explanation over the whole
// route actually flown. Used to hydrate both courier and arbitrage API rows.
import { computeDanger } from './danger';
import type { RouteSystem } from './types';

/** A value spread over the journey's jumps (the value itself when 0 jumps). */
export function perJump(value: number, totalJumps: number): number | null {
  if (totalJumps === 0) return value;
  return value / totalJumps;
}

export interface Journey {
  jumpsFromCurrent: number | null;
  jumpsToDest: number;
  totalJumps: number;
  danger: number;
  dangerSteps: string[];
}

/**
 * Jumps + danger for a two-leg journey. Unreachable journeys are filtered out
 * server-side, so the delivery leg is always present; `approachRoute` is null
 * only when no origin was given (→ total = delivery alone).
 */
export function deriveJourney(approachRoute: RouteSystem[] | null, deliveryRoute: RouteSystem[]): Journey {
  const jumpsToDest = Math.max(0, deliveryRoute.length - 1);
  const jumpsFromCurrent = approachRoute ? Math.max(0, approachRoute.length - 1) : null;
  const totalJumps = jumpsFromCurrent !== null ? jumpsFromCurrent + jumpsToDest : jumpsToDest;

  // Danger over the route the card draws: approach + delivery (drop the shared
  // seam — approach's last system == the source), or the delivery leg alone.
  const dangerRoute = approachRoute ? [...approachRoute, ...deliveryRoute.slice(1)] : deliveryRoute;
  const { index, steps } = computeDanger(dangerRoute);

  return { jumpsFromCurrent, jumpsToDest, totalJumps, danger: index, dangerSteps: steps };
}
