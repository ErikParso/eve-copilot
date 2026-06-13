import { Box, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import type { RouteType } from '../types';

interface RouteTypeToggleProps {
  value: RouteType;
  onChange: (value: RouteType) => void;
}

const OPTIONS: { value: RouteType; label: string; tooltip: string }[] = [
  {
    value: 'safest',
    label: 'Safest',
    tooltip: 'Prefers high-security space, avoiding low/null-sec as much as possible.',
  },
  {
    value: 'shortest',
    label: 'Shortest',
    tooltip: 'Fewest jumps regardless of security (may route through low/null-sec).',
  },
];

/** Route preference toggle controlling how jump counts are calculated. */
export function RouteTypeToggle({ value, onChange }: RouteTypeToggleProps) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        Route type
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        size="small"
        onChange={(_, next: RouteType | null) => {
          if (next !== null) onChange(next);
        }}
      >
        {OPTIONS.map((opt) => (
          <Tooltip key={opt.value} title={opt.tooltip} arrow>
            <ToggleButton value={opt.value}>{opt.label}</ToggleButton>
          </Tooltip>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}
