import { useEffect } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useQuery } from '@tanstack/react-query';
import { getWallet } from '@/api/character';
import { activeCharacterAtom, characterWalletAtom, type CharacterWallet } from './atoms';
import { ensureAccessToken } from './tokenManager';

const WALLET_SCOPE = 'esi-wallet.read_character_wallet.v1';
// ESI caches the balance for up to 120 s, so polling faster is wasted.
const POLL_MS = 120_000;

/**
 * Polls the active character's wallet balance into `characterWalletAtom`. Mount
 * once (app shell). No-op (and clears the balance) when the character hasn't
 * granted the wallet scope. Pauses while the tab is hidden.
 *
 * TanStack Query owns the poll: `refetchInterval` ticks it, the injected `signal`
 * cancels in-flight requests, background tabs pause, and it refetches on focus. A
 * small effect mirrors the result into the existing atom so consumers are unchanged.
 */
export function useCharacterWalletPoller(): void {
  const store = useStore();
  const active = useAtomValue(activeCharacterAtom);
  const setWallet = useSetAtom(characterWalletAtom);
  const characterId = active?.characterId ?? null;
  const hasScope = active?.scopes.includes(WALLET_SCOPE) ?? false;
  const enabled = characterId !== null && hasScope;

  const { data } = useQuery({
    queryKey: ['characterWallet', characterId],
    enabled,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }): Promise<CharacterWallet> => {
      const id = characterId as number;
      const token = await ensureAccessToken(store, id);
      const balance = await getWallet(id, token, signal);
      return { balance, fetchedAt: Date.now() };
    },
  });

  // Mirror query state into the shared atom (null when logged out / no scope).
  useEffect(() => {
    setWallet(enabled ? data ?? null : null);
  }, [enabled, data, setWallet]);
}
