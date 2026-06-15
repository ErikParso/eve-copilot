import { memo } from 'react';
import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { formatIsk, formatIskMillions, formatNumber, formatVolume } from '@/utils/format';
import { LocationCell } from '@/features/courierContracts/components/LocationCell';
import { AttractivityCell } from '@/features/courierContracts/components/AttractivityCell';
import { DangerText } from '@/features/courierContracts/components/DangerCell';
import type { ContractEndpoint } from '@/features/courierContracts/types';
import type { ArbitrageRow } from '../types';
import { ArbitrageRouteCell } from './ArbitrageRouteCell';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right' }}>
        {value}
      </Typography>
    </Box>
  );
}

function Endpoint({ label, endpoint }: { label: string; endpoint: ContractEndpoint }) {
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 28, flexShrink: 0, mt: 0.25 }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <LocationCell endpoint={endpoint} />
      </Box>
    </Box>
  );
}

/** One arbitrage opportunity rendered as a card for the results grid. */
export const ArbitrageCard = memo(function ArbitrageCard({ row }: { row: ArbitrageRow }) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'visible',
      }}
    >
      <Box sx={{ position: 'absolute', top: -10, right: -10, zIndex: 1 }}>
        <AttractivityCell score={row.attractivity} steps={row.attractivitySteps} circle />
      </Box>

      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1, minWidth: 0 }}>
        {/* Profit headline (kept clear of the bubble) */}
        <Box sx={{ pr: 4.5, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            Profit
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, color: 'primary.main' }}>
            {formatIskMillions(row.profit)}
          </Typography>
          <Typography variant="caption" color="success.main" sx={{ fontWeight: 600 }}>
            {formatNumber(row.marginPct, 1)}% margin
          </Typography>
        </Box>

        <Divider />

        {/* Item + quantity to move */}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap title={row.itemName}>
            {row.itemName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatNumber(row.quantity, 0)} unit{row.quantity === 1 ? '' : 's'} · {formatVolume(row.totalVolume)}
          </Typography>
        </Box>

        <Endpoint label="Buy" endpoint={row.source} />
        <Endpoint label="Sell" endpoint={row.dest} />

        <ArbitrageRouteCell row={row} trailing={<DangerText score={row.danger} steps={row.dangerSteps} />} />

        <Divider />

        <Stack spacing={0.5}>
          <Stat label="Buy price" value={`${formatIsk(row.buyPrice)} / unit`} />
          <Stat label="Sell price" value={`${formatIsk(row.sellPrice)} / unit`} />
          <Stat label="Investment" value={formatIskMillions(row.buyCost)} />
          <Stat
            label="Profit / jump"
            value={row.profitPerJump === null ? '—' : formatIsk(row.profitPerJump)}
          />
        </Stack>
      </CardContent>
    </Card>
  );
});
