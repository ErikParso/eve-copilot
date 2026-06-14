import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import SouthIcon from '@mui/icons-material/South';
import { formatDuration, formatIsk, formatIskMillions, formatVolume } from '@/utils/format';
import type { CourierRow } from '../types';
import { LocationCell } from './LocationCell';
import { AttractivityCell } from './AttractivityCell';
import { DangerText } from './DangerCell';
import { RouteCell } from './RouteCell';

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

/** One courier contract rendered as a card for the results grid. */
export function ContractCard({ row }: { row: CourierRow }) {
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
      }}
    >
      {/* Attractivity score as a bubble popping out of the top-right corner */}
      <Box sx={{ position: 'absolute', top: -10, right: -10, zIndex: 1 }}>
        <AttractivityCell score={row.attractivity} steps={row.attractivitySteps} circle />
      </Box>

      <CardContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1, minWidth: 0 }}
      >
        {/* Keep the pickup line clear of the bubble */}
        <Box sx={{ pr: 4.5, minWidth: 0 }}>
          <LocationCell endpoint={row.pickup} />
        </Box>
        <SouthIcon sx={{ fontSize: 16, color: 'text.disabled', alignSelf: 'center', my: -0.5 }} />
        <LocationCell endpoint={row.dropoff} />

        <RouteCell row={row} trailing={<DangerText score={row.danger} steps={row.dangerSteps} />} />

        <Divider />

        <Stack spacing={0.5}>
          <Stat label="Income" value={formatIskMillions(row.reward)} />
          <Stat label="Collateral" value={formatIskMillions(row.collateral)} />
          <Stat label="Cargo" value={formatVolume(row.volume)} />
          <Stat
            label="ISK / jump"
            value={row.incomePerJump === null ? '—' : formatIsk(row.incomePerJump)}
          />
          <Stat label="Time left" value={formatDuration(row.remainingSeconds)} />
          <Stat label="To complete" value={`${row.daysToComplete} days`} />
        </Stack>
      </CardContent>
    </Card>
  );
}
