import { useEffect, useState } from 'react';
import { Checkbox, ListItemText, MenuItem, TextField } from '@mui/material';
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
    <TextField
      select
      size="medium"
      fullWidth
      label="Opportunity type"
      value={draft}
      helperText="Empty = all kinds"
      SelectProps={{
        multiple: true,
        onClose: commit,
        renderValue: (selected) => {
          const ids = selected as ContractType[];
          if (ids.length === 0) return 'All';
          return ids.map((id) => LABELS.get(id)).join(', ');
        },
      }}
      onChange={(e) => {
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
    </TextField>
  );
}
