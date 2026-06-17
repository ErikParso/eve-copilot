import { useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  Alert,
  Box,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { haulingDataAtom, haulingRowsAtom, haulingViewAtom } from './atoms';
import { sortCombined } from './combined';
import { SORT_OPTIONS } from './sortContracts';
import type { SortOptionId } from './types';
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

/**
 * Hauling results. The data is fetched globally (auto on load + background
 * refresh, see useHaulingSearchController) and shared with Copilot; this page
 * just renders + sorts it. No search button or filter panel — capacity/ISK/route
 * /contract-type/weights are global Preferences.
 */
export function CourierContractsPage() {
  const { status, error, contractsAsOf, market } = useAtomValue(haulingDataAtom);
  const rows = useAtomValue(haulingRowsAtom);
  const [view, setView] = useAtom(haulingViewAtom);

  const loading = status === 'idle' || status === 'loading';
  const warming = status === 'success' && market !== null && market.status !== 'ready';
  const courierCount = rows.filter((r) => r.kind === 'courier').length;
  const arbitrageCount = rows.length - courierCount;

  // Sort live so the control above the grid reorders instantly.
  const sortedRows = useMemo(() => sortCombined(rows, view.sortBy), [rows, view.sortBy]);

  return (
    <Stack spacing={2}>
      {loading && <ProgressBar />}

      {status === 'error' && <Alert severity="error">Could not load the data: {error}</Alert>}

      {warming && (
        <Alert severity="warning">
          The market crawl is still warming up (the first all-region scan after the server starts),
          so arbitrage hauls may be incomplete — this refreshes automatically.
        </Alert>
      )}

      {status === 'success' && (
        <>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1.5,
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {courierCount} courier contract{courierCount === 1 ? '' : 's'} · {arbitrageCount}{' '}
              arbitrage haul{arbitrageCount === 1 ? '' : 's'}
            </Typography>

            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
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
              <TextField
                select
                size="small"
                label="Sort by"
                value={view.sortBy}
                onChange={(e) => setView({ sortBy: e.target.value as SortOptionId })}
                sx={{ minWidth: 190 }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <MenuItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          </Box>

          {rows.length > 0 ? (
            <CombinedGrid rows={sortedRows} />
          ) : (
            <Alert severity="info">
              Nothing matches. Widen the cargo / ISK / contract-type limits in Preferences.
            </Alert>
          )}
        </>
      )}
    </Stack>
  );
}
