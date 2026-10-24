/**
 * bff.ts — client for the Vibra user BFF (backend/main.py).
 *
 * The audio engine (api.ts) and the user backend are separate services:
 * audio/search goes to VITE_API_BASE_URL, everything account- and
 * history-shaped goes here. All calls run through safeFetch, so an unreachable
 * BFF degrades to `null`/`false` quietly — never a crash.
 */

import { safeFetch } from "./safeFetch";

// Env first; otherwise dev servers talk to the local BFF and production
// builds fall back to the deployed backend — never localhost in the browser.
const RAW_BFF: string =
  ((import.meta.env.VITE_BFF_BASE_URL as string | undefined) ?? "").trim() ||
  (import.meta.env.DEV
    ? "http://localhost:8000"
    : "https://bff.vybra.streamvy.me");

export const BFF_BASE = RAW_BFF.replace(/\/+$/, "");

// ─── Session ──────────────────────────────────────────────────────────────────
const TOKEN_KEY = "vibra_session_token";
/**
 * Set on explicit sign-out, cleared by the next successful sign-in. The
 * WebView's Neon Auth cookie outlives the app's token, so without this marker
 * the bootstrap's silent cookie exchange re-minted a session and signing out
 * never stuck on the APK.
 */
const SIGNED_OUT_KEY = "vibra_signed_out";

/**
 * Tracks which token has already triggered an expiry event, so a burst of
 * parallel 401s causes exactly ONE recovery attempt rather than N sign-outs.
 * Cleared by `setSessionToken` whenever the token changes (see below) — a
 * freshly minted token must be free to fail on its own terms later.
 */
let expiryFiredFor: string | null = null;

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  // A token change means the expiry bookkeeping (below) is stale — a fresh
  // token must be allowed to trigger its own recovery if it later dies.
  expiryFiredFor = null;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
      // Any live token means a real sign-in happened — lift the sign-out
      // marker (login, register and the OAuth exchange all land here).
      window.localStorage.removeItem(SIGNED_OUT_KEY);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* storage blocked — in-memory session only */
  }
}

/** Records the user's intent to sign out before any network call can fail. */
export function markSignedOut(): void {
  try {
    window.localStorage.setItem(SIGNED_OUT_KEY, "1");
  } catch { /* storage blocked — nothing to resurrect anyway */ }
}

/**
 * One-time Google OAuth handoff (`#vibra_token=…`, `?vibra_token=…`).
 * The BFF bounces straight back here after Google confirms; the bearer is
 * moved into storage and scrubbed from the URL *before React boots* — the
 * hash belongs to the router, so a stray `vibra_token` must never survive
 * into routing.
 */
