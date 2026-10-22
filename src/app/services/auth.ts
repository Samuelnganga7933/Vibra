/**
 * auth.ts — register / login / logout against the Vibra BFF.
 *
 * The token is an opaque bearer stored in localStorage; every bff.ts request
 * attaches it. All functions resolve `null` on failure (offline, invalid
 * credentials, BFF down) so screens can render inline errors instead of
 * crashing.
 */

import { BFF_BASE, bffSend, setSessionToken } from "./bff";
import { safeFetch } from "./safeFetch";
import { clearUserProfile } from "./store";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  username: string;
  initials: string;
  avatarUrl?: string;
  subscription: "free" | "premium";
}

interface AuthResponse {
  token?: string;
  user?: SessionUser;
}

interface AuthResult {
  data: AuthResponse | null;
  /** Server-side reason (password policy, duplicate email, rate limit) — show it inline. */
  error: string | null;
}

/** Mirrors the BFF's registration policy so weak passwords never leave the device. */
export function passwordStrengthError(password: string): string | null {
  if (password.length < 8 || password.length > 128) return "Password must be 8–128 characters long.";
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 2) return "Password must mix letter case, a number or a symbol.";
  if (new Set(password).size <= 2) return "Password is too easy to guess.";
  return null;
}

async function postAuth(path: string, body: Record<string, unknown>): Promise<AuthResult> {
  if (!BFF_BASE) return { data: null, error: null };
  // Through safeFetch like every other call: a hard timeout so a cold Render
  // start can never hang the button; 15s because auth also runs bcrypt.
  // 4xx (wrong password, policy) returns the response so the server's
  // `detail` shows inline — 5xx/timeout/offline fall back to the generic copy.
  const response = await safeFetch(`${BFF_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 15_000,
    accept: r => r.status >= 400 && r.status < 500,
  });
  if (!response) return { data: null, error: null }; // offline / timed out / BFF down
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch { /* non-JSON body */ }
  if (!response.ok) {
    const detail = (parsed as { detail?: unknown } | null)?.detail;
    return { data: null, error: typeof detail === "string" && detail ? detail : null };
  }
  return { data: (parsed ?? null) as AuthResponse | null, error: null };
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  const result = await postAuth("/auth/register", input);
  const token = result.data?.token;
  if (token) setSessionToken(token);
  return { data: token && result.data?.user ? result.data : null, error: result.error };
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const result = await postAuth("/auth/login", input);
  const token = result.data?.token;
  if (token) setSessionToken(token);
  return { data: token && result.data?.user ? result.data : null, error: result.error };
}

export async function logoutUser(): Promise<void> {
  // Tell the server first (bffSend attaches the token), but never let a
  // failed request skip the local clear — an offline logout used to leave the
  // session alive, so the next launch bounced straight back in.
  try {
    await bffSend("/auth/logout", { method: "POST" });
  } catch { /* offline — the server-side session dies on its own expiry */ }
  setSessionToken(null);
  // Explicit sign-out: the cached profile must not resurrect as a
  // "Local profile" half-state on the next load (the gate owns that state).
  clearUserProfile();
}
