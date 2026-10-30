/**
 * share — shareable Vybra links.
 *
 * A share must land IN the app (or on the hosted player), never on YouTube:
 * every song / album / lyric link is a `https://vybra.streamvy.me/...` URL
 * that Android routes back through the VIEW intent-filter and the web route
 * guard understands. Title and artist ride in the query so a deep link can
 * display and lyric-match a track without any backend lookup.
 */

export const APP_ORIGIN = "https://vybra.streamvy.me";

export interface ShareableTrack {
  id: string | number;
  title?: string;
  artist?: string;
}

export interface TrackSharePayload {
  title: string;
  text: string;
  url: string;
}

/** Deep link for one song. `lyrics: true` opens the player on the lyrics view. */
export function trackShareUrl(t: ShareableTrack, opts: { lyrics?: boolean } = {}): string {
  const id = encodeURIComponent(String(t.id ?? "").trim());
  const params = new URLSearchParams();
  if (t.title) params.set("t", t.title);
  if (t.artist) params.set("a", t.artist);
  if (opts.lyrics) params.set("lyrics", "1");
  const qs = params.toString();
  return `${APP_ORIGIN}/track/${id}${qs ? `?${qs}` : ""}`;
}

/** Music-first Web Share data: the track title leads, without app promotion. */
export function trackSharePayload(
  t: ShareableTrack,
  opts: { lyrics?: boolean } = {},
): TrackSharePayload {
  const title = t.title?.trim() || "Unknown track";
  const artist = t.artist?.trim();
  return {
    title,
    text: artist ? `${title} — ${artist}` : title,
    url: trackShareUrl(t, opts),
  };
}

/** Deep link for an album (opens as a playlist view built from a search). */
export function albumShareUrl(name: string, artist?: string): string {
  const suffix = artist ? `?a=${encodeURIComponent(artist)}` : "";
  return `${APP_ORIGIN}/album/${encodeURIComponent(name)}${suffix}`;
}

export type ParsedShare =
  | { kind: "track"; id: string; title: string; artist: string; lyrics: boolean }
  | { kind: "album"; name: string; artist: string };

const SHARE_KINDS = new Set(["track", "lyrics", "album"]);

/**
 * Parses any incoming URL — https deep links, `vybra://` scheme links and
 * `#/track/...` hash links — or returns null for anything else.
 */
export function parseShareUrl(raw: string): ParsedShare | null {
  let url: URL;
  try {
    url = new URL(raw, APP_ORIGIN);
  } catch {
    return null;
  }
  const pathSegs = url.pathname.split("/").filter(Boolean).map(s => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  // vybra://track/xyz → host carries the kind; https://…/track/xyz → path.
  const candidates = url.protocol === "vybra:"
    ? [url.host, ...pathSegs]
    : pathSegs.length > 0 && SHARE_KINDS.has(pathSegs[0])
      ? pathSegs
      : url.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const kindIdx = candidates.findIndex(c => SHARE_KINDS.has(c));
  if (kindIdx === -1) return null;
  const kind = candidates[kindIdx];
  const target = candidates[kindIdx + 1];
  if (!target) return null;
  const title = url.searchParams.get("t") ?? "";
  const artist = url.searchParams.get("a") ?? "";
  if (kind === "album") return { kind, name: target, artist };
  return {
    kind: "track",
    id: target,
    title,
    artist,
    lyrics: kind === "lyrics" || url.searchParams.get("lyrics") === "1",
  };
}
