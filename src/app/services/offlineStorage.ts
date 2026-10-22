/**
 * Offline storage — the local cache behind the Downloads view.
 * Every access is failure-tolerant: blocked storage, quota errors and
 * malformed JSON all degrade to safe defaults instead of throwing.
 */

export const OFFLINE_STORAGE_KEY = "vibra_downloads";
export const OFFLINE_CLEARED_KEY = "vibra_downloads_cleared";

export interface OfflineTrack {
  id: string | number;
  title: string;
  artist: string;
  duration?: string;
  bg?: string;
  imageUrl?: string;
  previewUrl?: string;
  streamUrl?: string;
  /** Relative path of the real file on the phone (native downloads only). */
  filePath?: string;
  /** Filesystem directory value the file lives in ("music", "data", …). */
  fileDir?: string;
}

function isTrack(value: unknown): value is OfflineTrack {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return typeof t.id !== "undefined" && typeof t.title === "string";
}

/** Parses the stored tracks array; malformed or hostile data resolves to []. */
export function readOfflineTracks(): OfflineTrack[] {
  try {
    const raw = window.localStorage.getItem(OFFLINE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrack).slice(0, 500);
  } catch {
    return [];
  }
}

export function writeOfflineTracks(tracks: OfflineTrack[]): void {
  try {
    window.localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(tracks));
  } catch {
    /* quota exceeded or storage disabled — callers keep working in memory */
  }
}

/** Adds one track to the cache (no duplicates) and lifts a cleared marker. */
export function addOfflineTrack(track: OfflineTrack): void {
  const merged = mergeOfflineTracks(readOfflineTracks(), [track]);
  writeOfflineTracks(merged);
  unmarkOfflineCleared();
}

/** Removes the cache and marks it cleared until the next explicit sync. */
export function clearOfflineTracks(): void {
  try {
    window.localStorage.removeItem(OFFLINE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.setItem(OFFLINE_CLEARED_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function unmarkOfflineCleared(): void {
  try {
    window.localStorage.removeItem(OFFLINE_CLEARED_KEY);
  } catch {
    /* ignore */
  }
}

export function wasOfflineCleared(): boolean {
  try {
    return window.localStorage.getItem(OFFLINE_CLEARED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Deduplicates two track lists by id, preserving first-seen order. */
export function mergeOfflineTracks(a: OfflineTrack[], b: OfflineTrack[]): OfflineTrack[] {
  const seen = new Set<string>();
  const out: OfflineTrack[] = [];
  for (const t of [...a, ...b]) {
    if (!isTrack(t)) continue;
    const key = String(t.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
