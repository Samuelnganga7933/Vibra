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
  /**
   * Returns the response to the caller for specific non-2xx statuses instead
   * of the usual null (used to inspect 401 session expiry). Accepted responses
   * skip the failure bookkeeping — they are not connection problems.
   */
  accept?: (response: Response) => boolean;
}

// ─── Connection store ─────────────────────────────────────────────────────────
type ConnectionListener = (status: ConnectionStatus) => void;

/** The banner stays hidden until this many consecutive pings fail. */
export const FAILURE_THRESHOLD = 3;
const PING_INTERVAL_MS = 30_000;

let connectionStatus: ConnectionStatus = "online";
let consecutiveFailures = 0;
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

/** A successful response clears the streak and restores "online". */
function noteSuccess(): void {
  consecutiveFailures = 0;
  setConnectionStatus("online");
}

/**
 * A failed response only degrades the status after FAILURE_THRESHOLD
 * consecutive failures — single blips and idle background pings never flip
 * the banner. Active timeouts on user-facing requests degrade immediately.
 */
function noteFailure(isTimeout: boolean, quiet: boolean): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    consecutiveFailures += 1;
    setConnectionStatus("offline");
    return;
  }
  consecutiveFailures += 1;
  const activeTimeout = isTimeout && !quiet;
  if (activeTimeout || consecutiveFailures >= FAILURE_THRESHOLD) {
    setConnectionStatus("degraded");
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    consecutiveFailures = 0;
    setConnectionStatus("online");
  });
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
  const { timeoutMs = SAFE_FETCH_TIMEOUT_MS, quiet, fallback: _fallback, accept, ...init } = options;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    noteFailure(false, quiet);
    if (!quiet) warn(url, "offline — device reports no network connection");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });

    if (!response.ok) {
      if (accept && accept(response)) return response;
      noteFailure(false, quiet);
      if (!quiet) {
        warn(url, `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
      }
      return null;
    }

    noteSuccess();
    return response;
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    noteFailure(aborted, quiet);
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
    noteFailure(false, options.quiet);
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

// ─── Background connection monitor ────────────────────────────────────────────
/**
 * Quiet background pings keep the connection status fresh without flashing
 * the banner: a single failed ping is tolerated, the "Connecting to audio
 * nodes…" pill only appears after FAILURE_THRESHOLD consecutive failures (or
 * an active request timeout), and any success clears it again.
 */
export function startConnectionMonitor(baseUrl: string, intervalMs = PING_INTERVAL_MS): () => void {
  if (typeof window === "undefined" || !baseUrl) return () => {};
  const w = window as Window & { __vibraPingTimer?: number };
  if (w.__vibraPingTimer) window.clearInterval(w.__vibraPingTimer);

  const ping = () => {
    void safeJson(baseUrl, { quiet: true, timeoutMs: SAFE_FETCH_TIMEOUT_MS, fallback: {} });
  };
  ping();
  w.__vibraPingTimer = window.setInterval(ping, intervalMs);

  return () => {
    if (w.__vibraPingTimer) window.clearInterval(w.__vibraPingTimer);
    w.__vibraPingTimer = undefined;
  };
}
