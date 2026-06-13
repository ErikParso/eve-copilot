import { useEffect, useState, type ReactNode } from 'react';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { loadSde, type SdeMeta } from './sde';
import { SdeContext } from './sdeContext';

type Phase = 'loading' | 'ready' | 'error';

function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
      }}
    >
      <Stack spacing={2} alignItems="center" textAlign="center">
        {children}
      </Stack>
    </Box>
  );
}

/**
 * Loads the EVE static data (stations + systems) before rendering the app, so
 * downstream code can rely on the codelists being in memory. First visit
 * fetches from the network; later visits load instantly from the IndexedDB
 * cache.
 */
export function SdeProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [meta, setMeta] = useState<SdeMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setPhase('loading');
    loadSde(attempt > 0)
      .then((m) => {
        if (!active) return;
        setMeta(m);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load EVE static data');
        setPhase('error');
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (phase === 'loading') {
    return (
      <CenteredScreen>
        <CircularProgress />
        <Typography variant="body1">Loading EVE static data…</Typography>
        <Typography variant="caption" color="text.secondary">
          Fetching the latest station and system list (first load only).
        </Typography>
      </CenteredScreen>
    );
  }

  if (phase === 'error') {
    return (
      <CenteredScreen>
        <Typography variant="h6">Couldn’t load EVE static data</Typography>
        <Typography variant="body2" color="text.secondary">
          {error}
        </Typography>
        <Button variant="contained" onClick={() => setAttempt((a) => a + 1)}>
          Retry
        </Button>
      </CenteredScreen>
    );
  }

  return <SdeContext.Provider value={meta}>{children}</SdeContext.Provider>;
}
