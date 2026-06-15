import { useEffect, useState } from 'react';
import { Box, Button } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import type { ArbitrageRow } from '../types';
import { ArbitrageCard } from './ArbitrageCard';

const PAGE_SIZE = 12;

/** Nested MUI grid of arbitrage cards with a "load 12 more" button. */
export function ArbitrageGrid({ rows }: { rows: ArbitrageRow[] }) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [rows]);

  const shown = rows.slice(0, visible);

  return (
    <Box>
      {/* pt leaves room for the cards' pop-out attractivity bubbles */}
      <Grid container spacing={2} sx={{ pt: '10px' }}>
        {shown.map((row) => (
          <Grid key={row.id} xs={12} sm={12} md={6} lg={4}>
            <ArbitrageCard row={row} />
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
