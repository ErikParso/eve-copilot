// Recent ship kills per system (ESI /universe/system_kills/), cached ~5 min.
import { esiGet } from './esi.js';

interface RawKills {
  system_id: number;
  ship_kills: number;
  pod_kills: number;
  npc_kills: number;
}

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; map: Map<number, number> } | null = null;
let inFlight: Promise<Map<number, number>> | null = null;

/** Map systemId -> ship kills in the last hour (absent = 0). */
export async function getShipKills(): Promise<Map<number, number>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  if (inFlight) return inFlight;
  inFlight = esiGet<RawKills[]>('/universe/system_kills/')
    .then((rows) => {
      const map = new Map<number, number>();
      for (const r of rows) map.set(r.system_id, r.ship_kills);
      cache = { at: Date.now(), map };
      return map;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
