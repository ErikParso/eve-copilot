// Phase 2: attractivity-maximizing suggestions. The Copilot proposes contracts /
// hauls to ADD to the current plan (never removals or swaps). For each candidate
// we build the resulting plan (current basket + that item, re-optimized by the
// planner) and score every candidate plan TOGETHER with the no-op baseline using
// the shared attractivity engine — the scorer is relative, so a plan only has a
// meaningful score against other plans. We then surface the candidates whose
// resulting plan beats the baseline, best first.
import { score, type AttractivityWeights, type Scorable } from '@/features/attractivity/scoring';
import { buildPlan, type PlannerInputs } from './planner';
import type { BasketItem, Plan } from './types';

/** Collapse a whole plan onto the neutral Scorable shape the engine expects. */
export function planToScorable(plan: Plan): Scorable {
  return {
    income: plan.totalIncome,
    totalJumps: plan.totalJumps,
    danger: plan.danger,
    cargo: plan.peakCargo,
    investment: plan.peakCapital,
  };
}

export interface Suggestion {
  item: BasketItem;
  /** The resulting plan's attractivity, relative to the scored candidate set. */
  attractivity: number;
  /** Extra jumps this addition costs the tour vs. the current plan. */
  deltaJumps: number;
  /** Extra income this addition adds vs. the current plan. */
  deltaIncome: number;
  plan: Plan;
}

/**
 * Rank candidate additions by the attractivity of the plan they'd produce.
 * Returns only those that beat the current plan, best first.
 */
export function rankSuggestions(
  basket: BasketItem[],
  candidates: BasketItem[],
  inp: PlannerInputs,
  weights: AttractivityWeights,
): Suggestion[] {
  const baseline = buildPlan(basket, inp);

  // Build each candidate's resulting plan; drop ones the planner can't place.
  const entries = candidates
    .map((item) => ({ item, plan: buildPlan([...basket, item], inp) }))
    .filter((e) => !e.plan.infeasibleKeys.includes(e.item.key));

  // Score the baseline and every candidate plan in one relative pass.
  const rows: Array<{ item: BasketItem | null; plan: Plan }> = [
    { item: null, plan: baseline },
    ...entries,
  ];
  const scored = score(rows, weights, (r) => planToScorable(r.plan));
  const baselineScore = scored.find((r) => r.item === null)?.attractivity ?? 0;

  return scored
    .filter((r): r is (typeof scored)[number] & { item: BasketItem } => r.item !== null)
    .map((r) => ({
      item: r.item,
      plan: r.plan,
      attractivity: r.attractivity,
      deltaJumps: r.plan.totalJumps - baseline.totalJumps,
      deltaIncome: r.plan.totalIncome - baseline.totalIncome,
    }))
    .filter((s) => s.attractivity > baselineScore)
    .sort((a, b) => b.attractivity - a.attractivity);
}
