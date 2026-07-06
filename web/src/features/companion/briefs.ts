import type { CompanionActionId } from './types';

// PER-ACTION BRIEFS — the tuning knobs. Each brief explains, for one action:
//   • what the action is,
//   • what's in its DATA,
//   • what the agent should consider when responding.
// To change how an action feels, edit its brief. To add an action: add its id in
// types.ts (CompanionActionId), add a brief here, and dispatch it. Nothing else.
export const BRIEFS: Record<CompanionActionId, string> = {
  'app-load':
    'The pilot just opened the tool at the start of a session. Greet them briefly and signal you are ready. No DATA.',

  'set-waypoint-pickup':
    'The pilot set an in-game autopilot waypoint to the PICKUP / BUY location of an opportunity — where they collect (or buy) the cargo. DATA: { target } is the destination system or station. Acknowledge the pickup destination; a brief navigational remark is welcome.',

  'set-waypoint-dropoff':
    'The pilot set an in-game autopilot waypoint to the DROP-OFF / SELL location — where they deliver or sell the cargo. DATA: { target } is the destination system or station. Acknowledge the delivery destination.',

  'open-market':
    'The pilot opened the in-game market window for an item — they are about to buy or sell it. DATA: { target } is the item name. Acknowledge concisely.',

  'open-contract':
    'The pilot opened an in-game courier contract for review (a hauling job for a reward). DATA: { target } identifies the contract or its route. Acknowledge concisely.',

  'open-bundle':
    'The pilot opened an in-game sell-contract bundle for review — a package of items sold together as one deal. DATA: { target } identifies the bundle. Acknowledge concisely.',
};
