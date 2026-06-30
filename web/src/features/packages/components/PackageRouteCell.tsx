import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { formatNumber } from '@/utils/format';
import { RouteSquares, type RouteNode } from '@/features/courierContracts/components/RouteSquares';
import type { PackageRow } from '../types';

/**
 * The whole journey as one strip of security-coloured squares — the package
 * analogue of ArbitrageRouteCell: an optional approach leg (current system →
 * source station) then the delivery leg (source → dest), with up/down markers.
 * `trailing` renders to the right of the jump-count line. When the package is in
 * transit (Phase 2), the approach leg is omitted.
 */
export function PackageRouteCell({ row, trailing }: { row: PackageRow & { status?: string }; trailing?: ReactNode }) {
  const { approachRoute, deliveryRoute, jumpsFromCurrent, jumpsToDest } = row;

  if (!deliveryRoute) return <>—</>;

  const isTransit = 'status' in row && row.status === 'transit';

  const nodes: RouteNode[] = [];
  if (approachRoute && !isTransit) {
    approachRoute.forEach((system, i) => {
      const marker = i === approachRoute.length - 1 ? 'pickup' : i === 0 ? 'current' : undefined;
      nodes.push({ system, marker });
    });
    deliveryRoute.slice(1).forEach((system, i) => {
      nodes.push({ system, marker: i === deliveryRoute.length - 2 ? 'dropoff' : undefined });
    });
  } else {
    deliveryRoute.forEach((system, i) => {
      const marker = i === 0 ? (isTransit ? 'current' : 'pickup') : i === deliveryRoute.length - 1 ? 'dropoff' : undefined;
      nodes.push({ system, marker });
    });
  }

  const label =
    jumpsFromCurrent !== null && !isTransit
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
