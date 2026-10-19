/**
 * Vibra API service — every request goes to the production audio engine and
 * through the `safeFetch` layer, so a dead network, a 5xx, a timeout or a
 * malformed payload can never crash the UI: callers always receive clean
 * arrays/objects.
 */

import { safeJson } from "./safeFetch";

const RAW_BASE: string =
  ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").trim() ||
  "https://lenium-music-api.onrender.com";

export const API_BASE = RAW_BASE.replace(/\/+$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiTrack {
  id: string;
  /** YouTube video id used for streaming/downloading, when known. */
  videoId?: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  imageUrl?: string;
  streamUrl?: string;
}

export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricsResult {
  synced: LyricLine[];
  plain: string;
}

// ─── Normalisation ────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    // "3:42" / "1:02:03"
    const parts = value.split(":").map(Number);
    if (parts.length >= 2 && parts.every(p => Number.isFinite(p))) {
      return parts.reduce((acc, p) => acc * 60 + p, 0);
    }
  }
  return undefined;
}

function pickDurationSec(raw: Record<string, unknown>): number | undefined {
  for (const key of ["duration", "durationSec", "durationSeconds", "length"]) {
    const n = asNumber(raw[key]);
    if (n !== undefined && n > 0) return n;
  }
  const ms = asNumber(raw.durationMs);
  if (ms !== undefined && ms > 0) return ms / 1000;
  return undefined;
}

function pickImageUrl(raw: Record<string, unknown>): string | undefined {
  const direct = asString(raw.thumbnail) ?? asString(raw.thumb) ?? asString(raw.coverUrl)
    ?? asString(raw.imageUrl) ?? asString(raw.artworkUrl) ?? asString(raw.cover);
  if (direct) return direct;
  const thumbs = raw.thumbnails;
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    const last = asRecord(thumbs[thumbs.length - 1]);
    const url = last && (asString(last.url) ?? asString(last.src));
    if (url) return url;
  }
  return undefined;
}

/** Maps one raw payload entry into an ApiTrack; returns null for junk rows. */
export function normalizeTrack(raw: unknown): ApiTrack | null {
  const r = asRecord(raw);
  if (!r) return null;

  const videoId = asString(r.videoId) ?? asString(r.video_id) ?? asString(r.id) ?? asString(r.webpage_url_id);
  const title = asString(r.title) ?? asString(r.name) ?? asString(r.trackName) ?? asString(r.track);
  if (!videoId || !title) return null;

  const artist =
    asString(r.artist) ?? asString(r.artistName) ?? asString(r.uploader) ??
    asString(r.channel) ?? asString(r.channelTitle) ?? asString(r.author) ??
    asString(r.albumArtist) ?? "Unknown artist";

  return {
    id: videoId,
    videoId,
    title,
    artist,
    album: asString(r.album) ?? asString(r.albumName),
    durationSec: pickDurationSec(r),
    imageUrl: pickImageUrl(r),
    streamUrl: asString(r.streamUrl) ?? asString(r.url),
  };
}

