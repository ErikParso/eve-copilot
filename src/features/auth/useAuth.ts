import { useCallback } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { buildAuthorizeRequest, isSsoConfigured } from '@/api/sso';
import {
  activeCharacterAtom,
  activeCharacterIdAtom,
  charactersAtom,
  type AuthCharacter,
} from './atoms';

const VERIFIER_KEY = 'eve-multitool.sso.verifier';
const STATE_KEY = 'eve-multitool.sso.state';

/** Auth actions + state for the SSO character session(s). */
export function useAuth() {
  const [characters, setCharacters] = useAtom(charactersAtom);
  const [activeId, setActiveId] = useAtom(activeCharacterIdAtom);
  const active = useAtomValue(activeCharacterAtom);

  /** Begin the SSO login (redirects to CCP). */
  const login = useCallback(async () => {
    if (!isSsoConfigured()) return;
    const { verifier, state, url } = await buildAuthorizeRequest();
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    window.location.assign(url);
  }, []);

  /** Add (or replace) a character after a successful token exchange. */
  const addCharacter = useCallback(
    (char: AuthCharacter) => {
      setCharacters((prev) => [...prev.filter((c) => c.characterId !== char.characterId), char]);
      setActiveId(char.characterId);
    },
    [setCharacters, setActiveId],
  );

  const setActive = useCallback((id: number) => setActiveId(id), [setActiveId]);

  const logout = useCallback(
    (id: number) => {
      const remaining = characters.filter((c) => c.characterId !== id);
      setCharacters(remaining);
      if (activeId === id) setActiveId(remaining[0]?.characterId ?? null);
    },
    [characters, activeId, setCharacters, setActiveId],
  );

  return { characters, active, login, logout, setActive, addCharacter, configured: isSsoConfigured() };
}

export { VERIFIER_KEY, STATE_KEY };
