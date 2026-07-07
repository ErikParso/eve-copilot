/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** EVE SSO application client ID (from developers.eveonline.com). */
  readonly VITE_EVE_CLIENT_ID?: string;
  /** Set to "true" to disable the AI companion entirely (voice + orb + requests).
   * Optional — the companion is enabled by default. */
  readonly VITE_DISABLE_COMPANION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
