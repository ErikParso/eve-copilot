// Expandable panel showing how fresh each region's market data is. Polls the
// lightweight /api/market/freshness endpoint every few seconds (independent of
// the heavier hauling fetch). Lets the user see, at a glance, which regions are
// loaded / stale / not yet fetched while the incremental crawler fills in.
import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  CircularProgress,
  LinearProgress,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
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

function statusTitle(r: RegionFreshness): string {
  if (r.status === 'loaded') return `Loaded · ${r.orderCount.toLocaleString()} orders · updated ${ageLabel(r.ageSeconds)}`;
  if (r.status === 'empty') return 'No market in this region';
  if (r.status === 'error') return `Error: ${r.lastError ?? 'fetch failed'} (showing last good data if any)`;
  return 'Not fetched yet';
}

export function MarketFreshnessPanel(): JSX.Element | null {
  const [data, setData] = useState<MarketFreshness | null>(null);
  const [failed, setFailed] = useState(false);

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
    if (failed) return null; // backend not reachable — stay out of the way
    return null;
  }

  const { regionsLoaded, regionsTotal, orderCount, status } = data;
  const pct = regionsTotal > 0 ? Math.round((regionsLoaded / regionsTotal) * 100) : 0;
  const withMarket = data.regions.filter((r) => r.status !== 'empty');

  return (
    <Accordion
      disableGutters
      elevation={0}
      variant="outlined"
      sx={{ borderRadius: 2, '&:before': { display: 'none' }, overflow: 'hidden' }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 48 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', width: '100%', pr: 1 }}>
          {status !== 'ready' ? (
            <CircularProgress size={16} thickness={5} />
          ) : (
            <FiberManualRecordIcon sx={{ fontSize: 14, color: 'success.main' }} />
          )}
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Market data
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {status === 'ready' ? 'all regions loaded' : `loading regions… ${regionsLoaded}/${regionsTotal}`}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label={`${regionsLoaded}/${regionsTotal} regions`} variant="outlined" />
          <Chip size="small" label={`${orderCount.toLocaleString()} orders`} variant="outlined" />
        </Box>
      </AccordionSummary>
      {status !== 'ready' && <LinearProgress variant="determinate" value={pct} />}
      <AccordionDetails sx={{ pt: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Each region's order book refreshes on ESI roughly every 5 minutes; the crawler re-checks them on a rolling
          cycle. Regions with no market are hidden.
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 0.5,
          }}
        >
          {withMarket.map((r) => (
            <Tooltip key={r.regionId} title={statusTitle(r)} arrow>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <FiberManualRecordIcon sx={{ fontSize: 10, color: STATUS_COLOR[r.status] }} />
                <Typography variant="body2" sx={{ fontWeight: r.priority ? 600 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name ?? `Region ${r.regionId}`}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  {r.status === 'loaded' ? ageLabel(r.ageSeconds) : r.status === 'never' ? '—' : r.status}
                </Typography>
              </Box>
            </Tooltip>
          ))}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
