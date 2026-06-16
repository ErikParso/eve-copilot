import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { formatNumber } from '@/utils/format';
import { RouteSquares, type RouteNode } from '@/features/courierContracts/components/RouteSquares';
import type { ArbitrageRow } from '../types';

/**
 * The whole journey as one strip of security-coloured squares: an optional
 * approach leg (current system → buy station) followed by the delivery leg
 * (buy → sell), with an up arrow on the buy system and a down arrow on the sell
 * system. `trailing` renders to the right of the jump-count line.
 */
export function ArbitrageRouteCell({ row, trailing }: { row: ArbitrageRow; trailing?: ReactNode }) {
  const { approachRoute, deliveryRoute, jumpsFromCurrent, jumpsToDest } = row;

  if (!deliveryRoute) return <>—</>;

  const nodes: RouteNode[] = [];
  if (approachRoute) {
    approachRoute.forEach((system, i) => {
      // Last approach system is the buy station; the first is the current location.
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
      ? `${formatNumber(jumpsFromCurrent, 0)} + ${formatNumber(jumpsToDest ?? 0, 0)} jumps`
      : `${formatNumber(jumpsToDest ?? 0, 0)} jumps`;

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