function consumeAuthHandoff(): void {
  try {
    const url = new URL(window.location.href);
    let token: string | null = null;
    if (url.hash.includes("vibra_token=")) {
      const params = new URLSearchParams(url.hash.replace(/^#\/?/, ""));
      token = params.get("vibra_token");
      params.delete("vibra_token");
      const rest = params.toString();
      url.hash = rest ? `#${rest}` : "";
    }
    if (!token) {
      token = url.searchParams.get("vibra_token");
      url.searchParams.delete("vibra_token");
    }
    if (!token) return;
    setSessionToken(token);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    /* never block boot on a cosmetic URL cleanup */
  }
}
consumeAuthHandoff();

/** True until the next successful sign-in — bootstrap skips the cookie exchange. */
export function hasSignedOutMarker(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function isSignedIn(): boolean {
  return getSessionToken() !== null;
}

// ─── Session expiry ───────────────────────────────────────────────────────────
// A 401 *from a server that actually answered* means the stored token no
// longer matches a live session (rotated elsewhere, or signed out on another
// device). We tell the app, which silently re-mints from the Neon cookie.
//
// Crucially we do NOT drop the token here and do NOT fire on network failure:
// an offline phone, a cold BFF or a timed-out fetch must never sign anyone
// out. The token is only cleared once the app has decided the session is
// genuinely dead (see the recovery handler in App.tsx), so a failed recovery
// keeps its credentials and can retry.
type SessionExpiredReason = "expired" | "offline";
type SessionExpiredListener = (reason?: SessionExpiredReason) => void;
const expiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  expiredListeners.add(listener);
  return () => { expiredListeners.delete(listener); };
}

function fireSessionExpired(reason: SessionExpiredReason): void {
  expiredListeners.forEach(listener => {
    try { listener(reason); } catch { /* a broken listener must not break the request */ }
  });
}

/**
 * True when this response means "the token is dead" (as opposed to "the
 * network is down"). Only a real 401 counts — and only once per token, so a
 * burst of parallel 401s triggers a single recovery attempt.
 */
function dropDeadSession(response: Response): boolean {
  if (response.status !== 401) return false;
  const token = getSessionToken();
  if (token === null) return true; // nothing to recover
  if (expiryFiredFor === token) return true; // already recovering this token
  expiryFiredFor = token;
  fireSessionExpired("expired");
  return true;
}

/** Called by the app once it has confirmed a token is truly dead. */
export function clearDeadSession(): void {
  expiryFiredFor = null;
  setSessionToken(null);
}

function headers(init?: RequestInit): Record<string, string> {
  const token = getSessionToken();
  const extra: Record<string, string> = {};
  const raw = init?.headers;
  if (raw instanceof Headers) {
    raw.forEach((value, key) => { extra[key] = value; });
  } else if (Array.isArray(raw)) {
    for (const [key, value] of raw) extra[key] = value;
  } else if (raw) {
    Object.assign(extra, raw);
  }
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// ─── Requests ─────────────────────────────────────────────────────────────────

/** JSON GET against the BFF. Returns `null` on any failure. */
export async function bffJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!BFF_BASE) return null;
  const response = await safeFetch(`${BFF_BASE}${path}`, {
    ...init,
    quiet: true,
    credentials: "include",
    headers: headers(init),
    accept: r => r.status === 401,
  });
  if (!response) return null;
  if (dropDeadSession(response)) return null;
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * JSON GET that reports why it failed. The session-recovery path needs to
 * distinguish "the server answered and rejected our token" (genuinely dead
 * session, safe to sign out) from "the request never got a reply" (offline,
 * cold BFF, timeout — the session must be kept and retried later).
 */
export type Verified<T> =
  | { ok: true; kind: "ok"; data: T }
  | { ok: false; kind: "rejected"; status: number } // server answered, said no
  | { ok: false; kind: "unreachable" };            // no reply at all

export async function bffVerified<T>(path: string, init?: RequestInit): Promise<Verified<T>> {
  if (!BFF_BASE) return { ok: false, kind: "unreachable" };
  const response = await safeFetch(`${BFF_BASE}${path}`, {
    ...init,
    quiet: true,
    credentials: "include",
    headers: headers(init),
    accept: r => r.status === 401,
  });
  // safeFetch resolves null only when the network/timeout failed us.
  if (!response) return { ok: false, kind: "unreachable" };
  if (dropDeadSession(response)) return { ok: false, kind: "rejected", status: response.status };
  try {
    return { ok: true, kind: "ok", data: (await response.json()) as T };
  } catch {
    return { ok: false, kind: "rejected", status: response.status };
  }
}

/** Fire-and-forget request; resolves `true` only on a 2xx. Never throws. */
export async function bffSend(path: string, init?: RequestInit): Promise<boolean> {
  if (!BFF_BASE) return false;
  const response = await safeFetch(`${BFF_BASE}${path}`, {
    ...init,
    quiet: true,
    timeoutMs: 6000,
    // Same as bffJson: the HttpOnly session cookie rides along cross-origin,
    // so cookie-auth calls (events, settings, logout) work without a bearer.
    credentials: "include",
    headers: headers(init),
    accept: r => r.status === 401,
  });
  if (response === null) return false;
  return !dropDeadSession(response) && response.ok;
}
