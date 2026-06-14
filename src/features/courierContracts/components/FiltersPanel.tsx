import { useAtom } from 'jotai';
import { Button, InputAdornment, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { draftFiltersAtom } from '../atoms';
import type { RouteType, SortOptionId } from '../types';
import { SORT_OPTIONS } from '../sortContracts';
import { SystemAutocomplete } from './SystemAutocomplete';
import { RouteTypeSelect } from './RouteTypeSelect';
import { AttractivityWeightsControl } from './AttractivityWeightsControl';

interface FiltersPanelProps {
  onSearch: () => void;
  loading: boolean;
}

/** Parse a numeric text input into a non-negative number or null (empty). */
function parseOptionalNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Vertical filter sidebar. Everything (incl. sort) is applied on Search. */
export function FiltersPanel({ onSearch, loading }: FiltersPanelProps) {
  const [filters, setFilters] = useAtom(draftFiltersAtom);

  return (
    <Paper sx={{ p: 2.5 }} elevation={2}>
      <Stack spacing={2.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Filters
        </Typography>

        <TextField
          label="Max collateral"
          type="number"
          size="small"
          fullWidth
          value={filters.maxCollateralMillions ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, maxCollateralMillions: parseOptionalNumber(e.target.value) }))
          }
          InputProps={{ endAdornment: <InputAdornment position="end">M ISK</InputAdornment> }}
          inputProps={{ min: 0 }}
        />

        <TextField
          label="Max cargo volume"
          type="number"
          size="small"
          fullWidth
          value={filters.maxCargoM3 ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, maxCargoM3: parseOptionalNumber(e.target.value) }))
          }
          InputProps={{ endAdornment: <InputAdornment position="end">m³</InputAdornment> }}
          inputProps={{ min: 0 }}
        />

        <SystemAutocomplete
          value={filters.currentSystemId}
          onChange={(currentSystemId) => setFilters((f) => ({ ...f, currentSystemId }))}
        />

        <RouteTypeSelect
          value={filters.routeType}
          onChange={(routeType: RouteType) => setFilters((f) => ({ ...f, routeType }))}
        />

        <TextField
          select
          size="small"
          fullWidth
          label="Sort by"
          value={filters.sortBy}
          onChange={(e) => setFilters((f) => ({ ...f, sortBy: e.target.value as SortOptionId }))}
        >
          {SORT_OPTIONS.map((opt) => (
            <MenuItem key={opt.id} value={opt.id}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>

        <AttractivityWeightsControl />

        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<SearchIcon />}
          onClick={onSearch}
          disabled={loading}
        >
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </Stack>
    </Paper>
  );
}
