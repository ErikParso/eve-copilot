import { MenuItem, TextField } from '@mui/material';
import type { RouteType } from '../types';

interface RouteTypeSelectProps {
  value: RouteType;
  onChange: (value: RouteType) => void;
}

const OPTIONS: { value: RouteType; label: string; description: string }[] = [
  {
    value: 'safest',
    label: 'Safest',
    description: 'Prefers high-security space.',
  },
  {
    value: 'shortest',
    label: 'Shortest',
    description: 'Fewest jumps regardless of security.',
  },
];

/** Route preference dropdown controlling how jump counts are calculated. */
export function RouteTypeSelect({ value, onChange }: RouteTypeSelectProps) {
  const active = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  return (
    <TextField
      select
      fullWidth
      label="Route type"
      value={value}
      onChange={(e) => onChange(e.target.value as RouteType)}
      helperText={active.description}
    >
      {OPTIONS.map((opt) => (
        <MenuItem key={opt.value} value={opt.value}>
          {opt.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
