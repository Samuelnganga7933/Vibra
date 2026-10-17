/**
 * home.ts — the server-driven Home feed.
 *
 * The UI never talks about learning: it renders whatever shelves come back
 * from `GET /api/home`, in order. When the BFF is unreachable we synthesise
 * the same cold-start shelves from the audio engine so Home is never empty.
 */

import { bffJson, isSignedIn } from "./bff";
import { searchTracks, type ApiTrack } from "./api";
import { getHistory, type StoredTrack } from "./store";
import { sanitizeMusicItems } from "./smartQueue";

export type ShelfType = "jump_back_in" | "mix_row" | "shelf" | "recent";

export interface HomeItem {
  id: string;
  title: string;
  artist?: string;
  subtitle?: string;
  durationSec?: number;
  imageUrl?: string;
  bg?: string;
  /** Video id when the item is directly playable. */
  videoId?: string;
  /** Seed query for mixes/playlists — the client searches it on open. */
  query?: string;
}

export interface HomeShelf {
  id: string;
  type: ShelfType;
  title: string;
  subtitle?: string;
  items: HomeItem[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const parts = value.split(":").map(Number);
    if (parts.length >= 2 && parts.every(p => Number.isFinite(p))) {
      return parts.reduce((acc, p) => acc * 60 + p, 0);
    }
  }
  return undefined;
}

function shelfType(value: unknown): ShelfType {
  return value === "jump_back_in" || value === "mix_row" || value === "recent"
    ? value
    : "shelf";
}

function normalizeItem(raw: unknown): HomeItem | null {
  const r = asRecord(raw);
  if (!r) return null;
  const title = str(r.title) ?? str(r.name);
  const id = str(r.videoId) ?? str(r.video_id) ?? str(r.id) ?? str(r.query);
  if (!title || !id) return null;
  return {
    id,
    title,
    artist: str(r.artist) ?? str(r.artistName) ?? str(r.uploader) ?? str(r.channelTitle),
    subtitle: str(r.subtitle) ?? str(r.description),
    durationSec: num(r.durationSec) ?? num(r.duration),
    imageUrl: str(r.imageUrl) ?? str(r.thumbnail) ?? str(r.coverUrl) ?? str(r.thumb),
    bg: str(r.coverColor) ?? str(r.bg),
    videoId: str(r.videoId) ?? str(r.video_id),
    query: str(r.query),
  };
}

function normalizeShelf(raw: unknown): HomeShelf | null {
  const r = asRecord(raw);
  if (!r) return null;
  const title = str(r.title) ?? str(r.name);
  if (!title) return null;
  const rawItems = Array.isArray(r.items) ? r.items : [];
  return {
    id: str(r.id) ?? `shelf-${title.toLowerCase().replace(/\W+/g, "-")}`,
    type: shelfType(r.type),
    title,
    subtitle: str(r.subtitle),
    items: rawItems.map(normalizeItem).filter((i): i is HomeItem => i !== null),
  };
}

function fromApiTracks(tracks: ApiTrack[], title: string, id: string, type: ShelfType = "shelf"): HomeShelf {
  return {
    id,
    type,
    title,
    items: tracks.map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      durationSec: t.durationSec,
      imageUrl: t.imageUrl,
      videoId: t.videoId ?? t.id,
    })),
  };
}

/** Cold-start shelves built from the audio engine when the BFF is down. */
async function synthesizeShelves(): Promise<HomeShelf[]> {
  const [kenya, trending, fresh] = await Promise.all([
    searchTracks("popular in kenya", 10).catch(() => []),
    searchTracks("trending music", 10).catch(() => []),
    searchTracks("new releases", 10).catch(() => []),
  ]);

  const shelves: HomeShelf[] = [];
  // Music-only + variant dedupe: the engine answers these queries with plenty
  // of slowed/cover duplicates and the odd 20-minute mix.
  if (kenya.length > 0) shelves.push(fromApiTracks(sanitizeMusicItems(kenya), "Popular in Kenya", "region-kenya"));
  if (trending.length > 0) shelves.push(fromApiTracks(sanitizeMusicItems(trending), "Trending now", "trending-now"));
  if (fresh.length > 0) shelves.push(fromApiTracks(sanitizeMusicItems(fresh), "New releases", "new-releases"));
  return shelves;
}

/**
 * Guest taste: one listen is enough. Signed-out listeners get a Home feed
 * derived from the device's own history — "Jump back in" plus a live
 * "More like {artist}" search seeded by the most recent play — before the
 * generic trending shelves.
 */
async function shelvesFromLocalHistory(history: StoredTrack[]): Promise<HomeShelf[]> {
  if (history.length === 0) return [];
  const shelves: HomeShelf[] = [{
    id: "local-jump-back-in",
    type: "jump_back_in",
    title: "Jump back in",
    subtitle: "From this device",
    items: history.slice(0, 10).map(t => ({
      id: String(t.id),
      title: t.title,
      artist: t.artist,
      durationSec: t.durationSec,
      imageUrl: t.imageUrl,
      bg: t.bg,
      videoId: t.videoId ?? String(t.id),
    })),
  }];

  const seed = history[0];
  if (seed?.artist) {
    try {
      const similar = await searchTracks(seed.artist, 8);
      const clean = sanitizeMusicItems(similar);
      if (clean.length > 0) {
        shelves.push({
          id: `more-like-${seed.artist.toLowerCase().replace(/\W+/g, "-").slice(0, 32)}`,
          type: "shelf",
          title: `More like ${seed.artist}`,
          items: clean.map(t => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            durationSec: t.durationSec,
            imageUrl: t.imageUrl,
            videoId: t.videoId ?? t.id,
          })),
        });
      }
    } catch { /* engine unreachable — the history shelf alone still renders */ }
  }
  return shelves;
}

/**
 * Fetches the user's home feed. Falls back to synthesised trending shelves
 * when the BFF is unreachable or returns nothing renderable.
 */
export async function fetchHome(): Promise<HomeShelf[]> {
  const data = await bffJson<{ shelves?: unknown }>("/api/home");
  const shelves = Array.isArray(data?.shelves)
    ? data.shelves.map(normalizeShelf).filter((s): s is HomeShelf => s !== null && s.items.length > 0)
    : [];
  const base = shelves.length > 0 ? shelves : await synthesizeShelves();
  // Signed-out listeners: local history leads the feed (see shelvesFromLocalHistory).
  if (isSignedIn()) return base;
  try {
    const local = await shelvesFromLocalHistory(getHistory());
    return local.length > 0 ? [...local, ...base] : base;
  } catch {
    return base;
  }
}
