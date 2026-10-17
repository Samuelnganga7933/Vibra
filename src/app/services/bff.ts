/**
 * bff.ts — client for the Vibra user BFF (backend/main.py).
 *
 * The audio engine (api.ts) and the user backend are separate services:
 * audio/search/lyrics go to VITE_API_BASE_URL, everything account- and
 * history-shaped goes here. All calls run through safeFetch, so an unreachable
 * BFF degrades to `null`/`false` quietly — never a crash.
 */

import { safeJson, safeFetch } from "./safeFetch";

const RAW_BFF: string =
  ((import.meta.env.VITE_BFF_BASE_URL as string | undefined) ?? "").trim() ||
  "http://localhost:8000";

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
  return safeJson<T>(`${BFF_BASE}${path}`, {
    ...init,
    quiet: true,
    credentials: "include",
    headers: headers(init),
  });
}

/** Fire-and-forget request; resolves `true` only on a 2xx. Never throws. */
export async function bffSend(path: string, init?: RequestInit): Promise<boolean> {
  if (!BFF_BASE) return false;
  const response = await safeFetch(`${BFF_BASE}${path}`, {
    ...init,
    quiet: true,
    timeoutMs: 6000,
    headers: headers(init),
  });
  return response !== null;
}
