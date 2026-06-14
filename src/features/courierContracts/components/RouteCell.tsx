import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { formatNumber } from '@/utils/format';
import type { CourierRow } from '../types';
import { RouteSquares, type RouteNode } from './RouteSquares';

/**
 * The whole journey as one cell: an optional approach leg (current station →
 * pickup) followed by the delivery leg (pickup → dropoff), drawn as a single
 * strip of security-coloured squares with up/down arrows on the pickup and
 * dropoff systems. `trailing` renders to the right of the jump-count line.
 */
export function RouteCell({ row, trailing }: { row: CourierRow; trailing?: ReactNode }) {
  const { approachRoute, deliveryRoute, jumpsFromCurrent, jumpsToDropoff } = row;

  if (!deliveryRoute) return <>—</>;

  // Stitch approach + delivery, dropping the duplicated pickup system at the
  // seam. The pickup is the last approach system (or the first delivery one).
  const nodes: RouteNode[] = [];
  if (approachRoute) {
    approachRoute.forEach((system, i) => {
      // Last approach system is the pickup; the first is the current location
      // (unless they're the same system, in which case pickup wins).
      const marker = i === approachRoute.length - 1 ? 'pickup' : i === 0 ? 'current' : undefined;
      nodes.push({ system, marker });
    });
    deliveryRoute.slice(1).forEach((system, i) => {
      nodes.push({ system, marker: i === deliveryRoute.length - 2 ? 'dropoff' : undefined });
    });
  } else {
    deliveryRoute.forEach((system, i) => {
      const marker = i === 0 ? 'pickup' : i === deliveryRoute.length - 1 ? 'dropoff' : undefined;
      nodes.push({ system, marker });
    });
  }

  const label =
    jumpsFromCurrent !== null
      ? `${formatNumber(jumpsFromCurrent, 0)} + ${formatNumber(jumpsToDropoff ?? 0, 0)} jumps`
      : `${formatNumber(jumpsToDropoff ?? 0, 0)} jumps`;

  return (
    <Box>
      <Box
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}
      >
        <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
          {label}
        </Box>
        {trailing}
      </Box>
      <RouteSquares nodes={nodes} align="left" />
    </Box>
  );
}
