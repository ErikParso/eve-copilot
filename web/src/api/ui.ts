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
