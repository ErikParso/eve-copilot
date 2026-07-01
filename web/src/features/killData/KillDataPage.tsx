import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
  Skeleton,
} from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import ArrowRightAltIcon from '@mui/icons-material/ArrowRightAlt';
import { securityColor, type SecurityBand } from '@/data/sde';
import { formatNumber } from '@/utils/format';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const POLL_MS = 5000;

interface GateKillEntry {
  destSystemId: number;
  destName: string;
  kills: number;
}
interface SystemGateKills {
  systemId: number;
  name: string;
  security: number;
  securityBand: SecurityBand;
  totalKills: number;
  gates: GateKillEntry[];
}
interface GateKillReport {
  windowMinutes: number;
  warmingUp: boolean;
  elapsedMinutes: number;
  totalGateKills: number;
  systems: SystemGateKills[];
}

/** "last 60 minutes" once warm; while warming up, how long it's been collecting. */
function windowLabel(data: GateKillReport): string {
  if (!data.warmingUp) return 'Data for the last 60 minutes';
  if (data.elapsedMinutes < 1) return 'Warming up · collecting for less than a minute';
  return `Warming up · data for the last ${data.elapsedMinutes} minute${data.elapsedMinutes === 1 ? '' : 's'}`;
}

export function KillDataPage() {
  const [data, setData] = useState<GateKillReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = 'EVE Copilot — Kill Data';
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/kills/gates`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as GateKillReport;
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

  const systems = data?.systems ?? [];

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.025em', mb: 0.5 }}>
          Kill Data
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Ship kills at stargates over a rolling 60-minute window, fed live from zKillboard. Only kills that
          happened at a gate count — station, plex and belt kills are excluded. Systems with recent gate kills
          are listed below, most-active first.
        </Typography>
      </Box>

      {failed && (
        <Alert severity="error">
          Failed to connect to the backend server. Make sure the server is running.
        </Alert>
      )}

      {!failed && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {data ? (
            <>
              <Chip
                icon={
                  data.warmingUp ? (
                    <CircularProgress size={14} thickness={6} sx={{ ml: 1 }} />
                  ) : (
                    <FiberManualRecordIcon sx={{ fontSize: 14, color: 'success.main' }} />
                  )
                }
                label={windowLabel(data)}
                color={data.warmingUp ? 'primary' : 'success'}
                variant="outlined"
              />
              <Chip label={`${formatNumber(data.totalGateKills, 0)} gate kills`} variant="outlined" />
              <Chip label={`${formatNumber(systems.length, 0)} systems`} variant="outlined" />
            </>
          ) : (
            <>
              <Skeleton variant="rectangular" width={260} height={32} sx={{ borderRadius: 16 }} />
              <Skeleton variant="rectangular" width={140} height={32} sx={{ borderRadius: 16 }} />
            </>
          )}
        </Box>
      )}

      {!failed && data && systems.length === 0 && (
        <Alert severity="info">
          {data.warmingUp
            ? 'No stargate kills recorded yet — the window is still warming up. Check back as data collects.'
            : 'No stargate kills anywhere in New Eden in the last 60 minutes. Fly safe.'}
        </Alert>
      )}

      {!failed && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          {data
            ? systems.map((s) => (
                <Card
                  key={s.systemId}
                  elevation={0}
                  variant="outlined"
                  sx={{ borderRadius: 2, flex: { xs: '1 1 100%', sm: '1 1 340px' }, minWidth: 0 }}
                >
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <FiberManualRecordIcon sx={{ fontSize: 12, color: securityColor(s.security) }} />
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, minWidth: 0 }}>
                        {s.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatNumber(s.security, 1)}
                      </Typography>
                      <Box sx={{ flexGrow: 1 }} />
                      <Chip
                        label={`${formatNumber(s.totalKills, 0)} kills`}
                        size="small"
                        color="error"
                        variant="outlined"
                      />
                    </Box>
                    <Stack spacing={0.5}>
                      {s.gates.map((g) => (
                        <Box
                          key={g.destSystemId}
                          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 0.5 }}
                        >
                          <ArrowRightAltIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
                            gate to {g.destName}
                          </Typography>
                          <Box sx={{ flexGrow: 1 }} />
                          <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {formatNumber(g.kills, 0)}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              ))
            : Array.from({ length: 4 }).map((_, idx) => (
                <Skeleton
                  key={idx}
                  variant="rectangular"
                  height={110}
                  sx={{ borderRadius: 2, flex: { xs: '1 1 100%', sm: '1 1 340px' } }}
                />
              ))}
        </Box>
      )}
    </Stack>
  );
}
