// Jump-count routing via ESI /route/{origin}/{destination}/.
// Origin/destination are SOLAR SYSTEM ids; the endpoint returns the ordered
// list of systems on the route, so jumps = systems - 1.
import { esiGet, EsiError } from './esiClient';

/** UI route preference mapped to the ESI `flag` query parameter. */
export type RouteType = 'safest' | 'shortest';

const FLAG_BY_TYPE: Record<RouteType, string> = {
  safest: 'secure', // prefers high-sec, avoids low/null as much as possible
  shortest: 'shortest', // fewest jumps regardless of security
};

// Routes are deterministic for a given (origin, dest, flag) within a session.
// We cache the in-flight Promise (not just the resolved value) so concurrent
// lookups of the same pair collapse into a single request — important because
// many contracts route toward the same hubs, and ESI 404s (unreachable systems
// like Pochven) count against the error rate limit.
const routeCache = new Map<string, Promise<number[] | null>>();

function cacheKey(origin: number, dest: number, type: RouteType): string {
  return `${origin}:${dest}:${type}`;
}

async function fetchRoute(
  origin: number,
  dest: number,
  type: RouteType,
  signal?: AbortSignal,
): Promise<number[] | null> {
  try {
    return await esiGet<number[]>(
      `/route/${origin}/${dest}/`,
      { flag: FLAG_BY_TYPE[type] },
      signal,
    );
  } catch (err) {
    // A 404 means no gate route exists (wormhole-only / Pochven / isolated) —
    // a stable answer worth caching as "no route".
    if (err instanceof EsiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * The ordered list of solar-system ids on the route between two systems, or
 * `null` when no gate route exists. For same-system the route is just the one
 * system. The list includes both endpoints, so jumps = length - 1.
 */
export function getRoute(
  origin: number,
  dest: number,
  type: RouteType,
  signal?: AbortSignal,
): Promise<number[] | null> {
  if (origin === dest) return Promise.resolve([origin]);

  const key = cacheKey(origin, dest, type);
  const cached = routeCache.get(key);
  if (cached) return cached;

  const promise = fetchRoute(origin, dest, type, signal).catch((err) => {
    // Don't cache transient failures (network/420/etc.) — drop so it can retry.
    routeCache.delete(key);
    throw err;
  });
  routeCache.set(key, promise);
  return promise;
}

/** Jump count for a route, or `null` when no route exists. */
export function jumpsFromRoute(route: number[] | null): number | null {
  return route === null ? null : Math.max(0, route.length - 1);
}
