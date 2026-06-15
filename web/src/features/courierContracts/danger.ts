// Danger model for a courier delivery route.
//
// Everything is built on one primitive: `systemRisk(system)` — the risk (0..1)
// of a single system/gate, combining its security baseline with recent kills
// (kills weighted by band, since high-sec kills are usually wars/duels rather
// than hauler ganks). That same per-gate risk drives both the skull markers and
// the route-level danger index, so the two can never disagree.
import type { SecurityBand } from '@/data/sde';
import { formatNumber } from '@/utils/format';
import type { RouteSystem } from './types';

// Baseline risk from security class alone (before any recent activity).
const SECURITY_BASE: Record<SecurityBand, number> = { high: 0, low: 0.25, null: 0.5 };
// How relevant recent kills are by band (high-sec barely counts).
const KILL_RELEVANCE: Record<SecurityBand, number> = { high: 0.05, low: 1, null: 1.5 };
// Risk-weighted kills in a single system that bring its kill factor to ~0.63.
const KILL_SCALE = 10;
// The route's danger leans on its worst system (one camp can kill you) plus its
// overall exposure.
const WORST_WEIGHT = 0.6;
const AVG_WEIGHT = 0.4;
// A system at or above this risk is flagged as a gank/camp hotspot (skull).
export const SKULL_RISK_THRESHOLD = 0.6;

function f2(n: number): string {
  return formatNumber(n, 2);
}

/** Risk (0..1) for a single system/gate: security baseline + recent kills. */
export function systemRisk(system: RouteSystem): number {
  const base = SECURITY_BASE[system.securityBand];
  const weightedKills = system.shipKills * KILL_RELEVANCE[system.securityBand];
  const killRisk = 1 - Math.exp(-weightedKills / KILL_SCALE);
  // Kills add on top of the baseline, scaled by the remaining headroom.
  return Math.min(1, base + (1 - base) * killRisk);
}

/** Whether a system should be flagged with a skull (gank/camp hotspot). */
export function isGankRisk(system: RouteSystem): boolean {
  return systemRisk(system) >= SKULL_RISK_THRESHOLD;
}

export interface DangerResult {
  index: number;
  steps: string[];
}

/** Route danger index (0–100) and its explanation, from per-gate risks. */
export function computeDanger(route: RouteSystem[]): DangerResult {
  if (route.length === 0) {
    return { index: 0, steps: ['No route systems to assess → danger 0.'] };
  }

  const risks = route.map(systemRisk);
  const worst = Math.max(...risks);
  const avg = risks.reduce((sum, r) => sum + r, 0) / risks.length;
  const blended = WORST_WEIGHT * worst + AVG_WEIGHT * avg;
  const index = Math.round(blended * 100);

  const worstSystem = route[risks.indexOf(worst)];
  const nNull = route.filter((s) => s.securityBand === 'null').length;
  const nLow = route.filter((s) => s.securityBand === 'low').length;
  const nHigh = route.length - nNull - nLow;

  const steps = [
    `Route: ${route.length} systems — ${nHigh} high-sec, ${nLow} low-sec, ${nNull} null-sec`,
    `Per-gate risk = security baseline + recent kills (kills weighted high×${KILL_RELEVANCE.high}, low×${KILL_RELEVANCE.low}, null×${KILL_RELEVANCE.null}).`,
    `1. Worst gate: ${worstSystem.name} (${worstSystem.securityBand}-sec, ${formatNumber(
      worstSystem.shipKills,
      0,
    )} kills/h) → risk ${f2(worst)}`,
    `2. Average gate risk across route = ${f2(avg)}`,
    `3. Danger = ${WORST_WEIGHT}×${f2(worst)} (worst) + ${AVG_WEIGHT}×${f2(avg)} (avg) = ${f2(
      blended,
    )} → ${index}`,
  ];

  return { index, steps };
}
