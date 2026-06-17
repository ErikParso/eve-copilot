import { useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Button, Paper, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import TuneIcon from '@mui/icons-material/Tune';
import { activeCharacterAtom, characterStatusAtom } from '@/features/auth/atoms';
import { preferencesOpenAtom } from '@/features/preferences/atoms';
import { haulingViewAtom } from '../atoms';
import { SystemAutocomplete } from './SystemAutocomplete';

interface FiltersPanelProps {
  onSearch: () => void;
  loading: boolean;
}

/**
 * Hauling search panel: just the contextual bits — origin system + Search.
 * Capacity / ISK / route / contract type / weights are global Preferences.
 */
export function FiltersPanel({ onSearch, loading }: FiltersPanelProps) {
  const [view, setView] = useAtom(haulingViewAtom);
  const activeCharacter = useAtomValue(activeCharacterAtom);
  const status = useAtomValue(characterStatusAtom);
  const openPrefs = useSetAtom(preferencesOpenAtom);

  // When logged in, the origin tracks the character's live location.
  const liveSystemId = activeCharacter ? status?.systemId ?? null : null;
  useEffect(() => {
    if (liveSystemId === null) return;
    setView((v) => (v.currentSystemId === liveSystemId ? v : { ...v, currentSystemId: liveSystemId }));
  }, [liveSystemId, setView]);

  return (
    <Paper sx={{ p: 2.5 }} elevation={2}>
      <Stack spacing={2.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Search
        </Typography>

        {activeCharacter ? (
          <TextField
            label="Current system"
            size="small"
            fullWidth
            disabled
            value={status?.systemName ?? 'Locating…'}
            helperText={
              status
                ? `from your character · ${Math.max(0, Math.round((Date.now() - status.fetchedAt) / 1000))} s ago`
                : ' '
            }
          />
        ) : (
          <SystemAutocomplete
            value={view.currentSystemId}
            onChange={(currentSystemId) => setView((v) => ({ ...v, currentSystemId }))}
          />
        )}

        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<SearchIcon />}
          onClick={onSearch}
          disabled={loading}
        >
          {loading ? 'Searching…' : 'Search'}
        </Button>

        <Button
          variant="text"
          size="small"
          startIcon={<TuneIcon />}
          onClick={() => openPrefs(true)}
          sx={{ justifyContent: 'flex-start' }}
        >
          Cargo, ISK, route & weights
        </Button>
      </Stack>
    </Paper>
  );
}
