import { Alert, Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { useCombinedSearch } from './useCombinedSearch';
import { FiltersPanel } from './components/FiltersPanel';
import { CombinedGrid } from './components/CombinedGrid';

function ProgressBar() {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Loading courier contracts and arbitrage hauls…
      </Typography>
      <LinearProgress />
    </Box>
  );
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function CourierContractsPage() {
  const { run, status, rows, error, contractsAsOf, market } = useCombinedSearch();
  const loading = status === 'loading';
  const warming = status === 'success' && market !== null && market.status !== 'ready';

  const courierCount = rows.filter((r) => r.kind === 'courier').length;
  const arbitrageCount = rows.length - courierCount;

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
              Set your filters and press <strong>Search</strong> to load current courier contracts
              and arbitrage hauls. The first search fetches every region and can take a moment.
            </Alert>
          )}

          {warming && (
            <Alert severity="warning">
              The market crawl is still warming up (the first all-region scan after the server
              starts), so arbitrage hauls may be incomplete — try again in a moment.
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
                  {courierCount} courier contract{courierCount === 1 ? '' : 's'} · {arbitrageCount}{' '}
                  arbitrage haul{arbitrageCount === 1 ? '' : 's'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  {contractsAsOf && (
                    <Tooltip
                      title="Contracts come from CCP's public feed (rebuilt ~every 30 min); the list can lag by up to ~30 minutes."
                      arrow
                    >
                      <Typography variant="caption" color="text.secondary">
                        Contracts as of {formatTime(contractsAsOf)}
                      </Typography>
                    </Tooltip>
                  )}
                  {market?.lastModifiedAt && (
                    <Tooltip
                      title={`Market order books come from CCP's feed (rebuilt ~every 5 min) across ${market.regions} regions; prices can lag by a few minutes.`}
                      arrow
                    >
                      <Typography variant="caption" color="text.secondary">
                        Market as of {formatTime(market.lastModifiedAt)}
                      </Typography>
                    </Tooltip>
                  )}
                </Box>
              </Box>
              {rows.length > 0 ? (
                <CombinedGrid rows={rows} />
              ) : (
                <Alert severity="info">
                  Nothing matches. Try relaxing the collateral or cargo limits.
                </Alert>
              )}
            </>
          )}
        </Stack>
      </Grid>
    </Grid>
  );
}
