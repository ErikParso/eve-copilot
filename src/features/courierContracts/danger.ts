// Danger index (0–100) for a courier delivery route.
//
// Unlike attractivity, this is an *absolute* score (not relative to the result
// set): it depends only on the route itself. It combines two factors:
//   - security exposure: how many low/null-sec systems the path crosses,
//     weighted by severity (null-sec counts double a low-sec system);
//   - recent combat: total ship kills along the path in the last hour,
//     run through a saturating curve so a few kills already register.
import { formatNumber } from '@/utils/format';
import type { RouteSystem } from './types';

// Higher = more weight to security exposure vs recent kills.
const SECURITY_WEIGHT = 0.7;
const KILL_WEIGHT = 0.3;
// Ship kills that bring the kill factor to ~0.5 (saturating constant).
const KILL_SCALE = 15;
// Per-jump danger contribution by security band. Null-sec is far riskier for a
// hauler (no CONCORD, gate camps), so it is weighted well above low-sec.
const LOW_SEC_WEIGHT = 0.5;
const NULL_SEC_WEIGHT = 2.5;

function f2(n: number): string {
  return formatNumber(n, 2);
}

export interface DangerResult {
  index: number;
  steps: string[];
}

/** Compute the danger index (0–100) and its explanation for a route. */
export function computeDanger(route: RouteSystem[]): DangerResult {
  const total = route.length;
  if (total === 0) {
    return { index: 0, steps: ['No route systems to assess → danger 0.'] };
  }

  const nNull = route.filter((s) => s.securityBand === 'null').length;
  const nLow = route.filter((s) => s.securityBand === 'low').length;
  const nHigh = total - nNull - nLow;
  const shipKills = route.reduce((sum, s) => sum + s.shipKills, 0);

  const securityScore = Math.min(1, (LOW_SEC_WEIGHT * nLow + NULL_SEC_WEIGHT * nNull) / total); // 0..1
  const killScore = 1 - Math.exp(-shipKills / KILL_SCALE); // 0..1, saturating

  const blended = Math.min(1, SECURITY_WEIGHT * securityScore + KILL_WEIGHT * killScore);
  const index = Math.round(blended * 100);

  const steps = [
    `Route: ${total} systems — ${nHigh} high-sec, ${nLow} low-sec, ${nNull} null-sec`,
    `1. Security exposure: (${LOW_SEC_WEIGHT}×${nLow} low + ${NULL_SEC_WEIGHT}×${nNull} null) ÷ ${total}, capped at 1 = ${f2(securityScore)}`,
    `2. Recent ship kills on route (last hour): ${formatNumber(shipKills, 0)} → 1 − e^(−${formatNumber(
      shipKills,
      0,
    )}/${KILL_SCALE}) = ${f2(killScore)}`,
    `3. Danger = ${SECURITY_WEIGHT}×${f2(securityScore)} + ${KILL_WEIGHT}×${f2(
      killScore,
    )} = ${f2(blended)} → ${index}`,
  ];

  return { index, steps };
}
