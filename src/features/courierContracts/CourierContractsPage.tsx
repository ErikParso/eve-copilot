import { useAtomValue } from 'jotai';
import {
  Alert,
  Box,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { searchProgressAtom } from './atoms';
import { useCourierSearch } from './useCourierSearch';
import { FiltersPanel } from './components/FiltersPanel';
import { ContractsTable } from './components/ContractsTable';

function ProgressBar() {
  const progress = useAtomValue(searchProgressAtom);

  if (progress.phase === 'contracts') {
    const { regionsDone, regionsTotal } = progress;
    const value = regionsTotal > 0 ? (regionsDone / regionsTotal) * 100 : undefined;
    return (
      <Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Fetching public contracts across regions… {regionsDone}/{regionsTotal || '?'}
        </Typography>
        <LinearProgress variant={value === undefined ? 'indeterminate' : 'determinate'} value={value} />
      </Box>
    );
  }

  const { routesDone, routesTotal } = progress;
  const value = routesTotal > 0 ? (routesDone / routesTotal) * 100 : undefined;
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Resolving routes & jumps… {routesDone}/{routesTotal || '?'}
      </Typography>
      <LinearProgress variant={value === undefined ? 'indeterminate' : 'determinate'} value={value} />
    </Box>
  );
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function CourierContractsPage() {
  const { run, status, rows, error, appliedFilters, contractsAsOf, contractsExpiresAt } =
    useCourierSearch();
  const loading = status === 'loading';
  const showCurrentJumps = appliedFilters?.currentStationId != null;

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Courier Contracts
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Find profitable courier hauls across New Eden. Set your filters and hit Search.
        </Typography>
      </Box>

      <FiltersPanel onSearch={run} loading={loading} />

      {loading && <ProgressBar />}

      {status === 'error' && (
        <Alert severity="error">Could not complete the search: {error}</Alert>
      )}

      {status === 'success' && (
        <>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              alignItems: 'baseline',
              justifyContent: 'space-between',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {rows.length} courier contract{rows.length === 1 ? '' : 's'} match your filters.
            </Typography>
            {(contractsAsOf || contractsExpiresAt) && (
              <Typography variant="caption" color="text.secondary">
                {contractsAsOf && <>EVE data as of {formatTime(contractsAsOf)}</>}
                {contractsExpiresAt && <> · fresh data ~{formatTime(contractsExpiresAt)}</>}
              </Typography>
            )}
          </Box>
          {rows.length > 0 ? (
            <ContractsTable rows={rows} showCurrentJumps={showCurrentJumps} />
          ) : (
            <Alert severity="info">
              No contracts match. Try relaxing the collateral or cargo limits.
            </Alert>
          )}
        </>
      )}

      {status === 'idle' && (
        <Alert severity="info">
          Set your filters above and press <strong>Search</strong> to load current courier contracts.
          The first search fetches every region and can take a little while.
        </Alert>
      )}
    </Stack>
  );
}
