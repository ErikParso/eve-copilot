// Auth state (jotai). Logged-in characters + their tokens are persisted to
// localStorage so login survives reloads. (Refresh tokens in the browser are a
// known trade-off for a no-backend SPA.)
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { SecurityBand } from '@/data/sde';

export interface AuthCharacter {
  characterId: number;
  name: string;
  scopes: string[];
  accessToken: string;
  refreshToken: string;
  /** Access-token expiry as epoch ms. */
  expiresAt: number;
}

export const charactersAtom = atomWithStorage<AuthCharacter[]>(
  'eve-multitool.auth.characters',
  [],
  undefined,
  { getOnInit: true },
);

export const activeCharacterIdAtom = atomWithStorage<number | null>(
  'eve-multitool.auth.activeId',
  null,
  undefined,
  { getOnInit: true },
);

/** The currently selected authenticated character, or null. */
export const activeCharacterAtom = atom((get) => {
  const id = get(activeCharacterIdAtom);
  return get(charactersAtom).find((c) => c.characterId === id) ?? null;
});

/** Live status of the active character (polled), or null. */
export interface CharacterStatus {
  systemId: number | null;
  systemName: string | null;
  security: number | null;
  securityBand: SecurityBand | null;
  shipTypeName: string | null;
  shipName: string | null;
  online: boolean | null;
  /** When this status was fetched (epoch ms). */
  fetchedAt: number;
}

export const characterStatusAtom = atom<CharacterStatus | null>(null);
