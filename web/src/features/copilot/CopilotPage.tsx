import { useState } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import { activeCharacterAtom, characterStatusAtom, characterWalletAtom } from '@/features/auth/atoms';
import { ensureAccessToken } from '@/features/auth/tokenManager';
import { openMarketWindow, setWaypoint } from '@/api/ui';
import { preferencesAtom, preferencesOpenAtom } from '@/features/preferences/atoms';
import { DangerText } from '@/features/courierContracts/components/DangerCell';
import type { RouteSystem } from '@/features/courierContracts/types';
import { formatIsk, formatIskMillions, formatNumber, formatVolume } from '@/utils/format';
import { completeStopAtom, planAtom, runModeAtom } from './atoms';
import { useRun, type RunSuggestion } from './useRun';
import { ShipInventoryPanel } from './components/ShipInventoryPanel';
import { RunModeToggle } from './components/RunModeToggle';
import type { BasketStop, RunPlan, RunStep, RunStop } from './types';

/** In-game waypoint target: the station id when resolved, else the system id. */
function destinationId(stop: BasketStop): number | null {
  if (stop.endpoint.resolved) return stop.endpoint.locationId;
  return stop.systemId;
}

function stopLine(stop: BasketStop): string {
  const sys = stop.endpoint.systemName ?? '?';
  return `${stop.endpoint.name} · ${sys}`;
}

/** Colour a system chip by its security status. */
function securityColor(sec: number): string {
  if (sec >= 0.5) return 'success.main';
  if (sec > 0) return 'warning.main';
  return 'error.main';
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

/** Read-only view of the global preferences + live wallet the plan is built from. */
function PlanSettingsPanel() {
  const prefs = useAtomValue(preferencesAtom);
  const status = useAtomValue(characterStatusAtom);
  const wallet = useAtomValue(characterWalletAtom);
  const openPrefs = useSetAtom(preferencesOpenAtom);

  const locationName = status?.systemName ?? null;
  const capacity = prefs.cargoM3 !== null ? formatVolume(prefs.cargoM3) : 'Unlimited';
  const walletText = wallet ? formatIskMillions(wallet.balance) : 'Not available';
  const route = prefs.routeType === 'safest' ? 'Safest' : 'Shortest';

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2">Settings</Typography>
        <Button size="small" onClick={() => openPrefs(true)}>
          Edit
        </Button>
      </Box>
      <Chip
        icon={<MyLocationIcon />}
        label={locationName ?? 'Unknown location'}
        size="small"
        color={locationName ? 'default' : 'warning'}
        variant="outlined"
        sx={{ alignSelf: 'flex-start' }}
      />
      <SettingRow label="Cargo capacity" value={capacity} />
      <SettingRow label="Wallet" value={walletText} />
      <SettingRow label="Route" value={route} />
      <Typography variant="caption" color="text.secondary">
        Cargo &amp; route from Preferences; ISK from your live wallet.
      </Typography>
    </Stack>
  );
}

/** The stops chosen for the current run, with manual removal. */
function RunPlanPanel() {
  const plan = useAtomValue(planAtom);
  const setPlan = useSetAtom(planAtom);
  const mode = useAtomValue(runModeAtom);
  if (plan.length === 0) return null;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2">In the {mode} run ({plan.length})</Typography>
        <Button size="small" color="inherit" onClick={() => setPlan([])}>
          Clear all
        </Button>
      </Box>
      <Stack spacing={1}>
        {plan.map((s) => (
          <Box
            key={s.key}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap title={s.itemName}>
                {formatNumber(s.quantity, 0)} × {s.itemName}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" noWrap>
                {s.stop.endpoint.systemName ?? '?'}
              </Typography>
            </Box>
            <Tooltip title="Remove from plan" arrow>
              <IconButton size="small" onClick={() => setPlan((prev) => prev.filter((p) => p.key !== s.key))}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 700 }}>
        {value}
      </Typography>
    </Box>
  );
}

function SummaryBanner({ plan }: { plan: RunPlan }) {
  return (
    <Stack spacing={1}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        {plan.mode === 'buy' ? (
          <Metric label="Total spend" value={formatIskMillions(plan.totalSpend)} />
        ) : (
          <Metric label="Net revenue" value={formatIskMillions(plan.totalRevenue)} />
        )}
        <Metric label="Jumps" value={formatNumber(plan.totalJumps, 0)} />
        <Metric label="Peak cargo" value={formatVolume(plan.peakCargo)} />
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Danger
          </Typography>
          <DangerText score={plan.danger} steps={plan.dangerSteps} />
        </Box>
      </Box>
      {plan.infeasibleKeys.length > 0 && (
        <Alert severity="info">
          {plan.infeasibleKeys.length} item(s) couldn't be routed (unresolved/unreachable location, or
          over your cargo/ISK limits) and were left out.
        </Alert>
      )}
    </Stack>
  );
}

