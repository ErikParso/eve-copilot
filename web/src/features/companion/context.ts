// Base context — the common facts useful for EVERY action (pilot name, balance,
// current location, client time…). Built fresh per event from the auth atoms and
// merged into the action's own data before the request goes to the server. The
// server treats the whole thing as the DATA payload.
import { createStore } from 'jotai';
import { activeCharacterAtom, characterStatusAtom, characterWalletAtom } from '@/features/auth/atoms';

type JotaiStore = ReturnType<typeof createStore>;

function compactIsk(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B ISK`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M ISK`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K ISK`;
  return `${Math.round(n)} ISK`;
}

/** The always-present ambient context. Only includes fields we actually have
 * (logged out / no scope simply omits them). */
export function buildBaseContext(store: JotaiStore): Record<string, unknown> {
  const active = store.get(activeCharacterAtom);
  const status = store.get(characterStatusAtom);
  const wallet = store.get(characterWalletAtom);

  const ctx: Record<string, unknown> = {
    clientTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
  if (active?.name) ctx.pilotName = active.name;
  if (wallet) ctx.balance = compactIsk(wallet.balance);
  if (status?.systemName) ctx.currentSystem = status.systemName;
  if (status?.security != null) ctx.currentSecurity = Number(status.security.toFixed(1));
  if (status?.shipTypeName) ctx.ship = status.shipTypeName;
  if (status?.online != null) ctx.online = status.online;
  return ctx;
}
