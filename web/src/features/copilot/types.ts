// Copilot data model: two mutually-exclusive runs (buy / sell) over one
// persistent ship inventory. A run is a list of single-leg RunStops — buy a cheap
// stack at a station, or sell a held stack into a station's bids — ordered into an
// open-path tour. The inventory is the bridge between runs (see atoms.ts).
import type { ContractEndpoint, RouteSystem } from '@/features/courierContracts/types';

export type BasketKind = 'courier' | 'arbitrage';

/** Which run the Copilot is driving. Buy = acquire cargo; Sell = dispose cargo. */
export type RunMode = 'buy' | 'sell';

/** A place the route stops at: where you buy or sell. */
export interface BasketStop {
  endpoint: ContractEndpoint;
  /** Solar-system id from the endpoint; null when the structure is unresolved. */
  systemId: number | null;
}

// --- Ship inventory ----------------------------------------------------------

/**
 * One stack of cargo the ship is carrying. The Copilot maintains this itself
 * (ESI can't read an active ship's hold): a completed buy adds a lot, a completed
 * sell shrinks one, and the user can hand-edit it when reality drifts. It is the
 * bridge between modes — switching runs discards the plan but keeps the cargo.
 */
export interface Holding {
  typeId: number;
  itemName: string;
  qty: number;
  /** Per-unit packaged volume (m³). */
  unitVolumeM3: number;
  /** Per-unit weighted-average acquisition cost (ISK). */
  unitCostBasis: number;
}

/** Add a freshly-bought lot to the inventory, merging by type with a weighted-average cost basis. */
export function addHolding(holdings: Holding[], lot: Holding): Holding[] {
  if (lot.qty <= 0) return holdings;
  const i = holdings.findIndex((h) => h.typeId === lot.typeId);
  if (i === -1) return [...holdings, lot];
  const existing = holdings[i];
  const totalQty = existing.qty + lot.qty;
  const merged: Holding = {
    ...existing,
    qty: totalQty,
    unitVolumeM3: lot.unitVolumeM3 || existing.unitVolumeM3,
    unitCostBasis:
      totalQty > 0
        ? (existing.qty * existing.unitCostBasis + lot.qty * lot.unitCostBasis) / totalQty
        : existing.unitCostBasis,
  };
  const next = holdings.slice();
  next[i] = merged;
  return next;
}

/** Shrink a held stack by `qty` (a completed sell); drops the stack when it hits zero. */
export function removeHolding(holdings: Holding[], typeId: number, qty: number): Holding[] {
  return holdings
    .map((h) => (h.typeId === typeId ? { ...h, qty: h.qty - qty } : h))
    .filter((h) => h.qty > 0);
}

/** Manually set a held stack's quantity (the drift escape-hatch); 0 removes it. */
export function setHoldingQty(holdings: Holding[], typeId: number, qty: number): Holding[] {
  return holdings
    .map((h) => (h.typeId === typeId ? { ...h, qty } : h))
    .filter((h) => h.qty > 0);
}

// --- Candidates from the server (FE mirrors of the route-free server shapes) --

/** A cheap stack to buy: the buy-run suggestion (mirror of server BuyOpportunity). */
export interface BuyCandidate {
  id: string;
  typeId: number;
  itemName: string;
  quantity: number;
  unitVolume: number;
  totalVolume: number;
  askPrice: number;
  buyCost: number;
  marketPrice: number | null;
  /** How far under market the ask sits (%); null when there's no reference price. */
  discountPct: number | null;
  bestResaleNet: number;
  resaleMarginPct: number;
  bestResaleStation: ContractEndpoint;
  demandUnits: number;
  source: ContractEndpoint;
}

/** A buyer for a held stack: the sell-run suggestion (mirror of server SellOpportunity). */
export interface SellCandidate {
  id: string;
  typeId: number;
  itemName: string;
  quantity: number;
  requested: number;
  unitVolume: number;
  totalVolume: number;
  sellPrice: number;
  grossRevenue: number;
  netRevenue: number;
  marketPrice: number | null;
  salesTax: number;
  dest: ContractEndpoint;
}

// --- Run plan ----------------------------------------------------------------

/**
 * One chosen, single-leg item in the current run. A buy stop acquires `quantity`
 * units (spending `capitalIsk`, gaining `cargoM3`); a sell stop disposes them
 * (receiving `cashFlow` net ISK, freeing `cargoM3`). Persisted in the plan atom.
 */
export interface RunStop {
  /** Candidate id — stable key for dedupe/removal. */
  key: string;
  mode: RunMode;
  typeId: number;
  itemName: string;
  quantity: number;
  cargoM3: number;
  /** Wallet change when completed: buy → −buyCost, sell → +netRevenue. */
  cashFlow: number;
  /** ISK needed up front to afford this stop (buy cost; 0 for a sell). */
  capitalIsk: number;
  /** The single stop: the buy station (buy run) or the sell station (sell run). */
  stop: BasketStop;
  /** The item's type id, to open its in-game market window. */
  marketTypeId: number;
}

/** One roadmap step: travel the leg to the stop, then buy/sell there. */
export interface RunStep {
  key: string;
  mode: RunMode;
  typeId: number;
  quantity: number;
  /** Verb-led label, e.g. "Buy 1 000 Tritanium". */
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

export interface RunPlan {
  mode: RunMode;
  steps: RunStep[];
  totalJumps: number;
  /** Danger index 0–100 over the whole tour. */
  danger: number;
  dangerSteps: string[];
  /** Largest cargo (m³) held at any point. */
  peakCargo: number;
  /** Buy run: total ISK spent acquiring stock. */
  totalSpend: number;
  /** Sell run: total net ISK received. */
  totalRevenue: number;
  /** Items that couldn't be placed (unresolved / unreachable / too big / unaffordable). */
  infeasibleKeys: string[];
}

/** Normalise a buy candidate into a run stop (acquisition: spend ISK, gain cargo). */
export function buyCandidateToStop(c: BuyCandidate): RunStop {
  return {
    key: c.id,
    mode: 'buy',
    typeId: c.typeId,
    itemName: c.itemName,
    quantity: c.quantity,
    cargoM3: c.totalVolume,
    cashFlow: -c.buyCost,
    capitalIsk: c.buyCost,
    stop: { endpoint: c.source, systemId: c.source.systemId },
    marketTypeId: c.typeId,
  };
}

/** Normalise a sell candidate into a run stop (disposal: receive ISK, free cargo). */
export function sellCandidateToStop(c: SellCandidate): RunStop {
  return {
    key: c.id,
    mode: 'sell',
    typeId: c.typeId,
    itemName: c.itemName,
    quantity: c.quantity,
    cargoM3: c.totalVolume,
    cashFlow: c.netRevenue,
    capitalIsk: 0,
    stop: { endpoint: c.dest, systemId: c.dest.systemId },
    marketTypeId: c.typeId,
  };
}
