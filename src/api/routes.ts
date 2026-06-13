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
const routeCache = new Map<string, Promise<number | null>>();

function cacheKey(origin: number, dest: number, type: RouteType): string {
  return `${origin}:${dest}:${type}`;
}

async function fetchJumps(
  origin: number,
  dest: number,
  type: RouteType,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const systems = await esiGet<number[]>(
      `/route/${origin}/${dest}/`,
      { flag: FLAG_BY_TYPE[type] },
      signal,
    );
    return Math.max(0, systems.length - 1);
  } catch (err) {
    // A 404 means no gate route exists (wormhole-only / Pochven / isolated) —
    // a stable answer worth caching as "no route".
    if (err instanceof EsiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Number of jumps between two systems, or `null` when no gate route exists
 * (e.g. wormhole-only systems). Returns 0 for same-system.
 */
export function getJumps(
  origin: number,
  dest: number,
  type: RouteType,
  signal?: AbortSignal,
): Promise<number | null> {
  if (origin === dest) return Promise.resolve(0);

  const key = cacheKey(origin, dest, type);
  const cached = routeCache.get(key);
  if (cached) return cached;

  const promise = fetchJumps(origin, dest, type, signal).catch((err) => {
    // Don't cache transient failures (network/420/etc.) — drop so it can retry.
    routeCache.delete(key);
    throw err;
  });
  routeCache.set(key, promise);
  return promise;
}
