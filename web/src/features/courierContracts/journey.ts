// Jumps per leg + total, derived from the route legs the server ships. Danger
// (index + breakdown) and per-system gank flags are computed on the server and
// shipped on each row, so they're not derived here.
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
}

/**
 * Jumps for a two-leg journey. Unreachable journeys are filtered out server-side,
 * so the delivery leg is always present; `approachRoute` is null only when no
 * origin was given (→ total = delivery alone).
 */
export function deriveJourney(approachRoute: RouteSystem[] | null, deliveryRoute: RouteSystem[]): Journey {
  const jumpsToDest = Math.max(0, deliveryRoute.length - 1);
  const jumpsFromCurrent = approachRoute ? Math.max(0, approachRoute.length - 1) : null;
  const totalJumps = jumpsFromCurrent !== null ? jumpsFromCurrent + jumpsToDest : jumpsToDest;
  return { jumpsFromCurrent, jumpsToDest, totalJumps };
}
