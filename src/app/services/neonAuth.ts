/**
 * neonAuth.ts — Google OAuth via Neon Auth (Managed Better Auth).
 *
 * The "Continue with Google" button on AuthScreen starts the OAuth dance
 * against VITE_NEON_AUTH_URL by calling Better Auth's /sign-in/social
 * endpoint and following the returned Google redirect. After Google sends
 * the browser back, `exchangeNeonSession` reads the session JWT (GET /token)
 * and trades it at the Vibra BFF (/auth/neon) for the normal Vibra bearer,
 * so the rest of the app (library, history, playlists) works unchanged.
 *
 * Plain fetch instead of the better-auth package: the endpoints are the
 * stable Better Auth HTTP surface, and this keeps the client bundle free of
 * the SDK's optional peer-dependency tree.
 */

import { bffJson, setSessionToken } from "./bff";
import type { SessionUser } from "./auth";

const NEON_AUTH_URL: string =
  ((import.meta.env.VITE_NEON_AUTH_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");

export const neonAuthEnabled = NEON_AUTH_URL.length > 0;

interface AuthResponse {
  token?: string;
  user?: SessionUser;
}

/** Kick off Google OAuth. Redirects the browser away on success. */
export async function signInWithGoogle(): Promise<string | null> {
  if (!neonAuthEnabled) return "Google sign-in isn't configured on this branch.";
  try {
    const response = await fetch(`${NEON_AUTH_URL}/sign-in/social`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      // Absolute current origin (plus hash deep link) so Google's round-trip
      // always lands back on this deployment — never a hardcoded domain.
      body: JSON.stringify({ provider: "google", callbackURL: window.location.href }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return body?.message || "Google sign-in failed. Try again.";
    }
    const data = (await response.json().catch(() => null)) as { url?: string } | null;
    if (!data?.url) return "Google sign-in failed. Try again.";
    // Full page redirect to Google → Neon Auth callback → back to the app.
    window.location.assign(data.url);
    return null;
  } catch {
    return "Couldn't reach the sign-in service. Check your connection.";
  }
}

/**
 * After the OAuth redirect: read the Better Auth session's JWT (GET /token,
 * signed EdDSA, verifiable by the BFF against NEON_AUTH_JWKS_URL) and
 * exchange it at the BFF (/auth/neon) for a Vibra bearer, so the rest of the
 * app (library, history, playlists) works unchanged.
 */
export async function exchangeNeonSession(): Promise<SessionUser | null> {
  if (!neonAuthEnabled) return null;
  let idToken: string | null = null;
  try {
    const response = await fetch(`${NEON_AUTH_URL}/token`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (response.ok) {
      const data = (await response.json().catch(() => null)) as { token?: string } | null;
      idToken = data?.token ?? null;
    }
  } catch {
    return null;
  }
  if (!idToken) return null;
  const result = await bffJson<AuthResponse>("/auth/neon", {
    method: "POST",
    body: JSON.stringify({ token: idToken }),
  });
  if (!result?.token || !result.user) return null;
  setSessionToken(result.token);
  return result.user;
}

/** End the Neon Auth session (called on Vibra logout). */
export async function signOutNeon(): Promise<void> {
  if (!neonAuthEnabled) return;
  try {
    await fetch(`${NEON_AUTH_URL}/sign-out`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* best-effort — the Vibra token is already dropped */
  }
}