/** A compact strip of the whole tour's systems, coloured by security. */
function RouteStrip({ steps }: { steps: RunStep[] }) {
  const systems: RouteSystem[] = [];
  for (const step of steps) {
    const leg = step.leg;
    const slice = systems.length === 0 ? leg : leg.slice(1);
    systems.push(...slice);
  }
  if (systems.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
      {systems.map((sys, i) => (
        <Tooltip key={`${sys.systemId}:${i}`} arrow title={`${sys.name} · ${sys.security.toFixed(1)} sec`}>
          <Box
            sx={{
              px: 0.75,
              py: 0.25,
              borderRadius: 0.5,
              fontSize: '0.65rem',
              fontWeight: 600,
              color: 'common.white',
              bgcolor: securityColor(sys.security),
              whiteSpace: 'nowrap',
            }}
          >
            {sys.name}
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}

function Roadmap({ plan }: { plan: RunPlan }) {
  const store = useStore();
  const active = useAtomValue(activeCharacterAtom);
  const planStops = useAtomValue(planAtom);
  const complete = useSetAtom(completeStopAtom);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byKey = new Map<string, RunStop>(planStops.map((s) => [s.key, s]));
  const steps = plan.steps;
  const doneVerb = plan.mode === 'buy' ? 'Bought' : 'Sold';

  const withToken = async (fn: (token: string) => Promise<void>) => {
    if (!active) {
      setError('Log in with a character to use in-game actions.');
      return;
    }
    try {
      const token = await ensureAccessToken(store, active.characterId);
      await fn(token);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'In-game action failed.');
    }
  };

  const sendWaypoint = (stop: BasketStop, add: boolean) => {
    const dest = destinationId(stop);
    if (dest === null) {
      setError('This stop has no resolvable destination.');
      return Promise.resolve();
    }
    return withToken((token) => setWaypoint(dest, token, { add }));
  };

  const sendFullRoute = async () => {
    setBusy(true);
    try {
      for (let i = 0; i < steps.length; i++) {
        await sendWaypoint(steps[i].stop, i > 0); // first clears, rest append
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2">Roadmap ({steps.length} stops)</Typography>
        <Button size="small" variant="outlined" disabled={busy || !active} onClick={sendFullRoute}>
          Send full route to autopilot
        </Button>
      </Box>

      <RouteStrip steps={steps} />

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack spacing={1}>
        {steps.map((step, i) => {
          const current = i === 0;
          const stop = byKey.get(step.key);
          return (
            <Box
              key={step.key}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1,
                borderRadius: 1,
                border: '1px solid',
                borderColor: current ? 'primary.main' : 'divider',
                bgcolor: current ? 'action.selected' : undefined,
              }}
            >
              <Typography
                variant="caption"
                color={current ? 'primary.main' : 'text.secondary'}
                sx={{ width: 24, textAlign: 'right', fontWeight: current ? 700 : 400 }}
              >
                {i + 1}.
              </Typography>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {step.jumps > 0 ? `Travel ${step.jumps} jump${step.jumps === 1 ? '' : 's'} → ` : ''}
                  {step.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" noWrap>
                  {formatNumber(step.quantity, 0)} units · {stopLine(step.stop)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Wallet {formatIskMillions(step.walletAfter)} · Cargo {formatVolume(step.cargoAfter)}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                <Tooltip title="Open the item's market window in the EVE client" arrow>
                  <span>
                    <Button size="small" disabled={!active} onClick={() => void withToken((t) => openMarketWindow(step.typeId, t))}>
                      Open market
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="Set in-game waypoint for this stop" arrow>
                  <span>
                    <Button size="small" disabled={!active} onClick={() => void sendWaypoint(step.stop, false)}>
                      Waypoint
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title={`Mark as ${doneVerb.toLowerCase()} — updates your inventory`} arrow>
                  <span>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={!stop}
                      onClick={() => stop && complete(stop)}
                    >
                      {doneVerb}
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
}

/** One suggestion card — mode-aware: buy leads with discount, sell with net price. */
function SuggestionCard({ s }: { s: RunSuggestion }) {
  const setPlan = useSetAtom(planAtom);
  const add = () => setPlan((prev) => (prev.some((p) => p.key === s.stop.key) ? prev : [...prev, s.stop]));

  const jumpsText = s.jumps === null ? 'route unknown' : `${formatNumber(s.jumps, 0)} jump${s.jumps === 1 ? '' : 's'}`;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap title={s.stop.itemName}>
          {formatNumber(s.stop.quantity, 0)} × {s.stop.itemName}
        </Typography>

        {s.buy && (
          <>
            <Typography variant="caption" color="success.main" display="block" sx={{ fontWeight: 700 }}>
              {s.buy.discountPct.toFixed(1)}% under market · {formatIsk(s.buy.askPrice)}/u
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" noWrap>
              Buy at {s.buy.source.systemName ?? '?'} · {jumpsText}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              Resale {s.buy.resaleMarginPct.toFixed(0)}% @ {s.buy.bestResaleStation.systemName ?? '?'} · demand{' '}
              {formatNumber(s.buy.demandUnits, 0)} u
            </Typography>
          </>
        )}

        {s.sell && (
          <>
            <Typography variant="caption" color="success.main" display="block" sx={{ fontWeight: 700 }}>
              {formatIskMillions(s.sell.netRevenue)} net · {formatIsk(s.sell.sellPrice)}/u
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" noWrap>
              Sell at {s.sell.dest.systemName ?? '?'} · {jumpsText}
            </Typography>
            {s.iskPerJump !== null && (
              <Typography variant="caption" color="text.secondary" display="block">
                {formatIskMillions(s.iskPerJump)} / jump
              </Typography>
            )}
          </>
        )}
      </Box>
      <Button size="small" variant="outlined" onClick={add}>
        Add
      </Button>
    </Box>
  );
}

function SuggestionsPanel({ run }: { run: ReturnType<typeof useRun> }) {
  const mode = run.mode;
  const TOP_N = 12;
  const visible = run.suggestions.slice(0, TOP_N);

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2">
          {mode === 'buy' ? 'Cheap stock to buy' : 'Buyers for your cargo'}
        </Typography>
        {run.status === 'loading' && <CircularProgress size={16} thickness={5} aria-label="Updating suggestions" />}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {mode === 'buy'
          ? 'Ranked by how far under market value the sell orders are priced. Check demand and resale margin before committing.'
          : 'The best-paying buyers for what your ship is carrying, ranked by net ISK per jump.'}
      </Typography>

      {run.status === 'error' && <Alert severity="error">{run.error}</Alert>}
      {mode === 'sell' && run.considered === 0 && run.status === 'ready' && (
        <Alert severity="info">Your hold is empty (or no buyers were found). Buy some cargo first.</Alert>
      )}
      {mode === 'buy' && run.considered === 0 && run.status === 'ready' && (
        <Alert severity="info">No cheap-under-market stock fits your cargo/ISK right now.</Alert>
      )}
      {run.suggestions.length > TOP_N && (
        <Typography variant="caption" color="text.secondary">
          Showing the top {TOP_N} of {run.suggestions.length}.
        </Typography>
      )}

      <Stack spacing={1}>
        {visible.map((s) => (
          <SuggestionCard key={s.stop.key} s={s} />
        ))}
      </Stack>
    </Stack>
  );
}

export function CopilotPage() {
  const run = useRun();
  const plan = useAtomValue(planAtom);
  const mode = useAtomValue(runModeAtom);

  return (
    <Grid container spacing={2} alignItems="flex-start">
      <Grid xs={12}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <RunModeToggle />
          <Typography variant="caption" color="text.secondary">
            {mode === 'buy'
              ? 'Stock up: buy attractive cargo cheaply, then switch to a sell run to offload it.'
              : 'Offload: sell what your ship is carrying to the best reachable buyers.'}
          </Typography>
        </Box>
      </Grid>

      <Grid xs={12} sm={6} md={4} lg={3}>
        <Box sx={{ position: { md: 'sticky' }, top: { md: 80 } }}>
          <Stack spacing={2}>
            <PlanSettingsPanel />
            <Divider />
            <ShipInventoryPanel />
            <Divider />
            <RunPlanPanel />
          </Stack>
        </Box>
      </Grid>

      <Grid xs={12} sm={6} md={5} lg={6}>
        <Stack spacing={2}>
          {plan.length === 0 && (
            <Alert severity="info">
              Your {mode} run is empty. Pick {mode === 'buy' ? 'cheap stock' : 'a buyer'} from the
              suggestions to build a route.
            </Alert>
          )}

          {run.planStatus === 'loading' && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Planning the route…
              </Typography>
              <LinearProgress />
            </Box>
          )}

          {run.planStatus === 'error' && <Alert severity="error">Could not plan the route: {run.error}</Alert>}

          {run.planStatus === 'ready' && run.plan && run.plan.steps.length === 0 && (
            <Alert severity="warning">
              None of the chosen stops could be routed. Check that the locations are reachable and within
              your cargo/ISK limits.
            </Alert>
          )}

          {run.planStatus === 'ready' && run.plan && run.plan.steps.length > 0 && (
            <>
              <SummaryBanner plan={run.plan} />
              <Divider />
              <Roadmap plan={run.plan} />
            </>
          )}
        </Stack>
      </Grid>

      <Grid xs={12} md={3} lg={3}>
        <SuggestionsPanel run={run} />
      </Grid>
    </Grid>
  );
}
