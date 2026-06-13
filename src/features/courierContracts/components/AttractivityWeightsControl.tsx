import { useState } from 'react';
import { useAtomValue } from 'jotai';
import { Box, Button, Typography } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import { attractivityWeightsAtom } from '../atoms';
import { ATTRACTIVITY_PRESETS, FACTORS, factorLabel, type FactorId } from '../attractivity';
import { AttractivityWeightsModal } from './AttractivityWeightsModal';

/** Summarise the active weights: the matching preset name, or top factors. */
function summarise(weights: Record<FactorId, number>): string {
  const preset = ATTRACTIVITY_PRESETS.find((p) =>
    FACTORS.every((f) => (p.weights[f.id] ?? 0) === (weights[f.id] ?? 0)),
  );
  if (preset) return `Preset: ${preset.label}`;

  const top = FACTORS.filter((f) => (weights[f.id] ?? 0) > 0)
    .sort((a, b) => (weights[b.id] ?? 0) - (weights[a.id] ?? 0))
    .slice(0, 3)
    .map((f) => factorLabel(f.id));

  if (top.length === 0) return 'No factors weighted';
  return `Custom: ${top.join(', ')}${top.length < FACTORS.filter((f) => weights[f.id] > 0).length ? '…' : ''}`;
}

/** Button + summary that opens the attractivity weights modal. */
export function AttractivityWeightsControl() {
  const [open, setOpen] = useState(false);
  const weights = useAtomValue(attractivityWeightsAtom);

  return (
    <Box>
      <Button
        variant="outlined"
        startIcon={<TuneIcon />}
        onClick={() => setOpen(true)}
        fullWidth
        sx={{ justifyContent: 'flex-start' }}
      >
        Attractivity weights
      </Button>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 0.5, lineHeight: 1.4 }}
      >
        {summarise(weights)}
      </Typography>
      <AttractivityWeightsModal open={open} onClose={() => setOpen(false)} />
    </Box>
  );
}
