import { useState, memo, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Box, Card, CardContent, Divider, Stack, Tooltip, Typography, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, alpha } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SegmentIcon from '@mui/icons-material/Segment';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { formatIsk, formatIskMillions, formatNumber, formatVolume } from '@/utils/format';
import arbitrageBg from '@/assets/card-arbitrage.jpg';
import { LocationCell } from '@/features/courierContracts/components/LocationCell';
import { AttractivityCell } from '@/features/courierContracts/components/AttractivityCell';
import { DangerText } from '@/features/courierContracts/components/DangerCell';
import type { ContractEndpoint } from '@/features/courierContracts/types';
import type { ArbitrageRow, ArbitrageItem } from '../types';
import { ArbitrageRouteCell } from './ArbitrageRouteCell';
import { OpenMarketButton } from './OpenMarketButton';
import { WaypointButton } from './WaypointButton';
import { PinnedHaul, pinnedHaulsAtom, pinHaulAtom, unpinHaulAtom, confirmBuyHaulAtom, executeHaulAtom } from '../atoms';
import MapIcon from '@mui/icons-material/Map';
import { SellDestinationsModal } from './SellDestinationsModal';

// Paying more than this multiple of the item's reference market value at the
// source is the real exposure: if the destination sale falls through (e.g. a
// bait buy order cancelled before you haul there), you're left holding stock
// worth ~market value but bought for more — a guaranteed loss. A buy at or below
// market protects you regardless, since you can always liquidate near cost.
const RISKY_BUY_FACTOR = 1.05; // flag paying >5% above market value

/** True when you're overpaying at the source vs the item's market value. */
function isOverpaying(buyPrice: number, marketPrice: number | null): boolean {
  return marketPrice !== null && marketPrice > 0 && buyPrice > marketPrice * RISKY_BUY_FACTOR;
}

