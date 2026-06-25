import { Box } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { ContractCard } from './ContractCard';
import { ArbitrageCard } from '@/features/arbitrage/components/ArbitrageCard';
import type { ResultCard } from '../combined';

/**
 * Nested MUI grid of mixed courier + arbitrage cards (denser now the page is
 * full-width: xs 12 / sm 6 / md 4 / lg 3). The server already truncates to the
 * top-N most attractive, so every shipped row is rendered — no paging.
 */
export function CombinedGrid({ rows, highlightedKey }: { rows: ResultCard[]; highlightedKey: string | null }) {
  return (
    <Box>
      {/* pt leaves room for the cards' pop-out attractivity bubbles */}
      <Grid container spacing={2} sx={{ pt: '10px' }}>
        {rows.map((card) => (
          <Grid
            key={card.key}
            id={`card-${card.key}`}
            xs={12}
            sm={6}
            md={4}
            lg={3}
            sx={{ scrollMarginTop: { xs: '64px', md: '80px' } }}
          >
            {card.kind === 'courier' || card.kind === 'pinned-courier' ? (
              <ContractCard row={card.row} isHighlighted={highlightedKey === card.key} />
            ) : (
              <ArbitrageCard row={card.row} isHighlighted={highlightedKey === card.key} />
            )}
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
