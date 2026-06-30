import { Box, Button } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { ContractCard } from './ContractCard';
import { ArbitrageCard } from '@/features/arbitrage/components/ArbitrageCard';
import { PackageCard } from '@/features/packages/components/PackageCard';
import { OpportunityCardSkeleton } from './OpportunityCardSkeleton';
import type { ResultCard } from '../combined';

/**
 * Nested MUI grid of mixed courier + arbitrage cards (denser now the page is
 * full-width: xs 12 / sm 6 / md 4 / lg 3). Renders the pre-paginated visible rows
 * and shows a "Show More" button if hasMore is true.
 */
export function CombinedGrid({
  rows,
  highlightedKey,
  showSkeletons = false,
  skeletonCount = 8,
  hasMore = false,
  onShowMore,
}: {
  rows: ResultCard[];
  highlightedKey: string | null;
  showSkeletons?: boolean;
  skeletonCount?: number;
  hasMore?: boolean;
  onShowMore?: () => void;
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

      {hasMore && onShowMore && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4, mb: 2 }}>
          <Button
            variant="outlined"
            onClick={onShowMore}
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


