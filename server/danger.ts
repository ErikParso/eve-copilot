// Route danger model — the single source of truth (the FE renders the index,
// steps and per-system skull flags shipped from here; it computes none of this).
//
// Danger is a PROBABILITY. Each gate a route uses gets pᵢ = the modelled chance of
// getting caught/killed there: an unobserved-camp FLOOR (by security) lifted toward
// a camp ceiling by the HAZARD from recent (60m) + habitual (24h) gate kills. The
// route danger is the chance of trouble on at least one gate — 1 − Π(1−pᵢ) — so
// every gate can only add risk (a longer route is never rated safer through the
// same camp) and the worst gate dominates on its own.
//
// Kills are read AT the specific stargates a route uses (station/mission/structure
// kills never threaten a hauler in transit). For each system we sum the two gates
// it actually uses: the gate to the previous system (where you land) and to the
// next (where you warp off and jump) — distinct stargates, so no double count.
import { getSystem, securityBand, connectionGate } from './sde.js';
import type { GateKillData } from './types.js';

// Empty-gate death probability by 0.1 security tier — the "an unobserved camp could
// be here" floor (absence of kills ≠ safety). Ramps high→null; 0.5 is 5× a 0.9 gate
// (lowest high-sec is where freighter ganks concentrate). Indexed by round(sec*10);
// null (≤0) is flat. These COMPOUND across a route, so they're deliberately small.
const P_FLOOR_NULL = 0.04;
const P_FLOOR = [
  P_FLOOR_NULL, // 0.0 (placeholder — ≤0 guarded to null)
  0.03, // 0.1
  0.02, // 0.2
  0.015, // 0.3
  0.01, // 0.4
  0.005, // 0.5
  0.003, // 0.6
  0.002, // 0.7
  0.002, // 0.8
  0.001, // 0.9
  0.001, // 1.0
];
function pFloor(security: number): number {
  if (security <= 0) return P_FLOOR_NULL;
  return P_FLOOR[Math.min(10, Math.max(1, Math.round(security * 10)))];
}

const P_MAX = 0.85; // ceiling for a fully-saturated camp (never 1 — camps are survivable)
const S_RECENT = 2.5; // recent-kill saturation: 1→0.33, 3→0.70, 5→0.86
const S_BASELINE = 3; // 24h-average saturation (gentler than recent): 1/h→0.28, 3/h→0.63

/** A system is flagged with a skull at this many RECENT (60m) gate kills or more. */
export const SKULL_MIN_GATE_KILLS = 1;

const f2 = (n: number): string => n.toFixed(2);
const f3 = (n: number): string => n.toFixed(3);

/** Saturating 0..1 signal for a kill count/rate. */
const sat = (x: number, scale: number): number => 1 - Math.exp(-x / scale);

/**
 * Per-gate probability (0..1) of getting caught/killed: the security floor lifted
 * toward P_MAX by the hazard from recent + 24h kills (a probabilistic OR — either
 * "camped now" or "habitually camped" raises it, both together most).
 */
export function gateProbability(security: number, recent: number, baseline: number): number {
  const floor = pFloor(security);
  const hazard = 1 - (1 - sat(recent, S_RECENT)) * (1 - sat(baseline, S_BASELINE));
  return floor + (P_MAX - floor) * hazard;
}

/** Whether a system should be flagged with a skull — RECENT (60m) kills only, so
 *  the skull means "camp right now", not "historically dangerous". */
export function isGankRisk(recentGateKills: number): boolean {
  return recentGateKills >= SKULL_MIN_GATE_KILLS;
}

export interface SystemDanger {
  index: number;
  steps: string[];
}

/**
 * One system's danger (0–100 = % chance of getting caught at its gates) plus the
 * exact-number breakdown, from the two gates it uses on the route. This is the
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
  const recent = recentPrev + recentNext;
  const base = basePrev + baseNext;
  const floor = pFloor(security);
  const ksR = sat(recent, S_RECENT);
  const ksB = sat(base, S_BASELINE);
  const hazard = 1 - (1 - ksR) * (1 - ksB);
  const p = floor + (P_MAX - floor) * hazard;
  const index = Math.round(p * 100);
  const steps = [
    `Recent kills 60m ${recent}: 1−e^(−${recent}/${S_RECENT}) = ${f2(ksR)}`,
    `24h avg ${f2(base)}/h: 1−e^(−${f2(base)}/${S_BASELINE}) = ${f2(ksB)}`,
    `Hazard = 1−(1−${f2(ksR)})(1−${f2(ksB)}) = ${f2(hazard)}`,
    `Floor (${band}-sec) ${f3(floor)} + (${P_MAX}−${f3(floor)})×${f2(hazard)} = ${f2(p)}`,
    `→ ${index}% chance of getting caught here`,
  ];
  return { index, steps };
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

/** How many worst gates the route tooltip lists individually before folding the rest. */
const MAX_LISTED_GATES = 5;

/**
 * Route danger (0–100 = % chance of getting caught on ≥1 gate) + its explanation,
 * over an ORDERED list of system ids. Chain-survival: danger = 1 − Π(1−pᵢ). Unknown
 * systems are treated as null-sec (conservative). Empty route → 0.
 */
export function dangerForSystems(systemIds: number[], data: GateKillData): DangerResult {
  if (systemIds.length === 0) {
    return { index: 0, steps: ['No route systems to assess → danger 0.'] };
  }

  const perGate: { name: string; p: number }[] = [];
  let survival = 1;
  for (let i = 0; i < systemIds.length; i++) {
    const id = systemIds[i];
    const sys = getSystem(id);
    const security = sys?.security ?? 0;
    const { recentPrev, recentNext, basePrev, baseNext } = gateKillsForSystem(systemIds, i, data);
    const p = gateProbability(security, recentPrev + recentNext, basePrev + baseNext);
    survival *= 1 - p;
    perGate.push({ name: sys?.name ?? `System ${id}`, p });
  }
  const index = Math.round((1 - survival) * 100);

  // List only gates that actually contribute (≥1%), busiest first; summarise the
  // safe majority as a count so the tooltip isn't a wall of "0%".
  const pct = (p: number): string => `${Math.round(p * 100)}%`;
  const notable = perGate.filter((g) => g.p >= 0.01).sort((a, b) => b.p - a.p);
  const listed = notable.slice(0, MAX_LISTED_GATES);
  const steps = listed.map((g) => `${g.name}: ${pct(g.p)}`);
  const others = systemIds.length - listed.length;
  if (listed.length === 0) {
    steps.push(`All ${systemIds.length} gate${systemIds.length === 1 ? '' : 's'} near-safe`);
  } else if (others > 0) {
    steps.push(`+ ${others} other gate${others === 1 ? '' : 's'}`);
  }
  steps.push(`Survival = Π(1−pᵢ) = ${f2(survival)} → ${index}% chance of trouble`);

  return { index, steps };
}
