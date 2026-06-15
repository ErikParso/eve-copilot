// Per-gate danger model (mirrors the client's danger.ts). Built on systemRisk:
// security baseline + recent kills (kills weighted by band — high-sec kills are
// usually wars/duels, not ganks). Route danger = worst gate + average.
import type { SecurityBand } from './sde.js';
import type { RouteSystem } from './types.js';

const SECURITY_BASE: Record<SecurityBand, number> = { high: 0, low: 0.25, null: 0.5 };
const KILL_RELEVANCE: Record<SecurityBand, number> = { high: 0.05, low: 1, null: 1.5 };
const KILL_SCALE = 10;
const WORST_WEIGHT = 0.6;
const AVG_WEIGHT = 0.4;

function f2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
function intStr(n: number): string {
  return Math.round(n).toString();
}

export function systemRisk(system: RouteSystem): number {
  const base = SECURITY_BASE[system.securityBand];
  const weightedKills = system.shipKills * KILL_RELEVANCE[system.securityBand];
  const killRisk = 1 - Math.exp(-weightedKills / KILL_SCALE);
  return Math.min(1, base + (1 - base) * killRisk);
}

export interface DangerResult {
  index: number;
  steps: string[];
}

export function computeDanger(route: RouteSystem[]): DangerResult {
  if (route.length === 0) return { index: 0, steps: ['No route systems to assess → danger 0.'] };

  const risks = route.map(systemRisk);
  const worst = Math.max(...risks);
  const avg = risks.reduce((s, r) => s + r, 0) / risks.length;
  const blended = WORST_WEIGHT * worst + AVG_WEIGHT * avg;
  const index = Math.round(blended * 100);

  const worstSystem = route[risks.indexOf(worst)];
  const nNull = route.filter((s) => s.securityBand === 'null').length;
  const nLow = route.filter((s) => s.securityBand === 'low').length;
  const nHigh = route.length - nNull - nLow;

  const steps = [
    `Route: ${route.length} systems — ${nHigh} high-sec, ${nLow} low-sec, ${nNull} null-sec`,
    `Per-gate risk = security baseline + recent kills (kills weighted high×${KILL_RELEVANCE.high}, low×${KILL_RELEVANCE.low}, null×${KILL_RELEVANCE.null}).`,
    `1. Worst gate: ${worstSystem.name} (${worstSystem.securityBand}-sec, ${intStr(
      worstSystem.shipKills,
    )} kills/h) → risk ${f2(worst)}`,
    `2. Average gate risk across route = ${f2(avg)}`,
    `3. Danger = ${WORST_WEIGHT}×${f2(worst)} (worst) + ${AVG_WEIGHT}×${f2(avg)} (avg) = ${f2(
      blended,
    )} → ${index}`,
  ];

  return { index, steps };
}
