import { useState } from 'react';
import { useStore, useAtomValue } from 'jotai';
import { IconButton, Tooltip } from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { activeCharacterAtom } from '@/features/auth/atoms';
import { ensureAccessToken } from '@/features/auth/tokenManager';
import { openContract } from '@/api/ui';

/**
 * Opens the in-game Contract window for a courier contract so the player can
 * review and accept it.
 * Needs a logged-in character; disabled with the reason otherwise.
 */
export function OpenContractButton({ contractId }: { contractId: number }) {
  const store = useStore();
  const active = useAtomValue(activeCharacterAtom);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    if (!active || busy) return;
    setBusy(true);
    try {
      const token = await ensureAccessToken(store, active.characterId);
      await openContract(contractId, token);
    } catch {
      // Best-effort UI action; nothing to recover. The client just won't open.
    } finally {
      setBusy(false);
    }
  };

  const title = active
    ? 'Open this contract in-game (review and accept it)'
    : 'Log in with a character to open this contract in-game';

  return (
    <Tooltip title={title} arrow>
      {/* span lets the tooltip show even when the button is disabled */}
      <span>
        <IconButton
          size="small"
          onClick={open}
          disabled={!active || busy}
          sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
        >
          <AssignmentIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
}
