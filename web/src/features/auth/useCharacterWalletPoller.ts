import { useEffect } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { getWallet } from '@/api/character';
import { activeCharacterAtom, characterWalletAtom } from './atoms';
import { ensureAccessToken } from './tokenManager';

const WALLET_SCOPE = 'esi-wallet.read_character_wallet.v1';
// ESI caches the balance for up to 120 s, so polling faster is wasted.
const POLL_MS = 120_000;

/**
 * Polls the active character's wallet balance into `characterWalletAtom`. Mount
 * once (app shell). No-op (and clears the balance) when the character hasn't
 * granted the wallet scope. Pauses while the tab is hidden.
 */
export function useCharacterWalletPoller(): void {
  const store = useStore();
  const active = useAtomValue(activeCharacterAtom);
  const setWallet = useSetAtom(characterWalletAtom);
  const characterId = active?.characterId ?? null;
  const hasScope = active?.scopes.includes(WALLET_SCOPE) ?? false;

  useEffect(() => {
    if (characterId === null || !hasScope) {
      setWallet(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const tick = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const token = await ensureAccessToken(store, characterId);
        const balance = await getWallet(characterId, token, controller.signal);
        if (cancelled) return;
        setWallet({ balance, fetchedAt: Date.now() });
      } catch {
        // Keep the last balance; the next tick will retry.
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [characterId, hasScope, store, setWallet]);
}
