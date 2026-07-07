// Feature flag for the whole AI companion (voice + orb + reaction requests).
// Enabled by default; set VITE_DISABLE_COMPANION=true to turn it off (e.g. on a
// host where the local Ollama / Kokoro models aren't available). FE-only gate:
// when disabled, useCompanion never subscribes or fires, so no request ever hits
// the server and none of the server-side model code loads.
export const COMPANION_ENABLED = import.meta.env.VITE_DISABLE_COMPANION !== 'true';
