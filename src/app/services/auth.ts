/**
 * auth.ts — register / login / logout against the Vibra BFF.
 *
 * The token is an opaque bearer stored in localStorage; every bff.ts request
 * attaches it. All functions resolve `null` on failure (offline, invalid
 * credentials, BFF down) so screens can render inline errors instead of
 * crashing.
 */

import { bffJson, bffSend, setSessionToken } from "./bff";

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

async function post(path: string, body: Record<string, unknown>): Promise<AuthResponse | null> {
  return bffJson<AuthResponse>(path, { method: "POST", body: JSON.stringify(body) });
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResponse | null> {
  const result = await post("/auth/register", input);
  if (result?.token) setSessionToken(result.token);
  return result?.token && result.user ? result : null;
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<AuthResponse | null> {
  const result = await post("/auth/login", input);
  if (result?.token) setSessionToken(result.token);
  return result?.token && result.user ? result : null;
}

export async function logoutUser(): Promise<void> {
  await bffSend("/auth/logout", { method: "POST" });
  setSessionToken(null);
}
