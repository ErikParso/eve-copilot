import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  Alert,
  Box,
  Divider,
  Pagination,
  Stack,
  TextField,
  Typography,
  InputAdornment,
  Paper,
  useTheme,
  useMediaQuery,
  Fab,
  Slide,
  alpha,
} from '@mui/material';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import CloseIcon from '@mui/icons-material/Close';
import { HaulingBubbleChart } from './components/HaulingBubbleChart';
import { haulingDataAtom, haulingPageAtom, pinnedRowsAtom, availableRowsAtom } from './atoms';
import { sortCombined } from './combined';

// Hard ceiling on how deep the ranked set can be paged — mirrors the server's
// MAX_PAGEABLE (server/hauling.ts). Keep the two in sync.
const MAX_PAGEABLE = 1000;
import { CombinedGrid } from './components/CombinedGrid';
import { preferencesAtom } from '@/features/preferences/atoms';
import { RouteTypeSelect } from './components/RouteTypeSelect';
import { ContractTypeSelect } from './components/ContractTypeSelect';
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



export function CourierContractsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { status, error, total, pageSize } = useAtomValue(haulingDataAtom);
  const pinnedRows = useAtomValue(pinnedRowsAtom);
  const availableRows = useAtomValue(availableRowsAtom);
  const [page, setPage] = useAtom(haulingPageAtom);
  const [prefs, setPrefs] = useAtom(preferencesAtom);

  const [showChart, setShowChart] = useState(false);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleBubbleClick = (key: string) => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    const cardEl = document.getElementById(`card-${key}`);
    if (cardEl) {
      // Scroll to start (top) so the card is visible above the bottom floating panel
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setHighlightedKey(key);
      if (isMobile) {
        setShowChart(false);
      }
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedKey(null);
      }, 4000);
    }
  };

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const loading = status === 'idle' || status === 'loading';

  // Pinned hauls are revalidated by the global hauling reload (same request +
  // same market snapshot as the opportunities), so there is no per-page polling.

  useEffect(() => {
    document.title = 'EVE Copilot — Hauling & Arbitrage Opportunities';
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute(
        'content',
        'Find the most profitable EVE Online courier contracts and arbitrage routes using real-time market data analysis, filtered by your cargo capacity and budget.'
      );
    }
  }, []);

  // The server ships one page already ranked, but the FE splits it back into kinds
  // (losing the cross-kind order), so re-sort the page by attractivity for display.
  // Pinned rows render in their own section above and are NOT paged/re-sorted here.
  const sortedRows = useMemo(() => sortCombined(availableRows, 'attractivity'), [availableRows]);

  // Pager: cap navigation at MAX_PAGEABLE even if the server scored more.
  const pageCount = Math.max(1, Math.ceil(Math.min(total, MAX_PAGEABLE) / Math.max(1, pageSize)));

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.025em', mb: 0.5 }}>
          EVE Online Hauling & Arbitrage Opportunities
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Find the most profitable courier contracts and arbitrage routes using real-time market data analysis.
        </Typography>
      </Box>

      <Stack spacing={2}>
        {status === 'error' && <Alert severity="error">Could not load the data: {error}</Alert>}

        {/* Settings Panel is always shown immediately */}
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

            <Box sx={{ flex: '1 1 180px', minWidth: 180 }}>
              <ContractTypeSelect
                value={prefs.contractTypes}
                onChange={(contractTypes) => setPrefs({ ...prefs, contractTypes })}
              />
            </Box>

            <Box sx={{ flex: { xs: '1 1 auto', sm: '2 0 440px' }, minWidth: { xs: 0, sm: 440 } }}>
              <AttractivityWeightsControl />
            </Box>
          </Box>
        </Paper>

        {/* Pinned hauls: the user's active work, always visible (never paged, and
            not hidden during a reload) and split from the ranked grid by a divider. */}
        {pinnedRows.length > 0 && (
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem', mt: 2, mb: 1.5 }}>
              Pinned Hauls
            </Typography>
            <CombinedGrid rows={pinnedRows} highlightedKey={highlightedKey} />
            <Divider sx={{ mt: 3 }} />
          </Box>
        )}

        {/* Available Opportunities Header (always visible as title, but dynamic count when loaded) */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            columnGap: 2,
            rowGap: 0.5,
            mt: 2,
            mb: 1.5,
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
            Available Opportunities
          </Typography>
          {!loading && status === 'success' && (
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {total > MAX_PAGEABLE
                ? `Top ${MAX_PAGEABLE.toLocaleString()} of ${total.toLocaleString()} · page ${page} of ${pageCount}`
                : pageCount > 1
                  ? `${total.toLocaleString()} opportunities · page ${page} of ${pageCount}`
                  : `${total.toLocaleString()} ${total === 1 ? 'opportunity' : 'opportunities'}`}
            </Typography>
          )}
        </Box>

        {(loading || status === 'success') && (
          <>
            {/* Show chart if bubble chart FAB is toggled and rows exist */}
            {sortedRows.length > 0 && (
              <>
                <Slide direction="up" in={showChart}>
                  <Paper
                    elevation={8}
                    sx={(theme) => ({
                      position: 'fixed',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: { xs: '30vh', md: '200px' },
                      zIndex: theme.zIndex.speedDial + 10,
                      borderRadius: 0,
                      bgcolor: alpha(theme.palette.background.paper, 0.9),
                      backdropFilter: 'blur(10px)',
                      borderTop: '2px solid',
                      borderColor: 'primary.main',
                      boxShadow: `0 -4px 20px ${alpha(theme.palette.primary.main, 0.15)}, 0 -8px 32px rgba(0, 0, 0, 0.5)`,
                      overflow: 'hidden',
                      pt: 2.5, // leaves room for the overlapping FAB centered on the top border
                    })}
                  >
                    <HaulingBubbleChart rows={sortedRows} onBubbleClick={handleBubbleClick} />
                  </Paper>
                </Slide>

                <Fab
                  color="primary"
                  size="small"
                  onClick={() => setShowChart(!showChart)}
                  sx={(theme) => ({
                    position: 'fixed',
                    bottom: showChart ? { xs: 'calc(30vh - 20px)', md: '180px' } : 12,
                    right: 12,
                    zIndex: theme.zIndex.speedDial + 20,
                    boxShadow: showChart
                      ? `0 0 12px ${alpha(theme.palette.primary.main, 0.4)}, 0 4px 12px rgba(0,0,0,0.5)`
                      : '0 6px 24px rgba(0,0,0,0.4)',
                    transition: theme.transitions.create(
                      ['bottom', 'background-color', 'border-color', 'box-shadow', 'color', 'transform'],
                      {
                        duration: showChart
                          ? theme.transitions.duration.enteringScreen
                          : theme.transitions.duration.leavingScreen,
                        easing: showChart
                          ? theme.transitions.easing.easeOut
                          : theme.transitions.easing.sharp,
                      }
                    ),
                    bgcolor: showChart ? 'background.paper' : 'primary.main',
                    color: showChart ? 'primary.main' : 'primary.contrastText',
                    border: '2px solid',
                    borderColor: 'primary.main',
                    '&:hover': {
                      bgcolor: showChart ? '#212c3d' : 'primary.dark',
                      boxShadow: showChart
                        ? `0 0 18px ${alpha(theme.palette.primary.main, 0.6)}, 0 4px 12px rgba(0,0,0,0.5)`
                        : `0 8px 28px ${alpha(theme.palette.primary.main, 0.4)}`,
                      transform: 'scale(1.05)',
                    },
                  })}
                >
                  {showChart ? <CloseIcon fontSize="small" /> : <BubbleChartIcon fontSize="small" />}
                </Fab>
              </>
            )}

            {sortedRows.length > 0 || loading ? (
              <>
                <CombinedGrid
                  rows={sortedRows}
                  highlightedKey={highlightedKey}
                  showSkeletons={loading}
                />
                {!loading && pageCount > 1 && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', mt: 4, mb: 2 }}>
                    <Pagination
                      count={pageCount}
                      page={page}
                      onChange={(_e, value) => setPage(value)}
                      color="primary"
                      shape="rounded"
                      size={isMobile ? 'small' : 'medium'}
                      siblingCount={isMobile ? 0 : 1}
                      boundaryCount={1}
                    />
                  </Box>
                )}
              </>
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
