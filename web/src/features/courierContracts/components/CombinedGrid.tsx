import { Box } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { ContractCard } from './ContractCard';
import { ArbitrageCard } from '@/features/arbitrage/components/ArbitrageCard';
import { PackageCard } from '@/features/packages/components/PackageCard';
import { OpportunityCardSkeleton } from './OpportunityCardSkeleton';
import type { ResultCard } from '../combined';

/**
 * Nested MUI grid of mixed courier + arbitrage cards (denser now the page is
 * full-width: xs 12 / sm 6 / md 4 / lg 3). Renders exactly the rows it's given —
 * paging is handled by the caller (the server ships one page at a time).
 */
export function CombinedGrid({
  rows,
  highlightedKey,
  showSkeletons = false,
  skeletonCount = 3,
}: {
  rows: ResultCard[];
  highlightedKey: string | null;
  showSkeletons?: boolean;
  skeletonCount?: number;
}) {
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
            ) : card.kind === 'package' || card.kind === 'pinned-package' ? (
              <PackageCard row={card.row} isHighlighted={highlightedKey === card.key} />
            ) : (
              <ArbitrageCard row={card.row} isHighlighted={highlightedKey === card.key} />
            )}
          </Grid>
        ))}
        {showSkeletons &&
          Array.from({ length: skeletonCount }).map((_, idx) => (
            <Grid key={`skeleton-${idx}`} xs={12} sm={6} md={4} lg={3}>
              <OpportunityCardSkeleton />
            </Grid>
          ))}
      </Grid>
    </Box>
  );
}


