// AI companion — shared types. The companion reacts to a pilot ACTION with a single
// spoken line. Each action is its own id (no merging) with its own brief (briefs.ts);
// the global identity lives in persona.ts. Character development (memory, reflection)
// is intentionally out for now — this is the minimal action→response pipe.

/** Every action the companion can react to. Add one here + a brief in briefs.ts +
 * a dispatch site, and it's wired. Kept flat and separate on purpose. */
export type CompanionActionId =
  | 'app-load'
  | 'set-waypoint-pickup'
  | 'set-waypoint-dropoff'
  | 'open-market'
  | 'open-contract'
  | 'open-bundle';

/** A dispatched event: which action + its flat DATA facts (item/system names,
 * numbers). `data` shape is per-action, described in that action's brief. */
export interface CompanionEvent {
  action: CompanionActionId;
  data?: Record<string, unknown>;
}

/** A line shown in the panel — the companion's response to an action. */
export interface CompanionMessage {
  id: string;
  ts: string;
  action: CompanionActionId;
  text: string;
}
