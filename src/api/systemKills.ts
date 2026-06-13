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

let cachedMap: Map<number, SystemKills> | null = null;
let inFlight: Promise<Map<number, SystemKills>> | null = null;

/**
 * Map of systemId → recent kills. Fetched fresh per search (the cache is
 * cleared by `clearSystemKillsCache`); within one search concurrent calls are
 * de-duplicated. Systems with no activity are absent (treat as zero kills).
 */
export function loadSystemKills(signal?: AbortSignal): Promise<Map<number, SystemKills>> {
  if (cachedMap) return Promise.resolve(cachedMap);
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
      cachedMap = map;
      return map;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Drop the kills cache so the next search fetches fresh activity. */
export function clearSystemKillsCache(): void {
  cachedMap = null;
}
