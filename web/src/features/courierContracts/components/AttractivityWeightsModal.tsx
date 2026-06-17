import { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import NorthIcon from '@mui/icons-material/North';
import SouthIcon from '@mui/icons-material/South';
import { attractivityWeightsAtom } from '../atoms';
import {
  ATTRACTIVITY_PRESETS,
  FACTORS,
  type AttractivityWeights,
  type FactorId,
} from '../attractivity';

// Marks at every step; labels only at 0 ("off"), 5 and 10.
const SLIDER_MARKS = Array.from({ length: 11 }, (_, v) => ({
  value: v,
  label: v === 0 ? 'off' : v === 5 ? '5' : v === 10 ? '10' : undefined,
}));

function weightsEqual(a: AttractivityWeights, b: AttractivityWeights): boolean {
  return FACTORS.every((f) => (a[f.id] ?? 0) === (b[f.id] ?? 0));
}

interface AttractivityWeightsModalProps {
  open: boolean;
  onClose: () => void;
}

export function AttractivityWeightsModal({ open, onClose }: AttractivityWeightsModalProps) {
  const committed = useAtomValue(attractivityWeightsAtom);
  const commit = useSetAtom(attractivityWeightsAtom);

  // Edit a local draft; only apply it (which re-scores/re-ranks downstream) when
  // the user confirms with Done. Closing/cancelling discards the draft.
  const [draft, setDraft] = useState(committed);
  useEffect(() => {
    if (open) setDraft(committed);
  }, [open, committed]);

  const activePreset = ATTRACTIVITY_PRESETS.find((p) => weightsEqual(p.weights, draft));

  const setWeight = (id: FactorId, value: number) =>
    setDraft((prev) => ({ ...prev, [id]: value }));

  const applyAndClose = () => {
    if (!weightsEqual(draft, committed)) commit(draft);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Attractivity weights
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Typography variant="subtitle2" gutterBottom>
          Presets
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {ATTRACTIVITY_PRESETS.map((preset) => (
            <Tooltip key={preset.id} title={preset.description} arrow>
              <Chip
                label={preset.label}
                color={activePreset?.id === preset.id ? 'primary' : 'default'}
                variant={activePreset?.id === preset.id ? 'filled' : 'outlined'}
                onClick={() => setDraft(preset.weights)}
              />
            </Tooltip>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {activePreset
            ? activePreset.description
            : 'Custom weights. Pick a preset above or tune each factor below.'}
        </Typography>

        <Divider sx={{ mb: 2 }} />

        <Typography variant="subtitle2" gutterBottom>
          Factors — weight 0 (off) to 10
        </Typography>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {FACTORS.map((factor) => {
            const value = draft[factor.id] ?? 0;
            const off = value === 0;
            return (
              <Box key={factor.id} sx={{ opacity: off ? 0.55 : 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {factor.direction === 'higher' ? (
                    <NorthIcon sx={{ fontSize: 14, color: 'success.main' }} />
                  ) : (
                    <SouthIcon sx={{ fontSize: 14, color: 'warning.main' }} />
                  )}
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {factor.label}
                  </Typography>
                  <Tooltip
                    title={`Set how relevant ${factor.label} is (0 = not relevant, 10 = most relevant)`}
                    arrow
                  >
                    <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                  </Tooltip>
                  <Box sx={{ flexGrow: 1 }} />
                  <Typography variant="caption" color={off ? 'text.disabled' : 'primary.main'}>
                    {off ? 'off' : value}
                  </Typography>
                </Box>
                <Box sx={{ px: 1 }}>
                  <Slider
                    value={value}
                    onChange={(_, v) => setWeight(factor.id, v as number)}
                    min={0}
                    max={10}
                    step={1}
                    marks={SLIDER_MARKS}
                    size="small"
                    valueLabelDisplay="auto"
                  />
                </Box>
              </Box>
            );
          })}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={() => setDraft(ATTRACTIVITY_PRESETS[0].weights)}>Reset</Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={applyAndClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
