import { memo } from 'react';
import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { formatDuration, formatIsk, formatIskMillions, formatVolume } from '@/utils/format';
import courierBg from '@/assets/card-courier.jpg';
import type { CourierRow } from '../types';
import type { ContractEndpoint } from '../types';
import { LocationCell } from './LocationCell';
import { AttractivityCell } from './AttractivityCell';
import { DangerText } from './DangerCell';
import { RouteCell } from './RouteCell';
import { AddToPlanButton } from '@/features/copilot/components/AddToPlanButton';
import { courierRowToBasketItem } from '@/features/copilot/types';

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
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ width: 28, flexShrink: 0, mt: 0.25 }}
      >
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <LocationCell endpoint={endpoint} />
      </Box>
    </Box>
  );
}

/** One courier contract rendered as a card for the results grid. */
export const ContractCard = memo(function ContractCard({ row }: { row: CourierRow }) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        minWidth: 0, // allow the card to shrink so long names truncate
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'visible', // let the bubble pop out past the corner
        // Themed artwork as the card background, anchored top-left (no scrim yet —
        // legibility tuning comes later).
        backgroundImage: `url(${courierBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'left top',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Attractivity score as a bubble popping out of the top-right corner */}
      <Box sx={{ position: 'absolute', top: -10, right: -10, zIndex: 1 }}>
        <AttractivityCell score={row.attractivity} steps={row.attractivitySteps} circle />
      </Box>

      {/* Add-to-Copilot toggle in the top-left corner */}
      <Box sx={{ position: 'absolute', top: 4, left: 4, zIndex: 1 }}>
        <AddToPlanButton item={courierRowToBasketItem(row)} />
      </Box>

      <CardContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1, minWidth: 0 }}
      >
        {/* Total income headline (kept clear of the bubble) */}
        <Box sx={{ pr: 4.5, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            Reward
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, color: 'primary.main' }}>
            {formatIskMillions(row.reward)}
          </Typography>
        </Box>

        <Divider />

        <Endpoint label="From" endpoint={row.pickup} />
        <Endpoint label="To" endpoint={row.dropoff} />

        <RouteCell row={row} trailing={<DangerText score={row.danger} steps={row.dangerSteps} />} />

        <Divider />

        <Stack spacing={0.5}>
          <Stat label="Collateral" value={formatIskMillions(row.collateral)} />
          <Stat label="Cargo" value={formatVolume(row.volume)} />
          <Stat
            label="ISK / jump"
            value={row.incomePerJump === null ? '—' : formatIsk(row.incomePerJump)}
          />
          <Stat label="Listed for" value={formatDuration(row.ageSeconds)} />
          <Stat label="Time left" value={formatDuration(row.remainingSeconds)} />
          <Stat label="To complete" value={`${row.daysToComplete} days`} />
        </Stack>
      </CardContent>
    </Card>
  );
});
