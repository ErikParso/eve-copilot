import { useEffect, useState } from 'react';
import { Box, Button } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { ContractCard } from './ContractCard';
import { ArbitrageCard } from '@/features/arbitrage/components/ArbitrageCard';
import type { ResultCard } from '../combined';

const PAGE_SIZE = 12;

/**
 * Nested MUI grid of mixed courier + arbitrage cards (item size xs 12 / sm 12 /
 * md 6 / lg 4) with a "load 12 more" button.
 */
export function CombinedGrid({ rows }: { rows: ResultCard[] }) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Reset to the first page whenever a new result set arrives.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [rows]);

  const shown = rows.slice(0, visible);

  return (
    <Box>
      {/* pt leaves room for the cards' pop-out attractivity bubbles */}
      <Grid container spacing={2} sx={{ pt: '10px' }}>
        {shown.map((card) => (
          <Grid key={card.key} xs={12} sm={12} md={6} lg={4}>
            {card.kind === 'courier' ? (
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
            Load 12 more ({shown.length} of {rows.length})
          </Button>
        </Box>
      )}
    </Box>
  );
}
