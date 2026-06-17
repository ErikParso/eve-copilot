import { useState } from 'react';
import { useStore, useAtomValue } from 'jotai';
import { IconButton, Tooltip } from '@mui/material';
import StorefrontIcon from '@mui/icons-material/Storefront';
import { activeCharacterAtom } from '@/features/auth/atoms';
import { ensureAccessToken } from '@/features/auth/tokenManager';
import { openMarketWindow } from '@/api/ui';

/**
 * Opens the in-game Market Details window for an arbitrage item so the player can
 * buy from the sell orders (an arbitrage haul is a market trade, not a contract).
 * Needs a logged-in character; disabled with the reason otherwise.
 */
export function OpenMarketButton({ typeId }: { typeId: number }) {
  const store = useStore();
  const active = useAtomValue(activeCharacterAtom);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    if (!active || busy) return;
    setBusy(true);
    try {
      const token = await ensureAccessToken(store, active.characterId);
      await openMarketWindow(typeId, token);
    } catch {
      // Best-effort UI action; nothing to recover. The client just won't open.
    } finally {
      setBusy(false);
    }
  };

  const title = active
    ? 'Open this item on the in-game Market (buy from the sell orders)'
    : 'Log in with a character to open the in-game Market';

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
          <StorefrontIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
}
