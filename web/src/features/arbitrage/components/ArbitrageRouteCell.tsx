import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { formatNumber } from '@/utils/format';
import { RouteSquares, type RouteNode } from '@/features/courierContracts/components/RouteSquares';
import type { ArbitrageRow } from '../types';

/**
 * The haul (source → destination) as one strip of security-coloured squares,
 * with an up arrow on the buy system and a down arrow on the sell system.
 * `trailing` renders to the right of the jump-count line.
 */
export function ArbitrageRouteCell({ row, trailing }: { row: ArbitrageRow; trailing?: ReactNode }) {
  if (!row.route) return <>—</>;

  const last = row.route.length - 1;
  const nodes: RouteNode[] = row.route.map((system, i) => ({
    system,
    marker: i === 0 ? 'pickup' : i === last ? 'dropoff' : undefined,
  }));

  const label = `${formatNumber(row.jumps ?? 0, 0)} jump${row.jumps === 1 ? '' : 's'}`;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
        <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
          {label}
        </Box>
        {trailing}
      </Box>
      <RouteSquares nodes={nodes} align="left" />
    </Box>
  );
}
