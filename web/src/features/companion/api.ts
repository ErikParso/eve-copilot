// FE → server. We send only the action + its payload (base context merged with the
// action's data). One response carries both the text reaction and its spoken audio
// (base64 WAV from the local Kokoro model, or null when TTS is off/failed).
import type { CompanionActionId } from './types';

// The companion runs on its own server/Space. VITE_COMPANION_URL points at it
// (e.g. https://<owner>-companion.hf.space). Empty = same origin — in dev the Vite
// proxy forwards /api/companion → the local companion-server.
const COMPANION_BASE = import.meta.env.VITE_COMPANION_URL ?? '';

export interface Reaction {
  text: string;
  audio: string | null;
}

export async function requestReaction(
  action: CompanionActionId,
  payload: Record<string, unknown>,
): Promise<Reaction> {
  const res = await fetch(`${COMPANION_BASE}/api/companion/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  if (!res.ok) {
    throw new Error(`companion ${res.status}`);
  }
  const data = (await res.json()) as {
    text?: string;
    audio?: string | null;
    timings?: { llm: number; tts: number; total: number };
  };
  if (data.timings) {
    console.log(`[Companion] ${action} timings: LLM ${data.timings.llm}ms, TTS ${data.timings.tts}ms, total ${data.timings.total}ms`);
  }
  return { text: (data.text ?? '').trim(), audio: data.audio ?? null };
}
