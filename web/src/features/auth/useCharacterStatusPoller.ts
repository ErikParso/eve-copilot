import { useEffect } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { getLocation, getOnline, getShip, resolveTypeName } from '@/api/character';
import { getSystem, securityBand } from '@/data/sde';
import { activeCharacterAtom, characterStatusAtom } from './atoms';
import { ensureAccessToken } from './tokenManager';

// Location/ship endpoints are cached ~5 s by ESI; poll a touch slower.
const POLL_MS = 6000;

/**
 * Polls the active character's location/ship/online into `characterStatusAtom`.
 * Mount this exactly once (in the app shell). Pauses while the tab is hidden.
 */
export function useCharacterStatusPoller(): void {
  const store = useStore();
  const active = useAtomValue(activeCharacterAtom);
  const setStatus = useSetAtom(characterStatusAtom);
  const characterId = active?.characterId ?? null;

  useEffect(() => {
    if (characterId === null) {
      setStatus(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const tick = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const token = await ensureAccessToken(store, characterId);
        const [location, ship, online] = await Promise.all([
          getLocation(characterId, token, controller.signal),
          getShip(characterId, token, controller.signal),
          getOnline(characterId, token, controller.signal),
        ]);
        const system = getSystem(location.solar_system_id);
        const shipTypeName = await resolveTypeName(ship.ship_type_id, controller.signal);
        if (cancelled) return;
        setStatus({
          systemId: location.solar_system_id,
          systemName: system?.name ?? null,
          security: system?.security ?? null,
          securityBand: system ? securityBand(system.security) : null,
          shipTypeName,
          shipName: ship.ship_name,
          online: online.online,
          fetchedAt: Date.now(),
        });
      } catch {
        // Keep the last status; the next tick will retry.
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
  }, [characterId, store, setStatus]);
}
