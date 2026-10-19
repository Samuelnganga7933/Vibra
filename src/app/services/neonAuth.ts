/**
 * neonAuth.ts — Google OAuth via Neon Auth (Managed Better Auth).
 *
 * Uses the official `@neondatabase/neon-js` auth client: it owns the OAuth
 * dance (redirect/popup), reads the `neon_auth_session_verifier` that Neon
 * appends on the return leg, and exposes `getSession()`/`getToken()` once the
 * session is finalised. We then trade that JWT at the Vibra BFF (/auth/neon)
 * for the normal Vibra bearer, so the rest of the app (library, history,
 * playlists) works unchanged.
 *
 * The verifier lives in `window.location.search` after Google sends the
 * browser back — it must survive until `exchangeNeonSession()` runs; only
 * then is it safe to strip from the address bar.
 */

import { bffJson, setSessionToken } from "./bff";
import type { SessionUser } from "./auth";

const NEON_AUTH_URL: string =
  ((import.meta.env.VITE_NEON_AUTH_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");

export const neonAuthEnabled = NEON_AUTH_URL.length > 0;

// createAuthClient's public type is a union over its adapters; we use the
// default Better Auth vanilla adapter, so narrow to its shape once here.
type AuthClient = {
  signIn: { social: (opts: { provider: "google"; callbackURL: string }) =>
    Promise<{ data?: { url?: string; redirect?: boolean } | null; error?: { message?: string } | null }> };
  getSession: () => Promise<{ data?: { session?: { access_token?: string } | null } | null; error?: unknown }>;
  getToken: () => Promise<{ data?: { token?: string } | null }>;
  signOut: () => Promise<unknown>;
};

let clientPromise: Promise<AuthClient | null> | null = null;
const getClient = async (): Promise<AuthClient | null> => {
  if (!neonAuthEnabled) return null;
  if (!clientPromise) {
    clientPromise = import("@neondatabase/neon-js/auth")
      .then(m => m.createAuthClient(NEON_AUTH_URL) as unknown as AuthClient)
      .catch(() => null);
  }
  return clientPromise;
};

/**
 * Neon Auth appends `?neon_auth_session_verifier=…` when it redirects back
 * from Google. Call this only AFTER `exchangeNeonSession()` — the client
 * forwards the verifier from the URL while finalising the session.
 */
export function clearOAuthQueryParams(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("neon_auth_session_verifier")) return;
    url.searchParams.delete("neon_auth_session_verifier");
    window.history.replaceState(
      window.history.state, "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    /* exotic URL — leaving the parameter is cosmetic, never a blocker */
  }
}

interface AuthResponse {
  token?: string;
  user?: SessionUser;
}

/** Kick off Google OAuth. Redirects the browser away on success. */
export async function signInWithGoogle(): Promise<string | null> {
  const auth = await getClient();
  if (!auth) return "Google sign-in isn't configured on this branch.";
  try {
    const res = (await auth.signIn.social({
      provider: "google",
      callbackURL: window.location.href,
    })) as { data?: { url?: string; redirect?: boolean } | null; error?: { message?: string } | null };
    if (res?.error) return res.error.message || "Google sign-in failed. Try again.";
    const url = res?.data?.url;
    // Some flows navigate on their own — only step in when we still have a URL.
    if (url && !window.location.href.startsWith(url)) {
      window.location.assign(url);
    }
    return null;
  } catch {
    return "Couldn't reach the sign-in service. Check your connection.";
  }
}

/**
 * After the OAuth redirect: finalise the Neon session (verifier + cookies),
 * read the JWT and exchange it at the BFF (/auth/neon) for a Vibra bearer,
 * so the rest of the app works unchanged.
 */
export async function exchangeNeonSession(): Promise<SessionUser | null> {
  const auth = await getClient();
  if (!auth) return null;
  try {
    const sessionRes = (await auth.getSession()) as {
      data?: { session?: { access_token?: string } | null } | null;
      error?: unknown;
    };
    if (sessionRes?.error) return null;

    const tokenRes = (await auth.getToken()) as { data?: { token?: string } | null };
    const idToken =
      tokenRes?.data?.token ?? sessionRes?.data?.session?.access_token ?? null;
    if (!idToken) return null;

    const result = await bffJson<AuthResponse>("/auth/neon", {
      method: "POST",
      body: JSON.stringify({ token: idToken }),
    });
    if (!result?.token || !result.user) return null;
    setSessionToken(result.token);
    return result.user;
  } catch {
    return null;
  }
}

/** End the Neon Auth session (called on Vibra logout). */
export async function signOutNeon(): Promise<void> {
  const auth = await getClient();
  if (!auth) return;
  try {
    await auth.signOut();
  } catch {
    /* best-effort — the Vibra token is already dropped */
  }
}
