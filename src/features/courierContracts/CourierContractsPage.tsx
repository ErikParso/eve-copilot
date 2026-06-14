import { useAtomValue } from 'jotai';
import { Alert, Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { searchProgressAtom } from './atoms';
import { useCourierSearch } from './useCourierSearch';
import { FiltersPanel } from './components/FiltersPanel';
import { ContractsGrid } from './components/ContractsGrid';

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
  const { run, status, rows, error, contractsAsOf } = useCourierSearch();
  const loading = status === 'loading';

  return (
    <Grid container spacing={2} alignItems="flex-start">
      {/* Left panel: filters (sticky on md+) */}
      <Grid xs={12} sm={6} md={4} lg={3} xl={3}>
        <Box sx={{ position: { md: 'sticky' }, top: { md: 80 } }}>
          <FiltersPanel onSearch={run} loading={loading} />
        </Box>
      </Grid>

      {/* Right panel: results */}
      <Grid xs={12} sm={6} md={8} lg={9}>
        <Stack spacing={2}>
          {loading && <ProgressBar />}

          {status === 'error' && (
            <Alert severity="error">Could not complete the search: {error}</Alert>
          )}

          {status === 'idle' && (
            <Alert severity="info">
              Set your filters and press <strong>Search</strong> to load current courier contracts.
              The first search fetches every region and can take a little while.
            </Alert>
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
                {contractsAsOf && (
                  <Tooltip
                    title="Contracts come from CCP's public feed, which is rebuilt on a ~30-min cycle. The list can therefore lag reality by up to ~30 minutes — accepted or expired contracts may still appear until CCP's next rebuild."
                    arrow
                  >
                    <Typography variant="caption" color="text.secondary">
                      EVE data as of {formatTime(contractsAsOf)}
                    </Typography>
                  </Tooltip>
                )}
              </Box>
              {rows.length > 0 ? (
                <ContractsGrid rows={rows} />
              ) : (
                <Alert severity="info">
                  No contracts match. Try relaxing the collateral or cargo limits.
                </Alert>
              )}
            </>
          )}
        </Stack>
      </Grid>
    </Grid>
  );
}
