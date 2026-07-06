// FE → server proxy → Ollama. We send the fully-assembled prompt; the server
// relays to the local model and returns the plain-text reaction (one sentence).
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export async function requestReaction(system: string, user: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API_BASE}/api/companion/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, user }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`companion ${res.status}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