/** Accepts an array or a wrapped envelope and always yields a track array. */
function extractTracks(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const r = asRecord(data);
  if (!r) return [];
  for (const key of ["results", "tracks", "items", "videos", "entries", "data", "songs"]) {
    const value = r[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/**
 * Maps a BFF discovery payload (`/discover/trending`, `/discover/featured`)
 * into ApiTracks. Returns [] for null/failed fetches so callers can fall
 * back to a direct engine search.
 */
export function toApiTracks(data: unknown, limit = 24): ApiTrack[] {
  const out: ApiTrack[] = [];
  const seen = new Set<string>();
  for (const row of extractTracks(data)) {
    const track = normalizeTrack(row);
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * Searches the live catalogue. Resolves to `[]` on every failure mode
 * (offline, timeout, 4xx/5xx, unexpected payload) — never rejects.
 */
export async function searchTracks(query: string, limit = 20): Promise<ApiTrack[]> {
  const q = query.trim();
  if (!q) return [];

  const data = await safeJson<unknown>(
    `${API_BASE}/api/v1/search?query=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`,
    { quiet: true, timeoutMs: 12_000 },
  );

  const seen = new Set<string>();
  const out: ApiTrack[] = [];
  for (const row of extractTracks(data)) {
    const track = normalizeTrack(row);
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
    if (out.length >= limit) break;
  }
  return out;
}

/** Direct HTML5 audio stream URL for a track's video id. */
export function getStreamUrl(videoId: string): string {
  return `${API_BASE}/api/v1/tracks/stream/${encodeURIComponent(String(videoId))}`;
}

/** Direct download URL for a track's video id. */
export function getDownloadUrl(videoId: string): string {
  return `${API_BASE}/api/v1/tracks/download/${encodeURIComponent(String(videoId))}`;
}

// ─── LRC parsing ──────────────────────────────────────────────────────────────

export function parseLrc(lrc: string): LyricLine[] {
  if (!lrc) return [];
  const lines: LyricLine[] = [];
  for (const line of lrc.split(/\r?\n/)) {
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
    if (!m) continue;
    const text = m[3].trim();
    if (text) lines.push({ time: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text });
  }
  return lines;
}

// ─── Lyrics ───────────────────────────────────────────────────────────────────

/** Noisy catalogue suffixes hurt lyric lookups — strip before querying. */
function stripLyricsNoise(s: string): string {
  return s
    .replace(/\s*[\(\[][^)\]]*(official|lyric|lyrics|audio|video|hd|hq|4k|visualizer|remastered|explicit|clean|version|feat)[^)\]]*[\)\]]\s*/gi, " ")
    .replace(/\s*-\s*Topic\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim() || s;
}

/** Engines answer misses with a placeholder sentence — never show those. */
function isPlaceholder(plain: string): boolean {
  const p = plain.trim();
  return p.length < 64 && /^(lyrics (are )?unavailable|no lyrics|not available|instrumental)/i.test(p);
}

function toLyricsResult(syncedRaw: string, plainRaw: string): LyricsResult {
  const synced = parseLrc(syncedRaw);
  const plain = isPlaceholder(plainRaw) ? "" : plainRaw.trim();
  if (!plain && synced.length === 0) return { synced: [], plain: "" };
  return { synced, plain };
}

/** Direct lrclib.net lookup (exact, then fuzzy) — CORS-open, keyless. */
async function lrclibLyrics(track: string, who: string): Promise<LyricsResult | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const exact = await safeJson<Record<string, unknown>>(
    `https://lrclib.net/api/get?${new URLSearchParams({ track_name: track, artist_name: who })}`,
    { quiet: true },
  );
  if (exact) {
    const r = toLyricsResult(asString(exact.syncedLyrics) ?? "", asString(exact.plainLyrics) ?? "");
    if (r.synced.length > 0 || r.plain) return r;
  }
  const hits = await safeJson<unknown[]>(
    `https://lrclib.net/api/search?${new URLSearchParams({ q: `${who} ${track}`.trim() })}`,
    { quiet: true },
  );
  if (!Array.isArray(hits)) return null;
  const nt = norm(track);
  const nw = norm(who);
  const rows = hits.map(asRecord).filter((h): h is Record<string, unknown> => !!h);
  const pick =
    rows.find(h => norm(asString(h.trackName) ?? "") === nt && (h.syncedLyrics || h.plainLyrics))
    ?? rows.find(h => {
      const t = norm(asString(h.trackName) ?? "");
      const a = norm(asString(h.artistName) ?? "");
      return (t.includes(nt) || nt.includes(t)) && (!nw || a === nw) && (h.syncedLyrics || h.plainLyrics);
    })
    ?? null;
  if (!pick) return null;
  return toLyricsResult(asString(pick.syncedLyrics) ?? "", asString(pick.plainLyrics) ?? "");
}

const LYRICS_CACHE = new Map<string, LyricsResult>();

/**
 * Fetches lyrics for a track — engine first, lrclib.net as fallback, cached
 * per cleaned title+artist. Returns `{ synced: [], plain: "" }` on any
 * failure — the lyrics panel simply shows its calm empty copy.
 */
export async function fetchLyrics(title: string, artist: string): Promise<LyricsResult> {
  const empty: LyricsResult = { synced: [], plain: "" };
  const track = stripLyricsNoise(title.trim());
  const who = artist.trim();
  if (!track) return empty;

  const key = `${track}|${who}`.toLowerCase();
  const hit = LYRICS_CACHE.get(key);
  if (hit) return hit;

  let result = empty;
  try {
    const params = new URLSearchParams({ track_name: track, artist_name: who, track, artist: who });
    const data = await safeJson<Record<string, unknown>>(
      `${API_BASE}/api/v1/lyrics?${params.toString()}`,
      { quiet: true },
    );
    if (data) result = toLyricsResult(asString(data.syncedLyrics) ?? "", asString(data.plainLyrics) ?? "");
    if (result.synced.length === 0 && !result.plain) {
      const fb = await lrclibLyrics(track, who);
      if (fb && (fb.synced.length > 0 || fb.plain)) result = fb;
    }
  } catch {
    /* empty result — panel shows its calm empty copy */
  }

  LYRICS_CACHE.set(key, result);
  return result;
}

/** Search-term autocomplete; resolves to `[]` on any failure. */
export async function searchSuggestions(query: string, limit = 8): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];

  const data = await safeJson<unknown>(
    `${API_BASE}/api/v1/search/autocomplete?q=${encodeURIComponent(q)}`,
    { quiet: true },
  );

  const r = asRecord(data);
  const raw = r && Array.isArray(r.suggestions) ? r.suggestions : Array.isArray(data) ? data : [];
  return raw
    .map(s => (typeof s === "string" ? s : asRecord(s)?.query))
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .slice(0, limit);
}
