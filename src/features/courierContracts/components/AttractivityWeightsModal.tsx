import { useAtom } from 'jotai';
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
  const [weights, setWeights] = useAtom(attractivityWeightsAtom);

  const activePreset = ATTRACTIVITY_PRESETS.find((p) => weightsEqual(p.weights, weights));

  const setWeight = (id: FactorId, value: number) =>
    setWeights((prev) => ({ ...prev, [id]: value }));

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
                onClick={() => setWeights(preset.weights)}
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
            const value = weights[factor.id] ?? 0;
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
                  <Tooltip title={factor.description} arrow>
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
        <Button onClick={() => setWeights(ATTRACTIVITY_PRESETS[0].weights)}>Reset</Button>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
