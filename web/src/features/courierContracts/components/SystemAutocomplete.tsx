import { useMemo, useState } from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { getSystem, searchSystems, securityColor, type SolarSystem } from '@/data/sde';
import { formatNumber } from '@/utils/format';

interface SystemAutocompleteProps {
  value: number | null;
  onChange: (systemId: number | null) => void;
  /** Field label (defaults to "Current system"). */
  label?: string;
}

const MIN_CHARS = 3;

/**
 * Solar-system picker for the "current system". Options appear once the user
 * has typed at least 3 characters (substring match over system names).
 */
export function SystemAutocomplete({ value, onChange, label = 'Current system' }: SystemAutocompleteProps) {
  const [input, setInput] = useState('');

  const selected = useMemo(() => (value !== null ? getSystem(value) ?? null : null), [value]);

  const options = useMemo<SolarSystem[]>(() => {
    if (input.trim().length < MIN_CHARS) return [];
    return searchSystems(input);
  }, [input]);

  const showHelper = input.trim().length > 0 && input.trim().length < MIN_CHARS;

  return (
    <Autocomplete
      value={selected}
      onChange={(_, system) => onChange(system ? system.id : null)}
      inputValue={input}
      onInputChange={(_, newInput) => setInput(newInput)}
      options={options}
      getOptionLabel={(system) => system.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(opts) => opts}
      size="small"
      noOptionsText={
        input.trim().length < MIN_CHARS ? 'Type at least 3 characters' : 'No systems found'
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder="Start typing a system name…"
          helperText={showHelper ? `Type ${MIN_CHARS - input.trim().length} more character(s)` : undefined}
        />
      )}
      renderOption={(props, system) => (
        <li {...props} key={system.id}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" noWrap>
              {system.name}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: securityColor(system.security), fontWeight: 600 }}
            >
              {formatNumber(system.security, 1)}
            </Typography>
          </Box>
        </li>
      )}
      fullWidth
    />
  );
}
