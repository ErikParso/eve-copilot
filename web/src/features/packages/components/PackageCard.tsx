import { useState, useRef, useEffect, memo, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Box, Card, CardContent, Divider, Stack, Tooltip, Typography, IconButton, Button, alpha } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RemoveIcon from '@mui/icons-material/Remove';
import SegmentIcon from '@mui/icons-material/Segment';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import MapIcon from '@mui/icons-material/Map';
import { formatIsk, formatIskMillions, formatNumber, formatVolume } from '@/utils/format';
import packageBg from '@/assets/card-package.png';
import { LocationCell } from '@/features/courierContracts/components/LocationCell';
import { AttractivityCell } from '@/features/courierContracts/components/AttractivityCell';
import { DangerText } from '@/features/courierContracts/components/DangerCell';
import { OpenMarketButton } from '@/features/arbitrage/components/OpenMarketButton';
import { WaypointButton } from '@/features/arbitrage/components/WaypointButton';
import type { ContractEndpoint } from '@/features/courierContracts/types';
import type { PackageRow } from '../types';
import { PackageRouteCell } from './PackageRouteCell';
import {
  PinnedPackage,
  pinnedPackagesAtom,
  pinPackageAtom,
  unpinPackageAtom,
  confirmBuyPackageAtom,
  executePackageAtom,
} from '../atoms';
import { PackageSellDestinationsModal } from './PackageSellDestinationsModal';

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right', color }}>
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

function Endpoint({ label, endpoint, action }: { label: string; endpoint: ContractEndpoint; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 28, flexShrink: 0, mt: 0.25 }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <LocationCell endpoint={endpoint} />
      </Box>
      {action}
    </Box>
  );
}

