import { useState } from 'react';
import { useStore, useAtomValue } from 'jotai';
import { IconButton, Tooltip } from '@mui/material';
import NearMeIcon from '@mui/icons-material/NearMe';
import { activeCharacterAtom } from '@/features/auth/atoms';
import { ensureAccessToken } from '@/features/auth/tokenManager';
import { setWaypoint } from '@/api/ui';
import type { ContractEndpoint } from '@/features/courierContracts/types';

interface WaypointButtonProps {
  endpoint: ContractEndpoint;
  /**
   * If true, defaults to appending the waypoint to the route.
   * If false, defaults to clearing the route and setting this as the sole destination.
   * In either case, holding Shift will perform the opposite action.
   */
  add?: boolean;
}

export function WaypointButton({ endpoint, add = false }: WaypointButtonProps) {
  const store = useStore();
  const active = useAtomValue(activeCharacterAtom);
  const [busy, setBusy] = useState(false);

  const destId = endpoint.resolved ? endpoint.locationId : endpoint.systemId;

  if (!destId) {
    return (
      <Tooltip title="Location cannot be resolved to set a waypoint" arrow>
        <span>
          <IconButton size="small" disabled>
            <NearMeIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    );
  }

  const handleSetWaypoint = async (e: React.MouseEvent) => {
    if (!active || busy) return;
    setBusy(true);

    // Shift click does the opposite of the default behavior
    const shouldAdd = e.shiftKey ? !add : add;

    try {
      const token = await ensureAccessToken(store, active.characterId);
      await setWaypoint(destId, token, { add: shouldAdd });
    } catch (err) {
      // Best-effort UI action; nothing to recover.
      console.error('Failed to set in-game waypoint:', err);
    } finally {
      setBusy(false);
    }
  };

  const modeText = add ? 'Add to' : 'Set as sole';
  const oppositeModeText = add ? 'set as sole destination' : 'add to route';
  
  const title = active
    ? `${modeText} in-game waypoint (Shift+Click to ${oppositeModeText})`
    : 'Log in with a character to set in-game waypoints';

  return (
    <Tooltip title={title} arrow>
      {/* span lets the tooltip show even when the button is disabled */}
      <span>
        <IconButton
          size="small"
          onClick={handleSetWaypoint}
          disabled={!active || busy}
          sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
        >
          <NearMeIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
}
