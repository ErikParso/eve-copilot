import { Checkbox, ListItemText, MenuItem, TextField } from '@mui/material';
import type { ContractType } from '../types';

interface ContractTypeSelectProps {
  value: ContractType[];
  onChange: (value: ContractType[]) => void;
}

const OPTIONS: { value: ContractType; label: string }[] = [
  { value: 'arbitrage', label: 'Arbitrage' },
  { value: 'courier', label: 'Courier' },
];

const LABELS = new Map(OPTIONS.map((o) => [o.value, o.label]));

/**
 * Multi-select for which opportunity kinds to show. An empty selection means
 * the filter is unset (both kinds are shown).
 */
export function ContractTypeSelect({ value, onChange }: ContractTypeSelectProps) {
  return (
    <TextField
      select
      size="small"
      fullWidth
      label="Contract type"
      value={value}
      SelectProps={{
        multiple: true,
        renderValue: (selected) => {
          const ids = selected as ContractType[];
          return ids.map((id) => LABELS.get(id)).join(', ');
        },
      }}
      onChange={(e) => {
        const v = e.target.value;
        onChange((typeof v === 'string' ? v.split(',') : v) as ContractType[]);
      }}
    >
      {OPTIONS.map((opt) => (
        <MenuItem key={opt.value} value={opt.value}>
          <Checkbox size="small" checked={value.includes(opt.value)} />
          <ListItemText primary={opt.label} />
        </MenuItem>
      ))}
    </TextField>
  );
}
