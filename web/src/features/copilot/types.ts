// Copilot data model: a serializable basket of contracts/hauls the user wants to
// run, plus the computed multi-stop Plan. Items are distilled from the Hauling
// page's ResultCards into a neutral pickup→dropoff shape so courier contracts and
// arbitrage hauls plan identically.
import type { CourierRow, ContractEndpoint, RouteSystem } from '@/features/courierContracts/types';
import type { ArbitrageRow } from '@/features/arbitrage/types';
import type { ResultCard } from '@/features/courierContracts/combined';

export type BasketKind = 'courier' | 'arbitrage';

/** A place the route stops at: where you load/buy (pickup) or unload/sell. */
export interface BasketStop {
  endpoint: ContractEndpoint;
  /** Solar-system id from the endpoint; null when the structure is unresolved. */
  systemId: number | null;
}

/** One item the user added to the plan, distilled from a ResultCard. */
export interface BasketItem {
  /** ResultCard.key — stable id used for dedupe/removal. */
  key: string;
  kind: BasketKind;
  /** Human label (item name for arbitrage, generic for courier). */
  label: string;
  /** ISK upside: courier reward / arbitrage profit. */
  income: number;
  /** Cargo to move (m³): courier volume / arbitrage total volume. */
  cargoM3: number;
  /** ISK put up at pickup: courier collateral / arbitrage buy cost. */
  capitalIsk: number;
  /** Where you load (courier pickup) or buy (arbitrage source). */
  pickup: BasketStop;
  /** Where you unload (courier dropoff) or sell (arbitrage dest). */
  dropoff: BasketStop;
}

export type StepAction = 'pickup' | 'dropoff';

/** One roadmap step: travel the leg to the stop, then do the action there. */
export interface PlanStep {
  action: StepAction;
  itemKey: string;
  kind: BasketKind;
  /** Verb-led label, e.g. "Buy Tritanium" / "Drop off courier". */
  label: string;
  stop: BasketStop;
  /** Route systems travelled to reach this stop (includes both endpoints). */
  leg: RouteSystem[];
  jumps: number;
  /** Simulated ISK wallet AFTER doing this step. */
  walletAfter: number;
  /** Simulated cargo (m³) held AFTER doing this step. */
  cargoAfter: number;
}

export interface Plan {
  steps: PlanStep[];
  totalJumps: number;
  /** Danger index 0–100 over the whole tour. */
  danger: number;
  dangerSteps: string[];
  /** Largest cargo (m³) held at any point. */
  peakCargo: number;
  /** Largest ISK committed at any point (start ISK − lowest wallet). */
  peakCapital: number;
  totalIncome: number;
  /** Items that couldn't be placed (unresolved / unreachable / too big / unaffordable). */
  infeasibleKeys: string[];
}

// Keys match the Hauling grid's ResultCard keys so a card and its basket entry
// dedupe against each other.
export function courierRowToBasketItem(r: CourierRow): BasketItem {
  return {
    key: `c:${r.id}`,
    kind: 'courier',
    label: 'Courier contract',
    income: r.reward,
    cargoM3: r.volume,
    capitalIsk: r.collateral,
    pickup: { endpoint: r.pickup, systemId: r.pickup.systemId },
    dropoff: { endpoint: r.dropoff, systemId: r.dropoff.systemId },
  };
}

export function arbitrageRowToBasketItem(r: ArbitrageRow): BasketItem {
  return {
    key: `a:${r.id}`,
    kind: 'arbitrage',
    label: r.itemName,
    income: r.profit,
    cargoM3: r.totalVolume,
    capitalIsk: r.buyCost,
    pickup: { endpoint: r.source, systemId: r.source.systemId },
    dropoff: { endpoint: r.dest, systemId: r.dest.systemId },
  };
}

/** Map a Hauling result card to a basket item for the Copilot plan. */
export function cardToBasketItem(card: ResultCard): BasketItem {
  return card.kind === 'courier'
    ? courierRowToBasketItem(card.row)
    : arbitrageRowToBasketItem(card.row);
}
