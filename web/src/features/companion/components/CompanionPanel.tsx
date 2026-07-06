import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { Box, Fade, Paper, Stack, Typography } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { companionMessagesAtom } from '../atoms';

/**
 * Output-only companion feed, docked bottom-right. Renders the "client responses"
 * the AI chose to say; no input (voice/chat come later). Auto-scrolls to newest.
 */
export function CompanionPanel() {
  const messages = useAtomValue(companionMessagesAtom);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  // Show only the most recent handful — the full log lives in localStorage.
  const recent = messages.slice(-6);

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        width: 320,
        maxWidth: 'calc(100vw - 32px)',
        zIndex: (t) => t.zIndex.drawer + 1,
        borderRadius: 2,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          bgcolor: 'background.default',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <SmartToyIcon fontSize="small" sx={{ color: 'primary.main' }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Assistant
        </Typography>
      </Box>

      <Box ref={scrollRef} sx={{ maxHeight: '38vh', overflowY: 'auto', px: 1.5, py: 1.5 }}>
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
    </Paper>
  );
}
