// FE → server proxy → Ollama. We send the fully-assembled prompt; the server
// relays to the local model and returns the parsed JSON reaction (unvalidated —
// see parseReaction in useCompanion).
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export async function requestReaction(
  system: string,
  user: string,
  format?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/companion/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, user, format }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`companion ${res.status}`);
  }
  const data = (await res.json()) as { json?: unknown };
  return data.json;
}
