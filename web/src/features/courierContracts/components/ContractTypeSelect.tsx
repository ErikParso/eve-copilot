import { useEffect, useState } from 'react';
import {
  Box,
  Checkbox,
  Chip,
  FormControl,
  FormHelperText,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  type SelectChangeEvent,
} from '@mui/material';
import type { ContractType } from '../types';

interface ContractTypeSelectProps {
  value: ContractType[];
  /** Called once the dropdown closes (blur), only if the selection changed. */
  onChange: (value: ContractType[]) => void;
}

const OPTIONS: { value: ContractType; label: string }[] = [
  { value: 'courier', label: 'Courier' },
  { value: 'arbitrage', label: 'Market' },
  { value: 'package', label: 'Bundle' },
];

const LABELS = new Map(OPTIONS.map((o) => [o.value, o.label]));

const sameSet = (a: ContractType[], b: ContractType[]) =>
  a.length === b.length && a.every((v) => b.includes(v));

/**
 * Multi-select for which opportunity kinds to show. An empty selection means
 * the filter is unset (all kinds are shown). Toggling checkboxes only updates a
 * local draft; the change is committed (triggering a BE refetch) when the
 * dropdown closes — i.e. on blur — so a multi-pick fires a single request.
 */
export function ContractTypeSelect({ value, onChange }: ContractTypeSelectProps) {
  const [draft, setDraft] = useState<ContractType[]>(value);

  // Keep the draft in sync if the committed value changes elsewhere.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (!sameSet(draft, value)) onChange(draft);
  };

  return (
    <FormControl fullWidth size="medium">
      {/* shrink/notched are driven off the selection count: with `renderValue`,
          MUI otherwise keeps the label floated even when the array is empty. */}
      <InputLabel id="opportunity-type-label">
        Opportunity type
      </InputLabel>
      <Select
        labelId="opportunity-type-label"
        input={<OutlinedInput label="Opportunity type" />}
        multiple
        value={draft}
        onClose={commit}
        renderValue={(selected) => {
          // Drop any unknown/stale ids so a missing label can't leave a stray
          // comma; show the rest as chips.
          const ids = (selected as ContractType[]).filter((id) => LABELS.has(id));
		  if (!ids.length) return 'Any'; // show placeholder text
          return (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {ids.map((id) => (
                <Chip key={id} size="small" label={LABELS.get(id)} />
              ))}
            </Box>
          );
        }}
        onChange={(e: SelectChangeEvent<ContractType[]>) => {
          const v = e.target.value;
          setDraft((typeof v === 'string' ? v.split(',') : v) as ContractType[]);
        }}
      >
        {OPTIONS.map((opt) => (
          <MenuItem key={opt.value} value={opt.value}>
            <Checkbox size="small" checked={draft.includes(opt.value)} />
            <ListItemText primary={opt.label} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
