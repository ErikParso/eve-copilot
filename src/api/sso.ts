// EVE Single Sign-On (OAuth2 Authorization Code + PKCE) for a browser SPA.
// Docs: https://developers.eveonline.com/docs/services/sso/
//
// Register an app at https://developers.eveonline.com to obtain a client ID,
// set the callback URL to `${origin}/auth/callback`, and request the scopes
// below. No client secret is used (PKCE public client).
//
// Note: the access token is short-lived (~20 min); the refresh token is stored
// in the browser (localStorage) — acceptable for this tool, but a small backend
// token-exchange would be more secure for production. If the token endpoint is
// CORS-blocked in the browser, a tiny proxy is needed for the POST calls.

const AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize/';
const TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';

export const CLIENT_ID = import.meta.env.VITE_EVE_CLIENT_ID ?? '';

/** Scopes requested at login (read status + future in-game actions). */
export const SCOPES = [
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_online.v1',
  'esi-ui.open_window.v1',
  'esi-ui.write_waypoint.v1',
  'esi-universe.read_structures.v1',
];

export function isSsoConfigured(): boolean {
  return CLIENT_ID.length > 0;
}

export function redirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface DecodedToken {
  characterId: number;
  name: string;
  scopes: string[];
  /** Expiry as epoch ms. */
  expiresAt: number;
}

// --- PKCE helpers --------------------------------------------------------

function base64Url(bytes: ArrayBuffer): string {
  let str = '';
  const arr = new Uint8Array(bytes);
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength = 48): string {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return base64Url(arr.buffer);
}

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

export interface PkceChallenge {
  verifier: string;
  state: string;
  url: string;
}

/** Build the authorize URL plus the verifier/state to stash for the callback. */
export async function buildAuthorizeRequest(): Promise<PkceChallenge> {
  const verifier = randomString();
  const state = randomString(16);
  const challenge = base64Url(await sha256(verifier));

  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirectUri(),
    client_id: CLIENT_ID,
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return { verifier, state, url: `${AUTHORIZE_URL}?${params.toString()}` };
}

// --- Token endpoint ------------------------------------------------------

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`SSO token request failed (${res.status})`);
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  return postToken({
    grant_type: 'authorization_code',
    code,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
}

export function refreshToken(refresh: string): Promise<TokenResponse> {
  return postToken({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: CLIENT_ID,
  });
}

/** Decode (not verify) the access-token JWT payload for character info. */
export function decodeToken(accessToken: string): DecodedToken {
  const payloadPart = accessToken.split('.')[1];
  const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
  const payload = JSON.parse(json) as {
    sub: string; // "CHARACTER:EVE:2112000000"
    name: string;
    scp?: string | string[];
    exp: number; // seconds
  };
  const characterId = Number(payload.sub.split(':').pop());
  const scopes = Array.isArray(payload.scp) ? payload.scp : payload.scp ? [payload.scp] : [];
  return { characterId, name: payload.name, scopes, expiresAt: payload.exp * 1000 };
}
