// AI companion: a thin proxy to a locally-hosted Ollama model. All companion
// memory (self-summary, meta log, messages) lives client-side in the browser;
// the server is stateless here — it just forwards an assembled prompt to Ollama
// and returns the parsed JSON reaction. Keeps the model off the public internet
// (Ollama is only ever reached from this process, never the browser).
//
// Config via env:
//   OLLAMA_URL       default http://localhost:11434
//   COMPANION_MODEL  default qwen2.5:1.5b  (small enough for CPU-only hosts)

// Use 127.0.0.1, not `localhost`: on Windows, Node resolves `localhost` to IPv6
// (::1) first, but Ollama binds IPv4 only — `localhost` there gives ECONNREFUSED.
import { GLOBAL_CONTEXT } from './companionPersona.js';
import { BRIEFS, type CompanionActionId } from './companionBriefs.js';

/**
 * Assemble the model prompt for one action. `system` is the global persona; `user`
 * is the action's brief (which includes the required response shape) followed by
 * the DATA payload — the ambient pilot context plus this action's specific facts,
 * merged client-side. This is where all prompt logic now lives (moved off the FE).
 */
export function buildReactionPrompt(
  action: CompanionActionId,
  payload: Record<string, unknown>,
): { system: string; user: string } {
  const user = `BRIEF: ${BRIEFS[action]}\nDATA: ${JSON.stringify(payload)}`;
  return { system: GLOBAL_CONTEXT, user };
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const COMPANION_MODEL = process.env.COMPANION_MODEL ?? 'qwen2.5:1.5b';

/**
 * Ask the model for one reaction. `system` and `user` are fully assembled by the
 * client (that's where the memory lives). The reply is plain text — one sentence —
 * so we ask for no structured format and return the raw content, trimmed. The
 * client does any final cleanup. Throws on transport failure.
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
      // Small model, short reply: keep it tight and a touch creative.
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
