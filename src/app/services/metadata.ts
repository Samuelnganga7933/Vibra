/**
 * metadata.ts — fills the Album column for table rows.
 *
 * The live engine's search carries no album field (only id/title/artist/
 * duration/cover), so table views ask the BFF's cached `/meta/albums`
 * enrichment in one batch per row set. Results (including misses) persist
 * locally, so each track is looked up at most once.
 */

import { bffJson } from "./bff";

const CACHE_KEY = "vibra_album_cache_v2";
const CACHE_MAX = 600;

interface AlbumQuery {
  id: string;
  title: string;
  artist?: string;
}

const memory = new Map<string, string | null>();

function cacheKey(track: AlbumQuery): string {
  return `${(track.artist ?? "").trim().toLowerCase()}|${track.title.trim().toLowerCase()}`;
}

function readCache(): Record<string, string | null> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string | null>;
  } catch {
    return {};
  }
}

function writeCache(entries: Record<string, string | null>): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {
    /* quota/private mode — the memory cache still serves this session */
  }
}

/**
 * Album names for the given tracks, keyed by track id. Resolves `[]`-style
 * failures to an empty object (rows render an em dash) and never rejects.
 */
export async function fetchAlbums(tracks: AlbumQuery[]): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const pending: AlbumQuery[] = [];
  const stored = readCache();

  for (const track of tracks) {
    const key = cacheKey(track);
    const cached = memory.has(key) ? memory.get(key) : (key in stored ? stored[key] : undefined);
    if (cached !== undefined) {
      if (cached) found[track.id] = cached;
    } else {
      pending.push(track);
    }
  }
  if (pending.length === 0) return found;

  const response = await bffJson<Record<string, string | null>>("/meta/albums", {
    method: "POST",
    body: JSON.stringify({ tracks: pending.slice(0, 30) }),
  });
  if (!response) return found;

  const additions: Record<string, string | null> = {};
  for (const track of pending) {
    const album = response[track.id] ?? null;
    const key = cacheKey(track);
    memory.set(key, album);
    additions[key] = album;
    if (album) found[track.id] = album;
  }
  const merged = { ...stored, ...additions };
  const keys = Object.keys(merged);
  if (keys.length > CACHE_MAX) {
    for (const key of keys.slice(CACHE_MAX)) delete merged[key];
  }
  writeCache(merged);
  return found;
}
