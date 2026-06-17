import { useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
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
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { activeCharacterAtom, characterStatusAtom, characterWalletAtom } from '@/features/auth/atoms';
import { ensureAccessToken } from '@/features/auth/tokenManager';
import { openContract, openMarketWindow, setWaypoint } from '@/api/ui';
import { haulingRowsAtom } from '@/features/courierContracts/atoms';
import { preferencesAtom, preferencesOpenAtom } from '@/features/preferences/atoms';
import { DangerText } from '@/features/courierContracts/components/DangerCell';
import { formatIsk, formatIskMillions, formatNumber, formatVolume } from '@/utils/format';
import { basketAtom, effectiveStartIskAtom, runProgressAtom } from './atoms';
import { usePlan } from './usePlan';
import { useSuggestions } from './useSuggestions';
import { AddToPlanButton } from './components/AddToPlanButton';
import type { BasketStop, Plan, PlanStep } from './types';

/** In-game waypoint target: the station id when resolved, else the system id. */
function destinationId(stop: BasketStop): number | null {
  if (stop.endpoint.resolved) return stop.endpoint.locationId;
  return stop.systemId;
}

function stopLine(stop: BasketStop): string {
  const sys = stop.endpoint.systemName ?? '?';
  return `${stop.endpoint.name} · ${sys}`;
}

/** Signed ISK delta, e.g. "+1.2 M ISK" / "−300 000 ISK"; em-dash when unknown. */
function signedIsk(n: number | null): string {
  if (n === null) return '—';
  return `${n >= 0 ? '+' : '−'}${formatIsk(Math.abs(n))}`;
}

function signedInt(n: number): string {
  return `${n >= 0 ? '+' : '−'}${formatNumber(Math.abs(n), 0)}`;
}

function signedVolume(n: number): string {
  return `${n >= 0 ? '+' : '−'}${formatVolume(Math.abs(n))}`;
}

/** Colour a change green/amber by whether it's an improvement. */
function changeColor(delta: number, higherIsBetter: boolean): string {
  if (delta === 0) return 'text.secondary';
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return good ? 'success.main' : 'warning.main';
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
  const startIsk = useAtomValue(effectiveStartIskAtom);
  const openPrefs = useSetAtom(preferencesOpenAtom);

  const locationName = status?.systemName ?? null;
  const capacity = prefs.cargoM3 !== null ? formatVolume(prefs.cargoM3) : 'Unlimited';
  const walletText = wallet ? formatIskMillions(wallet.balance) : 'Not available';
  // While a run is underway the plan simulates from a frozen balance.
  const frozen = startIsk !== null && wallet !== null && startIsk !== wallet.balance;
  const route = prefs.routeType === 'safest' ? 'Safest' : 'Shortest';

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2">Plan settings</Typography>
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
      {frozen && (
        <SettingRow label="Plan starts from" value={formatIskMillions(startIsk!)} />
      )}
      <SettingRow label="Route" value={route} />
      <Typography variant="caption" color="text.secondary">
        Cargo &amp; route from Preferences; ISK from your live wallet
        {frozen ? ' (frozen for the run in progress).' : '.'}
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

function SummaryBanner({ plan }: { plan: Plan }) {
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
        <Metric label="Peak cargo" value={formatVolume(plan.peakCargo)} />
        <Metric label="Peak ISK out" value={formatIskMillions(plan.peakCapital)} />
      </Box>
      {plan.infeasibleKeys.length > 0 && (
        <Alert severity="info">
          {plan.infeasibleKeys.length} item(s) couldn't be routed (unresolved or unreachable
          location) and were left out.
        </Alert>
      )}
    </Stack>
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

/** The in-game window action for a step, or null when none applies. */
function openActionLabel(step: PlanStep): string | null {
  if (step.kind === 'arbitrage') return 'Open market';
  if (step.kind === 'courier' && step.action === 'pickup') return 'Open contract';
  return null;
}

function Roadmap({ plan }: { plan: Plan }) {
  const store = useStore();
  const active = useAtomValue(activeCharacterAtom);
  const status = useAtomValue(characterStatusAtom);
  const wallet = useAtomValue(characterWalletAtom);
  const basket = useAtomValue(basketAtom);
  const [progress, setProgress] = useAtom(runProgressAtom);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byKey = new Map(basket.map((b) => [b.key, b]));
  const steps = plan.steps;
  const signature = useMemo(() => steps.map((s) => `${s.itemKey}:${s.action}`).join('|'), [steps]);

  // Reset progress whenever the plan's step sequence changes.
  useEffect(() => {
    setProgress((p) => (p.signature === signature ? p : { signature, index: 0, startIsk: null }));
  }, [signature, setProgress]);

  const currentIndex = progress.signature === signature ? Math.min(progress.index, steps.length) : 0;

  // Advancing past step 0 freezes the wallet balance as the plan's start ISK, so
  // the forward simulation isn't thrown off by buys you make during the run.
  const setIndex = (i: number) => {
    const clamped = Math.max(0, Math.min(i, steps.length));
    setProgress((p) => ({
      signature,
      index: clamped,
      startIsk:
        clamped > 0
          ? p.signature === signature && p.startIsk !== null
            ? p.startIsk
            : wallet?.balance ?? null
          : null,
    }));
  };

  // Auto-advance: when the character reaches an upcoming step's system, jump the
  // roadmap to that step (steps before it become done). ESI only reports your
  // system, not that you docked/accepted/bought — confirm those with Done.
  const sysId = status?.systemId ?? null;
  useEffect(() => {
    if (sysId === null) return;
    for (let j = currentIndex; j < steps.length; j++) {
      if (steps[j].stop.systemId === sysId) {
        if (j > currentIndex) setIndex(j);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sysId]);

  const done = currentIndex >= steps.length;
  const nowWallet = currentIndex > 0 ? steps[currentIndex - 1].walletAfter : null;
  const nowCargo = currentIndex > 0 ? steps[currentIndex - 1].cargoAfter : null;

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

  const openWindowFor = (step: PlanStep) => {
    const item = byKey.get(step.itemKey);
    if (!item) return;
    if (item.kind === 'arbitrage' && item.marketTypeId != null) {
      void withToken((token) => openMarketWindow(item.marketTypeId!, token));
    } else if (item.kind === 'courier' && item.contractId != null) {
      void withToken((token) => openContract(item.contractId!, token));
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
        <Typography variant="subtitle2">Roadmap ({steps.length} stops)</Typography>
        <Button size="small" variant="outlined" disabled={busy || !active} onClick={sendFullRoute}>
          Send full route to autopilot
        </Button>
      </Box>

      {/* Progress controls — advances automatically as you arrive in each stop's
          system; Done confirms an action, Back/Restart adjust manually. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          p: 1,
          borderRadius: 1,
          bgcolor: 'action.hover',
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {done ? 'Run complete' : `Step ${currentIndex + 1} of ${steps.length}`}
        </Typography>
        {nowWallet !== null && (
          <Typography variant="caption" color="text.secondary">
            · wallet {formatIskMillions(nowWallet)} · cargo {formatVolume(nowCargo ?? 0)}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" disabled={currentIndex === 0} onClick={() => setIndex(currentIndex - 1)}>
          Back
        </Button>
        <Button size="small" variant="contained" disabled={done} onClick={() => setIndex(currentIndex + 1)}>
          Done
        </Button>
        <Button size="small" color="inherit" disabled={currentIndex === 0} onClick={() => setIndex(0)}>
          Restart
        </Button>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Stack spacing={1}>
        {steps.map((step, i) => {
          const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
          return (
          <Box
            key={`${step.itemKey}:${step.action}:${i}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1,
              borderRadius: 1,
              border: '1px solid',
              borderColor: state === 'current' ? 'primary.main' : 'divider',
              bgcolor: state === 'current' ? 'action.selected' : undefined,
              opacity: state === 'done' ? 0.55 : 1,
            }}
          >
            {state === 'done' ? (
              <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
            ) : (
              <Typography
                variant="caption"
                color={state === 'current' ? 'primary.main' : 'text.secondary'}
                sx={{ width: 24, textAlign: 'right', fontWeight: state === 'current' ? 700 : 400 }}
              >
                {i + 1}.
              </Typography>
            )}
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
            <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
              {openActionLabel(step) && (
                <Tooltip title="Open the relevant window in the EVE client" arrow>
                  <span>
                    <Button size="small" disabled={!active} onClick={() => openWindowFor(step)}>
                      {openActionLabel(step)}
                    </Button>
                  </span>
                </Tooltip>
              )}
              <Tooltip title="Set in-game waypoint for this stop" arrow>
                <span>
                  <Button
                    size="small"
                    disabled={!active}
                    onClick={() => void sendWaypoint(step.stop, false)}
                  >
                    Waypoint
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

/** Auto-updating list of additions that would raise the plan's attractivity. */
function SuggestionsPanel() {
  const haulingRows = useAtomValue(haulingRowsAtom);
  const basket = useAtomValue(basketAtom);
  const openPrefs = useSetAtom(preferencesOpenAtom);
  const { status, suggestions, error, considered } = useSuggestions();

  const TOP_N = 12;
  const hasResults = haulingRows.length > 0;
  const inBasket = new Set(basket.map((b) => b.key));
  const ranked = suggestions.filter((s) => !inBasket.has(s.item.key));
  const visible = ranked.slice(0, TOP_N);

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2">Suggested additions</Typography>
        {status === 'loading' && (
          <CircularProgress size={16} thickness={5} aria-label="Updating suggestions" />
        )}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Auto-updates as the list, your plan and preferences change. Ranked by the attractivity of the
        plan with that contract added — scored like the Hauling cards, using your{' '}
        <Box
          component="span"
          onClick={() => openPrefs(true)}
          sx={{ color: 'primary.main', cursor: 'pointer', textDecoration: 'underline' }}
        >
          attractivity weights
        </Box>
        .
      </Typography>

      {!hasResults && (
        <Alert severity="info">
          No hauling results yet — suggestions are drawn from the live list.
        </Alert>
      )}
      {status === 'error' && <Alert severity="error">{error}</Alert>}
      {status === 'ready' && considered > 0 && ranked.length === 0 && (
        <Alert severity="info">None of the contracts fit the current plan's cargo / ISK limits.</Alert>
      )}
      {ranked.length > TOP_N && (
        <Typography variant="caption" color="text.secondary">
          Showing the top {TOP_N} of {ranked.length}.
        </Typography>
      )}

      <Stack spacing={1}>
        {visible.map((s) => (
          <Box
            key={s.item.key}
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
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap title={s.item.label}>
                  {s.item.kind === 'arbitrage' ? s.item.label : 'Courier contract'}
                </Typography>
                <Tooltip
                  arrow
                  slotProps={{ tooltip: { sx: { maxWidth: 360 } } }}
                  title={
                    <Box sx={{ py: 0.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                        Why this rank (score {s.attractivity})
                      </Typography>
                      {s.attractivitySteps.map((step, k) => (
                        <Typography key={k} variant="caption" sx={{ display: 'block', lineHeight: 1.5 }}>
                          {step}
                        </Typography>
                      ))}
                    </Box>
                  }
                >
                  <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary', cursor: 'help', flexShrink: 0 }} />
                </Tooltip>
              </Box>
              <Typography variant="caption" color="text.secondary" display="block" noWrap>
                {s.item.pickup.endpoint.systemName ?? '?'} →{' '}
                {s.item.dropoff.endpoint.systemName ?? '?'}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                +{formatIskMillions(s.deltaIncome)} · +{formatNumber(s.deltaJumps, 0)} jump
                {s.deltaJumps === 1 ? '' : 's'}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                <Box component="span" sx={{ color: changeColor(s.deltaDanger, false) }}>
                  {signedInt(s.deltaDanger)} danger
                </Box>
                {' · '}
                <Box component="span" sx={{ color: changeColor(s.deltaIskPerJump ?? 0, true) }}>
                  {signedIsk(s.deltaIskPerJump)} / jump
                </Box>
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                <Box component="span" sx={{ color: changeColor(s.deltaCargo, false) }}>
                  {signedVolume(s.deltaCargo)}
                </Box>
                {' · '}
                <Box component="span" sx={{ color: changeColor(s.deltaInvestment, false) }}>
                  {signedIsk(s.deltaInvestment)} invested
                </Box>
              </Typography>
            </Box>
            <AddToPlanButton item={s.item} />
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

export function CopilotPage() {
  const basket = useAtomValue(basketAtom);
  const { status, plan, error } = usePlan();

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
              <SummaryBanner plan={plan} />
              <Divider />
              <Roadmap plan={plan} />
            </>
          )}

          <Divider />
          <SuggestionsPanel />
        </Stack>
      </Grid>
    </Grid>
  );
}
