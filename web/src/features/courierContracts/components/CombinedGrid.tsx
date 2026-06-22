import { useEffect, useState } from 'react';
import { Box, Button } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { ContractCard } from './ContractCard';
import { ArbitrageCard } from '@/features/arbitrage/components/ArbitrageCard';
import type { ResultCard } from '../combined';

const PAGE_SIZE = 16;

/**
 * Nested MUI grid of mixed courier + arbitrage cards (denser now the page is
 * full-width: xs 12 / sm 6 / md 4 / lg 3) with a "load more" button.
 */
export function CombinedGrid({ rows }: { rows: ResultCard[] }) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Reset to the first page only when the set or order of items changes.
  const keysStr = rows.map((r) => r.key).join(',');
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [keysStr]);

  const shown = rows.slice(0, visible);

  return (
    <Box>
      {/* pt leaves room for the cards' pop-out attractivity bubbles */}
      <Grid container spacing={2} sx={{ pt: '10px' }}>
        {shown.map((card) => (
          <Grid key={card.key} xs={12} sm={6} md={4} lg={3}>
            {card.kind === 'courier' || card.kind === 'pinned-courier' ? (
              <ContractCard row={card.row} />
            ) : (
              <ArbitrageCard row={card.row} />
            )}
          </Grid>
        ))}
      </Grid>

      {visible < rows.length && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Button variant="outlined" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Load more ({shown.length} of {rows.length})
          </Button>
        </Box>
      )}
    </Box>
  );
}
