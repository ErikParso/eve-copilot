import { Box, MenuItem, TextField, Typography } from '@mui/material';
import type { RouteType } from '../types';

interface RouteTypeSelectProps {
  value: RouteType;
  onChange: (value: RouteType) => void;
}

const OPTIONS: { value: RouteType; label: string; description: string }[] = [
  {
    value: 'safest',
    label: 'Safest',
    description: 'Prefers high-security space, avoiding low/null-sec as much as possible.',
  },
  {
    value: 'shortest',
    label: 'Shortest',
    description: 'Fewest jumps regardless of security (may route through low/null-sec).',
  },
];

/** Route preference dropdown controlling how jump counts are calculated. */
export function RouteTypeSelect({ value, onChange }: RouteTypeSelectProps) {
  const active = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  return (
    <Box>
      <TextField
        select
        fullWidth
        label="Route type"
        value={value}
        onChange={(e) => onChange(e.target.value as RouteType)}
      >
        {OPTIONS.map((opt) => (
          <MenuItem key={opt.value} value={opt.value}>
            {opt.label}
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
