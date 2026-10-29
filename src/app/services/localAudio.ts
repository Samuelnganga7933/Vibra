/**
 * localAudio — downloaded-track storage and lookup.
 *
 * Native: a real file under Downloads/Vybra (visible in the phone's Files app),
 * streamed into <audio> through a MediaStore content URI. Web: an
 * IndexedDB blob (the BFF proxies googlevideo because it sets no CORS header
 * for our origin).
 *
 * Every call is failure-tolerant: blocked storage, a deleted file or a cold
 * database degrades to "no local copy" and the caller falls through to
 * streaming. Presence in the metadata list alone never counts as downloaded —
 * old metadata-only "saves" correctly read as not-downloaded.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
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

/** VybraMedia extras that land finished downloads in the phone's Download/Vybra. */
const Media = registerPlugin<{
  saveToDownloads(opts: { source: string; fileName: string }): Promise<{ path: string; size: number }>;
  fileExists(opts: { path: string }): Promise<{ exists: boolean; size: number }>;
  deleteDownloadFile(opts: { path: string }): Promise<void>;
}>("VybraMedia");

/** Meta marker: filePath is a MediaStore content URI on Android 10+. */
const DOWNLOADS_DIR = "Downloads";

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
  // Each path writes its own metadata (native: filePath + size; web: size).
  if (!isNativePlatform()) return await saveWeb(track, id, onProgress);
  // Native saves are QUEUED: the Filesystem "progress" channel is global, so
  // two concurrent downloads would interleave bytes and show each other's
  // percentages. One at a time keeps every row's % truthful. A failed or
  // thrown save must never stall the queue — hence the ignored reject handler.
  const run = () => saveNative(track, id, onProgress);
  const next = nativeSaveChain.then(run, run);
  nativeSaveChain = next.catch(() => { /* row already surfaced the failure */ });
  return await next;
}

/** Tail of the native-save queue (see saveDownload). */
let nativeSaveChain: Promise<unknown> = Promise.resolve();

