import { Box, MenuItem, TextField, Typography } from '@mui/material';
import {
  ATTRACTIVITY_METHODS,
  type AttractivityMethod,
} from '../attractivity';

interface AttractivityMethodSelectProps {
  value: AttractivityMethod;
  onChange: (value: AttractivityMethod) => void;
}

/** Dropdown to pick the attractivity scoring method + a description of it. */
export function AttractivityMethodSelect({ value, onChange }: AttractivityMethodSelectProps) {
  const active = ATTRACTIVITY_METHODS.find((m) => m.id === value) ?? ATTRACTIVITY_METHODS[0];

  return (
    <Box>
      <TextField
        select
        fullWidth
        label="Attractivity method"
        value={value}
        onChange={(e) => onChange(e.target.value as AttractivityMethod)}
      >
        {ATTRACTIVITY_METHODS.map((method) => (
          <MenuItem key={method.id} value={method.id}>
            {method.label}
          </MenuItem>
        ))}
      </TextField>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 0.5, lineHeight: 1.4 }}
      >
        {active.description}
      </Typography>
    </Box>
  );
}
