/**
 * localAudio — downloaded-track storage and lookup.
 *
 * Native: a real file under Downloads/Vybra (visible in the phone's Files app),
 * streamed into <audio> through a MediaStore content URI. Web: a native
 * browser file download from the backend's returned download URL.
 *
 * Every call is failure-tolerant: blocked storage, a deleted file or a cold
 * database degrades to "no local copy" and the caller falls through to
 * streaming. Presence in the metadata list alone never counts as downloaded —
 * old metadata-only "saves" correctly read as not-downloaded.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { API_BASE, getDownloadDescriptor, getDownloadUrl, searchTracks } from "./api";
import { BFF_BASE } from "./bff";
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

function absoluteDownloadUrl(raw: string): string {
  try {
    // The catalogue returns /api/audio/...; that route belongs to the BFF,
    // not the catalogue host that returned the descriptor.
    return new URL(raw, BFF_BASE || API_BASE).href;
  } catch {
    return raw;
  }
}

function looksLikeVideoId(value: string | undefined): boolean {
  return !!value && /^[A-Za-z0-9_-]{10,16}$/.test(value);
}

async function resolveDownloadVideoId(track: DownloadableTrack, id: string): Promise<string | null> {
  const direct = track.videoId?.trim() || id.trim();
  if (looksLikeVideoId(direct)) return direct;
  const query = `${track.title} ${track.artist}`.trim();
  if (!query) return null;
  const hits = await searchTracks(query, 5);
  const hit = hits.find(item => looksLikeVideoId(item.videoId ?? item.id));
  return hit?.videoId ?? (hit && looksLikeVideoId(hit.id) ? hit.id : null);
}

/**
 * Resolve the phone-direct and backend download sources concurrently. Yield
 * each source as soon as it is ready so a slow resolver cannot hold up the
 * first byte from a faster alternative.
 */
function streamCandidates(videoId: string): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      const ready: string[] = [];
      const seen = new Set<string>();
      let pending = 0;
      let wake: (() => void) | undefined;
      const add = (url: string | null) => {
        if (url && !seen.has(url)) {
          seen.add(url);
          ready.push(url);
          wake?.();
          wake = undefined;
        }
      };
      const start = (request: Promise<string | null>) => {
        pending += 1;
        void request.then(add, () => {}).finally(() => {
          pending -= 1;
          wake?.();
          wake = undefined;
        });
      };

      // The proxy URL is usable immediately; do not wait for descriptor JSON.
      start(Promise.resolve(getDownloadUrl(videoId)));
      start(resolveOnDevice(videoId).then(result => result?.url ?? null));
      if (videoId.length > 0 && videoId.length <= 20) {
        start(getDownloadDescriptor(videoId).then(descriptor => descriptor?.download_url ? absoluteDownloadUrl(descriptor.download_url) : null));
      }

      return (async function* () {
        while (ready.length > 0 || pending > 0) {
          if (ready.length > 0) {
            yield ready.shift()!;
            continue;
          }
          await new Promise<void>(resolve => {
            wake = resolve;
            if (ready.length > 0 || pending === 0) {
              const resume = wake;
              wake = undefined;
              resume();
            }
          });
        }
      })();
    },
  };
}

function toMeta(track: DownloadableTrack): OfflineTrack {
  return {
    id: track.id,
    videoId: track.videoId,
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
  const videoId = await resolveDownloadVideoId(track, id);
  if (!videoId) return "failed";

  const fileName = `${sanitizeFileName(`${track.artist} - ${track.title}`)}.m4a`;
  // This is a temporary file in the app cache. Keep it flat: Capacitor's
  // Android downloadFile() does not create nested parent directories, so a
  // path such as Cache/Vybra/name.m4a fails on a fresh install.
  const relativePath = fileName;
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
          connectTimeout: 8_000,
          // A dead/stalled source should fail over quickly instead of holding
          // up the other already-resolved URL for a full minute.
          // No new bytes for 20s fails the download
          // instead of spinning forever on an interrupted stream.
          readTimeout: 20_000,
        });
      } catch (err) { lastError = err; return undefined; }
    };
    for await (const url of streamCandidates(videoId)) {
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
  // Desktop downloads must be real browser downloads. Buffering a multi-MB
  // audio file into fetch/IndexedDB was slow, quota-sensitive, and produced
  // truncated files when the proxy returned a ranged response.
  try {
    const sourceId = await resolveDownloadVideoId(track, id);
    if (!sourceId) return "failed";
    const descriptor = await getDownloadDescriptor(sourceId);
    const downloadUrl = descriptor?.download_url ? absoluteDownloadUrl(descriptor.download_url) : getDownloadUrl(sourceId);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `${sanitizeFileName(`${track.artist} - ${track.title}`)}.m4a`;
    a.rel = "noopener";
    document.body.appendChild(a);
    onProgress?.(0);
    a.click();
    a.remove();
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

/** Raw native URI for the Android service player; unlike the WebView URL this
 *  can be opened directly by ExoPlayer while the app is backgrounded. */
export async function getNativeLocalAudioUri(id: string): Promise<string | null> {
  if (!isNativePlatform()) return null;
  try {
    const meta = metaFor(id);
    if (!meta?.filePath) return null;
    if (meta.fileDir === DOWNLOADS_DIR) return meta.filePath;
    if (meta.fileDir) {
      const { uri } = await Filesystem.getUri({
        path: meta.filePath,
        directory: meta.fileDir as Directory,
      });
      return uri || null;
    }
    return null;
  } catch {
    return null;
  }
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
