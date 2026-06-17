import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import {
  Box,
  Drawer,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { ContractType, RouteType } from '@/features/courierContracts/types';
import { RouteTypeSelect } from '@/features/courierContracts/components/RouteTypeSelect';
import { ContractTypeSelect } from '@/features/courierContracts/components/ContractTypeSelect';
import { AttractivityWeightsControl } from '@/features/courierContracts/components/AttractivityWeightsControl';
import { preferencesAtom, preferencesOpenAtom } from './atoms';

/** Parse a numeric text input into a non-negative number or null (empty). */
function parseOptionalNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Numeric preference field that buffers typing locally and only commits the
 * value on blur or Enter — so the downstream re-filter/re-fetch doesn't fire on
 * every keystroke.
 */
function NumberPrefField({
  label,
  value,
  unit,
  helperText,
  onCommit,
}: {
  label: string;
  value: number | null;
  unit: string;
  helperText: string;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  // Re-sync the buffer if the committed value changes elsewhere (e.g. reset).
  useEffect(() => {
    setText(value === null ? '' : String(value));
  }, [value]);

  const commit = () => {
    const parsed = parseOptionalNumber(text);
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <TextField
      label={label}
      type="number"
      size="small"
      fullWidth
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      InputProps={{ endAdornment: <InputAdornment position="end">{unit}</InputAdornment> }}
      inputProps={{ min: 0 }}
      helperText={helperText}
    />
  );
}

/** Slide-out panel for the global hauling preferences. */
export function PreferencesDrawer() {
  const [open, setOpen] = useAtom(preferencesOpenAtom);
  const [prefs, setPrefs] = useAtom(preferencesAtom);
  const close = () => setOpen(false);

  return (
    <Drawer anchor="right" open={open} onClose={close}>
      <Box sx={{ width: 320, p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Preferences
          </Typography>
          <IconButton size="small" onClick={close} aria-label="Close preferences">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Stack spacing={2.5}>
          <Typography variant="caption" color="text.secondary">
            How you haul — shared by the Hauling search and the Copilot plan.
          </Typography>

          <NumberPrefField
            label="Available ISK"
            value={prefs.availableIskMillions}
            unit="M ISK"
            helperText="Your wallet — hides what you can't cover; the plan's start balance."
            onCommit={(availableIskMillions) => setPrefs({ ...prefs, availableIskMillions })}
          />

          <NumberPrefField
            label="Cargo capacity"
            value={prefs.cargoM3}
            unit="m³"
            helperText="Your hold — hides oversized hauls; the plan's capacity."
            onCommit={(cargoM3) => setPrefs({ ...prefs, cargoM3 })}
          />

          <RouteTypeSelect
            value={prefs.routeType}
            onChange={(routeType: RouteType) => setPrefs({ ...prefs, routeType })}
          />

          <ContractTypeSelect
            value={prefs.contractTypes}
            onChange={(contractTypes: ContractType[]) => setPrefs({ ...prefs, contractTypes })}
          />

          <AttractivityWeightsControl />
        </Stack>
      </Box>
    </Drawer>
  );
}
