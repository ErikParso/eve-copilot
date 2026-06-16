import { useState } from 'react';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { activeCharacterAtom, characterStatusAtom } from '@/features/auth/atoms';
import { ensureAccessToken } from '@/features/auth/tokenManager';
import { setWaypoint } from '@/api/ui';
import { getSystem } from '@/data/sde';
import { draftFiltersAtom } from '@/features/courierContracts/atoms';
import { DangerText } from '@/features/courierContracts/components/DangerCell';
import { formatIskMillions, formatNumber, formatVolume } from '@/utils/format';
import { basketAtom } from './atoms';
import { usePlan } from './usePlan';
import type { BasketStop, Plan } from './types';

/** In-game waypoint target: the station id when resolved, else the system id. */
function destinationId(stop: BasketStop): number | null {
  if (stop.endpoint.resolved) return stop.endpoint.locationId;
  return stop.systemId;
}

function stopLine(stop: BasketStop): string {
  const sys = stop.endpoint.systemName ?? '?';
  return `${stop.endpoint.name} · ${sys}`;
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}

/** Read-only view of the shared Hauling settings the plan is built from. */
function PlanSettingsPanel() {
  const filters = useAtomValue(draftFiltersAtom);
  const status = useAtomValue(characterStatusAtom);

  const locationName =
    status?.systemName ??
    (filters.currentSystemId !== null ? getSystem(filters.currentSystemId)?.name ?? null : null);
  const capacity = filters.maxCargoM3 !== null ? formatVolume(filters.maxCargoM3) : 'Unlimited';
  const isk =
    filters.maxCollateralMillions !== null
      ? formatIskMillions(filters.maxCollateralMillions * 1_000_000)
      : 'Unlimited';
  const route = filters.routeType === 'safest' ? 'Safest' : 'Shortest';

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2">Plan settings</Typography>
        <Button size="small" component={RouterLink} to="/couriers">
          Edit in filters
        </Button>
      </Box>
      <Chip
        icon={<MyLocationIcon />}
        label={locationName ?? 'Unknown — set in filters'}
        size="small"
        color={locationName ? 'default' : 'warning'}
        variant="outlined"
        sx={{ alignSelf: 'flex-start' }}
      />
      <SettingRow label="Cargo capacity" value={capacity} />
      <SettingRow label="Available ISK" value={isk} />
      <SettingRow label="Route" value={route} />
      <Typography variant="caption" color="text.secondary">
        Shared with the Hauling search — change them there.
      </Typography>
    </Stack>
  );
}

