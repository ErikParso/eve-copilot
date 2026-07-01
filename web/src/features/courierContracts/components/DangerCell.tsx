import { Box, Tooltip, Typography } from '@mui/material';

/** Colour from green (0, safe) through amber to red (100, deadly). */
export function dangerColor(score: number): string {
  const hue = (100 - Math.max(0, Math.min(100, score))) * 1.2; // 0 → green, 100 → red
  return `hsl(${hue}, 70%, 55%)`;
}

interface DangerTextProps {
  score: number | null;
  /** Step-by-step calculation of this row's danger index (with real numbers). */
  steps?: string[];
}

/** Danger index as a small "Danger NN" label, the number coloured by risk. */
export function DangerText({ score, steps }: DangerTextProps) {
  const hasSteps = !!steps && steps.length > 0;

  const content = (
    <Typography
      variant="caption"
      sx={{ display: 'inline-flex', gap: 0.5, cursor: hasSteps && score !== null ? 'help' : 'default' }}
    >
      <Box component="span" sx={{ color: 'text.secondary' }}>
        Danger
      </Box>
      <Box component="span" sx={{ fontWeight: 700, color: score === null ? 'text.disabled' : dangerColor(score) }}>
        {score === null ? '—' : score}
      </Box>
    </Typography>
  );

  if (score === null || !hasSteps) return content;

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
      {content}
    </Tooltip>
  );
}
