/**
 * smartQueue.ts — music-only filtering and remix-variant dedupe for the client.
 *
 * The BFF sanitises everything it serves; the audio engine is also queried
 * directly (search screen, vibe matching), so the same two rules apply here:
 *
 *   1. Never surface non-music (films, trailers, news, podcasts, 12-min+ videos).
 *   2. Collapse slowed / reverb / 8D / cover duplicates of the same song,
 *      keeping the clean official track.
 *
 * Structurally typed on purpose — usable for Track, HomeItem and raw engine
 * rows alike, with no import cycle back into the app context.
 */

export interface MusicLike {
  title: string;
  artist?: string;
  durationSec?: number;
  duration?: string;
}

const VARIANT_SOURCE =
  "(slowed(?:\\s*\\+\\s*reverb)?|reverb|nightcore|sped up|speed up|8d(?:\\s+audio|\\s+music)?|bass boosted|karaoke|instrumental|fan cover|acoustic cover|cover|remix|flip|extended mix|radio edit|mashup|ringtone|432\\s?hz|tiktok version)";

const NON_MUSIC_SOURCE =
  "(full movie|full film|full episode|movie|film|trailer|official trailer|teaser|news|breaking news|podcast|episode|documentary|lecture|interview|reaction|gameplay|unboxing|vlog|live stream|livestream|audiobooks?|commentary|behind the scenes|weather|tv show|stand[- ]?up|comedy special)";

const OFFICIAL_SOURCE = "(official audio|official music video|official video|lyric video)";

const VARIANT = new RegExp(`\\b${VARIANT_SOURCE}\\b`, "i");
const VARIANT_GI = new RegExp(`\\b${VARIANT_SOURCE}\\b`, "gi");
const NON_MUSIC = new RegExp(`\\b${NON_MUSIC_SOURCE}\\b`, "i");
const OFFICIAL = new RegExp(`\\b${OFFICIAL_SOURCE}\\b`, "i");
const OFFICIAL_GI = new RegExp(`\\b${OFFICIAL_SOURCE}\\b`, "gi");
const PARENS = /\(.*?\)|\[.*?\]/g;
const STRIP_WORDS = /\b(official|audio|video|lyrics?|hd|hq|visualizer)\b/gi;

function durationSeconds(item: MusicLike): number | undefined {
  if (typeof item.durationSec === "number" && item.durationSec > 0) return item.durationSec;
  const m = /^(\d+):(\d{1,2})$/.exec((item.duration ?? "").trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return undefined;
}

/** Songs only: nothing longer than 12 minutes, nothing that isn't music. */
export function isLikelyMusic(item: MusicLike): boolean {
  const seconds = durationSeconds(item);
  if (seconds !== undefined && seconds > 12 * 60) return false;
  return !NON_MUSIC.test(item.title);
}

/** Does the title look like a slowed/reverb/8D/cover variant? */
export function isVariantTitle(title: string): boolean {
  return VARIANT.test(title);
}

/** Lower is better: 0 = clean/official, +1 per remix-flavoured marker. */
function variantRank(title: string): number {
  const markers = title.match(VARIANT_GI)?.length ?? 0;
  return OFFICIAL.test(title) ? markers - 2 : markers;
}

/** Same song with/without variant suffixes groups together. */
function baseKey(item: MusicLike): string {
  const base = item.title
    .toLowerCase()
    .replace(PARENS, " ")
    .replace(VARIANT_GI, " ")
    .replace(OFFICIAL_GI, " ")
    .replace(STRIP_WORDS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const who = (item.artist ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const group = !who || who === "unknown artist" ? base : who;
  return `${base}::${group}`;
}

/**
 * Music-only + variant dedupe in one pass. Groups collapse to their cleanest
 * member (official/shortest wins) while keeping each group's first-seen order.
 */
export function sanitizeMusicItems<T extends MusicLike>(items: T[]): T[] {
  const groups = new Map<string, { item: T; rank: number; seconds: number; pos: number }>();
  items.filter(isLikelyMusic).forEach((item, pos) => {
    const key = baseKey(item);
    const rank = variantRank(item.title);
    const seconds = durationSeconds(item) ?? 0;
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { item, rank, seconds, pos });
      return;
    }
    // Tie-break: shorter is likelier the studio track, not a long mix.
    if (rank < prev.rank || (rank === prev.rank && seconds < prev.seconds)) {
      groups.set(key, { item, rank, seconds, pos: prev.pos });
    }
  });
  return [...groups.values()].sort((a, b) => a.pos - b.pos).map(g => g.item);
}

/**
 * Keeps one artist from swallowing a discovery shelf: rows beyond
 * `perArtist` from the same artist drop out, original order preserved —
 * "Because you played X" reads as a mix, not a single-artist echo.
 */
export function diversifyByArtist<T extends { artist?: string }>(
  items: T[],
  limit = 10,
  perArtist = 3,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const key = (item.artist ?? "").trim().toLowerCase() || "?";
    const seen = counts.get(key) ?? 0;
    if (seen >= perArtist) continue;
    counts.set(key, seen + 1);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
