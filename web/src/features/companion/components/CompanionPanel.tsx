import { useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { alpha, Box, Collapse, Fade, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { companionMessagesAtom, companionMutedAtom } from '../atoms';
import { speak, stopSpeaking } from '../voice';

/**
 * Output-only companion feed, docked bottom-right. Collapses to just its header
 * bar and expands to the message feed — same expand/collapse affordance as the
 * hauling bubble-graph panel (elevated, primary-accented, blurred). Speaks each
 * new line via the Web Speech API unless muted.
 */
export function CompanionPanel() {
  const messages = useAtomValue(companionMessagesAtom);
  const [muted, setMuted] = useAtom(companionMutedAtom);
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Seed with the newest existing message so restored backlog isn't read aloud on
  // load; only lines that arrive after mount get spoken.
  const lastSpokenId = useRef<string | undefined>(messages[messages.length - 1]?.id);

  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest || latest.id === lastSpokenId.current) return;
    lastSpokenId.current = latest.id; // mark seen even when muted
    if (!muted) speak(latest.text);
  }, [messages, muted]);

  useEffect(() => {
    if (expanded) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages.length, expanded]);

  const toggleMuted = () => {
    if (!muted) stopSpeaking(); // cut off any current utterance when muting
    setMuted(!muted);
  };

  const recent = messages.slice(-20);

  return (
    <Paper
      elevation={8}
      sx={(theme) => ({
        position: 'fixed',
        right: 16,
        bottom: 16,
        width: 340,
        maxWidth: 'calc(100vw - 32px)',
        zIndex: theme.zIndex.drawer + 1,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: alpha(theme.palette.background.paper, 0.9),
        backdropFilter: 'blur(10px)',
        border: '1px solid',
        borderColor: 'divider',
        borderTop: '2px solid',
        borderTopColor: 'primary.main',
        boxShadow: `0 0 12px ${alpha(theme.palette.primary.main, 0.15)}, 0 8px 32px rgba(0, 0, 0, 0.5)`,
      })}
    >
      <Box
        onClick={() => setExpanded((v) => !v)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <SmartToyIcon fontSize="small" sx={{ color: 'primary.main' }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>
          Assistant
        </Typography>

        <Tooltip title={muted ? 'Unmute voice' : 'Mute voice'} arrow>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              toggleMuted();
            }}
          >
            {muted ? <VolumeOffIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />}
          </IconButton>
        </Tooltip>

        <Tooltip title={expanded ? 'Collapse' : 'Expand'} arrow>
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
            {expanded ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      <Collapse in={expanded}>
        <Box
          ref={scrollRef}
          sx={{
            maxHeight: '60vh',
            overflowY: 'auto',
            px: 1.5,
            py: 1.5,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          {recent.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Standing by…
            </Typography>
          ) : (
            <Stack spacing={1}>
              {recent.map((m) => (
                <Fade in key={m.id}>
                  <Typography variant="body2" sx={{ lineHeight: 1.4 }}>
                    {m.text}
                  </Typography>
                </Fade>
              ))}
            </Stack>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