function Stat({
  label,
  value,
  color,
  adornment,
  tooltip,
}: {
  label: string;
  value: string;
  color?: string;
  adornment?: ReactNode;
  tooltip?: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        {adornment}
        <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right', color }}>
          {value}
        </Typography>
        {tooltip && (
          <Tooltip arrow title={tooltip} slotProps={{ tooltip: { sx: { maxWidth: 'none' } } }}>
            <SegmentIcon sx={{ fontSize: 13, color: 'text.secondary', cursor: 'help', opacity: 0.8, '&:hover': { opacity: 1 } }} />
          </Tooltip>
        )}
      </Box>
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
  /** Optional trailing control (e.g. open the in-game Market at the buy station). */
  action?: ReactNode;
}) {
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

interface DisplayRung {
  units: number;
  buy: number;
  sell: number;
}

function getDisplayRungs(row: ArbitrageRow): DisplayRung[] {
  let remaining = row.quantity;
  const displayRungs: DisplayRung[] = [];
  let ladderBuyCost = 0;
  let ladderSellGross = 0;

  for (const rung of row.ladder) {
    if (remaining <= 0) break;
    const take = Math.min(rung.units, remaining);
    displayRungs.push({ units: take, buy: rung.buy, sell: rung.sell });
    remaining -= take;
    ladderBuyCost += take * rung.buy;
    ladderSellGross += take * rung.sell;
  }

  if (remaining > 0) {
    const tailUnits = remaining;
    const totalSellGross = row.sellPrice * row.quantity;
    const tailBuyCost = Math.max(0, row.buyCost - ladderBuyCost);
    const tailSellGross = Math.max(0, totalSellGross - ladderSellGross);
    displayRungs.push({
      units: tailUnits,
      buy: tailBuyCost / tailUnits,
      sell: tailSellGross / tailUnits,
    });
  }

  return displayRungs;
}

const RungBreakdownTooltip = ({ rungs }: { rungs: DisplayRung[] }) => {
  return (
    <Box sx={{ p: 0.5 }}>
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 700,
          mb: 1,
          borderBottom: '1px solid rgba(255,255,255,0.2)',
          pb: 0.5,
        }}
      >
        Order Depth Breakdown
      </Typography>
      <Stack spacing={0.75}>
        {rungs.map((r, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 2, justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
              {formatNumber(r.units, 0)} units
            </Typography>
            <Typography variant="caption" sx={{ color: 'warning.light', fontFamily: 'monospace' }}>
              Buy: {formatIsk(r.buy)}
            </Typography>
            <Typography variant="caption" sx={{ color: 'success.light', fontFamily: 'monospace' }}>
              Sell: {formatIsk(r.sell)}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  );
};

/** One arbitrage opportunity rendered as a card for the results grid. */
export const ArbitrageCard = memo(function ArbitrageCard({
  row,
  isHighlighted,
  variant = 'default',
  onSelect,
}: {
  row: ArbitrageRow | PinnedHaul;
  isHighlighted?: boolean;
  /** 'sell' renders a liquidation alternative: buy side is "In ship", profit goes
   *  red when ≤ 0, and the pin control is hidden (you set a waypoint instead). */
  variant?: 'default' | 'sell';
  onSelect?: (option: ArbitrageRow) => void;
}) {
  const isSell = variant === 'sell';
  const pinnedHauls = useAtomValue(pinnedHaulsAtom);
  const pinHaul = useSetAtom(pinHaulAtom);
  const unpinHaul = useSetAtom(unpinHaulAtom);
  const confirmBuy = useSetAtom(confirmBuyHaulAtom);
  const executeHaul = useSetAtom(executeHaulAtom);

  const pinnedItem = pinnedHauls.find((h) => h.id === row.id);
  const isPinned = !!pinnedItem;
  
  // Dialog state
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [confirmQty, setConfirmQty] = useState(String(row.quantity));
  const [confirmPrice, setConfirmPrice] = useState(String(row.buyPrice));
  const [confirmTotal, setConfirmTotal] = useState(String((row.quantity * row.buyPrice) / 1_000_000));

  const handlePinClick = () => {
    if (isPinned) {
      unpinHaul(row.id);
    } else {
      pinHaul(row as ArbitrageItem);
    }
  };

  const handleOpenBuyDialog = () => {
    // Default to the values captured when pinned, not the live (re-optimized)
    // ones — the live qty/price may have collapsed to 0 precisely because you
    // bought the stock yourself. You can still adjust to what you actually paid.
    const pin = row as PinnedHaul;
    const qty = pin.originalQuantity ?? row.quantity;
    const price = pin.originalBuyPrice ?? row.buyPrice;
    setConfirmQty(String(qty));
    setConfirmPrice(String(price));
    setConfirmTotal(String((qty * price) / 1_000_000));
    setBuyDialogOpen(true);
  };

  const handleQtyChange = (val: string) => {
    setConfirmQty(val);
    const qty = Number(val) || 0;
    const price = Number(confirmPrice) || 0;
    setConfirmTotal(String((qty * price) / 1_000_000));
  };

  const handlePriceChange = (val: string) => {
    setConfirmPrice(val);
    const price = Number(val) || 0;
    const qty = Number(confirmQty) || 0;
    setConfirmTotal(String((qty * price) / 1_000_000));
  };

  const handleTotalChange = (val: string) => {
    setConfirmTotal(val);
    const totalM = Number(val) || 0;
    const qty = Number(confirmQty) || 0;
    if (qty > 0) {
      setConfirmPrice(String((totalM * 1_000_000) / qty));
    }
  };

  const handleConfirmBuy = () => {
    const pin = row as PinnedHaul;
    const qty = Number(confirmQty) || pin.originalQuantity || row.quantity;
    const price = Number(confirmPrice) || pin.originalBuyPrice || row.buyPrice;
    confirmBuy({ id: row.id, qty, price });
    setBuyDialogOpen(false);
  };

  const handleConfirmSell = () => {
    executeHaul(row.id);
  };

  // Determine current active status & statistics
  const isPinnedMode = 'status' in row;
  const haulStatus = isPinnedMode ? (row as PinnedHaul).status : null;
  const isTransit = haulStatus === 'transit';
  
  // Baseline stats to display
  const dispQty = row.quantity;
  const dispBuyPrice = 'buyPrice' in row ? row.buyPrice : 0;
  const dispSellPrice = row.sellPrice;
  const dispBuyCost = row.buyCost ?? (dispQty * dispBuyPrice);
  const dispProfit = row.profit;
  const dispMarginPct = row.marginPct;
  const dispVolume = dispQty * row.unitVolume;

  const pinnedWithLive = isPinnedMode ? (row as PinnedHaul) : null;
  const statusKind = pinnedWithLive?.statusKind ?? null;
  const statusMessage = pinnedWithLive?.statusMessage ?? '';
  const incomeZero = statusKind === 'zero';

  const overpaying = isOverpaying(dispBuyPrice, row.marketPrice);
  const overValue =
    row.marketPrice && row.marketPrice > 0 ? dispBuyPrice / row.marketPrice : null;
  const overpayWarning =
    `You'd pay ${formatNumber(overValue ?? 0, 1)}× the item's market value ` +
    `(${formatIsk(row.marketPrice ?? 0)} / unit) at the source. If the destination sale ` +
    `falls through — e.g. a bait buy order cancelled before you arrive — you'd be left ` +
    `holding stock worth less than you paid, a real loss. A buy below market value would ` +
    `protect you. Verify the deal before committing.`;

  const displayRungs = getDisplayRungs(row as ArbitrageRow);
  const breakdownTooltip = <RungBreakdownTooltip rungs={displayRungs} />;

  const getPinnedBorderColor = () => {
    if (!isPinnedMode) return undefined;
    return pinnedWithLive?.borderColor ?? 'primary.main';
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
          backgroundImage: `url(${arbitrageBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'left top',
          backgroundRepeat: 'no-repeat',
          borderColor: getPinnedBorderColor(),
          borderWidth: '1px',
          margin: '0px',
          boxShadow: (theme) => {
            if (isHighlighted) return undefined;
            if (!isPinnedMode) return undefined;
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
          {!isSell && (
            <Tooltip title={isPinned ? "Unpin opportunity" : "Pin opportunity"} arrow>
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

          {!isPinned && (
            <AttractivityCell score={'attractivity' in row ? row.attractivity : 0} steps={'attractivitySteps' in row ? row.attractivitySteps : []} circle />
          )}
        </Box>

        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1, minWidth: 0 }}>
          {/* Profit headline */}
          <Box sx={{ pr: 5, minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              {isSell ? 'Income if sold here' : 'Expected Profit'}
            </Typography>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                lineHeight: 1.2,
                color: incomeZero || (isSell && dispProfit <= 0) ? 'error.main' : 'primary.main',
              }}
            >
              {incomeZero ? '0.00 ISK' : formatIskMillions(dispProfit)}
            </Typography>
            <Typography variant="caption" color={isSell && dispMarginPct < 0 ? 'error.main' : 'success.main'} sx={{ fontWeight: 600 }}>
              {formatNumber(dispMarginPct, 1)}% margin
            </Typography>
          </Box>

          <Divider />

          {/* Item + quantity to move */}
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
                title={row.itemName}
              >
                {row.itemName}
              </Typography>
              {statusKind === 'up' && (
                <Tooltip title={statusMessage} arrow>
                  <ArrowUpwardIcon sx={{ fontSize: 18, color: 'success.main', cursor: 'help' }} />
                </Tooltip>
              )}
              {(statusKind === 'down' || statusKind === 'zero') && (
                <Tooltip title={statusMessage} arrow>
                  <ArrowDownwardIcon
                    sx={{ fontSize: 18, color: statusKind === 'zero' ? 'error.main' : 'warning.main', cursor: 'help' }}
                  />
                </Tooltip>
              )}
              <OpenMarketButton typeId={row.typeId} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {`${formatNumber(dispQty, 0)} unit${dispQty === 1 ? '' : 's'}`} · {formatVolume(dispVolume)}
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

          {'danger' in row && (
            <ArbitrageRouteCell row={row as ArbitrageRow} trailing={<DangerText score={row.danger} steps={row.dangerSteps} />} />
          )}



          <Divider />

          {/* Stats list */}
          <Stack spacing={0.5}>
            <Stat
              label={isTransit ? "Buy price (Paid)" : "Buy (you pay)"}
              value={`${formatIsk(dispBuyPrice)} / unit`}
              color={overpaying ? 'warning.main' : undefined}
              adornment={
                overpaying && !isTransit ? (
                  <Tooltip arrow title={overpayWarning}>
                    <WarningAmberIcon sx={{ fontSize: 16, color: 'warning.main', cursor: 'help' }} />
                  </Tooltip>
                ) : undefined
              }
            />
            <Stat label="Sell (you get)" value={`${formatIsk(dispSellPrice)} / unit`} />
            <Stat
              label="Market value"
              value={row.marketPrice === null ? '—' : `${formatIsk(row.marketPrice)} / unit`}
            />
            <Stat label="Investment" value={formatIskMillions(dispBuyCost)} />
          </Stack>

          {/* Action buttons at the bottom of pinned cards */}
          {isPinnedMode && (
            <Box sx={{ mt: 'auto', pt: 1, display: 'flex', gap: 1 }}>
              {haulStatus === 'transit' ? (
                <Box sx={{ display: 'flex', gap: 1, width: '100%' }}>
                  <Button
                    variant="contained"
                    color="success"
                    size="small"
                    sx={{ flex: 1 }}
                    startIcon={<CheckCircleOutlineIcon />}
                    onClick={handleConfirmSell}
                  >
                    Confirm Sell
                  </Button>
                  <Button
                    variant="outlined"
                    color="primary"
                    size="small"
                    sx={{ flex: 1 }}
                    startIcon={<MapIcon />}
                    onClick={() => setSellModalOpen(true)}
                  >
                    Sell Elsewhere
                  </Button>
                </Box>
              ) : haulStatus === 'executed' ? (
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
                  onClick={handleOpenBuyDialog}
                >
                  Confirm Buy
                </Button>
              )}
            </Box>
          )}

          {variant === 'sell' && onSelect && (
            <Box sx={{ mt: 'auto', pt: 1 }}>
              <Button
                variant="contained"
                color="primary"
                size="small"
                fullWidth
                onClick={() => onSelect(row as ArbitrageRow)}
              >
                Redirect Here
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Confirm Buy Dialog */}
      <Dialog open={buyDialogOpen} onClose={() => setBuyDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Confirm Cargo Acquisition</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Enter the exact amount of cargo you successfully purchased to add it to your cargo hold manifest.
            </Typography>
            <TextField
              label="Quantity Purchased"
              type="number"
              fullWidth
              value={confirmQty}
              onChange={(e) => handleQtyChange(e.target.value)}
              inputProps={{ min: 1, max: row.quantity }}
            />
            <TextField
              label="Total Cost Paid (Millions ISK)"
              type="number"
              fullWidth
              value={confirmTotal}
              onChange={(e) => handleTotalChange(e.target.value)}
              helperText={confirmTotal ? `${formatIsk(Number(confirmTotal) * 1_000_000)} total` : undefined}
            />
            <TextField
              label="Unit Price Paid (ISK)"
              type="number"
              fullWidth
              value={confirmPrice}
              onChange={(e) => handlePriceChange(e.target.value)}
              helperText="Automatically calculated from total cost, or override directly"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setBuyDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleConfirmBuy}>Confirm &amp; Load</Button>
        </DialogActions>
      </Dialog>

      {isPinnedMode && haulStatus === 'transit' && (
        <SellDestinationsModal
          open={sellModalOpen}
          onClose={() => setSellModalOpen(false)}
          haul={row as PinnedHaul}
        />
      )}
    </>
  );
});
