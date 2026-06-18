// The Copilot run planner: orders a set of single-leg stops into one open-path
// tour (start at the current system, end wherever the last stop lands — no return
// leg). A buy run visits buy stations while they still fit cargo + wallet; a sell
// run visits sell stations to dispose held stock (no capital/cargo gate — you
// already hold it). Constrained nearest-neighbour by jumps on the chosen route
// type, which is the order-dependent slice of attractivity (jumps↓ / danger↓).
import { computeDanger } from '@/features/courierContracts/danger';
import type { RouteSystem } from '@/features/courierContracts/types';
import type { RunMode, RunPlan, RunStep, RunStop } from './types';

export interface RunPlannerInputs {
  mode: RunMode;
  /** Current solar-system id, or null when the character location is unknown. */
  origin: number | null;
  /** Usable cargo capacity in m³ (Infinity = unconstrained). */
  capacity: number;
  /** Starting wallet in ISK (Infinity = unconstrained). */
  startIsk: number;
  /** Cargo (m³) already in the hold when the run starts. */
  startCargo: number;
  /** Route legs between solar systems, keyed "from:to" (null = unreachable). */
  getLeg: (from: number, to: number) => RouteSystem[] | null;
}

function jumpsOf(leg: RouteSystem[]): number {
  return Math.max(0, leg.length - 1);
}

function stepLabel(stop: RunStop): string {
  const verb = stop.mode === 'buy' ? 'Buy' : 'Sell';
  return `${verb} ${stop.itemName}`;
}

/** Build the ordered run plan for a set of stops under the given constraints. */
export function buildRunPlan(stops: RunStop[], inp: RunPlannerInputs): RunPlan {
  const infeasibleKeys: string[] = [];

  // Drop stops that can never be placed regardless of order. For a buy, the stack
  // must fit an empty-of-this hold and be affordable; a sell only needs a system.
  const feasible: RunStop[] = [];
  for (const s of stops) {
    const unreachable = s.stop.systemId === null;
    const tooBig = inp.mode === 'buy' && inp.startCargo + s.cargoM3 > inp.capacity;
    const tooPricey = inp.mode === 'buy' && s.capitalIsk > inp.startIsk;
    if (unreachable || tooBig || tooPricey) infeasibleKeys.push(s.key);
    else feasible.push(s);
  }

  const done = new Set<string>();
  let current = inp.origin;
  let wallet = inp.startIsk;
  let cargo = inp.startCargo;
  let peakCargo = cargo;
  let totalSpend = 0;
  let totalRevenue = 0;
  let totalJumps = 0;
  const steps: RunStep[] = [];
  const dangerSystems: RouteSystem[] = [];

  for (;;) {
    // Eligible: a stop not yet placed that still fits the constraints from here.
    const eligible = feasible.filter((s) => {
      if (done.has(s.key)) return false;
      if (s.mode === 'buy') return cargo + s.cargoM3 <= inp.capacity && wallet - s.capitalIsk >= 0;
      return true; // sells are always allowed — you already hold the stock
    });
    if (eligible.length === 0) break;

    // Nearest by jumps. With no known origin, distance is meaningless → take the
    // first eligible and start the tour there.
    let best: { stop: RunStop; leg: RouteSystem[] } | null = null;
    let bestJumps = Infinity;
    for (const cand of eligible) {
      const to = cand.stop.systemId!;
      let leg: RouteSystem[];
      if (current === null) {
        leg = [];
      } else {
        const l = inp.getLeg(current, to);
        if (l === null) continue; // unreachable from here
        leg = l;
      }
      const jumps = jumpsOf(leg);
      if (jumps < bestJumps) {
        best = { stop: cand, leg };
        bestJumps = jumps;
      }
      if (current === null) break;
    }
    if (best === null) break; // everything left is unreachable from here

    const { stop, leg } = best;
    totalJumps += jumpsOf(leg);
    // Stitch legs into one route for danger, dropping the seam shared with the
    // previous leg's last system.
    if (dangerSystems.length === 0) dangerSystems.push(...leg);
    else dangerSystems.push(...leg.slice(1));

    done.add(stop.key);
    wallet += stop.cashFlow;
    cargo += stop.mode === 'buy' ? stop.cargoM3 : -stop.cargoM3;
    if (stop.mode === 'buy') totalSpend += stop.capitalIsk;
    else totalRevenue += stop.cashFlow;
    peakCargo = Math.max(peakCargo, cargo);

    steps.push({
      key: stop.key,
      mode: stop.mode,
      typeId: stop.typeId,
      quantity: stop.quantity,
      label: stepLabel(stop),
      stop: stop.stop,
      leg,
      jumps: jumpsOf(leg),
      walletAfter: wallet,
      cargoAfter: Math.max(0, cargo),
    });
    current = stop.stop.systemId;
  }

  // Anything feasible we couldn't place (unreachable from the tour).
  for (const s of feasible) if (!done.has(s.key)) infeasibleKeys.push(s.key);

  const { index, steps: dangerSteps } = computeDanger(dangerSystems);

  return {
    mode: inp.mode,
    steps,
    totalJumps,
    danger: index,
    dangerSteps,
    peakCargo,
    totalSpend,
    totalRevenue,
    infeasibleKeys,
  };
}
