// FE → server. We send only the action + its payload (base context merged with the
// action's data). One response carries both the text reaction and its spoken audio
// (base64 WAV from the local Kokoro model, or null when TTS is off/failed).
import type { CompanionActionId } from './types';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export interface Reaction {
  text: string;
  audio: string | null;
}

export async function requestReaction(
  action: CompanionActionId,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Reaction> {
  const res = await fetch(`${API_BASE}/api/companion/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`companion ${res.status}`);
  }
  const data = (await res.json()) as { text?: string; audio?: string | null };
  return { text: (data.text ?? '').trim(), audio: data.audio ?? null };
}
