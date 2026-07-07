/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** EVE SSO application client ID (from developers.eveonline.com). */
  readonly VITE_EVE_CLIENT_ID?: string;
  /** Set to "true" to disable the AI companion entirely (voice + orb + requests).
   * Optional — the companion is enabled by default. */
  readonly VITE_DISABLE_COMPANION?: string;
  /** Base URL of the standalone companion server/Space (e.g.
   * https://owner-companion.hf.space). Empty = same origin (dev uses the Vite proxy). */
  readonly VITE_COMPANION_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
