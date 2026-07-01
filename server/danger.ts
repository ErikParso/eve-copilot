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
import type { GateKillData } from './types.js';

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

// Per-system risk = three weighted, independently-saturating terms that sum to
// the danger (weights sum to 1, so a fully-saturated null-sec gate = exactly 100):
//   security (small floor) + recent 60-min kills (dominant) + 24h baseline (medium).
const W_SEC = 0.15; // small — security is a floor/tiebreaker
const W_RECENT = 0.6; // dominant — a live camp right now is what kills you on this jump
const W_BASE = 0.25; // medium — habitual chokepoint danger (24h average)
const KILL_SCALE = 3; // saturating scale: x=1→0.28, 2→0.49, 3→0.63, 5→0.81
const WORST_WEIGHT = 0.6;
const AVG_WEIGHT = 0.4;
/** A system is a gank/camp hotspot (skull) at this many RECENT (60m) gate kills or more. */
export const SKULL_MIN_GATE_KILLS = 1;

const f2 = (n: number): string => n.toFixed(2);

/** Saturating 0..1 score for a gate-kill count or rate. */
function killScore(x: number): number {
  return 1 - Math.exp(-x / KILL_SCALE);
}

/** Risk (0..1) for one system: security floor + recent gate kills + 24h baseline. */
export function systemRisk(security: number, recentKills: number, baselineRate: number): number {
  const risk =
    W_SEC * securityInverted(security) + W_RECENT * killScore(recentKills) + W_BASE * killScore(baselineRate);
  return Math.min(1, risk);
}

export interface SystemDanger {
  index: number;
  steps: string[];
}

/**
 * One system's danger index (0–100) plus its exact-number breakdown, from the two
 * gates it uses on the route (toward the previous & next system) — recent (60m)
 * kills and the 24h average kills/h, each summed across the two gates. This is the
 * per-square tooltip's "how it's calculated" content.
 */
export function systemDanger(
  security: number,
  recentPrev: number,
  recentNext: number,
  basePrev: number,
  baseNext: number,
): SystemDanger {
  const band = securityBand(security);
  const si = securityInverted(security);
  const recent = recentPrev + recentNext;
  const base = basePrev + baseNext;
  const ksR = killScore(recent);
  const ksB = killScore(base);
  const secTerm = W_SEC * si;
  const recentTerm = W_RECENT * ksR;
  const baseTerm = W_BASE * ksB;
  const risk = Math.min(1, secTerm + recentTerm + baseTerm);
  const index = Math.round(risk * 100);
  const steps = [
    `Security ${security.toFixed(2)} (${band}): ${f2(si)} × ${W_SEC} = ${f2(secTerm)}`,
    `Kills last hour ${recent}: 1−e^(−${recent}/${KILL_SCALE}) = ${f2(ksR)} × ${W_RECENT} = ${f2(recentTerm)}`,
    `Avg kills/h 24h ${f2(base)}: 1−e^(−${f2(base)}/${KILL_SCALE}) = ${f2(ksB)} × ${W_BASE} = ${f2(baseTerm)}`,
    `Danger = ${f2(secTerm)} + ${f2(recentTerm)} + ${f2(baseTerm)} = ${f2(risk)} → ${index}`,
  ];
  return { index, steps };
}

/** Whether a system should be flagged with a skull — RECENT (60m) gate kills only,
 *  so the skull means "camp right now", not "historically dangerous". */
export function isGankRisk(recentGateKills: number): boolean {
  return recentGateKills >= SKULL_MIN_GATE_KILLS;
}

export interface RouteGateKills {
  /** Recent (60m) kills on the gate toward the previous / next system. */
  recentPrev: number;
  recentNext: number;
  /** 24h average kills/h on the gate toward the previous / next system. */
  basePrev: number;
  baseNext: number;
}

/**
 * Recent kills and 24h baseline on the two gates system `i` uses on this route:
 * the gate toward the previous system (inbound/landing) and toward the next
 * (outbound/departure). Absent at the route ends (no prev / no next → 0).
 */
export function gateKillsForSystem(systemIds: number[], i: number, data: GateKillData): RouteGateKills {
  const sys = systemIds[i];
  const prev = i > 0 ? systemIds[i - 1] : undefined;
  const next = i < systemIds.length - 1 ? systemIds[i + 1] : undefined;
  const gp = prev !== undefined ? connectionGate(sys, prev) : undefined;
  const gn = next !== undefined ? connectionGate(sys, next) : undefined;
  const at = (m: Map<number, number>, g: number | undefined) => (g !== undefined ? (m.get(g) ?? 0) : 0);
  return {
    recentPrev: at(data.recent, gp),
    recentNext: at(data.recent, gn),
    basePrev: at(data.baseline, gp),
    baseNext: at(data.baseline, gn),
  };
}

export interface DangerResult {
  index: number;
  steps: string[];
}

/**
 * Route danger index (0–100) + its explanation, over an ORDERED list of system
 * ids using the gate-kill data (recent 60m counts + 24h baseline rates). Unknown
 * systems are treated as null-sec (conservative). Empty route → 0.
 */
export function dangerForSystems(systemIds: number[], data: GateKillData): DangerResult {
  if (systemIds.length === 0) {
    return { index: 0, steps: ['No route systems to assess → danger 0.'] };
  }

  let worst = -1;
  let worstName = '';
  let worstBand: SecurityBand = 'null';
  let worstRecent = 0;
  let worstBase = 0;
  let sum = 0;
  for (let i = 0; i < systemIds.length; i++) {
    const id = systemIds[i];
    const sys = getSystem(id);
    const security = sys?.security ?? 0;
    const band: SecurityBand = securityBand(security);
    const { recentPrev, recentNext, basePrev, baseNext } = gateKillsForSystem(systemIds, i, data);
    const recent = recentPrev + recentNext;
    const base = basePrev + baseNext;
    const r = systemRisk(security, recent, base);
    if (r > worst) {
      worst = r;
      worstName = sys?.name ?? `System ${id}`;
      worstBand = band;
      worstRecent = recent;
      worstBase = base;
    }
    sum += r;
  }
  const avg = sum / systemIds.length;
  const blended = WORST_WEIGHT * worst + AVG_WEIGHT * avg;
  const index = Math.round(blended * 100);

  const steps = [
    `Worst system: ${worstName} (${worstBand}-sec, ${worstRecent} recent / ${f2(worstBase)}/h avg gate kills) → risk ${f2(worst)}`,
    `Average system risk = ${f2(avg)}`,
    `Danger = ${WORST_WEIGHT} × ${f2(worst)} + ${AVG_WEIGHT} × ${f2(avg)} = ${f2(blended)} → ${index}`,
  ];

  return { index, steps };
}
