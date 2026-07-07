// AI companion — text reaction via Groq (free, OpenAI-compatible, fast). Needs a
// free key (GROQ_API_KEY, from console.groq.com). Rate-limited, not metered. The
// spoken audio is produced separately in companionTts.ts.
import { GLOBAL_CONTEXT } from './companionPersona.js';
import { BRIEFS, type CompanionActionId } from './companionBriefs.js';

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

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const COMPANION_MODEL = process.env.COMPANION_MODEL ?? 'llama-3.1-8b-instant';

// Read at call-time (not module-load) so the dev .env loader has run first.
function authHeader(): string {
  return `Bearer ${process.env.GROQ_API_KEY}`;
}

/**
 * Ask the model for one reaction. Plain-text reply, one sentence. Throws on
 * transport failure.
 */
export async function generateReaction(system: string, user: string): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify({
      model: COMPANION_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 120,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Groq API ${res.status} ${res.statusText}: ${errorText}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

/**
 * Ping the LLM at boot so the first reaction is warm. Best-effort. Returns the model
 * label on success, or null on failure (the caller logs one consolidated warm line).
 */
export async function warmModel(): Promise<string | null> {
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(),
      },
      body: JSON.stringify({
        model: COMPANION_MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    return res.ok ? COMPANION_MODEL : null;
  } catch {
    return null;
  }
}
