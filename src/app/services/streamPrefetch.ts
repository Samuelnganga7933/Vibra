import { getStreamUrl } from "./api";

/**
 * Warm the BFF/YouTube resolver ahead of intent without downloading whole songs.
 * The media element asks for metadata only; the short lifetime keeps memory and
 * bandwidth bounded while still warming the server-side URL cache and TLS path.
 */
const warmed = new Map<string, number>();
const pending = new Map<string, HTMLAudioElement>();
const MAX_WARMED = 32;
const WARM_TTL_MS = 10 * 60_000;
const CLEANUP_MS = 20_000;

function validVideoId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(value);
}

export function prefetchStream(videoId?: string, streamUrl?: string): void {
  const url = streamUrl || (validVideoId(videoId) ? getStreamUrl(videoId) : "");
  if (!url || typeof window === "undefined") return;

  const now = Date.now();
  const at = warmed.get(url);
  if (at && now - at < WARM_TTL_MS) return;
  if (pending.has(url)) return;

  // Keep the warm set small and discard expired entries opportunistically.
  for (const [key, timestamp] of warmed) {
    if (now - timestamp >= WARM_TTL_MS) warmed.delete(key);
  }
  while (warmed.size >= MAX_WARMED) {
    const oldest = warmed.keys().next().value as string | undefined;
    if (!oldest) break;
    warmed.delete(oldest);
  }

  const audio = new Audio();
  audio.preload = "metadata";
  audio.muted = true;
  pending.set(url, audio);
  audio.addEventListener("loadedmetadata", () => {
    warmed.set(url, Date.now());
    window.setTimeout(() => {
      if (!pending.has(url)) return;
      pending.delete(url);
      audio.src = "";
      audio.load();
    }, CLEANUP_MS);
  }, { once: true });
  audio.addEventListener("error", () => pending.delete(url), { once: true });
  audio.src = url;
  audio.load();
}

/** Claim a warmed element so playback can continue from its existing buffer. */
export function takePrefetchedAudio(videoId?: string, streamUrl?: string): HTMLAudioElement | null {
  const url = streamUrl || (validVideoId(videoId) ? getStreamUrl(videoId) : "");
  if (!url) return null;
  const audio = pending.get(url);
  if (!audio) return null;
  pending.delete(url);
  warmed.set(url, Date.now());
  audio.muted = false;
  return audio;
}

export function prefetchStreams(tracks: Array<{ videoId?: string; streamUrl?: string }>, limit = 6): void {
  // Start only a small batch so prefetching never competes with visible data.
  tracks.slice(0, limit).forEach(track => prefetchStream(track.videoId, track.streamUrl));
}
