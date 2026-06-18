import { useState, type ReactNode } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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
import { LocationCell } from '@/features/courierContracts/components/LocationCell';
import { OpenMarketButton } from '@/features/arbitrage/components/OpenMarketButton';
import type { ContractEndpoint, RouteSystem } from '@/features/courierContracts/types';
import arbitrageBg from '@/assets/card-arbitrage.jpg';
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
            Danger index
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

/** Label/value row, mirroring the Hauling arbitrage card's stat list. */
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right', color }}>
        {value}
      </Typography>
    </Box>
  );
}

/** A pickup/dropoff endpoint row with an optional trailing control. */
function Endpoint({ label, endpoint, action }: { label: string; endpoint: ContractEndpoint; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 40, flexShrink: 0, mt: 0.25 }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <LocationCell endpoint={endpoint} />
      </Box>
      {action}
    </Box>
  );
}

/** A full suggestion card — Hauling-style, with the complete price/margin breakdown. */
function SuggestionCard({ s }: { s: RunSuggestion }) {
  const setPlan = useSetAtom(planAtom);
  const add = () => setPlan((prev) => (prev.some((p) => p.key === s.stop.key) ? prev : [...prev, s.stop]));

  const dangerColor = s.dangerDelta > 0 ? 'warning.main' : s.dangerDelta < 0 ? 'success.main' : 'text.secondary';
  const dangerText = `${s.dangerDelta >= 0 ? '+' : '−'}${formatNumber(Math.abs(s.dangerDelta), 0)}`;
  const addsJumps = `+${formatNumber(s.deltaJumps, 0)}`;
  const sellMarginPct =
    s.sell && s.unitCostBasis > 0 ? (s.profit / (s.unitCostBasis * s.stop.quantity)) * 100 : null;

  return (
    <Card
      variant="outlined"
      sx={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundImage: `url(${arbitrageBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'left top',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, '&:last-child': { pb: 1.5 } }}>
        {/* Headline: the value this move makes + the primary ISK/jump rank. */}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {s.buy ? 'Resale upside' : 'Profit'}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, color: 'primary.main' }}>
            {formatIskMillions(s.profit)}
          </Typography>
          <Typography variant="caption" color="success.main" sx={{ fontWeight: 600 }}>
            {s.iskPerJump === null ? 'unplaceable' : `${formatIskMillions(s.iskPerJump)} / jump`}
          </Typography>
        </Box>

        <Divider />

        {/* Item + quantity + volume */}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap title={s.stop.itemName}>
            {s.stop.itemName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatNumber(s.stop.quantity, 0)} unit{s.stop.quantity === 1 ? '' : 's'} · {formatVolume(s.stop.cargoM3)}
          </Typography>
        </Box>

        {s.buy && (
          <>
            <Endpoint label="Buy" endpoint={s.buy.source} action={<OpenMarketButton typeId={s.stop.typeId} />} />
            <Endpoint label="Resale" endpoint={s.buy.bestResaleStation} />
          </>
        )}
        {s.sell && <Endpoint label="Sell" endpoint={s.sell.dest} action={<OpenMarketButton typeId={s.stop.typeId} />} />}

        {/* Run impact: jumps the whole run would take + danger increase. */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {s.runJumps === null ? 'no route' : `${formatNumber(s.runJumps, 0)} jumps run (${addsJumps})`}
          </Typography>
          <Typography variant="caption" sx={{ color: dangerColor, fontWeight: 600 }}>
            {dangerText} danger
          </Typography>
        </Box>

        <Divider />

        {/* Full price / margin breakdown. */}
        <Stack spacing={0.5}>
          {s.buy && (
            <>
              <Stat label="Total price" value={formatIskMillions(s.buy.buyCost)} />
              <Stat label="Buy / unit" value={`${formatIsk(s.buy.askPrice)} / unit`} />
              <Stat
                label="Market value"
                value={s.buy.marketPrice === null ? '—' : `${formatIsk(s.buy.marketPrice)} / unit`}
              />
              <Stat
                label="Under market"
                value={s.buy.discountPct === null ? '—' : `${s.buy.discountPct.toFixed(1)}%`}
                color={s.buy.discountPct !== null && s.buy.discountPct > 0 ? 'success.main' : undefined}
              />
              <Stat label="Best bid / unit" value={`${formatIsk(s.buy.bestResaleNet)} / unit`} />
              <Stat label="Resale margin" value={`${s.buy.resaleMarginPct.toFixed(1)}%`} color="success.main" />
              <Stat label="Demand (bids)" value={`${formatNumber(s.buy.demandUnits, 0)} u`} />
            </>
          )}
          {s.sell && (
            <>
              <Stat label="Net revenue" value={formatIskMillions(s.sell.netRevenue)} />
              <Stat label="Gross revenue" value={formatIskMillions(s.sell.grossRevenue)} />
              <Stat label="Sell / unit" value={`${formatIsk(s.sell.sellPrice)} / unit`} />
              <Stat
                label="Market value"
                value={s.sell.marketPrice === null ? '—' : `${formatIsk(s.sell.marketPrice)} / unit`}
              />
              <Stat
                label="Cost basis / unit"
                value={s.unitCostBasis > 0 ? `${formatIsk(s.unitCostBasis)} / unit` : '—'}
              />
              <Stat
                label="Profit"
                value={formatIskMillions(s.profit)}
                color={s.profit >= 0 ? 'success.main' : 'warning.main'}
              />
              {sellMarginPct !== null && (
                <Stat
                  label="Margin"
                  value={`${sellMarginPct.toFixed(1)}%`}
                  color={sellMarginPct >= 0 ? 'success.main' : 'warning.main'}
                />
              )}
              <Stat label="Sales tax" value={`${(s.sell.salesTax * 100).toFixed(1)}%`} />
            </>
          )}
        </Stack>

        <Button size="small" variant="contained" onClick={add} sx={{ mt: 0.5 }}>
          Add to run
        </Button>
      </CardContent>
    </Card>
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
          ? "Ranked by ISK per jump — resale upside ÷ the whole run's jumps if added. Each card shows the jumps & danger it adds, plus discount, demand and resale margin."
          : "Ranked by ISK per jump — profit over your cost basis ÷ the whole run's jumps if added. Each card shows the jumps & danger it adds."}
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
