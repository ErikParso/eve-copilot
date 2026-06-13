import { Box } from '@mui/material';

/** Colour from red (0) through amber to green (100). */
function scoreColor(score: number): string {
  const hue = Math.max(0, Math.min(100, score)) * 1.2; // 0 → red, 120 → green
  return `hsl(${hue}, 70%, 45%)`;
}

/** Attractivity index rendered as a colour-coded badge (0–100). */
export function AttractivityCell({ score }: { score: number }) {
  return (
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
        bgcolor: scoreColor(score),
      }}
    >
      {score}
    </Box>
  );
}
