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
    : "https://backend-des-vybra.onrender.com");

export const BFF_BASE = RAW_BFF.replace(/\/+$/, "");

// ─── Session ──────────────────────────────────────────────────────────────────
const TOKEN_KEY = "vibra_session_token";

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked — in-memory session only */
  }
}

export function isSignedIn(): boolean {
  return getSessionToken() !== null;
}

// ─── Session expiry ───────────────────────────────────────────────────────────
// A 401 means the stored token no longer matches a live server session
// (rotated elsewhere, or logged out on another device). We drop the dead
// token and let the app fall back to signed-out.
type SessionExpiredListener = () => void;
const expiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  expiredListeners.add(listener);
  return () => { expiredListeners.delete(listener); };
}

function dropDeadSession(response: Response): boolean {
  if (response.status !== 401) return false;
  if (getSessionToken() !== null) {
    setSessionToken(null);
    expiredListeners.forEach(listener => {
      try { listener(); } catch { /* a broken listener must not break the request */ }
    });
  }
  return true;
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

/** Fire-and-forget request; resolves `true` only on a 2xx. Never throws. */
export async function bffSend(path: string, init?: RequestInit): Promise<boolean> {
  if (!BFF_BASE) return false;
  const response = await safeFetch(`${BFF_BASE}${path}`, {
    ...init,
    quiet: true,
    timeoutMs: 6000,
    headers: headers(init),
    accept: r => r.status === 401,
  });
  if (response === null) return false;
  return !dropDeadSession(response) && response.ok;
}
