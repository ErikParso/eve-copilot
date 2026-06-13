// Recent kill activity per solar system, from ESI /universe/system_kills/.
// One unauthenticated call returns ship/pod/npc kills over the last hour for
// every system with activity (ESI caches it ~1h). Used by the danger index.
import { esiGet } from './esiClient';

export interface SystemKills {
  shipKills: number;
  podKills: number;
  npcKills: number;
}

interface RawSystemKills {
  system_id: number;
  ship_kills: number;
  pod_kills: number;
  npc_kills: number;
}

const TTL_MS = 30 * 60 * 1000;
let cache: { fetchedAt: number; map: Map<number, SystemKills> } | null = null;
let inFlight: Promise<Map<number, SystemKills>> | null = null;

/**
 * Map of systemId → recent kills. Cached for the session (30 min) and
 * de-duplicated while in flight. Systems with no activity are simply absent
 * from the map (treat as zero kills).
 */
export function loadSystemKills(signal?: AbortSignal): Promise<Map<number, SystemKills>> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return Promise.resolve(cache.map);
  }
  if (inFlight) return inFlight;

  inFlight = esiGet<RawSystemKills[]>('/universe/system_kills/', undefined, signal)
    .then((rows) => {
      const map = new Map<number, SystemKills>();
      for (const r of rows) {
        map.set(r.system_id, {
          shipKills: r.ship_kills,
          podKills: r.pod_kills,
          npcKills: r.npc_kills,
        });
      }
      cache = { fetchedAt: Date.now(), map };
      return map;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
