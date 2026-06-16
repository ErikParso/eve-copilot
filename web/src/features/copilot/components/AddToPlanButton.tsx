import { useAtom } from 'jotai';
import { IconButton, Tooltip } from '@mui/material';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';
import { basketAtom } from '../atoms';
import type { BasketItem } from '../types';

/**
 * Toggles an opportunity in/out of the Copilot basket. Rendered on the Hauling
 * cards; reflects whether the item is already in the plan.
 */
export function AddToPlanButton({ item }: { item: BasketItem }) {
  const [basket, setBasket] = useAtom(basketAtom);
  const added = basket.some((b) => b.key === item.key);

  const toggle = () =>
    setBasket(added ? basket.filter((b) => b.key !== item.key) : [...basket, item]);

  return (
    <Tooltip title={added ? 'Remove from Copilot plan' : 'Add to Copilot plan'} arrow>
      <IconButton
        size="small"
        onClick={toggle}
        color={added ? 'primary' : 'default'}
        sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
      >
        {added ? <PlaylistAddCheckIcon fontSize="small" /> : <PlaylistAddIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