/** Per-line contents breakdown shown in the package tooltip. */
const ContentsBreakdownTooltip = ({ row }: { row: PackageRow | PinnedPackage }) => {
  return (
    <Box sx={{ p: 0.5, minWidth: 280 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, borderBottom: '1px solid rgba(255,255,255,0.2)', pb: 0.5 }}>
        Package Contents ({row.contents.length} {row.contents.length === 1 ? 'type' : 'types'})
      </Typography>
      <Stack spacing={0.75}>
        {row.contents.map((line, i) => {
          const unsellable = line.isBlueprintCopy || line.sellValue <= 0;
          return (
            <Box key={i} sx={{ display: 'flex', gap: 2, justifyContent: 'space-between', opacity: unsellable ? 0.55 : 1 }}>
              <Typography variant="caption" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formatNumber(line.quantity, 0)}× {line.itemName}
                {line.isBlueprintCopy ? ' (BPC)' : ''}
              </Typography>
              <Typography
                variant="caption"
                sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', color: unsellable ? 'text.disabled' : 'success.light' }}
              >
                {unsellable
                  ? "can't sell"
                  : `${formatIsk(line.sellValue)}${line.soldQuantity < line.quantity ? ` (${formatNumber(line.soldQuantity, 0)}/${formatNumber(line.quantity, 0)})` : ''}`}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
};

/** One sell-contract (package) opportunity rendered as a card — the visual +
 *  functional twin of ArbitrageCard, adapted for a fixed-price, multi-item bundle
 *  (Confirm-Buy is one click; there's no per-unit buy dialog). */
export const PackageCard = memo(function PackageCard({
  row,
  isHighlighted,
  variant = 'default',
  onSelect,
}: {
  row: PackageRow | PinnedPackage;
  isHighlighted?: boolean;
  /** 'sell' renders a liquidation alternative: buy side is "In ship" and the pin
   *  control is hidden (you pick it via "Redirect Here" instead). */
  variant?: 'default' | 'sell';
  onSelect?: (option: PackageRow) => void;
}) {
  const isSell = variant === 'sell';
  const pinnedPackages = useAtomValue(pinnedPackagesAtom);
  const pinPackage = useSetAtom(pinPackageAtom);
  const unpinPackage = useSetAtom(unpinPackageAtom);
  const confirmBuy = useSetAtom(confirmBuyPackageAtom);
  const executePackage = useSetAtom(executePackageAtom);

  const isPinned = pinnedPackages.some((p) => p.id === row.id);
  const [sellModalOpen, setSellModalOpen] = useState(false);

  // Pulse the card border when the server returns a changed profit value.
  const prevProfitRef = useRef<number | undefined>(undefined);
  const [isPulsing, setIsPulsing] = useState(false);
  const profit = row.profit;
  useEffect(() => {
    if (prevProfitRef.current !== undefined && prevProfitRef.current !== profit) {
      setIsPulsing(true);
      const timer = setTimeout(() => setIsPulsing(false), 4000);
      return () => clearTimeout(timer);
    }
    prevProfitRef.current = profit;
  }, [profit]);
  useEffect(() => {
    prevProfitRef.current = profit;
  });

  const isPinnedMode = 'status' in row;
  const pkgStatus = isPinnedMode ? (row as PinnedPackage).status : null;
  const isTransit = pkgStatus === 'transit';
  const pinnedWithLive = isPinnedMode ? (row as PinnedPackage) : null;
  const statusKind = pinnedWithLive?.statusKind ?? null;
  const statusMessage = pinnedWithLive?.statusMessage ?? '';

  const totalUnits = row.contents.reduce((s, l) => s + l.quantity, 0);
  const soldUnits = row.contents.reduce((s, l) => s + l.soldQuantity, 0);
  const breakdownTooltip = <ContentsBreakdownTooltip row={row} />;

  const handlePinClick = () => {
    if (isPinned) unpinPackage(row.id);
    else pinPackage(row as PackageRow);
  };

  const getPinnedBorderColor = () => (isPinnedMode ? pinnedWithLive?.borderColor ?? 'primary.main' : undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getHighlightColor = (theme: any) => {
    const colorKey = getPinnedBorderColor();
    if (!colorKey) return theme.palette.primary.main;
    let node: unknown = theme.palette;
    for (const part of colorKey.split('.')) {
      node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
    }
    return typeof node === 'string' ? node : theme.palette.primary.main;
  };

  return (
    <>
      <Card
        variant="outlined"
        sx={{
          height: '100%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'visible',
          backgroundImage: `url(${packageBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'left top',
          backgroundRepeat: 'no-repeat',
          borderColor: getPinnedBorderColor(),
          borderWidth: '1px',
          margin: '0px',
          boxShadow: (theme) => {
            if (isHighlighted || !isPinnedMode) return undefined;
            const color = getHighlightColor(theme);
            return `0 4px 12px rgba(0, 0, 0, 0.08), 0 0 8px ${alpha(color, 0.35)}`;
          },
          '@keyframes highlightPulse': {
            '0%': {
              boxShadow: (theme) => `0 0 6px ${alpha(getHighlightColor(theme), 0.25)}, 0 4px 12px rgba(0, 0, 0, 0.08)`,
            },
            '100%': {
              boxShadow: (theme) => `0 0 24px ${alpha(getHighlightColor(theme), 0.7)}, 0 4px 12px rgba(0, 0, 0, 0.08)`,
            },
          },
          animation: isHighlighted || isPulsing ? 'highlightPulse 0.5s ease-in-out 4 alternate' : undefined,
          transition: 'box-shadow 0.6s ease-out',
        }}
      >
        {/* Top-right: Pin button + Attractivity bubble */}
        <Box sx={{ position: 'absolute', top: -10, right: -10, zIndex: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          {!isSell && (
            <Tooltip title={isPinned ? 'Unpin package' : 'Pin package'} arrow>
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
          )}
          {!isPinned && <AttractivityCell score={'attractivity' in row ? row.attractivity : 0} steps={[]} circle />}
        </Box>

        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1, minWidth: 0 }}>
          {/* Profit headline */}
          <Box sx={{ pr: 5, minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              {isSell ? 'Income if sold here' : 'Expected Profit'}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, color: profit <= 0 ? 'error.main' : 'primary.main' }}>
              {formatIskMillions(profit)}
            </Typography>
            <Typography variant="caption" color={row.marginPct < 0 ? 'error.main' : 'success.main'} sx={{ fontWeight: 600 }}>
              {formatNumber(row.marginPct, 1)}% margin
            </Typography>
          </Box>

          <Divider />

          {/* Package + contents */}
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
              <Inventory2OutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Package · {row.contents.length} {row.contents.length === 1 ? 'item type' : 'item types'}
              </Typography>
              {statusKind === 'up' && (
                <Tooltip title={statusMessage} arrow>
                  <ArrowUpwardIcon sx={{ fontSize: 18, color: 'success.main', cursor: 'help' }} />
                </Tooltip>
              )}
              {(statusKind === 'down' || statusKind === 'zero') && (
                <Tooltip title={statusMessage} arrow>
                  <ArrowDownwardIcon sx={{ fontSize: 18, color: statusKind === 'zero' ? 'error.main' : 'warning.main', cursor: 'help' }} />
                </Tooltip>
              )}
              {isPinnedMode && statusKind === null && (
                <Tooltip title="Income of this package didn't change yet" arrow>
                  <RemoveIcon sx={{ fontSize: 18, color: 'primary.main', cursor: 'help' }} />
                </Tooltip>
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {`${formatNumber(totalUnits, 0)} unit${totalUnits === 1 ? '' : 's'}`} · {formatVolume(row.totalVolume)}
              </Typography>
              <Tooltip arrow title={breakdownTooltip} slotProps={{ tooltip: { sx: { maxWidth: 'none' } } }}>
                <SegmentIcon sx={{ fontSize: 13, color: 'text.secondary', cursor: 'help', opacity: 0.8, '&:hover': { opacity: 1 } }} />
              </Tooltip>
            </Box>
          </Box>

          {/* Endpoints */}
          {isTransit || isSell ? (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ width: 28, flexShrink: 0, mt: 0.25 }}>
                Buy
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main', mt: 0.25 }}>
                In ship
              </Typography>
            </Box>
          ) : (
            <Endpoint label="Buy" endpoint={row.source} action={<WaypointButton endpoint={row.source} add={false} />} />
          )}
          <Endpoint label="Sell" endpoint={row.dest} action={<WaypointButton endpoint={row.dest} add={true} />} />

          <PackageRouteCell row={row as PackageRow & { status?: string }} trailing={<DangerText score={row.danger} steps={row.dangerSteps} />} />

          <Divider />

          {/* Stats list */}
          <Stack spacing={0.5}>
            <Stat label="Price (you pay)" value={formatIskMillions(row.price)} />
            <Stat label="Sale value (you get)" value={formatIskMillions(row.sellValue)} />
            <Stat
              label="Items sellable"
              value={`${formatNumber(soldUnits, 0)} / ${formatNumber(totalUnits, 0)}`}
              color={soldUnits < totalUnits ? 'warning.main' : undefined}
            />
          </Stack>

          {/* Open the first item's market (a convenience; full list in the tooltip). */}
          {!isPinnedMode && !isSell && row.contents[0] && (
            <Box sx={{ pt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Open market:
              </Typography>
              <OpenMarketButton typeId={row.contents[0].typeId} />
            </Box>
          )}

          {/* Pinned action buttons */}
          {isPinnedMode && (
            <Box sx={{ mt: 'auto', pt: 1, display: 'flex', gap: 1 }}>
              {pkgStatus === 'transit' ? (
                <Box sx={{ display: 'flex', gap: 1, width: '100%' }}>
                  <Button variant="contained" color="success" size="small" sx={{ flex: 1 }} startIcon={<CheckCircleOutlineIcon />} onClick={() => executePackage(row.id)}>
                    Confirm Sell
                  </Button>
                  <Button variant="outlined" color="primary" size="small" sx={{ flex: 1 }} startIcon={<MapIcon />} onClick={() => setSellModalOpen(true)}>
                    Sell Elsewhere
                  </Button>
                </Box>
              ) : pkgStatus === 'executed' ? (
                <Button variant="contained" color="success" size="small" fullWidth disabled startIcon={<CheckCircleOutlineIcon />}>
                  Executed
                </Button>
              ) : (
                <Button variant="outlined" size="small" fullWidth onClick={() => confirmBuy(row.id)}>
                  Confirm Buy
                </Button>
              )}
            </Box>
          )}

          {/* Sell-variant redirect */}
          {isSell && onSelect && (
            <Box sx={{ mt: 'auto', pt: 1 }}>
              <Button variant="contained" color="primary" size="small" fullWidth onClick={() => onSelect(row as PackageRow)}>
                Redirect Here
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>

      {isPinnedMode && pkgStatus === 'transit' && (
        <PackageSellDestinationsModal open={sellModalOpen} onClose={() => setSellModalOpen(false)} pkg={row as PinnedPackage} />
      )}
    </>
  );
});