function BasketPanel() {
  const [basket, setBasket] = useAtom(basketAtom);
  if (basket.length === 0) return null;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2">In the plan ({basket.length})</Typography>
        <Button size="small" color="inherit" onClick={() => setBasket([])}>
          Clear all
        </Button>
      </Box>
      <Stack spacing={1}>
        {basket.map((item) => (
          <Box
            key={item.key}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap title={item.label}>
                {item.kind === 'arbitrage' ? item.label : 'Courier contract'}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" noWrap>
                {item.pickup.endpoint.systemName ?? '?'} → {item.dropoff.endpoint.systemName ?? '?'}
              </Typography>
            </Box>
            <Tooltip title="Remove" arrow>
              <IconButton
                size="small"
                onClick={() => setBasket(basket.filter((b) => b.key !== item.key))}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function SummaryBanner({ plan, capacity, startIsk }: { plan: Plan; capacity: number; startIsk: number }) {
  const overCargo = plan.peakCargo > capacity;
  const overIsk = plan.peakCapital > startIsk;
  return (
    <Stack spacing={1}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <Metric label="Total income" value={formatIskMillions(plan.totalIncome)} />
        <Metric label="Jumps" value={formatNumber(plan.totalJumps, 0)} />
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Danger
          </Typography>
          <DangerText score={plan.danger} steps={plan.dangerSteps} />
        </Box>
        <Metric
          label="Peak cargo"
          value={formatVolume(plan.peakCargo)}
          warn={overCargo}
        />
        <Metric
          label="Peak ISK out"
          value={formatIskMillions(plan.peakCapital)}
          warn={overIsk}
        />
      </Box>
      {overCargo && (
        <Alert severity="warning">
          Peak cargo ({formatVolume(plan.peakCargo)}) exceeds your capacity. Some items won't fit at
          once — remove a few or split the run.
        </Alert>
      )}
      {overIsk && (
        <Alert severity="warning">
          Peak ISK committed ({formatIskMillions(plan.peakCapital)}) exceeds your wallet. You can't
          afford every buy/collateral simultaneously.
        </Alert>
      )}
      {plan.infeasibleKeys.length > 0 && (
        <Alert severity="info">
          {plan.infeasibleKeys.length} item(s) couldn't be placed (unresolved location, unreachable,
          too large, or unaffordable) and were left out of the route.
        </Alert>
      )}
    </Stack>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 700, color: warn ? 'warning.main' : undefined }}>
        {value}
      </Typography>
    </Box>
  );
}

function Roadmap({ plan }: { plan: Plan }) {
  const store = useStore();
  const active = useAtomValue(activeCharacterAtom);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendWaypoint = async (stop: BasketStop, add: boolean) => {
    if (!active) {
      setError('Log in with a character to set waypoints.');
      return;
    }
    const dest = destinationId(stop);
    if (dest === null) {
      setError('This stop has no resolvable destination.');
      return;
    }
    try {
      const token = await ensureAccessToken(store, active.characterId);
      await setWaypoint(dest, token, { add });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set waypoint.');
    }
  };

  const sendFullRoute = async () => {
    setBusy(true);
    try {
      for (let i = 0; i < plan.steps.length; i++) {
        await sendWaypoint(plan.steps[i].stop, i > 0); // first clears, rest append
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2">Roadmap ({plan.steps.length} stops)</Typography>
        <Button size="small" variant="outlined" disabled={busy || !active} onClick={sendFullRoute}>
          Send full route to autopilot
        </Button>
      </Box>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Stack spacing={1}>
        {plan.steps.map((step, i) => (
          <Box
            key={`${step.itemKey}:${step.action}:${i}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ width: 24, textAlign: 'right' }}>
              {i + 1}.
            </Typography>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {step.jumps > 0 ? `Travel ${step.jumps} jump${step.jumps === 1 ? '' : 's'} → ` : ''}
                {step.label}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" noWrap>
                {stopLine(step.stop)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Wallet {formatIskMillions(step.walletAfter)} · Cargo {formatVolume(step.cargoAfter)}
              </Typography>
            </Box>
            <Tooltip title="Set in-game waypoint for this stop" arrow>
              <span>
                <Button size="small" disabled={!active} onClick={() => sendWaypoint(step.stop, false)}>
                  Waypoint
                </Button>
              </span>
            </Tooltip>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

export function CopilotPage() {
  const basket = useAtomValue(basketAtom);
  const filters = useAtomValue(draftFiltersAtom);
  const { status, plan, error } = usePlan();

  const capacity = filters.maxCargoM3 ?? Number.POSITIVE_INFINITY;
  const startIsk =
    filters.maxCollateralMillions !== null
      ? filters.maxCollateralMillions * 1_000_000
      : Number.POSITIVE_INFINITY;

  return (
    <Grid container spacing={2} alignItems="flex-start">
      <Grid xs={12} sm={6} md={4} lg={3}>
        <Box sx={{ position: { md: 'sticky' }, top: { md: 80 } }}>
          <Stack spacing={2}>
            <PlanSettingsPanel />
            <Divider />
            <BasketPanel />
          </Stack>
        </Box>
      </Grid>

      <Grid xs={12} sm={6} md={8} lg={9}>
        <Stack spacing={2}>
          {basket.length === 0 && (
            <Alert severity="info">
              Your plan is empty. On the <strong>Hauling</strong> page, use the “Add to Copilot plan”
              button on a contract or arbitrage card to build a run, then come back here for an
              optimized route.
            </Alert>
          )}

          {status === 'loading' && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Planning the route…
              </Typography>
              <LinearProgress />
            </Box>
          )}

          {status === 'error' && <Alert severity="error">Could not plan the route: {error}</Alert>}

          {status === 'ready' && plan && plan.steps.length === 0 && (
            <Alert severity="warning">
              None of the basket items could be routed. Check that the locations are resolvable and
              within your cargo/ISK limits.
            </Alert>
          )}

          {status === 'ready' && plan && plan.steps.length > 0 && (
            <>
              <SummaryBanner plan={plan} capacity={capacity} startIsk={startIsk} />
              <Divider />
              <Roadmap plan={plan} />
            </>
          )}
        </Stack>
      </Grid>
    </Grid>
  );
}
