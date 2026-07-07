// Feature flag for the whole AI companion (voice + orb + reaction requests).
// Enabled by default; set VITE_DISABLE_COMPANION=true to turn it off. FE-only gate:
// when disabled, useCompanion never subscribes or fires, so no request ever hits
// the server. The companion is served by the main backend (same origin); the LLM
// (Groq) and TTS (Edge) both run off-box.
export const COMPANION_ENABLED = import.meta.env.VITE_DISABLE_COMPANION !== 'true';
