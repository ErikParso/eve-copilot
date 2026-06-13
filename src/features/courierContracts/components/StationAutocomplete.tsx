import { useMemo, useState } from 'react';
import { Autocomplete, TextField, Typography } from '@mui/material';
import { getStation, searchStations, type Station } from '@/data/sde';

interface StationAutocompleteProps {
  value: number | null;
  onChange: (stationId: number | null) => void;
}

const MIN_CHARS = 3;

/**
 * Station picker for the "current station". Options only appear once the user
 * has typed at least 3 characters (substring match over NPC station names).
 */
export function StationAutocomplete({ value, onChange }: StationAutocompleteProps) {
  const [input, setInput] = useState('');

  const selected = useMemo(() => (value !== null ? getStation(value) ?? null : null), [value]);

  const options = useMemo<Station[]>(() => {
    if (input.trim().length < MIN_CHARS) return [];
    return searchStations(input);
  }, [input]);

  const showHelper = input.trim().length > 0 && input.trim().length < MIN_CHARS;

  return (
    <Autocomplete
      value={selected}
      onChange={(_, station) => onChange(station ? station.id : null)}
      inputValue={input}
      onInputChange={(_, newInput) => setInput(newInput)}
      options={options}
      getOptionLabel={(station) => station.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      // We pre-filter via searchStations; let MUI keep that order.
      filterOptions={(opts) => opts}
      noOptionsText={
        input.trim().length < MIN_CHARS ? 'Type at least 3 characters' : 'No stations found'
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label="Current station"
          placeholder="Start typing a station name…"
          helperText={showHelper ? `Type ${MIN_CHARS - input.trim().length} more character(s)` : ' '}
        />
      )}
      renderOption={(props, station) => (
        <li {...props} key={station.id}>
          <Typography variant="body2" noWrap>
            {station.name}
          </Typography>
        </li>
      )}
      fullWidth
    />
  );
}
