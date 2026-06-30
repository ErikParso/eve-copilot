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
import { BreakdownModal } from '@/components/BreakdownModal';
import MapIcon from '@mui/icons-material/Map';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { formatIsk, formatIskMillions, formatNumber, formatVolume } from '@/utils/format';
import packageBg from '@/assets/card-package.png';
import { LocationCell } from '@/features/courierContracts/components/LocationCell';
import { AttractivityCell } from '@/features/courierContracts/components/AttractivityCell';
import { DangerText } from '@/features/courierContracts/components/DangerCell';
import { OpenContractButton } from '@/features/courierContracts/components/OpenContractButton';
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
	const [contentsModalOpen, setContentsModalOpen] = useState(false);
	const [leftExpanded, setLeftExpanded] = useState(false); // left-at-station list collapsed by default

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
	const hauledUnits = row.contents.reduce((s, l) => s + l.soldQuantity, 0);
	const hasLeft = row.leftMarketValue > 0 || row.contents.some((l) => l.leftQuantity > 0);

	// Breakdown rows: hauled items first, a separator, then the items left in station.
	// A type can straddle the line, appearing in both halves.
	type BreakdownRow =
		| { kind: 'hauled'; line: PackageRow['contents'][number] }
		| { kind: 'left'; line: PackageRow['contents'][number] }
		| { kind: 'separator' };
	const leftRows = row.contents.filter((l) => l.leftQuantity > 0).map((l) => ({ kind: 'left' as const, line: l }));
	const breakdownRows: BreakdownRow[] = [
		...row.contents.filter((l) => l.soldQuantity > 0).map((l) => ({ kind: 'hauled' as const, line: l })),
		...(hasLeft ? [{ kind: 'separator' as const }] : []),
		...(leftExpanded ? leftRows : []),
	];

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
							{/* A package is bought as an item_exchange contract, so the inline
                  action opens the contract window (not a single item's market). */}
							{!isSell && row.contractId > 0 && <OpenContractButton contractId={row.contractId} />}
						</Box>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
							<Typography variant="caption" color="text.secondary">
								{hauledUnits === totalUnits
									? `${formatNumber(totalUnits, 0)} unit${totalUnits === 1 ? '' : 's'}`
									: `${formatNumber(hauledUnits, 0)} of ${formatNumber(totalUnits, 0)} units`}{' '}
								· {formatVolume(row.hauledVolume)} carried
							</Typography>
							<Tooltip title="View package contents breakdown">
								<IconButton
									onClick={() => setContentsModalOpen(true)}
									sx={{ p: 0 }}
								>
									<SegmentIcon fontSize="small" />
								</IconButton>
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
						<Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
							<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
								<Typography variant="caption" color="text.secondary">
									Worth left at station
								</Typography>
								<Tooltip
									arrow
									title="Items that didn't fit your ship are left at the station. Valued at nominal market price — you keep the bundle's full price as a cost, but won't sell these here."
								>
									<InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary', cursor: 'help', opacity: 0.8, '&:hover': { opacity: 1 } }} />
								</Tooltip>
							</Box>
							<Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right', color: 'text.secondary' }}>
								{formatIskMillions(row.leftMarketValue)}
							</Typography>
						</Box>
					</Stack>

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

			<BreakdownModal
				open={contentsModalOpen}
				onClose={() => setContentsModalOpen(false)}
				title={`Package Contents (${row.contents.length} ${row.contents.length === 1 ? 'type' : 'types'})`}
				description="You buy the whole bundle, then carry only what fits your hold — the rest is left at the station."
				columns={[
					{ header: 'Item Name', gridWidth: '2fr' },
					{ header: 'Quantity', gridWidth: '1fr', align: 'right' },
					{ header: 'Volume', gridWidth: '1fr', align: 'right' },
					{ header: 'Value', gridWidth: '1fr', align: 'right' },
				]}
				items={breakdownRows}
				renderRow={(brow) => {
					if (brow.kind === 'separator') {
						return (
							<Box
								onClick={() => setLeftExpanded((v) => !v)}
								sx={{
									gridColumn: '1 / -1',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									gap: 1,
									cursor: 'pointer',
									userSelect: 'none',
									'&:hover': { opacity: 0.85 },
								}}
							>
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
									{leftExpanded ? <ExpandLessIcon sx={{ fontSize: 16, color: 'warning.main' }} /> : <ExpandMoreIcon sx={{ fontSize: 16, color: 'warning.main' }} />}
									<Typography variant="caption" sx={{ fontWeight: 700, color: 'warning.main', textTransform: 'uppercase', letterSpacing: 0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
										Won't fit — left at the station
									</Typography>
								</Box>
								<Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
									{leftRows.length} {leftRows.length === 1 ? 'item' : 'items'} · worth ~{formatIsk(row.leftMarketValue)}
								</Typography>
							</Box>
						);
					}
					const { line } = brow;
					const isLeft = brow.kind === 'left';
					const qty = isLeft ? line.leftQuantity : line.soldQuantity;
					return (
						<>
							<Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', opacity: isLeft ? 0.6 : 1 }}>
								{line.itemName}
								{line.isBlueprintCopy && (
									<Typography component="span" variant="caption" sx={{ ml: 1, color: 'info.main', bgcolor: 'info.light', px: 0.5, py: 0.1, borderRadius: 0.5, opacity: 0.8 }}>
										BPC
									</Typography>
								)}
							</Typography>
							<Typography variant="body2" sx={{ fontFamily: 'monospace', textAlign: 'right', opacity: isLeft ? 0.6 : 1 }}>
								{formatNumber(qty, 0)}
							</Typography>
							<Typography variant="body2" sx={{ fontFamily: 'monospace', textAlign: 'right', color: 'text.secondary', opacity: isLeft ? 0.6 : 1 }}>
								{formatVolume(qty * line.unitVolume)}
							</Typography>
							<Typography
								variant="body2"
								sx={{
									fontFamily: 'monospace',
									color: isLeft ? 'text.disabled' : 'success.main',
									textAlign: 'right',
									opacity: isLeft ? 0.6 : 1,
								}}
							>
								{isLeft
									? line.marketPrice === null
										? '—'
										: `~${formatIsk(line.leftMarketValue)}`
									: formatIsk(line.sellValue)}
							</Typography>
						</>
					);
				}}
			/>
		</>
	);
});
