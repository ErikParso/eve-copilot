import { memo, ReactNode } from 'react';
import { Box, Card, CardContent, Divider, Stack, Typography, Tooltip, IconButton, Button, alpha } from '@mui/material';
import { useAtomValue, useSetAtom } from 'jotai';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { pinnedCouriersAtom, pinCourierAtom, unpinCourierAtom, secureCourierAtom, executeCourierAtom } from '@/features/arbitrage/atoms';
import { formatDuration, formatIsk, formatIskMillions, formatVolume } from '@/utils/format';
import courierBg from '@/assets/card-courier.jpg';
import type { CourierRow } from '../types';
import type { ContractEndpoint } from '../types';
import { LocationCell } from './LocationCell';
import { AttractivityCell } from './AttractivityCell';
import { DangerText } from './DangerCell';
import { RouteCell } from './RouteCell';
import { WaypointButton } from '@/features/arbitrage/components/WaypointButton';
import { OpenContractButton } from './OpenContractButton';

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

function Endpoint({
  label,
  endpoint,
  action,
}: {
  label: string;
  endpoint: ContractEndpoint;
  action?: ReactNode;
}) {
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
      {action}
    </Box>
  );
}

/** One courier contract rendered as a card for the results grid. */
export const ContractCard = memo(function ContractCard({
  row,
  isHighlighted,
}: {
  row: CourierRow & { status?: 'planned' | 'secured' | 'executed'; unavailable?: boolean };
  isHighlighted?: boolean;
}) {
  const pinnedCouriers = useAtomValue(pinnedCouriersAtom);
  const pinCourier = useSetAtom(pinCourierAtom);
  const unpinCourier = useSetAtom(unpinCourierAtom);
  const secureCourier = useSetAtom(secureCourierAtom);
  const executeCourier = useSetAtom(executeCourierAtom);

  const isPinned = pinnedCouriers.some((c) => c.id === row.id);

  const handlePinClick = () => {
    if (isPinned) {
      unpinCourier(row.id);
    } else {
      pinCourier(row);
    }
  };

  const getRemainingSeconds = () => {
    if ('expiresAt' in row && typeof row.expiresAt === 'number') {
      return Math.max(0, (row.expiresAt - Date.now()) / 1000);
    }
    return row.remainingSeconds;
  };

  const getAgeSeconds = () => {
    if ('issuedAt' in row && typeof row.issuedAt === 'number') {
      return Math.max(0, (Date.now() - row.issuedAt) / 1000);
    }
    return row.ageSeconds;
  };

  const getPinnedBorderColor = () => {
    if (!isPinned) return undefined;
    if (row.unavailable) return 'error.main'; // Red if unavailable (taken by someone else)
    return 'success.main'; // Green if fresh or secured
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getHighlightColor = (theme: any) => {
    const colorKey = getPinnedBorderColor();
    if (!colorKey) return theme.palette.primary.main;
    const parts = colorKey.split('.');
    let node: unknown = theme.palette;
    for (const part of parts) {
      node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
    }
    return typeof node === 'string' ? node : theme.palette.primary.main;
  };

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
        borderColor: getPinnedBorderColor(),
        borderWidth: '1px',
        margin: '0px',
        boxShadow: (theme) => {
          if (isHighlighted) return undefined;
          if (!isPinned) return undefined;
          const color = getHighlightColor(theme);
          return `0 4px 12px rgba(0, 0, 0, 0.08), 0 0 8px ${alpha(color, 0.35)}`;
        },
        '@keyframes highlightPulse': {
          '0%': {
            boxShadow: (theme) => {
              const color = getHighlightColor(theme);
              return `0 0 6px ${alpha(color, 0.25)}, 0 4px 12px rgba(0, 0, 0, 0.08)`;
            },
          },
          '100%': {
            boxShadow: (theme) => {
              const color = getHighlightColor(theme);
              return `0 0 24px ${alpha(color, 0.7)}, 0 4px 12px rgba(0, 0, 0, 0.08)`;
            },
          },
        },
        animation: isHighlighted ? 'highlightPulse 0.5s ease-in-out 4 alternate' : undefined,
        transition: 'box-shadow 0.6s ease-out',
      }}
    >
      {/* Top-right actions: Pin button and Attractivity bubble */}
      <Box
        sx={{
          position: 'absolute',
          top: -10,
          right: -10,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Tooltip title={isPinned ? "Unpin contract" : "Pin contract"} arrow>
          <IconButton
            size="small"
            onClick={handlePinClick}
            sx={{
              color: isPinned ? 'primary.main' : 'text.secondary',
              bgcolor: 'background.paper',
              boxShadow: 2,
              border: '1px solid',
              borderColor: 'divider',
              width: 32,
              height: 32,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {isPinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>

        {!isPinned && (
          <AttractivityCell score={row.attractivity} steps={row.attractivitySteps} circle />
        )}
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

        {/* Package title */}
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`Package for ${row.dropoff.systemName ?? 'Unknown'}`}
            >
              {`Package for ${row.dropoff.systemName ?? 'Unknown'}`}
            </Typography>
            {isPinned && row.unavailable && (
              <Tooltip title="Contract Unavailable: No longer in public EVE feed. It may have been accepted, cancelled, or expired." arrow>
                <WarningAmberIcon sx={{ fontSize: 18, color: 'error.main', cursor: 'help' }} />
              </Tooltip>
            )}
            <OpenContractButton contractId={row.id} />
          </Box>
          <Typography variant="caption" color="text.secondary">
            {`1 units · ${formatVolume(row.volume)}`}
          </Typography>
        </Box>

        {row.status === 'secured' ? (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 28, flexShrink: 0, mt: 0.25 }}>
              From
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main', mt: 0.25 }}>
              In ship
            </Typography>
          </Box>
        ) : (
          <Endpoint
            label="From"
            endpoint={row.pickup}
            action={<WaypointButton endpoint={row.pickup} add={false} />}
          />
        )}
        <Endpoint
          label="To"
          endpoint={row.dropoff}
          action={<WaypointButton endpoint={row.dropoff} add={true} />}
        />

        <RouteCell row={row} trailing={<DangerText score={row.danger} steps={row.dangerSteps} />} />

        <Divider />

        <Stack spacing={0.5}>
          <Stat label="Collateral" value={formatIskMillions(row.collateral)} />
          <Stat
            label="ISK / jump"
            value={row.incomePerJump === null ? '—' : formatIsk(row.incomePerJump)}
          />
          <Stat label="Listed for" value={formatDuration(getAgeSeconds())} />
          <Stat label="Time left" value={formatDuration(getRemainingSeconds())} />
          <Stat label="To complete" value={`${row.daysToComplete} days`} />
        </Stack>

        {/* Action buttons for Pinned Courier Mode */}
        {isPinned && (
          <Box sx={{ mt: 'auto', pt: 1.25 }}>
            {row.status === 'secured' ? (
              <Button
                variant="contained"
                color="success"
                size="small"
                fullWidth
                onClick={() => executeCourier(row.id)}
                startIcon={<CheckCircleOutlineIcon />}
              >
                Confirm Deliver
              </Button>
            ) : row.status === 'executed' ? (
              <Button
                variant="contained"
                color="success"
                size="small"
                fullWidth
                disabled
                startIcon={<CheckCircleOutlineIcon />}
              >
                Executed
              </Button>
            ) : (
              <Button
                variant="outlined"
                size="small"
                fullWidth
                onClick={() => secureCourier(row.id)}
                sx={{
                  borderColor: row.unavailable ? 'error.main' : 'primary.main',
                  color: row.unavailable ? 'error.main' : 'primary.main',
                  '&:hover': {
                    borderColor: row.unavailable ? 'error.light' : 'primary.light',
                    bgcolor: row.unavailable ? 'rgba(211, 47, 47, 0.05)' : undefined,
                  }
                }}
              >
                Confirm Accept
              </Button>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
});
