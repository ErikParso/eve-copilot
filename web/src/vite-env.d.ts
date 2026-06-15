/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** EVE SSO application client ID (from developers.eveonline.com). */
  readonly VITE_EVE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
