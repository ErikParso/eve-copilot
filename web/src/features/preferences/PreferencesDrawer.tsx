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

          <TextField
            label="Available ISK"
            type="number"
            size="small"
            fullWidth
            value={prefs.availableIskMillions ?? ''}
            onChange={(e) =>
              setPrefs({ ...prefs, availableIskMillions: parseOptionalNumber(e.target.value) })
            }
            InputProps={{ endAdornment: <InputAdornment position="end">M ISK</InputAdornment> }}
            inputProps={{ min: 0 }}
            helperText="Your wallet — hides what you can't cover; the plan's start balance."
          />

          <TextField
            label="Cargo capacity"
            type="number"
            size="small"
            fullWidth
            value={prefs.cargoM3 ?? ''}
            onChange={(e) => setPrefs({ ...prefs, cargoM3: parseOptionalNumber(e.target.value) })}
            InputProps={{ endAdornment: <InputAdornment position="end">m³</InputAdornment> }}
            inputProps={{ min: 0 }}
            helperText="Your hold — hides oversized hauls; the plan's capacity."
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
