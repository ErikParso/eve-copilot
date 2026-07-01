import { useAtomValue, useSetAtom } from 'jotai';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, CircularProgress, Alert } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import CloseIcon from '@mui/icons-material/Close';
import { PackageCard } from './PackageCard';
import { PinnedPackage, redirectPackageAtom } from '../atoms';
import type { PackageRow } from '../types';
import { deriveJourney, perJump } from '@/features/courierContracts/journey';
import { attractivityWeightsAtom } from '@/features/courierContracts/atoms';
import { preferencesAtom, DEFAULT_SALES_TAX_PCT } from '@/features/preferences/atoms';
import { characterStatusAtom } from '@/features/auth/atoms';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** Server shape: a routed, scored sell destination (no jumps/per-jump — derived here). */
type ApiPackageSellDestination = Omit<PackageRow, 'jumpsFromCurrent' | 'jumpsToDest' | 'totalJumps' | 'profitPerJump' | 'attractivitySteps'>;

function hydrate(item: ApiPackageSellDestination): PackageRow {
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
 * Where can I sell the package I'm carrying? Liquidation alternatives for a
 * package in transit, ranked by the same attractivity weights as the hauling
 * list, routed from the current system. Best-available — loss-making
 * destinations are shown (red income) so there's always an option.
 */
export function PackageSellDestinationsModal({ open, onClose, pkg }: { open: boolean; onClose: () => void; pkg: PinnedPackage }) {
  const weights = useAtomValue(attractivityWeightsAtom);
  const prefs = useAtomValue(preferencesAtom);
  const origin = useAtomValue(characterStatusAtom)?.systemId ?? null;

  const redirectPackage = useSetAtom(redirectPackageAtom);

  const handleSelectAlternative = (option: PackageRow) => {
    redirectPackage({
      id: pkg.id,
      newDest: option.dest,
      newSellValue: option.sellValue,
      newProfit: option.profit,
      newContents: option.contents,
      newHauledVolume: option.hauledVolume,
      newLeftMarketValue: option.leftMarketValue,
      newLimited: option.limited,
    });
    onClose();
  };

  // The carried subset (what's actually in the ship) is what we're offloading.
  const lines = pkg.contents
    .filter((l) => l.soldQuantity > 0)
    .map((l) => ({ typeId: l.typeId, quantity: l.soldQuantity, isBlueprintCopy: l.isBlueprintCopy }));
  const taxPct = prefs.salesTaxPct ?? DEFAULT_SALES_TAX_PCT;

  const { data: rows = [], isFetching, error } = useQuery({
    // Only runs while open with a known location; refetches whenever any input
    // (weights included) changes. TanStack Query owns cancellation + caching.
    enabled: open && origin !== null,
    queryKey: ['pkgSellDest', lines, pkg.price, origin, prefs.routeType, taxPct, weights],
    queryFn: async ({ signal }): Promise<PackageRow[]> => {
      const res = await fetch(`${API_BASE}/api/packages/sell-destinations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ lines, price: pkg.price, origin, routeType: prefs.routeType, taxPct, weights }),
      });
      if (!res.ok) throw new Error(`Sell-destination search returned ${res.status}`);
      const data = (await res.json()) as { items?: ApiPackageSellDestination[] };
      return (data.items ?? []).map(hydrate);
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
        Sell this package — where?
        <Typography variant="body2" color="text.secondary">
          Best markets for the bundle in your hold, from your current location. Income is after sales tax; red means you'd take a loss.
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
            <Typography color="text.secondary">Routing the markets that buy this bundle…</Typography>
          </Box>
        )}
        {origin !== null && !isFetching && error && <Alert severity="warning">{error.message}</Alert>}
        {origin !== null && !isFetching && !error && rows.length === 0 && <Alert severity="info">No market is currently buying this bundle within reach.</Alert>}
        {origin !== null && !isFetching && !error && rows.length > 0 && (
          <Grid container spacing={2} sx={{ pt: '10px' }}>
            {rows.map((row) => (
              <Grid key={row.id} xs={12} sm={6} md={4} lg={3}>
                <PackageCard row={row} variant="sell" onSelect={handleSelectAlternative} />
              </Grid>
            ))}
          </Grid>
        )}
      </DialogContent>
    </Dialog>
  );
}
