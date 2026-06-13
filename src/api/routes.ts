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
const routeCache = new Map<string, number | null>();

function cacheKey(origin: number, dest: number, type: RouteType): string {
  return `${origin}:${dest}:${type}`;
}

/**
 * Number of jumps between two systems, or `null` when no gate route exists
 * (e.g. wormhole-only systems). Returns 0 for same-system.
 */
export async function getJumps(
  origin: number,
  dest: number,
  type: RouteType,
  signal?: AbortSignal,
): Promise<number | null> {
  if (origin === dest) return 0;

  const key = cacheKey(origin, dest, type);
  const cached = routeCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const systems = await esiGet<number[]>(
      `/route/${origin}/${dest}/`,
      { flag: FLAG_BY_TYPE[type] },
      signal,
    );
    const jumps = Math.max(0, systems.length - 1);
    routeCache.set(key, jumps);
    return jumps;
  } catch (err) {
    if (err instanceof EsiError && err.status === 404) {
      routeCache.set(key, null);
      return null;
    }
    throw err;
  }
}
