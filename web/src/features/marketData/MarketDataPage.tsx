import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const POLL_MS = 5000;

type RegionStatus = 'never' | 'loaded' | 'empty' | 'error';

interface RegionFreshness {
  regionId: number;
  name: string | null;
  status: RegionStatus;
  ageSeconds: number | null;
  dueInSeconds: number | null;
  orderCount: number;
  priority: boolean;
  lastError: string | null;
}

interface MarketFreshness {
  status: 'cold' | 'warming' | 'ready';
  regionsTotal: number;
  regionsLoaded: number;
  orderCount: number;
  builtAt: number | null;
  lastModifiedAt: number | null;
  regions: RegionFreshness[];
}

function ageLabel(sec: number | null): string {
  if (sec === null) return 'not loaded yet';
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const STATUS_COLOR: Record<RegionStatus, string> = {
  loaded: 'success.main',
  empty: 'text.disabled',
  never: 'warning.main',
  error: 'error.main',
};



export function MarketDataPage() {
  const [data, setData] = useState<MarketFreshness | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = 'EVE Copilot — Market Data Status';
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute(
        'content',
        'Monitor the synchronization and freshness of EVE Online regional market order books from the ESI API in real-time.'
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/market/freshness`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as MarketFreshness;
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

  if (!data) {
    if (failed) {
      return (
        <Alert severity="error">
          Failed to connect to the backend server. Make sure the server is running.
        </Alert>
      );
    }
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const { regionsLoaded, regionsTotal, orderCount, status } = data;
  const pct = regionsTotal > 0 ? Math.round((regionsLoaded / regionsTotal) * 100) : 0;
  const withMarket = data.regions
    .filter((r) => r.status !== 'empty')
    .sort((a, b) => b.orderCount - a.orderCount);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.025em', mb: 0.5 }}>
          Market Data Status
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Track the crawler's progress as it updates regional market order books from the EVE Online ESI API.
        </Typography>
      </Box>

      <Card
        elevation={0}
        variant="outlined"
        sx={{
          borderRadius: 2,
          boxShadow: (theme) => theme.palette.mode === 'light' 
            ? '0 2px 8px rgba(0,0,0,0.04)' 
            : '0 2px 8px rgba(0,0,0,0.16)',
        }}
      >
        <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
          <Stack spacing={3}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'flex-start', sm: 'center' },
                gap: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {status !== 'ready' ? (
                  <CircularProgress size={20} thickness={5} />
                ) : (
                  <FiberManualRecordIcon sx={{ fontSize: 18, color: 'success.main' }} />
                )}
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {status === 'ready' ? 'All regions loaded' : 'Synchronizing market data…'}
                </Typography>
              </Box>

              <Box sx={{ display: { xs: 'none', sm: 'block' }, flexGrow: 1 }} />

              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  flexWrap: 'wrap',
                  width: { xs: '100%', sm: 'auto' },
                }}
              >
                <Chip
                  label={`${regionsLoaded}/${regionsTotal} regions loaded`}
                  color={status === 'ready' ? 'success' : 'primary'}
                  variant="outlined"
                  sx={{ flexGrow: { xs: 1, sm: 0 } }}
                />
                <Chip
                  label={`${orderCount.toLocaleString()} total orders`}
                  variant="outlined"
                  sx={{ flexGrow: { xs: 1, sm: 0 } }}
                />
              </Box>
            </Box>

            {status !== 'ready' && (
              <Box sx={{ width: '100%' }}>
                <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3 }} />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'right' }}>
                  {pct}% Complete
                </Typography>
              </Box>
            )}

            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Each region's order book refreshes on ESI roughly every 5 minutes; the crawler re-checks them on a rolling
                cycle. Regions with no active market are hidden.
              </Typography>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {withMarket.map((r) => (
                  <Box
                    key={r.regionId}
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
                      flex: { xs: '1 1 100%', sm: '1 1 280px' },
                      minWidth: 0,
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <FiberManualRecordIcon sx={{ fontSize: 10, color: STATUS_COLOR[r.status] }} />
                    <Typography
                      variant="body2"
                      sx={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.name ?? `Region ${r.regionId}`}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'loaded' ? (
                        `${r.orderCount.toLocaleString()} orders · ${ageLabel(r.ageSeconds)}`
                      ) : r.status === 'never' ? (
                        'Not fetched'
                      ) : (
                        `Error: ${r.lastError ?? 'Failed'}`
                      )}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
