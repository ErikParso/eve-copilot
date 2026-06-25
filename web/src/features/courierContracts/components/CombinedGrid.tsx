import { useState } from 'react';
import { Box, Button } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { ContractCard } from './ContractCard';
import { ArbitrageCard } from '@/features/arbitrage/components/ArbitrageCard';
import { OpportunityCardSkeleton } from './OpportunityCardSkeleton';
import type { ResultCard } from '../combined';

/**
 * Nested MUI grid of mixed courier + arbitrage cards (denser now the page is
 * full-width: xs 12 / sm 6 / md 4 / lg 3). Show 12 cards initially, with a
 * "Show More" button at the bottom to load more.
 */
export function CombinedGrid({
  rows,
  highlightedKey,
  showSkeletons = false,
}: {
  rows: ResultCard[];
  highlightedKey: string | null;
  showSkeletons?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(12);

  const handleShowMore = () => {
    setVisibleCount((prev) => prev + 12);
  };

  const hasMore = rows.length > visibleCount;

  return (
    <Box>
      {/* pt leaves room for the cards' pop-out attractivity bubbles */}
      <Grid container spacing={2} sx={{ pt: '10px' }}>
        {rows.slice(0, visibleCount).map((card) => (
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
        {showSkeletons &&
          Array.from({ length: 3 }).map((_, idx) => (
            <Grid key={`skeleton-${idx}`} xs={12} sm={6} md={4} lg={3}>
              <OpportunityCardSkeleton />
            </Grid>
          ))}
      </Grid>

      {hasMore && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4, mb: 2 }}>
          <Button
            variant="outlined"
            onClick={handleShowMore}
            sx={{
              px: 4,
              py: 1,
              borderRadius: 2,
              fontWeight: 600,
            }}
          >
            Show More
          </Button>
        </Box>
      )}
    </Box>
  );
}

