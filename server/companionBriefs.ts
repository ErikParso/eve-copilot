// PER-ACTION BRIEFS — the tuning knobs. Each brief explains, for one action:
//   • what the action is,
//   • what's in its action-specific DATA (beyond the always-present ambient context),
//   • what the agent should consider, and
//   • HOW the response should look (length/shape) — this differs per action.
// To change how an action feels, edit its brief. To add an action: add its id to
// CompanionActionId + ACTION_IDS, add a brief here, and dispatch it from the FE.

export type CompanionActionId =
  | 'app-load'
  | 'set-waypoint-pickup'
  | 'set-waypoint-dropoff'
  | 'open-market'
  | 'open-contract'
  | 'open-bundle';

const ACTION_IDS: CompanionActionId[] = [
  'app-load',
  'set-waypoint-pickup',
  'set-waypoint-dropoff',
  'open-market',
  'open-contract',
  'open-bundle',
];

export function isCompanionAction(value: unknown): value is CompanionActionId {
  return typeof value === 'string' && (ACTION_IDS as string[]).includes(value);
}

export const BRIEFS: Record<CompanionActionId, string> = {
  'app-load':
    'The pilot just opened the tool at the start of a session. Greet them with a greeting that fits the time of day, inferred from DATA.clientTime (local time HH:MM). Use their name (DATA.pilotName) if present, and signal you are ready. No action-specific DATA. RESPONSE: one short greeting, about 5-12 words.',

  'set-waypoint-pickup':
    'The pilot set an in-game autopilot waypoint to the PICKUP / BUY location of an opportunity — where they collect or buy the cargo. Action DATA: { target } is the destination system or station. Acknowledge the pickup destination; a brief navigational remark is welcome. RESPONSE: one sentence, about 6-14 words.',

  'set-waypoint-dropoff':
    'The pilot set an in-game autopilot waypoint to the DROP-OFF / SELL location — where they deliver or sell the cargo. Action DATA: { target } is the destination system or station. Acknowledge the delivery destination. RESPONSE: one sentence, about 6-14 words.',

  'open-market':
    'The pilot opened the in-game market window for an item — they are about to buy or sell it. Action DATA: { target } is the item name. RESPONSE: one very short acknowledgement, about 5-10 words.',

  'open-contract':
    'The pilot opened an in-game courier contract for review (a hauling job for a reward). Action DATA: { target } identifies the contract or its route. RESPONSE: one short acknowledgement, about 5-12 words.',

  'open-bundle':
    'The pilot opened an in-game sell-contract bundle for review — a package of items sold together as one deal. Action DATA: { target } identifies the bundle. RESPONSE: one short acknowledgement, about 5-12 words.',
};
