import { useMemo } from 'react';
import { Box, Card, CardContent, Divider, Skeleton, Typography, alpha } from '@mui/material';

const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

/**
 * Loading placeholder for an opportunity card. Deliberately minimal — just the
 * card's top headline block (label / value / subtitle) so the grid isn't a noisy
 * wall of bars while loading. Uses the same CardContent padding + gap and the same
 * headline line spacing as the real cards, and a slightly randomised bar width per
 * instance so a row of them doesn't look mechanically identical.
 */
export function OpportunityCardSkeleton() {
  // Jitter widths once per mount (stable across re-renders while loading).
  const w = useMemo(
    () => ({ label: rand(100, 140), value: rand(150, 200), sub: rand(90, 130), name: rand(170, 220), amount: rand(120, 170) }),
    [],
  );

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        minHeight: 400,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.5),
        borderColor: 'divider',
        borderWidth: '1px',
        margin: '0px',
      }}
    >
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1, minWidth: 0 }}>
        {/* Headline block: label / value / subtitle. Each Skeleton is wrapped in a
            Typography of the SAME variant as the real card, so its line-height
            matches exactly (pr:5 clears where the attractivity bubble sits). */}
        <Box sx={{ pr: 5, minWidth: 0 }}>
          <Typography variant="caption"><Skeleton width={w.label} /></Typography>
          <Typography variant="h6" sx={{ lineHeight: 1.2 }}><Skeleton width={w.value} /></Typography>
          <Typography variant="caption"><Skeleton width={w.sub} /></Typography>
        </Box>

        <Divider />

        {/* Item name (body2) + amount (caption), matching the real card's variants. */}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.25 }}><Skeleton width={w.name} /></Typography>
          <Typography variant="caption"><Skeleton width={w.amount} /></Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
