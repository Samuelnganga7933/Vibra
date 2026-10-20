/**
 * home.ts — the server-driven Home feed.
 *
 * The UI never talks about learning: it renders whatever shelves come back
 * from `GET /api/home`, in order. When the BFF is unreachable we synthesise
 * the same cold-start shelves from the audio engine so Home is never empty.
 */

import { bffJson } from "./bff";
import { API_BASE, searchTracks, type ApiTrack } from "./api";
import { sanitizeMusicItems, diversifyByArtist } from "./smartQueue";
import { localeParam, marketChartQuery, marketLabel } from "./locale";

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

function shelfType(value: unknown, id: string): ShelfType {
  if (value === "jump_back_in" || value === "mix_row" || value === "recent") return value;
  // The engine's home feed sends shelves without a `type` — the id decides.
  if (id === "jump_back_in") return "jump_back_in";
  return "shelf";
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
  const id = str(r.id) ?? `shelf-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return {
    id,
    type: shelfType(r.type, id),
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

// ─── Shelf diversity ───────────────────────────────────────────────────────────
// Recommendation rows ("Because you played …", "More like …", trending) never
// let one artist occupy more than three slots — the same cap the BFF applies
// server-side, kept here so cached/older shelf payloads self-heal too. Market
// charts keep their native order: a chart is a chart.
const DIVERSE_SHELF = (shelf: HomeShelf): boolean =>
  shelf.type === "shelf" && (
    shelf.id.startsWith("because") ||
    shelf.id.startsWith("more-like-") ||
    shelf.id === "trending-now" ||
    shelf.id === "fresh_vibes"
  );

function withDiversity(shelves: HomeShelf[]): HomeShelf[] {
  return shelves.map(shelf =>
    DIVERSE_SHELF(shelf)
      ? { ...shelf, items: diversifyByArtist(shelf.items, 10, 3) }
      : shelf,
  );
}

/** Cold-start shelves built from the audio engine when the BFF is down. */
async function synthesizeShelves(): Promise<HomeShelf[]> {
  const market = marketLabel();
  const [region, trending, fresh] = await Promise.all([
    searchTracks(marketChartQuery(), 10).catch(() => []),
    searchTracks("trending music", 10).catch(() => []),
    searchTracks("new music releases", 10).catch(() => []),
  ]);

  const shelves: HomeShelf[] = [];
  // Music-only + variant dedupe: the engine answers these queries with plenty
  // of slowed/cover duplicates and the odd 20-minute mix.
  if (region.length > 0) {
    shelves.push(fromApiTracks(
      sanitizeMusicItems(region),
      `Popular in ${market}`,
      `region-${market.toLowerCase().replace(/\s+/g, "-")}`,
    ));
  }
  if (trending.length > 0) shelves.push(fromApiTracks(sanitizeMusicItems(trending), "Trending now", "trending-now"));
  if (fresh.length > 0) shelves.push(fromApiTracks(sanitizeMusicItems(fresh), "New releases", "new-releases"));
  return shelves;
}

/**
 * The Lenium engine's multi-category home feed: shelves like "Jump Back In",
 * "Because you played …" and "Fresh & Smooth" straight from
 * `GET /discover/home-shelves`.
 */
async function fetchEngineShelves(): Promise<HomeShelf[]> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${API_BASE}/discover/home-shelves`, { signal: controller.signal });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const shelves = Array.isArray(asRecord(data)?.shelves) ? (asRecord(data)!.shelves as unknown[]) : [];
    return shelves
      .map(normalizeShelf)
      .filter((s): s is HomeShelf => s !== null && s.items.length > 0);
  } finally {
    window.clearTimeout(timer);
  }
}

/** The BFF's blended feed — the fallback when the engine is unreachable. */
async function fetchBffShelves(): Promise<HomeShelf[]> {
  const data = await bffJson<{ shelves?: unknown }>(`/api/home?${localeParam()}`, { timeoutMs: 20_000 } as RequestInit);
  return Array.isArray(data?.shelves)
    ? data.shelves.map(normalizeShelf).filter((s): s is HomeShelf => s !== null && s.items.length > 0)
    : [];
}

/**
 * Fetches the user's home feed. The BFF leads: its shelves are personalised
 * from real play history ("Because you played …", region charts). The engine
 * only contributes extra categories the BFF doesn't produce (e.g. Fresh &
 * Smooth) — it never replaces the personalised rows. Everything degrades:
 * BFF → engine → synthesised trending shelves.
 */
export async function fetchHome(): Promise<HomeShelf[]> {
  let bff: HomeShelf[] = [];
  try {
    bff = await fetchBffShelves();
  } catch { /* BFF down — the engine still covers us */ }

  let engine: HomeShelf[] = [];
  try {
    engine = await fetchEngineShelves();
  } catch { /* engine cold start or offline */ }

  // Engine extras: skip its generic recommendation rows (the BFF owns those)
  // and anything already on screen under another id.
  const seenTitles = new Set(bff.map(s => s.title.toLowerCase()));
  const extras = bff.length > 0
    ? engine.filter(s =>
        s.id !== "jump_back_in" &&
        !s.id.startsWith("because") &&
        !seenTitles.has(s.title.toLowerCase()))
    : engine;

  const shelves = [...bff, ...extras];
  if (shelves.length > 0) return withDiversity(shelves);
  return withDiversity(await synthesizeShelves());
}

// ─── Home shelf cache ─────────────────────────────────────────────────────────
/** The last good shelf list, kept so Home paints instantly on every launch. */
const HOME_CACHE_KEY = "vibra_home_shelves";

export function readCachedShelves(): HomeShelf[] {
  try {
    const raw = window.localStorage.getItem(HOME_CACHE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return withDiversity(parsed as HomeShelf[]);
  } catch {
    return [];
  }
}

export function writeCachedShelves(shelves: HomeShelf[]): void {
  try {
    window.localStorage.setItem(HOME_CACHE_KEY, JSON.stringify(shelves));
  } catch {
    /* quota/private mode — the cache is a nicety, never a blocker */
  }
}
