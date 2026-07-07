// AI companion LLM: a thin proxy to a locally-hosted Ollama model. Stateless — it
// forwards an assembled prompt to Ollama and returns the plain-text reaction.
//
// Config via env:
//   OLLAMA_URL       default http://127.0.0.1:11434  (IPv4 — `localhost` can resolve
//                    to IPv6 ::1, which Ollama doesn't bind → ECONNREFUSED)
//   COMPANION_MODEL  default llama3.2:1b  (small + fast for CPU-only hosts)
import { GLOBAL_CONTEXT } from './persona.js';
import { BRIEFS, type CompanionActionId } from './briefs.js';

/**
 * Assemble the model prompt for one action. `system` is the global persona; `user`
 * is the action's brief (which includes the required response shape) followed by
 * the DATA payload — the ambient pilot context plus this action's specific facts.
 */
export function buildReactionPrompt(
  action: CompanionActionId,
  payload: Record<string, unknown>,
): { system: string; user: string } {
  const user = `BRIEF: ${BRIEFS[action]}\nDATA: ${JSON.stringify(payload)}`;
  return { system: GLOBAL_CONTEXT, user };
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const COMPANION_MODEL = process.env.COMPANION_MODEL ?? 'llama3.2:1b';

/**
 * Ask the model for one reaction. Plain-text reply, one sentence. Pass an
 * AbortSignal to cancel: aborting the fetch tells Ollama to stop generating and
 * frees the CPU. Throws on transport failure.
 */
export async function generateReaction(system: string, user: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: COMPANION_MODEL,
      stream: false,
      // keep_alive: -1 keeps the model resident in RAM forever, so it never pays a
      // multi-second reload after an idle gap.
      keep_alive: -1,
      options: { temperature: 0.7, num_predict: 120 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return (data.message?.content ?? '').trim();
}

/** Load the LLM into memory at boot and pin it there, so the first real reaction
 * isn't slowed by a cold model load. Best-effort. */
export async function warmModel(): Promise<void> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: COMPANION_MODEL, prompt: 'hi', stream: false, keep_alive: -1, options: { num_predict: 1 } }),
    });
    if (res.ok) console.log(`[Companion] LLM warm (${COMPANION_MODEL}, kept resident).`);
  } catch (err) {
    console.error('[Companion] LLM warm failed', err);
  }
}
