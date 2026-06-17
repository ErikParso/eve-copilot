// Phase 2: attractivity-maximizing suggestions. The Copilot proposes contracts /
// hauls to ADD to the current plan (never removals or swaps). For each candidate
// we build the resulting plan (current basket + that item, re-optimized by the
// planner) and score every candidate plan TOGETHER with the no-op baseline using
// the shared attractivity engine — the scorer is relative, so a plan only has a
// meaningful score against other plans. We then surface the candidates whose
// resulting plan beats the baseline, best first.
import { score, type AttractivityWeights, type Scorable } from '@/features/attractivity/scoring';
import { perJump } from '@/features/courierContracts/journey';
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
  /** The resulting plan's attractivity (relative to the set) — used to rank/filter, not shown. */
  attractivity: number;
  /** Extra jumps this addition costs the tour vs. the current plan. */
  deltaJumps: number;
  /** Extra income this addition adds vs. the current plan. */
  deltaIncome: number;
  /** Change in the plan's danger index (0–100) vs. the current plan (+ = more dangerous). */
  deltaDanger: number;
  /** The resulting plan's ISK-per-jump (income ÷ total jumps). */
  iskPerJump: number | null;
  /** Change in ISK-per-jump vs. the current plan (+ = more efficient). */
  deltaIskPerJump: number | null;
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
  // The current plan, used only to report each addition's marginal cost.
  const baseline = buildPlan(basket, inp);

  // Build each candidate's resulting plan; drop the ones that don't fit.
  const entries = candidates
    .map((item) => ({ item, plan: buildPlan([...basket, item], inp) }))
    .filter((e) => !e.plan.infeasibleKeys.includes(e.item.key));

  // Score the resulting plans exactly the way Hauling scores its cards: the
  // shared engine, min-max normalised across the set being ranked, weighted.
  // The set here is "the plan with each candidate added" — so on an EMPTY plan
  // every resulting plan is a single contract and the set is the Hauling set,
  // which reproduces the Hauling card scores and ordering. (The baseline is NOT
  // part of this set, so its all-zero metrics can't skew the normalisation.)
  const scored = score(entries, weights, (e) => planToScorable(e.plan));

  const baseIskPerJump = perJump(baseline.totalIncome, baseline.totalJumps);

  return scored
    .map((e) => {
      const iskPerJump = perJump(e.plan.totalIncome, e.plan.totalJumps);
      return {
        item: e.item,
        plan: e.plan,
        attractivity: e.attractivity,
        deltaJumps: e.plan.totalJumps - baseline.totalJumps,
        deltaIncome: e.plan.totalIncome - baseline.totalIncome,
        deltaDanger: e.plan.danger - baseline.danger,
        iskPerJump,
        deltaIskPerJump:
          iskPerJump !== null && baseIskPerJump !== null ? iskPerJump - baseIskPerJump : null,
      };
    })
    .sort((a, b) => b.attractivity - a.attractivity);
}
