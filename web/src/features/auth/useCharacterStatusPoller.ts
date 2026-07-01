import { useEffect } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useQuery } from '@tanstack/react-query';
import { getLocation, getOnline, getShip, resolveTypeName } from '@/api/character';
import { getSystem, securityBand } from '@/data/sde';
import { activeCharacterAtom, characterStatusAtom, type CharacterStatus } from './atoms';
import { ensureAccessToken } from './tokenManager';

// Location/ship endpoints are cached ~5 s by ESI; poll a touch slower.
const POLL_MS = 6000;

/**
 * Polls the active character's location/ship/online into `characterStatusAtom`.
 * Mount this exactly once (in the app shell). Pauses while the tab is hidden.
 *
 * TanStack Query owns the fetch lifecycle: `refetchInterval` drives the poll,
 * it cancels in-flight requests via the injected `signal`, refetches on window
 * focus, and skips polling while the tab is hidden (`refetchIntervalInBackground`
 * defaults to false). A small effect mirrors the result into the existing atom so
 * every current consumer of `characterStatusAtom` keeps working unchanged.
 */
export function useCharacterStatusPoller(): void {
  const store = useStore();
  const active = useAtomValue(activeCharacterAtom);
  const setStatus = useSetAtom(characterStatusAtom);
  const characterId = active?.characterId ?? null;

  const { data } = useQuery({
    queryKey: ['characterStatus', characterId],
    enabled: characterId !== null,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }): Promise<CharacterStatus> => {
      const id = characterId as number;
      const token = await ensureAccessToken(store, id);
      const [location, ship, online] = await Promise.all([
        getLocation(id, token, signal),
        getShip(id, token, signal),
        getOnline(id, token, signal),
      ]);
      const system = getSystem(location.solar_system_id);
      const shipTypeName = await resolveTypeName(ship.ship_type_id, signal);
      return {
        systemId: location.solar_system_id,
        systemName: system?.name ?? null,
        security: system?.security ?? null,
        securityBand: system ? securityBand(system.security) : null,
        shipTypeName,
        shipName: ship.ship_name,
        online: online.online,
        fetchedAt: Date.now(),
      };
    },
  });

  // Mirror query state into the shared atom (null while logged out).
  useEffect(() => {
    setStatus(characterId === null ? null : data ?? null);
  }, [characterId, data, setStatus]);
}
