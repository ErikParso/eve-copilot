import { Box, Tooltip, Typography } from '@mui/material';

/** Colour from red (0) through amber to green (100). */
function scoreColor(score: number): string {
  const hue = Math.max(0, Math.min(100, score)) * 1.2; // 0 → red, 120 → green
  return `hsl(${hue}, 70%, 45%)`;
}

interface AttractivityCellProps {
  score: number;
  /** Step-by-step calculation of this row's score (with real numbers). */
  steps?: string[];
  /** Render as a round bubble (for the card corner) instead of a pill. */
  circle?: boolean;
}

/** Attractivity index rendered as a colour-coded badge (0–100). */
export function AttractivityCell({ score, steps, circle }: AttractivityCellProps) {
  const hasSteps = !!steps && steps.length > 0;

  const badge = (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        color: '#0d1117',
        bgcolor: scoreColor(score),
        cursor: hasSteps ? 'help' : 'default',
        ...(circle
          ? { width: 34, height: 34, borderRadius: '50%', fontSize: '0.8rem', boxShadow: 2 }
          : { minWidth: 40, px: 1, py: 0.25, borderRadius: 1, fontSize: '0.85rem' }),
      }}
    >
      {score}
    </Box>
  );

  if (!hasSteps) return badge;

  const title = (
    <Box sx={{ py: 0.5 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
        How this score is calculated
      </Typography>
      {steps!.map((step, i) => (
        <Typography key={i} variant="caption" sx={{ display: 'block', lineHeight: 1.5 }}>
          {step}
        </Typography>
      ))}
    </Box>
  );

  return (
    <Tooltip title={title} arrow slotProps={{ tooltip: { sx: { maxWidth: 360 } } }}>
      {badge}
    </Tooltip>
  );
}
