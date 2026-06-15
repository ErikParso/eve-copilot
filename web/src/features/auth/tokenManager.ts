// Returns a valid access token for a character, refreshing it (once, even
// under concurrent callers) when it is about to expire. Reads/writes the
// characters atom via the jotai store, so it works outside React render.
import { createStore } from 'jotai';
import { decodeToken, refreshToken } from '@/api/sso';
import { charactersAtom, type AuthCharacter } from './atoms';

type JotaiStore = ReturnType<typeof createStore>;

// Refresh slightly ahead of expiry to avoid races with in-flight requests.
const REFRESH_MARGIN_MS = 60_000;

const inFlight = new Map<number, Promise<string>>();

export async function ensureAccessToken(store: JotaiStore, characterId: number): Promise<string> {
  const char = store.get(charactersAtom).find((c) => c.characterId === characterId);
  if (!char) throw new Error('Character is not authenticated');

  if (char.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return char.accessToken;
  }

  let refresh = inFlight.get(characterId);
  if (!refresh) {
    refresh = (async () => {
      const tok = await refreshToken(char.refreshToken);
      const decoded = decodeToken(tok.access_token);
      const updated: AuthCharacter = {
        ...char,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: decoded.expiresAt,
        scopes: decoded.scopes,
      };
      store.set(
        charactersAtom,
        store.get(charactersAtom).map((c) => (c.characterId === characterId ? updated : c)),
      );
      return tok.access_token;
    })().finally(() => inFlight.delete(characterId));
    inFlight.set(characterId, refresh);
  }
  return refresh;
}
