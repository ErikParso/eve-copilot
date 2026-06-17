import { useAtom, useAtomValue } from 'jotai';
import { IconButton, Tooltip } from '@mui/material';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';
import { preferencesAtom } from '@/features/preferences/atoms';
import { basketAtom } from '../atoms';
import type { BasketItem } from '../types';

/**
 * Toggles an opportunity in/out of the Copilot basket. Rendered on the Hauling
 * cards. An item that can't fit your ship or wallet (per the global cargo/ISK
 * preferences) can't be added — the button is disabled with the reason.
 */
export function AddToPlanButton({ item }: { item: BasketItem }) {
  const [basket, setBasket] = useAtom(basketAtom);
  const prefs = useAtomValue(preferencesAtom);
  const added = basket.some((b) => b.key === item.key);

  const capacity = prefs.cargoM3 ?? Number.POSITIVE_INFINITY;
  const availableIsk =
    prefs.availableIskMillions !== null
      ? prefs.availableIskMillions * 1_000_000
      : Number.POSITIVE_INFINITY;
  const tooBig = item.cargoM3 > capacity;
  const tooPricey = item.capitalIsk > availableIsk;
  const blocked = !added && (tooBig || tooPricey);

  const toggle = () =>
    setBasket(added ? basket.filter((b) => b.key !== item.key) : [...basket, item]);

  const title = added
    ? 'Remove from Copilot plan'
    : tooBig
      ? "Won't fit your cargo capacity — change it in the Hauling filters"
      : tooPricey
        ? 'Costs more than your available ISK — change it in the Hauling filters'
        : 'Add to Copilot plan';

  return (
    <Tooltip title={title} arrow>
      {/* span lets the tooltip show even when the button is disabled */}
      <span>
        <IconButton
          size="small"
          onClick={toggle}
          disabled={blocked}
          color={added ? 'primary' : 'default'}
          sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
        >
          {added ? <PlaylistAddCheckIcon fontSize="small" /> : <PlaylistAddIcon fontSize="small" />}
        </IconButton>
      </span>
    </Tooltip>
  );
}
