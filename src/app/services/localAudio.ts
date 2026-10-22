/**
 * localAudio — downloaded-track storage and lookup.
 *
 * Native: a real file under Documents/Vybra (visible in the phone's Files app),
 * streamed into <audio> through Capacitor's local asset server. Web: an
 * IndexedDB blob (the BFF proxies googlevideo because it sets no CORS header
 * for our origin).
 *
 * Every call is failure-tolerant: blocked storage, a deleted file or a cold
 * database degrades to "no local copy" and the caller falls through to
 * streaming. Presence in the metadata list alone never counts as downloaded —
 * old metadata-only "saves" correctly read as not-downloaded.
 */
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { getDownloadUrl } from "./api";
import { isNativePlatform, resolveOnDevice } from "./deviceAudio";
import {
  addOfflineTrack,
  clearOfflineTracks,
  readOfflineTracks,
  writeOfflineTracks,
  type OfflineTrack,
} from "./offlineStorage";

export type SaveOutcome = "saved" | "already" | "failed";

export interface DownloadableTrack {
  id: string | number;
  title: string;
  artist: string;
  duration?: string;
  bg?: string;
  imageUrl?: string;
  videoId?: string;
}

// ─── IndexedDB blob store (web) ────────────────────────────────────────────────

const DB_NAME = "vibra_offline_audio";
const STORE = "audio";
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function idbRun<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDb().then(db => new Promise<T | null>(resolve => {
    if (!db) { resolve(null); return; }
    try {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve((request.result ?? null) as T | null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

// ─── Metadata helpers ─────────────────────────────────────────────────────────

function metaFor(id: string): OfflineTrack | undefined {
  return readOfflineTracks().find(t => String(t.id) === id);
}

/** Replaces (or inserts) the entry for one id — later wins. */
function putMeta(entry: OfflineTrack): void {
  const id = String(entry.id);
  writeOfflineTracks([
    entry,
    ...readOfflineTracks().filter(t => String(t.id) !== id),
  ]);
}

export function removeOfflineMeta(id: string): void {
  writeOfflineTracks(readOfflineTracks().filter(t => String(t.id) !== id));
}

function sanitizeFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
  return (clean || "track").slice(0, 80);
}

function toMeta(track: DownloadableTrack): OfflineTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    bg: track.bg,
    imageUrl: track.imageUrl,
  };
}

// ─── Save ─────────────────────────────────────────────────────────────────────

/**
 * Downloads one track for keeps. `onProgress` gets 0..1 while the native
 * downloader reports chunks (web fetches report only completion).
 * Resolves "failed" rather than throwing — the menu shows one calm toast.
 */
export async function saveDownload(
  track: DownloadableTrack,
  onProgress?: (fraction: number | null) => void,
): Promise<SaveOutcome> {
  const id = String(track.id);
  if (!id) return "failed";
  if (await hasDownload(id)) return "already";
  const outcome = isNativePlatform()
    ? await saveNative(track, id, onProgress)
    : await saveWeb(track, id, onProgress);
  if (outcome === "saved") putMeta(toMeta(track));
  return outcome;
}

async function saveNative(
  track: DownloadableTrack,
  id: string,
  onProgress?: (fraction: number | null) => void,
): Promise<SaveOutcome> {
  const videoId = (track.videoId ?? id).trim();
  const resolved = await resolveOnDevice(videoId);
  if (!resolved?.url) return "failed";

  const fileName = `${sanitizeFileName(`${track.artist} - ${track.title}`)}.m4a`;
  const relativePath = `Vybra/${fileName}`;
  const listener = onProgress
    ? await Filesystem.addListener("progress", progress => {
        if (progress.contentLength > 0) {
          onProgress(Math.min(1, progress.bytes / progress.contentLength));
        }
      })
    : null;

  try {
    let directory = Directory.Documents;
    let written: { path?: string } | undefined;
    try {
      written = await Filesystem.downloadFile({
        url: resolved.url,
        path: relativePath,
        directory,
        progress: !!onProgress,
        recursive: true,
        connectTimeout: 15_000,
        readTimeout: 180_000,
      });
    } catch {
      // Android ≤9 without the legacy storage grant can't write the
      // public folder — app-private storage keeps the download working
      // on-device, just out of the public Files app.
      directory = Directory.Data;
      written = await Filesystem.downloadFile({
        url: resolved.url,
        path: relativePath,
        directory,
        progress: !!onProgress,
        recursive: true,
        connectTimeout: 15_000,
        readTimeout: 180_000,
      });
    }
    if (!written?.path) return "failed";
    const meta = toMeta(track);
    meta.filePath = relativePath;
    meta.fileDir = directory;
    putMeta(meta);
    onProgress?.(1);
    return "saved";
  } catch {
    return "failed";
  } finally {
    void listener?.remove?.();
  }
}

async function saveWeb(
  _track: DownloadableTrack,
  id: string,
  onProgress?: (fraction: number | null) => void,
): Promise<SaveOutcome> {
  try {
    const response = await fetch(getDownloadUrl(id), { headers: { Range: "bytes=0-" } });
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!response.ok || type.startsWith("application/json") || type.startsWith("text/")) {
      return "failed";
    }
    const blob = await response.blob();
    if (blob.size < 20_000) return "failed";
    const stored = await idbRun<IDBValidKey>("readwrite", store => store.put({ id, blob }));
    if (stored === null) return "failed";
    onProgress?.(1);
    return "saved";
  } catch {
    return "failed";
  }
}

// ─── Presence ─────────────────────────────────────────────────────────────────

export async function hasDownload(id: string): Promise<boolean> {
  const meta = metaFor(id);
  if (meta?.filePath && isNativePlatform()) {
    try {
      await Filesystem.stat({ path: meta.filePath, directory: meta.fileDir as Directory });
      return true;
    } catch {
      removeOfflineMeta(id); // file vanished (user deleted it in Files) — heal the list
      return false;
    }
  }
  const entry = await idbRun<{ id: string }>("readonly", store => store.get(id));
  return !!entry;
}

// ─── Playback ─────────────────────────────────────────────────────────────────

const objectUrls = new Map<string, string>();

/** Local playable URL (object URL / Capacitor asset) or null when not saved. */
export async function getLocalAudioUrl(id: string): Promise<string | null> {
  try {
    const meta = metaFor(id);
    if (meta?.filePath && meta.fileDir && isNativePlatform()) {
      const { uri } = await Filesystem.getUri({
        path: meta.filePath,
        directory: meta.fileDir as Directory,
      });
      const src = Capacitor.convertFileSrc(uri);
      if (src) return src;
    }
    const entry = await idbRun<{ id: string; blob: Blob }>("readonly", store => store.get(id));
    const blob = entry?.blob;
    if (blob && blob.size > 0) {
      let url = objectUrls.get(id);
      if (!url) {
        url = URL.createObjectURL(blob);
        objectUrls.set(id, url);
      }
      return url;
    }
  } catch {
    /* fall through — streaming will pick it up */
  }
  return null;
}

// ─── Remove ───────────────────────────────────────────────────────────────────

export async function removeDownload(id: string): Promise<void> {
  const meta = metaFor(id);
  if (meta?.filePath && meta.fileDir) {
    try {
      await Filesystem.deleteFile({ path: meta.filePath, directory: meta.fileDir as Directory });
    } catch {
      /* already gone */
    }
  }
  await idbRun("readwrite", store => store.delete(id));
  removeOfflineMeta(id);
  const url = objectUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }
}

/** Clears every local copy (files, blobs, metadata) behind the view's confirm. */
export async function removeAllDownloads(): Promise<void> {
  const all = readOfflineTracks();
  for (const meta of all) {
    const id = String(meta.id);
    if (meta.filePath && meta.fileDir) {
      try {
        await Filesystem.deleteFile({ path: meta.filePath, directory: meta.fileDir as Directory });
      } catch {
        /* already gone */
      }
    }
    await idbRun("readwrite", store => store.delete(id));
    const url = objectUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrls.delete(id);
    }
  }
  clearOfflineTracks();
}
