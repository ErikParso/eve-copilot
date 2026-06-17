// In-game UI actions via authenticated ESI (the `esi-ui.*` scopes, already
// requested at login). These are the only writes the app makes — Copilot is a
// navigator, so it can set waypoints but never accepts contracts or trades.
import { esiPostAuthed } from './esiClient';

/**
 * Add an in-game autopilot waypoint to `destinationId` (a station, structure or
 * solar-system id). By default it clears existing waypoints and sets this as the
 * sole destination; pass `add` to append to the current route instead.
 */
export function setWaypoint(
  destinationId: number,
  token: string,
  opts: { add?: boolean } = {},
  signal?: AbortSignal,
): Promise<void> {
  const add = opts.add ?? false;
  return esiPostAuthed(
    '/ui/autopilot/waypoint/',
    token,
    {
      destination_id: destinationId,
      add_to_beginning: 'false',
      clear_other_waypoints: add ? 'false' : 'true',
    },
    signal,
  );
}

/**
 * Open the in-game Market Details window for `typeId` in the running client. This
 * is how an arbitrage haul (which is a market trade, not a contract) is acted on:
 * the player buys from the sell orders shown here. ESI has no way to target a
 * specific order or station — it opens the item's market view; the buy station is
 * on the card, and Waypoint gets the player there.
 */
export function openMarketWindow(typeId: number, token: string, signal?: AbortSignal): Promise<void> {
  return esiPostAuthed('/ui/openwindow/marketdetails/', token, { type_id: typeId }, signal);
}

/**
 * Open the in-game window for a specific public contract, so the player can
 * review and accept it. (ESI can't accept it — Copilot is a navigator.)
 */
export function openContract(contractId: number, token: string, signal?: AbortSignal): Promise<void> {
  return esiPostAuthed('/ui/openwindow/contract/', token, { contract_id: contractId }, signal);
}
