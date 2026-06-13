import { Box, Tooltip, Typography } from '@mui/material';

/** Colour from green (0, safe) through amber to red (100, deadly). */
function dangerColor(score: number): string {
  const hue = (100 - Math.max(0, Math.min(100, score))) * 1.2; // 0 → green, 100 → red
  return `hsl(${hue}, 70%, 45%)`;
}

interface DangerCellProps {
  score: number | null;
  /** Step-by-step calculation of this row's danger index (with real numbers). */
  steps?: string[];
}

/** Danger index rendered as a colour-coded badge (0–100, higher = riskier). */
export function DangerCell({ score, steps }: DangerCellProps) {
  if (score === null) return <>—</>;

  const hasSteps = !!steps && steps.length > 0;

  const badge = (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 40,
        px: 1,
        py: 0.25,
        borderRadius: 1,
        fontWeight: 700,
        fontSize: '0.85rem',
        color: '#0d1117',
        bgcolor: dangerColor(score),
        cursor: hasSteps ? 'help' : 'default',
      }}
    >
      {score}
    </Box>
  );

  if (!hasSteps) return badge;

  const title = (
    <Box sx={{ py: 0.5 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
        How this danger index is calculated
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
