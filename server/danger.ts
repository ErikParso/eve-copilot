// Route danger model — the single source of truth (the FE renders the index,
// steps and per-system skull flags shipped from here; it computes none of this).
//
// Risk is driven by kills AT the specific stargates a route uses, not system-wide
// kill totals (which lump in station games, mission runners and structure bashes
// that never threaten a hauler in transit). For each system on the route we read
// the kills on the two gates it actually uses — the gate to the previous system
// (where you land) and the gate to the next system (where you warp off and jump).
// Both are distinct stargates, so summing them across the route counts each gate
// once. Per-system risk = a small security-baseline term + a much larger term for
// those gate kills. The route index blends the worst system with the average.
import { getSystem, securityBand, connectionGate, type SecurityBand } from './sde.js';

// Danger contribution from security ALONE (0..1), by 0.1 security tier. Higher sec
// → safer → lower value; null-sec (≤0.0) is 4× the top of low-sec (0.25). Indexed
// by round(security*10); security ≤ 0 short-circuits to the null value.
const SEC_INVERTED = [
  1.0, // 0.0  (null — handled by the ≤0 guard, listed for completeness)
  0.25, // 0.1
  0.24, // 0.2
  0.2, // 0.3
  0.16, // 0.4
  0.1, // 0.5
  0.06, // 0.6
  0.04, // 0.7
  0.02, // 0.8
  0.01, // 0.9
  0.0, // 1.0
];
function securityInverted(security: number): number {
  if (security <= 0) return 1.0;
  const tier = Math.min(10, Math.max(1, Math.round(security * 10)));
  return SEC_INVERTED[tier];
}

const W_SEC = 0.15; // small weight — security is a floor/tiebreaker
const W_KILL = 0.85; // dominant weight — recent gate kills drive the number
const KILL_SCALE = 3; // saturating scale: 1 kill≈0.28, 2≈0.49, 3≈0.63, 5≈0.81
const WORST_WEIGHT = 0.6;
const AVG_WEIGHT = 0.4;
/** A system is a gank/camp hotspot (skull marker) at this many gate kills or more. */
export const SKULL_MIN_GATE_KILLS = 1;

const f2 = (n: number): string => n.toFixed(2);

/** Saturating 0..1 score for a raw gate-kill count. */
function killScore(gateKills: number): number {
  return 1 - Math.exp(-gateKills / KILL_SCALE);
}

/** Risk (0..1) for one system: security floor + (dominant) recent gate kills. */
export function systemRisk(security: number, gateKills: number): number {
  const risk = W_SEC * securityInverted(security) + W_KILL * killScore(gateKills);
  return Math.min(1, risk);
}

export interface SystemDanger {
  index: number;
  steps: string[];
}

/**
 * One system's danger index (0–100) plus its exact-number breakdown, from the two
 * gate-kill counts it uses on the route (toward the previous & next system). This
 * is the per-square tooltip's "how it's calculated" content.
 */
export function systemDanger(security: number, toPrev: number, toNext: number): SystemDanger {
  const band = securityBand(security);
  const si = securityInverted(security);
  const kills = toPrev + toNext;
  const ks = killScore(kills);
  const secTerm = W_SEC * si;
  const killTerm = W_KILL * ks;
  const risk = Math.min(1, secTerm + killTerm);
  const index = Math.round(risk * 100);
  const steps = [
    `Security ${security.toFixed(2)} (${band}): ${f2(si)} × ${W_SEC} = ${f2(secTerm)}`,
    `Gate kills ${kills}: 1−e^(−${kills}/${KILL_SCALE}) = ${f2(ks)} × ${W_KILL} = ${f2(killTerm)}`,
    `Danger = ${f2(secTerm)} + ${f2(killTerm)} = ${f2(risk)} → ${index}`,
  ];
  return { index, steps };
}

/** Whether a system should be flagged with a skull, given its total gate kills. */
export function isGankRisk(gateKills: number): boolean {
  return gateKills >= SKULL_MIN_GATE_KILLS;
}

/**
 * Kills on the two gates system `i` uses on this route: the gate toward the
 * previous system (inbound/landing) and the gate toward the next system
 * (outbound/departure). Absent at the route ends (no prev / no next → 0).
 */
export function gateKillsForSystem(
  systemIds: number[],
  i: number,
  gateKills: Map<number, number>,
): { toPrev: number; toNext: number } {
  const sys = systemIds[i];
  const prev = i > 0 ? systemIds[i - 1] : undefined;
  const next = i < systemIds.length - 1 ? systemIds[i + 1] : undefined;
  const gp = prev !== undefined ? connectionGate(sys, prev) : undefined;
  const gn = next !== undefined ? connectionGate(sys, next) : undefined;
  return {
    toPrev: gp !== undefined ? (gateKills.get(gp) ?? 0) : 0,
    toNext: gn !== undefined ? (gateKills.get(gn) ?? 0) : 0,
  };
}

export interface DangerResult {
  index: number;
  steps: string[];
}

/**
 * Route danger index (0–100) + its explanation, over an ORDERED list of system
 * ids using a gate-kills map (stargate itemId → recent kills). Unknown systems
 * are treated as null-sec (conservative). Empty route → 0.
 */
export function dangerForSystems(systemIds: number[], gateKills: Map<number, number>): DangerResult {
  if (systemIds.length === 0) {
    return { index: 0, steps: ['No route systems to assess → danger 0.'] };
  }

  let worst = -1;
  let worstName = '';
  let worstBand: SecurityBand = 'null';
  let worstKills = 0;
  let sum = 0;
  for (let i = 0; i < systemIds.length; i++) {
    const id = systemIds[i];
    const sys = getSystem(id);
    const security = sys?.security ?? 0;
    const band: SecurityBand = securityBand(security);
    const { toPrev, toNext } = gateKillsForSystem(systemIds, i, gateKills);
    const k = toPrev + toNext;
    const r = systemRisk(security, k);
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
    `Worst system: ${worstName} (${worstBand}-sec, ${worstKills} gate kills) → risk ${f2(worst)}`,
    `Average system risk = ${f2(avg)}`,
    `Danger = ${WORST_WEIGHT} × ${f2(worst)} + ${AVG_WEIGHT} × ${f2(avg)} = ${f2(blended)} → ${index}`,
  ];

  return { index, steps };
}
