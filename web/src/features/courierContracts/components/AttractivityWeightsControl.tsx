import { useState } from 'react';
import { useAtom } from 'jotai';
import { Box, Chip, Tooltip, Typography, FormHelperText } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import { attractivityWeightsAtom } from '../atoms';
import { ATTRACTIVITY_PRESETS, FACTORS, type AttractivityWeights } from '../attractivity';
import { AttractivityWeightsModal } from './AttractivityWeightsModal';

function weightsEqual(a: AttractivityWeights, b: AttractivityWeights): boolean {
  return FACTORS.every((f) => (a[f.id] ?? 0) === (b[f.id] ?? 0));
}

/** Directly displays attractivity presets as chips, and opens custom sliders on 'Custom' click. */
export function AttractivityWeightsControl() {
  const [weights, setWeights] = useAtom(attractivityWeightsAtom);
  const [open, setOpen] = useState(false);

  const activePreset = ATTRACTIVITY_PRESETS.find((p) => weightsEqual(p.weights, weights));
  const isCustom = !activePreset;

  return (
    <Box>
      <Box
        sx={{
          border: '1px solid',
          borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(0, 0, 0, 0.23)' : 'rgba(255, 255, 255, 0.23)',
          borderRadius: 1,
          px: 1.5,
          py: 0,
          position: 'relative',
          minHeight: 56,
          display: 'flex',
          alignItems: 'center',
          boxSizing: 'border-box',
          '&:hover': {
            borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(0, 0, 0, 0.87)' : 'rgba(255, 255, 255, 0.87)',
          },
          '&:focus-within': {
            borderColor: 'primary.main',
            borderWidth: '2px',
            px: '11px',
          },
        }}
      >
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            top: -9,
            left: 9,
            bgcolor: 'background.paper',
            px: 0.5,
            color: 'text.secondary',
            fontSize: '0.75rem',
            lineHeight: 1,
            pointerEvents: 'none',
          }}
        >
          Attractivity Preset
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: { xs: 'wrap', md: 'nowrap' }, gap: 1, py: 1 }}>
          {ATTRACTIVITY_PRESETS.map((preset) => (
            <Tooltip key={preset.id} title={preset.description} arrow>
              <Chip
                label={preset.label}
                color={activePreset?.id === preset.id ? 'primary' : 'default'}
                variant={activePreset?.id === preset.id ? 'filled' : 'outlined'}
                size="small"
                onClick={() => setWeights(preset.weights)}
                sx={{ cursor: 'pointer' }}
              />
            </Tooltip>
          ))}
          <Tooltip title="Configure custom weights using factor sliders" arrow>
            <Chip
              label="Custom..."
              icon={<TuneIcon sx={{ fontSize: 14 }} />}
              color={isCustom ? 'primary' : 'default'}
              variant={isCustom ? 'filled' : 'outlined'}
              size="small"
              onClick={() => setOpen(true)}
              sx={{ cursor: 'pointer' }}
            />
          </Tooltip>
        </Box>
      </Box>
      <FormHelperText sx={{ mx: 1.75, mt: 0.5, minHeight: 20 }}>
        {activePreset?.description ?? 'Custom weights adjusted via factor sliders.'}
      </FormHelperText>
      <AttractivityWeightsModal open={open} onClose={() => setOpen(false)} />
    </Box>
  );
}
