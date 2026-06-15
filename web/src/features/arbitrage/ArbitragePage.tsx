import { Alert, Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { useArbitrageSearch } from './useArbitrageSearch';
import { ArbitrageFiltersPanel } from './components/ArbitrageFiltersPanel';
import { ArbitrageGrid } from './components/ArbitrageGrid';

function ProgressBar() {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Scanning the market for arbitrage…
      </Typography>
      <LinearProgress />
    </Box>
  );
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ArbitragePage() {
  const { run, status, rows, error, market } = useArbitrageSearch();
  const loading = status === 'loading';
  const warming = status === 'success' && market !== null && market.status !== 'ready';

  return (
    <Grid container spacing={2} alignItems="flex-start">
      {/* Left panel: filters (sticky on md+) */}
      <Grid xs={12} sm={6} md={4} lg={3} xl={3}>
        <Box sx={{ position: { md: 'sticky' }, top: { md: 80 } }}>
          <ArbitrageFiltersPanel onSearch={run} loading={loading} />
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
              Set your filters and press <strong>Search</strong> to find items worth hauling for
              profit. Leave <strong>From</strong>/<strong>To</strong> empty to scan all of New Eden.
            </Alert>
          )}

          {warming && (
            <Alert severity="warning">
              The market crawl is still warming up (the first all-region scan after the server
              starts). Results may be incomplete — try again in a moment.
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
                  {rows.length} arbitrage opportunit{rows.length === 1 ? 'y' : 'ies'} found.
                </Typography>
                {market?.lastModifiedAt && (
                  <Tooltip
                    title={`Order books come from CCP's market feed (rebuilt ~every 5 min) across ${market.regions} regions. The list can lag live prices by a few minutes.`}
                    arrow
                  >
                    <Typography variant="caption" color="text.secondary">
                      Market data as of {formatTime(market.lastModifiedAt)}
                    </Typography>
                  </Tooltip>
                )}
              </Box>
              {rows.length > 0 ? (
                <ArbitrageGrid rows={rows} />
              ) : (
                <Alert severity="info">
                  No profitable hauls match. Try raising the investment/cargo limits, widening the
                  jump cap, or clearing the From/To systems.
                </Alert>
              )}
            </>
          )}
        </Stack>
      </Grid>
    </Grid>
  );
}
