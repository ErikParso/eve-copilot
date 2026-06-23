// Route danger model — server-side mirror of web/src/features/courierContracts/danger.ts.
// KEEP IN SYNC with that file: the two must produce identical indices or the
// server's attractivity ranking (used to pick the shipped top-N) will disagree
// with the FE's displayed score. There is no shared package between web/ and
// server/, so the formula is duplicated deliberately.
//
// One primitive: per-system risk (0..1) = security baseline + recent kills
// (kills weighted by band). The route index blends the worst system with the
// average. Operates on raw system ids + a kills map, so it needs no RouteSystem[]
// objects (the light path for scoring ~40k candidates).
import { getSystem, securityBand, type SecurityBand } from './sde.js';

const SECURITY_BASE: Record<SecurityBand, number> = { high: 0, low: 0.25, null: 0.5 };
const KILL_RELEVANCE: Record<SecurityBand, number> = { high: 0.05, low: 1, null: 1.5 };
const KILL_SCALE = 10;
const WORST_WEIGHT = 0.6;
const AVG_WEIGHT = 0.4;

/** Risk (0..1) for one system: security baseline + recent kills on top. */
function systemRisk(band: SecurityBand, shipKills: number): number {
  const base = SECURITY_BASE[band];
  const weightedKills = shipKills * KILL_RELEVANCE[band];
  const killRisk = 1 - Math.exp(-weightedKills / KILL_SCALE);
  return Math.min(1, base + (1 - base) * killRisk);
}

/**
 * Route danger index (0–100) over a list of system ids, using a kills map
 * (systemId → recent ship kills). Unknown systems are treated as null-sec
 * (conservative). Empty route → 0.
 */
export function dangerForSystems(systemIds: number[], kills: Map<number, number>): number {
  if (systemIds.length === 0) return 0;
  let worst = 0;
  let sum = 0;
  for (const id of systemIds) {
    const sys = getSystem(id);
    const band: SecurityBand = sys ? securityBand(sys.security) : 'null';
    const r = systemRisk(band, kills.get(id) ?? 0);
    if (r > worst) worst = r;
    sum += r;
  }
  const avg = sum / systemIds.length;
  return Math.round((WORST_WEIGHT * worst + AVG_WEIGHT * avg) * 100);
}
