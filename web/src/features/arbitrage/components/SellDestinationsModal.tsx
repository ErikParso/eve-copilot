import { useAtomValue, useSetAtom } from 'jotai';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  CircularProgress,
  Alert,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import CloseIcon from '@mui/icons-material/Close';
import { ArbitrageCard } from './ArbitrageCard';
import { PinnedHaul, redirectHaulAtom } from '../atoms';
import type { ArbitrageRow } from '../types';
import { deriveJourney, perJump } from '@/features/courierContracts/journey';
import { attractivityWeightsAtom } from '@/features/courierContracts/atoms';
import { preferencesAtom, DEFAULT_SALES_TAX_PCT } from '@/features/preferences/atoms';
import { characterStatusAtom } from '@/features/auth/atoms';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** Server shape: a routed, scored sell destination (no jumps/per-jump — derived here). */
type ApiSellDestination = Omit<ArbitrageRow, 'jumpsFromCurrent' | 'jumpsToDest' | 'totalJumps' | 'profitPerJump' | 'attractivitySteps'>;

function hydrate(item: ApiSellDestination): ArbitrageRow {
  const j = deriveJourney(item.approachRoute, item.deliveryRoute ?? []);
  return {
    ...item,
    jumpsFromCurrent: j.jumpsFromCurrent,
    jumpsToDest: j.jumpsToDest,
    totalJumps: j.totalJumps,
    profitPerJump: perJump(item.profit, j.totalJumps),
    attractivitySteps: [],
  };
}

/**
 * Where can I sell the cargo I'm carrying? Liquidation alternatives for a haul in
 * transit, ranked by the same attractivity weights as the hauling list, routed
 * from the current system. Best-available — loss-making destinations are shown
 * (red income) so the user is never left without options.
 */
export function SellDestinationsModal({ open, onClose, haul }: { open: boolean; onClose: () => void; haul: PinnedHaul }) {
  const weights = useAtomValue(attractivityWeightsAtom);
  const prefs = useAtomValue(preferencesAtom);
  const origin = useAtomValue(characterStatusAtom)?.systemId ?? null;

  const redirectHaul = useSetAtom(redirectHaulAtom);

  const handleSelectAlternative = (option: ArbitrageRow) => {
    redirectHaul({
      id: haul.id,
      newDest: option.dest,
      newSellPrice: option.sellPrice,
      newProfit: option.profit,
    });
    onClose();
  };

  const quantity = haul.boughtQuantity ?? haul.quantity;
  const boughtPrice = haul.boughtPrice ?? haul.buyPrice;
  const taxPct = prefs.salesTaxPct ?? DEFAULT_SALES_TAX_PCT;

  const { data: rows = [], isFetching, error } = useQuery({
    // Only runs while open with a known location; refetches whenever any input
    // (weights included) changes. TanStack Query owns cancellation + caching.
    enabled: open && origin !== null,
    queryKey: ['arbSellDest', haul.typeId, quantity, boughtPrice, origin, prefs.routeType, taxPct, weights],
    queryFn: async ({ signal }): Promise<ArbitrageRow[]> => {
      const res = await fetch(`${API_BASE}/api/arbitrage/sell-destinations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ typeId: haul.typeId, quantity, boughtPrice, origin, routeType: prefs.routeType, taxPct, weights }),
      });
      if (!res.ok) throw new Error(`Sell-destination search returned ${res.status}`);
      const data = (await res.json()) as { items?: ApiSellDestination[] };
      return (data.items ?? []).map(hydrate);
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
        Sell {haul.itemName} — where?
        <Typography variant="body2" color="text.secondary">
          Best markets for the {(haul.boughtQuantity ?? haul.quantity).toLocaleString()} units in your hold, from your current
          location. Income is after sales tax; red means you'd take a loss.
        </Typography>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {origin === null && (
          <Alert severity="warning">
            Your current location is unknown — start the character location tracker to find sell destinations.
          </Alert>
        )}
        {origin !== null && isFetching && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1.5, py: 6 }}>
            <CircularProgress size={22} />
            <Typography color="text.secondary">Routing the markets that buy {haul.itemName}…</Typography>
          </Box>
        )}
        {origin !== null && !isFetching && error && <Alert severity="warning">{error.message}</Alert>}
        {origin !== null && !isFetching && !error && rows.length === 0 && (
          <Alert severity="info">No market is currently buying {haul.itemName} within reach.</Alert>
        )}
        {origin !== null && !isFetching && !error && rows.length > 0 && (
          <Grid container spacing={2} sx={{ pt: '10px' }}>
            {rows.map((row) => (
              <Grid key={row.id} xs={12} sm={6} md={4} lg={3}>
                <ArbitrageCard row={row} variant="sell" onSelect={handleSelectAlternative} />
              </Grid>
            ))}
          </Grid>
        )}
      </DialogContent>
    </Dialog>
  );
}
