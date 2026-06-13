import { useAtom } from 'jotai';
import { Box, Button, Grid, InputAdornment, Paper, TextField } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { attractivityMethodAtom, draftFiltersAtom } from '../atoms';
import type { RouteType } from '../types';
import { StationAutocomplete } from './StationAutocomplete';
import { RouteTypeSelect } from './RouteTypeSelect';
import { AttractivityMethodSelect } from './AttractivityMethodSelect';

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

export function FiltersPanel({ onSearch, loading }: FiltersPanelProps) {
  const [filters, setFilters] = useAtom(draftFiltersAtom);
  const [method, setMethod] = useAtom(attractivityMethodAtom);

  return (
    <Paper sx={{ p: 2.5 }} elevation={2}>
      <Grid container spacing={2.5} alignItems="flex-start">
        <Grid item xs={12} sm={6} md={3}>
          <TextField
            label="Max collateral"
            type="number"
            fullWidth
            value={filters.maxCollateralMillions ?? ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, maxCollateralMillions: parseOptionalNumber(e.target.value) }))
            }
            InputProps={{
              endAdornment: <InputAdornment position="end">M ISK</InputAdornment>,
            }}
            inputProps={{ min: 0 }}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <TextField
            label="Max cargo volume"
            type="number"
            fullWidth
            value={filters.maxCargoM3 ?? ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, maxCargoM3: parseOptionalNumber(e.target.value) }))
            }
            InputProps={{
              endAdornment: <InputAdornment position="end">m³</InputAdornment>,
            }}
            inputProps={{ min: 0 }}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <StationAutocomplete
            value={filters.currentStationId}
            onChange={(currentStationId) => setFilters((f) => ({ ...f, currentStationId }))}
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <RouteTypeSelect
            value={filters.routeType}
            onChange={(routeType: RouteType) => setFilters((f) => ({ ...f, routeType }))}
          />
        </Grid>

        <Grid item xs={12} md={9}>
          <AttractivityMethodSelect value={method} onChange={setMethod} />
        </Grid>

        <Grid item xs={12} md={3}>
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
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
          </Box>
        </Grid>
      </Grid>
    </Paper>
  );
}
