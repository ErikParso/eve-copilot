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
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const COMPANION_MODEL = process.env.COMPANION_MODEL ?? 'qwen2.5:1.5b';

/**
 * Ask the model for one reaction. `system` and `user` are fully assembled by the
 * client (that's where the memory lives); `format` is Ollama's structured-output
 * spec — either the string `'json'` or a JSON schema object, which a small model
 * follows far more reliably than a free-form "reply as JSON" instruction. We only
 * add decoding options. Returns the parsed JSON object the model emitted (shape is
 * the client's contract, not ours), or throws on transport / parse failure.
 */
export async function generateReaction(
  system: string,
  user: string,
  format: unknown = 'json',
): Promise<unknown> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: COMPANION_MODEL,
      stream: false,
      format,
      // Small model, short reply: keep it tight and a touch creative.
      options: { temperature: 0.7, num_predict: 200 },
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
  const content = data.message?.content ?? '{}';
  // format:'json' guarantees valid JSON syntax, but a tiny model can still emit
  // an unexpected shape — that's the client's problem to validate, not ours.
  return JSON.parse(content) as unknown;
}
