import { useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Button, InputAdornment, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { activeCharacterAtom, characterStatusAtom } from '@/features/auth/atoms';
import { SystemAutocomplete } from '@/features/courierContracts/components/SystemAutocomplete';
import { RouteTypeSelect } from '@/features/courierContracts/components/RouteTypeSelect';
import { arbitrageDraftFiltersAtom } from '../atoms';
import { ARBITRAGE_SORT_OPTIONS } from '../sortArbitrage';
import type { ArbitrageSortId, RouteType } from '../types';

interface Props {
  onSearch: () => void;
  loading: boolean;
}

function parseOptionalNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Vertical filter sidebar for the arbitrage finder. Applied on Search. */
export function ArbitrageFiltersPanel({ onSearch, loading }: Props) {
  const [filters, setFilters] = useAtom(arbitrageDraftFiltersAtom);
  const activeCharacter = useAtomValue(activeCharacterAtom);
  const status = useAtomValue(characterStatusAtom);

  // When logged in, default the source to the character's live system once
  // (only if not already set) — still freely editable / clearable to "Any".
  const liveSystemId = activeCharacter ? status?.systemId ?? null : null;
  useEffect(() => {
    if (liveSystemId === null) return;
    setFilters((f) => (f.fromSystemId === null ? { ...f, fromSystemId: liveSystemId } : f));
  }, [liveSystemId, setFilters]);

  return (
    <Paper sx={{ p: 2.5 }} elevation={2}>
      <Stack spacing={2.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Filters
        </Typography>

        <SystemAutocomplete
          label="From (any)"
          value={filters.fromSystemId}
          onChange={(fromSystemId) => setFilters((f) => ({ ...f, fromSystemId }))}
        />

        <SystemAutocomplete
          label="To (any)"
          value={filters.toSystemId}
          onChange={(toSystemId) => setFilters((f) => ({ ...f, toSystemId }))}
        />

        <TextField
          label="Max investment"
          type="number"
          size="small"
          fullWidth
          value={filters.maxInvestmentMillions ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, maxInvestmentMillions: parseOptionalNumber(e.target.value) }))
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
          onChange={(e) => setFilters((f) => ({ ...f, maxCargoM3: parseOptionalNumber(e.target.value) }))}
          InputProps={{ endAdornment: <InputAdornment position="end">m³</InputAdornment> }}
          inputProps={{ min: 0 }}
        />

        <RouteTypeSelect
          value={filters.routeType}
          onChange={(routeType: RouteType) => setFilters((f) => ({ ...f, routeType }))}
        />

        <TextField
          label="Max jumps"
          type="number"
          size="small"
          fullWidth
          value={filters.maxJumps ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, maxJumps: parseOptionalNumber(e.target.value) }))}
          inputProps={{ min: 0 }}
        />

        <TextField
          label="Sales tax"
          type="number"
          size="small"
          fullWidth
          value={filters.salesTaxPercent}
          onChange={(e) =>
            setFilters((f) => ({ ...f, salesTaxPercent: parseOptionalNumber(e.target.value) ?? 0 }))
          }
          InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
          inputProps={{ min: 0, max: 100, step: 0.1 }}
          helperText="Applied to sell proceeds (lower with Accounting skill)."
        />

        <TextField
          select
          size="small"
          fullWidth
          label="Sort by"
          value={filters.sortBy}
          onChange={(e) => setFilters((f) => ({ ...f, sortBy: e.target.value as ArbitrageSortId }))}
        >
          {ARBITRAGE_SORT_OPTIONS.map((opt) => (
            <MenuItem key={opt.id} value={opt.id}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>

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
