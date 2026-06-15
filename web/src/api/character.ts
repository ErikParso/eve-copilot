// Authenticated character endpoints used by the status display.
import { esiGet, esiGetAuthed } from './esiClient';

export interface CharacterLocation {
  solar_system_id: number;
  station_id?: number;
  structure_id?: number;
}

export interface CharacterShip {
  ship_type_id: number;
  ship_item_id: number;
  ship_name: string;
}

export interface CharacterOnline {
  online: boolean;
  last_login?: string;
  last_logout?: string;
  logins?: number;
}

export function getLocation(
  characterId: number,
  token: string,
  signal?: AbortSignal,
): Promise<CharacterLocation> {
  return esiGetAuthed(`/characters/${characterId}/location/`, token, undefined, signal);
}

export function getShip(
  characterId: number,
  token: string,
  signal?: AbortSignal,
): Promise<CharacterShip> {
  return esiGetAuthed(`/characters/${characterId}/ship/`, token, undefined, signal);
}

export function getOnline(
  characterId: number,
  token: string,
  signal?: AbortSignal,
): Promise<CharacterOnline> {
  return esiGetAuthed(`/characters/${characterId}/online/`, token, undefined, signal);
}

// Type id → name (public, rarely changes), cached for the session.
const typeNameCache = new Map<number, Promise<string>>();

export function resolveTypeName(typeId: number, signal?: AbortSignal): Promise<string> {
  const cached = typeNameCache.get(typeId);
  if (cached) return cached;
  const p = esiGet<{ name: string }>(`/universe/types/${typeId}/`, undefined, signal)
    .then((t) => t.name)
    .catch(() => `Type ${typeId}`);
  typeNameCache.set(typeId, p);
  return p;
}

/** Character portrait URL (no auth needed). */
export function portraitUrl(characterId: number, size = 64): string {
  return `https://images.evetech.net/characters/${characterId}/portrait?size=${size}`;
}
