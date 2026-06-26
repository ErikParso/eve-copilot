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

// --- Test override for E2E tests ---
let testKillsOverride: Map<number, number> | null = null;

/** Inject test kills data (merged on top of real data). */
export function setTestKills(kills: Map<number, number>): void {
  testKillsOverride = kills;
}

/** Clear test kills override. */
export function clearTestKills(): void {
  testKillsOverride = null;
}

/** Map systemId -> ship kills in the last hour (absent = 0). */
export async function getShipKills(): Promise<Map<number, number>> {
  if (process.env.OFFLINE === 'true') {
    // In offline mode, return test kills if injected, otherwise empty
    return testKillsOverride ?? new Map<number, number>();
  }
  if (cache && Date.now() - cache.at < TTL_MS) {
    if (testKillsOverride) {
      const merged = new Map(cache.map);
      for (const [k, v] of testKillsOverride) merged.set(k, v);
      return merged;
    }
    return cache.map;
  }
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
