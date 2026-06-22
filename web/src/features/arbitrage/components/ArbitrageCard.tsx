import { memo, type ReactNode } from 'react';
import { Box, Card, CardContent, Divider, Stack, Tooltip, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SegmentIcon from '@mui/icons-material/Segment';
import { formatIsk, formatIskMillions, formatNumber, formatVolume } from '@/utils/format';
import arbitrageBg from '@/assets/card-arbitrage.jpg';
import { LocationCell } from '@/features/courierContracts/components/LocationCell';
import { AttractivityCell } from '@/features/courierContracts/components/AttractivityCell';
import { DangerText } from '@/features/courierContracts/components/DangerCell';
import type { ContractEndpoint } from '@/features/courierContracts/types';
import type { ArbitrageRow } from '../types';
import { ArbitrageRouteCell } from './ArbitrageRouteCell';
import { OpenMarketButton } from './OpenMarketButton';

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
        <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right', color }}>
          {value}
        </Typography>
        {tooltip && (
          <Tooltip arrow title={tooltip} slotProps={{ tooltip: { sx: { maxWidth: 'none' } } }}>
            <SegmentIcon sx={{ fontSize: 13, color: 'text.secondary', cursor: 'help', opacity: 0.8, '&:hover': { opacity: 1 } }} />
          </Tooltip>
        )}
        {adornment}
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
  let ladderUnits = 0;
  let ladderBuyCost = 0;
  let ladderSellGross = 0;

  for (const rung of row.ladder) {
    if (remaining <= 0) break;
    const take = Math.min(rung.units, remaining);
    displayRungs.push({ units: take, buy: rung.buy, sell: rung.sell });
    remaining -= take;
    ladderUnits += rung.units;
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
export const ArbitrageCard = memo(function ArbitrageCard({ row }: { row: ArbitrageRow }) {
  const overpaying = isOverpaying(row.buyPrice, row.marketPrice);
  const overValue =
    row.marketPrice && row.marketPrice > 0 ? row.buyPrice / row.marketPrice : null;
  const overpayWarning =
    `You'd pay ${formatNumber(overValue ?? 0, 1)}× the item's market value ` +
    `(${formatIsk(row.marketPrice ?? 0)} / unit) at the source. If the destination sale ` +
    `falls through — e.g. a bait buy order cancelled before you arrive — you'd be left ` +
    `holding stock worth less than you paid, a real loss. A buy below market value would ` +
    `protect you. Verify the deal before committing.`;

  const displayRungs = getDisplayRungs(row);
  const breakdownTooltip = <RungBreakdownTooltip rungs={displayRungs} />;

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
        // Themed artwork as the card background, anchored top-left (no scrim yet —
        // legibility tuning comes later).
        backgroundImage: `url(${arbitrageBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'left top',
        backgroundRepeat: 'no-repeat',
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

        {/* Item + quantity to move (scaled to what fits your hold + wallet) */}
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
            <OpenMarketButton typeId={row.typeId} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {row.limited
                ? `${formatNumber(row.quantity, 0)} of ${formatNumber(row.fullQuantity, 0)} units`
                : `${formatNumber(row.quantity, 0)} unit${row.quantity === 1 ? '' : 's'}`}{' '}
              · {formatVolume(row.totalVolume)}
            </Typography>
            <Tooltip arrow title={breakdownTooltip} slotProps={{ tooltip: { sx: { maxWidth: 'none' } } }}>
              <SegmentIcon sx={{ fontSize: 13, color: 'text.secondary', cursor: 'help', opacity: 0.8, '&:hover': { opacity: 1 } }} />
            </Tooltip>
          </Box>
          {row.limited && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', fontWeight: 600 }}>
              Limited to what fits your hold + wallet
            </Typography>
          )}
        </Box>

        <Endpoint label="Buy" endpoint={row.source} />
        <Endpoint label="Sell" endpoint={row.dest} />

        <ArbitrageRouteCell row={row} trailing={<DangerText score={row.danger} steps={row.dangerSteps} />} />

        <Divider />

        <Stack spacing={0.5}>
          <Stat
            label="Buy (you pay)"
            value={`${formatIsk(row.buyPrice)} / unit`}
            color={overpaying ? 'warning.main' : undefined}
            tooltip={breakdownTooltip}
            adornment={
              overpaying ? (
                <Tooltip arrow title={overpayWarning}>
                  <WarningAmberIcon
                    sx={{ fontSize: 16, color: 'warning.main', cursor: 'help' }}
                  />
                </Tooltip>
              ) : undefined
            }
          />
          <Stat label="Sell (you get)" value={`${formatIsk(row.sellPrice)} / unit`} tooltip={breakdownTooltip} />
          <Stat
            label="Market value"
            value={row.marketPrice === null ? '—' : `${formatIsk(row.marketPrice)} / unit`}
          />
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
