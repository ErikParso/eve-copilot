// Switches between the two mutually-exclusive runs. Buy and sell never run at the
// same time; switching discards the current plan (and its progress) but KEEPS the
// ship inventory — the cargo is the bridge between a buy run and the sell run that
// disposes of it.
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import SellIcon from '@mui/icons-material/Sell';
import { planAtom, runModeAtom } from '../atoms';
import type { RunMode } from '../types';

export function RunModeToggle() {
  const [mode, setMode] = useAtom(runModeAtom);
  const plan = useAtomValue(planAtom);
  const setPlan = useSetAtom(planAtom);

  const switchTo = (next: RunMode) => {
    if (next === mode) return;
    if (
      plan.length > 0 &&
      !window.confirm(
        `Discard the current ${mode} run plan and switch to the ${next} run?\n\nYour ship cargo is kept.`,
      )
    ) {
      return;
    }
    setPlan([]);
    setMode(next);
  };

  return (
    <ToggleButtonGroup
      value={mode}
      exclusive
      size="small"
      onChange={(_e, next: RunMode | null) => next && switchTo(next)}
      aria-label="Run mode"
    >
      <ToggleButton value="buy" aria-label="Buy run">
        <Tooltip title="Buy attractive cargo as cheaply as possible" arrow>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ShoppingCartIcon fontSize="small" /> Buy run
          </span>
        </Tooltip>
      </ToggleButton>
      <ToggleButton value="sell" aria-label="Sell run">
        <Tooltip title="Sell what's in your hold for the best price" arrow>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <SellIcon fontSize="small" /> Sell run
          </span>
        </Tooltip>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
