// The Copilot route planner: orders a basket of pickup→dropoff items into a
// single open-path tour (start at the current system, end wherever the last
// delivery lands — no return leg), respecting cargo capacity, available ISK, and
// pickup-before-dropoff precedence.
//
// Phase 1 uses a constrained nearest-neighbour heuristic: from the current
// position, repeatedly take the nearest *eligible* stop (a pickup that still
// fits cargo + capital, or any dropoff of something already loaded). Fewest
// jumps on the chosen route type is the order-dependent slice of attractivity
// (jumps↓ / danger↓), so this approximates "maximise the plan's attractivity"
// for ordering; the full attractivity comparison comes with Phase-2 suggestions.
import { computeDanger } from '@/features/courierContracts/danger';
import type { RouteSystem } from '@/features/courierContracts/types';
import type { BasketItem, BasketStop, Plan, PlanStep, StepAction } from './types';

export interface PlannerInputs {
  /** Current solar-system id, or null when the character location is unknown. */
  origin: number | null;
  /** Usable cargo capacity in m³ (Infinity = unconstrained). */
  capacity: number;
  /** Starting wallet in ISK (Infinity = unconstrained). */
  startIsk: number;
  /** Route legs between solar systems, keyed "from:to" (null = unreachable). */
  getLeg: (from: number, to: number) => RouteSystem[] | null;
}

function jumpsOf(leg: RouteSystem[]): number {
  return Math.max(0, leg.length - 1);
}

function stopOf(item: BasketItem, phase: StepAction): BasketStop {
  return phase === 'pickup' ? item.pickup : item.dropoff;
}

function stepLabel(item: BasketItem, phase: StepAction): string {
  if (item.kind === 'arbitrage') {
    return phase === 'pickup' ? `Buy ${item.label}` : `Sell ${item.label}`;
  }
  return phase === 'pickup' ? 'Pick up courier' : 'Drop off courier';
}

/** Build the ordered plan for a basket under the given constraints. */
export function buildPlan(items: BasketItem[], inp: PlannerInputs): Plan {
  const infeasibleKeys: string[] = [];

  // Drop items that can never be placed regardless of order.
  const feasible: BasketItem[] = [];
  for (const it of items) {
    if (
      it.pickup.systemId === null ||
      it.dropoff.systemId === null ||
      it.cargoM3 > inp.capacity ||
      it.capitalIsk > inp.startIsk
    ) {
      infeasibleKeys.push(it.key);
    } else {
      feasible.push(it);
    }
  }

  const pickedUp = new Set<string>();
  const dropped = new Set<string>();

  let current = inp.origin;
  let wallet = inp.startIsk;
  let cargo = 0;
  // ISK currently tied up (collateral held + stock bought, not yet recovered).
  // Tracked directly so it's correct even when no starting wallet is set.
  let committed = 0;
  let peakCargo = 0;
  let peakCapital = 0;
  let totalIncome = 0;
  let totalJumps = 0;
  const steps: PlanStep[] = [];
  const dangerSystems: RouteSystem[] = [];

  for (;;) {
    // Eligible stops: undelivered pickups that still fit, or any loaded dropoff.
    const eligible: Array<{ item: BasketItem; phase: StepAction }> = [];
    for (const it of feasible) {
      if (dropped.has(it.key)) continue;
      if (pickedUp.has(it.key)) {
        eligible.push({ item: it, phase: 'dropoff' });
      } else if (cargo + it.cargoM3 <= inp.capacity && wallet - it.capitalIsk >= 0) {
        eligible.push({ item: it, phase: 'pickup' });
      }
    }
    if (eligible.length === 0) break;

    // Pick the nearest by jumps; tie-break toward dropoffs (they free cargo +
    // capital). With no known origin, distance is meaningless → take the first
    // eligible and start the tour there.
    let best: { item: BasketItem; phase: StepAction; leg: RouteSystem[] } | null = null;
    let bestJumps = Infinity;
    let bestPhaseRank = Number.POSITIVE_INFINITY;
    for (const cand of eligible) {
      const to = stopOf(cand.item, cand.phase).systemId!;
      let leg: RouteSystem[];
      if (current === null) {
        leg = [];
      } else {
        const l = inp.getLeg(current, to);
        if (l === null) continue; // unreachable from here
        leg = l;
      }
      const jumps = jumpsOf(leg);
      const phaseRank = cand.phase === 'dropoff' ? 0 : 1;
      if (jumps < bestJumps || (jumps === bestJumps && phaseRank < bestPhaseRank)) {
        best = { item: cand.item, phase: cand.phase, leg };
        bestJumps = jumps;
        bestPhaseRank = phaseRank;
      }
      if (current === null) break;
    }

    if (best === null) break; // everything left is unreachable from here

    const { item, phase, leg } = best;
    const stop = stopOf(item, phase);
    totalJumps += jumpsOf(leg);
    // Stitch legs into one route for danger, dropping the seam shared with the
    // previous leg's last system.
    if (dangerSystems.length === 0) dangerSystems.push(...leg);
    else dangerSystems.push(...leg.slice(1));

    if (phase === 'pickup') {
      pickedUp.add(item.key);
      wallet -= item.capitalIsk;
      committed += item.capitalIsk;
      cargo += item.cargoM3;
    } else {
      dropped.add(item.key);
      wallet += item.capitalIsk + item.income;
      committed -= item.capitalIsk;
      cargo -= item.cargoM3;
      totalIncome += item.income;
    }
    peakCargo = Math.max(peakCargo, cargo);
    peakCapital = Math.max(peakCapital, committed);

    steps.push({
      action: phase,
      itemKey: item.key,
      kind: item.kind,
      label: stepLabel(item, phase),
      stop,
      leg,
      jumps: jumpsOf(leg),
      walletAfter: wallet,
      cargoAfter: cargo,
    });
    current = stop.systemId;
  }

  // Anything feasible we couldn't deliver (deadlock / unreachable dropoff).
  for (const it of feasible) if (!dropped.has(it.key)) infeasibleKeys.push(it.key);

  const { index, steps: dangerSteps } = computeDanger(dangerSystems);

  return {
    steps,
    totalJumps,
    danger: index,
    dangerSteps,
    peakCargo,
    peakCapital,
    totalIncome,
    infeasibleKeys,
  };
}