async function saveNative(
  track: DownloadableTrack,
  id: string,
  onProgress?: (fraction: number | null) => void,
): Promise<SaveOutcome> {
  const videoId = (track.videoId ?? id).trim();
  // Two sources, same as playback: the phone's own innertube resolution
  // (fastest, unciphhered), then the BFF proxy stream — so a resolution
  // failure on the phone's network can never make Download dead-end.
  const sources: string[] = [];
  const resolved = await resolveOnDevice(videoId);
  if (resolved?.url) sources.push(resolved.url);
  if (videoId.length > 0 && videoId.length <= 20) sources.push(getDownloadUrl(videoId));
  if (sources.length === 0) return "failed";

  const fileName = `${sanitizeFileName(`${track.artist} - ${track.title}`)}.m4a`;
  // Public Downloads/Vybra — visible straight from the phone's Downloads app
  // and file managers (scoped-storage Documents hides the folder on modern
  // Android, which made downloads look like they never happened).
  const relativePath = `Vybra/${fileName}`;
  let totalBytes = 0;
  const listener = onProgress
    ? await Filesystem.addListener("progress", progress => {
        if (progress.contentLength > 0) {
          totalBytes = progress.contentLength;
          onProgress(Math.min(1, progress.bytes / progress.contentLength));
        }
      })
    : null;

  try {
    // Fast temp write into the app cache, then the native move into the
    // phone's public Download/Vybra folder (what the user actually sees in
    // the Downloads app). Cache is always writable, so the move step can
    // only fail on exotic OEM MediaStore builds — then the cache copy
    // stays as the offline source.
    let written: { path?: string } | undefined;
    let lastError: unknown = null;
    const attempt = async (url: string): Promise<{ path?: string } | undefined> => {
      try {
        return await Filesystem.downloadFile({
          url,
          path: relativePath,
          directory: Directory.Cache,
          progress: !!onProgress,
          recursive: true,
          connectTimeout: 15_000,
          // Strict stall limit: no new bytes for 60s fails the download
          // instead of spinning forever on an interrupted stream.
          readTimeout: 60_000,
        });
      } catch (err) { lastError = err; return undefined; }
    };
    for (const url of sources) {
      written = await attempt(url);
      if (written?.path) break;
    }
    if (!written?.path) { console.warn("[vibra] download failed", lastError); return "failed"; }

    let size = totalBytes;
    if (!size) {
      try { size = (await Filesystem.stat({ path: relativePath, directory: Directory.Cache })).size ?? 0; } catch { size = 0; }
    }

    const meta = toMeta(track);
    try {
      const moved = await Media.saveToDownloads({ source: written.path, fileName });
      try { await Filesystem.deleteFile({ path: relativePath, directory: Directory.Cache }); } catch { /* cache copy gone */ }
      meta.filePath = moved.path;
      meta.fileDir = DOWNLOADS_DIR;
      if (moved.size > 0) meta.sizeBytes = moved.size;
    } catch {
      // MediaStore move failed — keep the cache-dir copy; still offline-proof.
      meta.filePath = relativePath;
      meta.fileDir = Directory.Cache;
    }
    if (!meta.sizeBytes && size > 0) meta.sizeBytes = size;
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
  track: DownloadableTrack,
  id: string,
  onProgress?: (fraction: number | null) => void,
): Promise<SaveOutcome> {
  // Stall watchdog (not a total cap): abort only when NO byte arrives for
  // 60s. A slow-but-flowing BFF proxy download is allowed to finish; an
  // interrupted stream dies within a minute instead of spinning forever.
  // Credentials ride along so a cookie-gated proxy keeps working too.
  const controller = new AbortController();
  let watchdog = setTimeout(() => controller.abort(), 60_000);
  const poke = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => controller.abort(), 60_000);
  };
  try {
    const response = await fetch(getDownloadUrl(id), {
      headers: { Range: "bytes=0-" },
      signal: controller.signal,
      credentials: "include",
    });
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!response.ok || type.startsWith("application/json") || type.startsWith("text/")) {
      return "failed";
    }
    const total = Number(response.headers.get("content-length")) || 0;
    // Stream the body so in-flight rows can show real percentages (a whole
    // response.blob() only ever reports 0% then 100%) — and so the watchdog
    // can be reset on every chunk.
    let blob: Blob;
    const reader = response.body?.getReader?.();
    if (reader) {
      const chunks: BlobPart[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        poke();
        chunks.push(value);
        received += value.length;
        if (total > 0 && onProgress) onProgress(Math.min(1, received / total));
      }
      blob = new Blob(chunks, { type: type || "audio/mp4" });
    } else {
      blob = await response.blob();
      poke();
    }
    if (blob.size < 20_000) return "failed";
    const stored = await idbRun<IDBValidKey>("readwrite", store => store.put({ id, blob }));
    if (stored === null) return "failed";
    // The web path owns its own metadata write — a shared putMeta in
    // saveDownload used to run after saveNative too, wiping the filePath
    // that native local playback depends on.
    const meta = toMeta(track);
    meta.sizeBytes = blob.size;
    putMeta(meta);
    onProgress?.(1);
    return "saved";
  } catch {
    return "failed";
  } finally {
    clearTimeout(watchdog); // no orphaned abort timers after success/failure
  }
}

// ─── Presence ─────────────────────────────────────────────────────────────────

export async function hasDownload(id: string): Promise<boolean> {
  const meta = metaFor(id);
  if (meta?.filePath && isNativePlatform()) {
    try {
      if (meta.fileDir === DOWNLOADS_DIR) {
        const res = await Media.fileExists({ path: meta.filePath });
        if (!res.exists) { removeOfflineMeta(id); return false; }
        return true;
      }
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
    if (meta?.filePath && isNativePlatform()) {
      if (meta.fileDir === DOWNLOADS_DIR) {
        // MediaStore content URI — the WebView bridge serves it through the
        // scoped-storage-safe content bridge.
        const src = Capacitor.convertFileSrc(meta.filePath);
        if (src) return src;
      } else if (meta.fileDir) {
        const { uri } = await Filesystem.getUri({
          path: meta.filePath,
          directory: meta.fileDir as Directory,
        });
        const src = Capacitor.convertFileSrc(uri);
        if (src) return src;
      }
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
  if (meta?.filePath) {
    try {
      if (meta.fileDir === DOWNLOADS_DIR) await Media.deleteDownloadFile({ path: meta.filePath });
      else if (meta.fileDir) await Filesystem.deleteFile({ path: meta.filePath, directory: meta.fileDir as Directory });
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
    if (meta.filePath) {
      try {
        if (meta.fileDir === DOWNLOADS_DIR) await Media.deleteDownloadFile({ path: meta.filePath });
        else if (meta.fileDir) await Filesystem.deleteFile({ path: meta.filePath, directory: meta.fileDir as Directory });
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
