/**
 * safeFetch — the single network gateway for Vibra.
 *
 * Guarantees:
 *  - never throws to the caller (4xx / 5xx / timeout / CORS / offline / bad JSON
 *    all resolve to a structured fallback),
 *  - hard 8s timeout via AbortController,
 *  - one clean, formatted console warning per failure for debugging,
 *  - feeds a tiny connection store so the UI can show a calm
 *    "Connecting to audio nodes…" banner instead of crashing.
 */

export const SAFE_FETCH_TIMEOUT_MS = 8000;

export type ConnectionStatus = "online" | "degraded" | "offline";

export interface SafeFetchOptions extends Omit<RequestInit, "signal"> {
  /** Hard timeout in milliseconds. Defaults to 8000. */
  timeoutMs?: number;
  /** Structured value returned when the request cannot be completed. */
  fallback?: unknown;
  /** Suppress the console warning (use for expected background probes). */
  quiet?: boolean;
}

// ─── Connection store ─────────────────────────────────────────────────────────
type ConnectionListener = (status: ConnectionStatus) => void;

let connectionStatus: ConnectionStatus = "online";
const connectionListeners = new Set<ConnectionListener>();

export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus;
}

export function subscribeConnection(listener: ConnectionListener): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

function setConnectionStatus(next: ConnectionStatus): void {
  if (next === connectionStatus) return;
  connectionStatus = next;
  connectionListeners.forEach(listener => {
    try {
      listener(next);
    } catch {
      /* a broken subscriber must never break the network layer */
    }
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setConnectionStatus("online"));
  window.addEventListener("offline", () => setConnectionStatus("offline"));
}

function warn(url: string, detail: string): void {
  console.warn(`[vibra:net] ${url} — ${detail}`);
}

function shortReason(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") return "request aborted";
  if (err instanceof TypeError) return err.message || "network unreachable (CORS or offline)";
  if (err instanceof Error) return err.message;
  return "unknown network failure";
}

// ─── safeFetch ────────────────────────────────────────────────────────────────
/**
 * Performs a request and returns the `Response` on success, or `null` on any
 * failure. Never rejects.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<Response | null> {
  const { timeoutMs = SAFE_FETCH_TIMEOUT_MS, quiet, fallback: _fallback, ...init } = options;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setConnectionStatus("offline");
    if (!quiet) warn(url, "offline — device reports no network connection");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });

    if (!response.ok) {
      setConnectionStatus("degraded");
      if (!quiet) {
        warn(url, `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
      }
      return null;
    }

    setConnectionStatus("online");
    return response;
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    setConnectionStatus(offline ? "offline" : "degraded");
    if (!quiet) {
      warn(url, aborted ? `timed out after ${timeoutMs}ms` : shortReason(err));
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Performs a request and parses JSON, returning `fallback` (default `null`)
 * for every failure mode including schema/parse errors. Never rejects.
 */
export async function safeJson<T>(url: string, options: SafeFetchOptions = {}): Promise<T | null> {
  const fallback = (options.fallback ?? null) as T | null;
  const response = await safeFetch(url, options);
  if (!response) return fallback;

  try {
    return (await response.json()) as T;
  } catch (err) {
    setConnectionStatus("degraded");
    if (!options.quiet) {
      warn(url, `response was not valid JSON (${err instanceof Error ? err.message : "parse error"})`);
    }
    return fallback;
  }
}

/** Like `safeJson`, but always resolves to an array — never `null`. */
export async function safeList<T>(url: string, options: SafeFetchOptions = {}): Promise<T[]> {
  const data = await safeJson<unknown>(url, options);
  return Array.isArray(data) ? (data as T[]) : [];
}
