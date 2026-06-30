import { useEffect, useState } from 'react';
import { Box, Card, CardContent, Chip, CircularProgress, LinearProgress, Skeleton, Stack, Typography } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const POLL_MS = 5000;

interface PackagesFreshness {
  workerRunning: boolean;
  liveContracts: number;
  cached: number;
  sellable: number;
  skipped: number;
  pending: number;
  opportunities: number;
  lastReconcileAt: number | null;
  marketBuiltAt: number | null;
}

function ageLabel(ms: number | null): string {
  if (ms === null) return 'not yet';
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/**
 * Sell-contract (bundle) processing status for the Market Data tab. Polls the
 * package service's freshness on the same cadence as the market panel: how many
 * contracts' contents have been fetched, how many are still queued, and how many
 * profitable bundles came out. The contents-fetch worker shares the ESI rate
 * limiter with the market crawler, so this warms up gradually after each crawl.
 */
export function PackagesProcessingPanel() {
  const [data, setData] = useState<PackagesFreshness | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/packages/freshness`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as PackagesFreshness;
        if (!cancelled) {
          setData(json);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (failed) return null; // the market panel already surfaces a backend-down error

  const live = data?.liveContracts ?? 0;
  const cached = data?.cached ?? 0;
  const pending = data?.pending ?? 0;
  const pct = live > 0 ? Math.round((cached / live) * 100) : 0;
  const warming = (data?.pending ?? 0) > 0;
  const running = data?.workerRunning ?? false;

  return (
    <Card
      elevation={0}
      variant="outlined"
      sx={{
        borderRadius: 2,
        boxShadow: (theme) => (theme.palette.mode === 'light' ? '0 2px 8px rgba(0,0,0,0.04)' : '0 2px 8px rgba(0,0,0,0.16)'),
      }}
    >
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        <Stack spacing={3}>
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {data ? (
                !running ? (
                  <Inventory2OutlinedIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
                ) : warming ? (
                  <CircularProgress size={20} thickness={5} />
                ) : (
                  <FiberManualRecordIcon sx={{ fontSize: 18, color: 'success.main' }} />
                )
              ) : (
                <Skeleton variant="circular" width={20} height={20} />
              )}
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {data ? (
                  !running ? 'Sell contracts — not running' : warming ? 'Fetching sell-contract contents…' : 'Sell contracts up to date'
                ) : (
                  <Skeleton variant="text" width={260} height={28} />
                )}
              </Typography>
            </Box>

            <Box sx={{ display: { xs: 'none', sm: 'block' }, flexGrow: 1 }} />

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' } }}>
              {data ? (
                <>
                  <Chip label={`${cached.toLocaleString()} / ${live.toLocaleString()} fetched`} color={warming ? 'primary' : 'success'} variant="outlined" sx={{ flexGrow: { xs: 1, sm: 0 } }} />
                  <Chip label={`${data.opportunities.toLocaleString()} profitable bundles`} variant="outlined" sx={{ flexGrow: { xs: 1, sm: 0 } }} />
                </>
              ) : (
                <>
                  <Skeleton variant="rectangular" width={140} height={32} sx={{ borderRadius: 16 }} />
                  <Skeleton variant="rectangular" width={140} height={32} sx={{ borderRadius: 16 }} />
                </>
              )}
            </Box>
          </Box>

          {data && warming && live > 0 && (
            <Box sx={{ width: '100%' }}>
              <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3 }} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'right' }}>
                {pct}% of contracts fetched · {pending.toLocaleString()} queued
              </Typography>
            </Box>
          )}

          {data ? (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Profit and the best destination for each bundle update live with the market — about once a minute, the same as
                arbitrage. We also scan for newly-listed and bought/expired contracts every few minutes.
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <StatPill label="Live contracts" value={live} />
                <StatPill label="Contents fetched" value={cached} />
                <StatPill label="Queued" value={pending} />
                <StatPill label="Sellable" value={data.sellable} />
                <StatPill label="Skipped (want-to-buy)" value={data.skipped} />
                <StatPill label="Profitable bundles" value={data.opportunities} />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  💹 Prices updated {ageLabel(data.marketBuiltAt)} (live with the market).
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  📦 Contract list checked {ageLabel(data.lastReconcileAt)}.
                </Typography>
              </Box>
            </Box>
          ) : (
            <Box>
              <Skeleton variant="text" width="90%" height={20} />
              <Skeleton variant="text" width="60%" height={20} />
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 1.5,
        py: 1,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        flex: { xs: '1 1 100%', sm: '1 1 200px' },
        minWidth: 0,
      }}
    >
      <Typography variant="body2" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
        {value.toLocaleString()}
      </Typography>
    </Box>
  );
}
