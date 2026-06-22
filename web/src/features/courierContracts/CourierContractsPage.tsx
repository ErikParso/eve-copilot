import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  Alert,
  Box,
  LinearProgress,
  Stack,
  TextField,
  Typography,
  InputAdornment,
  Paper,
} from '@mui/material';
import { haulingDataAtom, haulingRowsAtom } from './atoms';
import { sortCombined } from './combined';
import { CombinedGrid } from './components/CombinedGrid';
import {
  pinnedHaulsAtom,
  updatePinnedStatusesAtom,
} from '@/features/arbitrage/atoms';
import { preferencesAtom } from '@/features/preferences/atoms';
import { RouteTypeSelect } from './components/RouteTypeSelect';
import { AttractivityWeightsControl } from './components/AttractivityWeightsControl';

function parseOptionalNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function NumberPrefField({
  label,
  value,
  unit,
  helperText,
  onCommit,
}: {
  label: string;
  value: number | null;
  unit: string;
  helperText: string;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    setText(value === null ? '' : String(value));
  }, [value]);

  const commit = () => {
    const parsed = parseOptionalNumber(text);
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <TextField
      label={label}
      type="number"
      fullWidth
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      InputProps={{ endAdornment: <InputAdornment position="end">{unit}</InputAdornment> }}
      inputProps={{ min: 0 }}
      helperText={helperText}
    />
  );
}

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

export function CourierContractsPage() {
  const { status, error, market } = useAtomValue(haulingDataAtom);
  const rows = useAtomValue(haulingRowsAtom);
  const [prefs, setPrefs] = useAtom(preferencesAtom);
  
  // Pinned hauls state
  const pinnedHauls = useAtomValue(pinnedHaulsAtom);
  const updatePinnedStatuses = useSetAtom(updatePinnedStatusesAtom);

  const loading = status === 'idle' || status === 'loading';
  const warming = status === 'success' && market !== null && market.status !== 'ready';

  // Poll pinned statuses
  const pinnedHaulsRef = useRef(pinnedHauls);
  pinnedHaulsRef.current = pinnedHauls;

  useEffect(() => {
    if (pinnedHauls.length === 0) return;

    let active = true;
    const checkStatuses = async () => {
      try {
        const body = {
          hauls: pinnedHaulsRef.current.map((h) => ({
            id: h.id,
            typeId: h.typeId,
            source: h.source.locationId,
            dest: h.dest.locationId,
            quantity: h.status === 'planning' ? h.quantity : (h.boughtQuantity ?? h.quantity),
            status: h.status,
            boughtPrice: h.boughtPrice,
          })),
        };
        const res = await fetch('/api/arbitrage/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Status check failed');
        const data = await res.json();
        if (active && data.statuses) {
          updatePinnedStatuses(data.statuses);
        }
      } catch (err) {
        console.error('Failed to check pinned hauls status', err);
      }
    };

    checkStatuses();

    const interval = setInterval(checkStatuses, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pinnedHauls.length, updatePinnedStatuses]);

  // Sort live by attractivity always
  const sortedRows = useMemo(() => sortCombined(rows, 'attractivity'), [rows]);

  return (
    <Stack spacing={3}>
      {/* Pinned Hauls Section */}

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
            <Paper
              elevation={0}
              variant="outlined"
              sx={{
                p: 2.5,
                bgcolor: 'background.paper',
                borderRadius: 2,
                boxShadow: (theme) => theme.palette.mode === 'light' 
                  ? '0 2px 8px rgba(0,0,0,0.04)' 
                  : '0 2px 8px rgba(0,0,0,0.16)',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: { xs: 'wrap' },
                  gap: 2,
                  alignItems: 'flex-start',
                }}
              >
                <Box sx={{ flex: '1 1 140px', minWidth: 140 }}>
                  <NumberPrefField
                    label="Cargo capacity"
                    value={prefs.cargoM3}
                    unit="m³"
                    helperText="Your hold — hides oversized hauls."
                    onCommit={(cargoM3) => setPrefs({ ...prefs, cargoM3 })}
                  />
                </Box>

                <Box sx={{ flex: '1 1 180px', minWidth: 180 }}>
                  <RouteTypeSelect
                    value={prefs.routeType}
                    onChange={(routeType) => setPrefs({ ...prefs, routeType })}
                  />
                </Box>

                <Box sx={{ flex: { xs: '1 1 auto', sm: '2 0 440px' }, minWidth: { xs: 0, sm: 440 } }}>
                  <AttractivityWeightsControl />
                </Box>
              </Box>
            </Paper>

            {rows.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                  Available Opportunities
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {rows.length} {rows.length === 1 ? 'opportunity' : 'opportunities'} found
                </Typography>
              </Box>
            )}

            {rows.length > 0 ? (
              <CombinedGrid rows={sortedRows} />
            ) : (
              <Alert severity="info" sx={{ mt: 2 }}>
                Nothing matches. Widen the cargo / ISK / contract-type limits in Preferences.
              </Alert>
            )}
          </>
        )}
      </Stack>
    </Stack>
  );
}
