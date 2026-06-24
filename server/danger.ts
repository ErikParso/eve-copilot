// Route danger model — the single source of truth (the FE renders the index,
// steps and per-system skull flags shipped from here; it no longer computes any
// of this). One primitive: per-system risk (0..1) = security baseline + recent
// kills (kills weighted by band). The route index blends the worst system with
// the average.
import { getSystem, securityBand, type SecurityBand } from './sde.js';

const SECURITY_BASE: Record<SecurityBand, number> = { high: 0, low: 0.25, null: 0.5 };
const KILL_RELEVANCE: Record<SecurityBand, number> = { high: 0.05, low: 1, null: 1.5 };
const KILL_SCALE = 10;
const WORST_WEIGHT = 0.6;
const AVG_WEIGHT = 0.4;
/** A system at or above this risk is a gank/camp hotspot (skull marker). */
export const SKULL_RISK_THRESHOLD = 0.6;

/** Risk (0..1) for one system: security baseline + recent kills on top. */
export function systemRisk(band: SecurityBand, shipKills: number): number {
  const base = SECURITY_BASE[band];
  const weightedKills = shipKills * KILL_RELEVANCE[band];
  const killRisk = 1 - Math.exp(-weightedKills / KILL_SCALE);
  return Math.min(1, base + (1 - base) * killRisk);
}

/** Whether a system should be flagged with a skull (gank/camp hotspot). */
export function isGankRisk(band: SecurityBand, shipKills: number): boolean {
  return systemRisk(band, shipKills) >= SKULL_RISK_THRESHOLD;
}

export interface DangerResult {
  index: number;
  steps: string[];
}

const f2 = (n: number): string => n.toFixed(2);

/**
 * Route danger index (0–100) + its explanation, over a list of system ids using
 * a kills map (systemId → recent ship kills). Unknown systems are treated as
 * null-sec (conservative). Empty route → 0.
 */
export function dangerForSystems(systemIds: number[], kills: Map<number, number>): DangerResult {
  if (systemIds.length === 0) {
    return { index: 0, steps: ['No route systems to assess → danger 0.'] };
  }

  let worst = -1;
  let worstName = '';
  let worstBand: SecurityBand = 'null';
  let worstKills = 0;
  let sum = 0;
  let nHigh = 0;
  let nLow = 0;
  let nNull = 0;
  for (const id of systemIds) {
    const sys = getSystem(id);
    const band: SecurityBand = sys ? securityBand(sys.security) : 'null';
    const k = kills.get(id) ?? 0;
    if (band === 'high') nHigh++;
    else if (band === 'low') nLow++;
    else nNull++;
    const r = systemRisk(band, k);
    if (r > worst) {
      worst = r;
      worstName = sys?.name ?? `System ${id}`;
      worstBand = band;
      worstKills = k;
    }
    sum += r;
  }
  const avg = sum / systemIds.length;
  const blended = WORST_WEIGHT * worst + AVG_WEIGHT * avg;
  const index = Math.round(blended * 100);

  const steps = [
    `Route: ${systemIds.length} systems — ${nHigh} high-sec, ${nLow} low-sec, ${nNull} null-sec`,
    `Per-gate risk = security baseline + recent kills (kills weighted high×${KILL_RELEVANCE.high}, low×${KILL_RELEVANCE.low}, null×${KILL_RELEVANCE.null}).`,
    `1. Worst gate: ${worstName} (${worstBand}-sec, ${worstKills} kills/h) → risk ${f2(worst)}`,
    `2. Average gate risk across route = ${f2(avg)}`,
    `3. Danger = ${WORST_WEIGHT}×${f2(worst)} (worst) + ${AVG_WEIGHT}×${f2(avg)} (avg) = ${f2(blended)} → ${index}`,
  ];

  return { index, steps };
}
