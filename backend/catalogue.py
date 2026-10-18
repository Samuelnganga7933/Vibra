"""Catalogue lookups against the public audio engine (search only).

Used by `GET /api/home` to build cold-start / "Because you played …" shelves
server-side. Failures return `[]` — the frontend synthesises the same shelves
from its own search when the BFF cannot reach the catalogue.

Two strictness layers live here so every builder inherits them:

1. **Music-only sanitizer** — movies, trailers, news, podcasts, documentaries
   and anything longer than 12 minutes never reach a shelf or a search reply.
2. **Variant dedupe** — slowed / reverb / 8D / karaoke duplicates of the same
   song collapse to one entry, preferring the clean official track.
"""

from __future__ import annotations

import os
import re
from typing import Any

import httpx

CATALOGUE_BASE = os.environ.get(
    "CATALOGUE_BASE", "https://lenium-music-api.onrender.com"
).rstrip("/")

_ENVELOPE_KEYS = ("results", "tracks", "items", "videos", "entries", "data", "songs")

# ── Music-only feed sanitizer ──────────────────────────────────────────────────

MAX_MUSIC_SECONDS = 12 * 60  # podcasts / full films / broadcasts run longer

_NON_MUSIC = re.compile(
    r"\b("
    r"full movie|full film|full episode|movie|film|trailer|official trailer|teaser|"
    r"news|breaking news|podcast|episode|documentary|docu series|docuseries|"
    r"lecture|interview|reaction|gameplay|unboxing|vlog|live stream|livestream|"
    r"audiobook|audiobooks|commentary|behind the scenes|movie scene|film scene|"
    r"weather|highlights reel|sports highlights|tv show|full show|standup|stand-up comedy|"
    r"comedy special|audio book|"
    r"tutorial|how to|how-to|lesson|for beginners|phrases|vocabulary|language learning"
    r")\b",
    re.IGNORECASE,
)

# ── Duplicate/remix variant preference ────────────────────────────────────────

_VARIANT = re.compile(
    r"\b("
    r"slowed|reverb|slowed \+ reverb|nightcore|sped up|speed up|"
    r"8d|8d audio|8d music|bass boosted|karaoke|instrumental|"
    r"cover|fan cover|acoustic cover|remix|flip|extended mix|radio edit|"
    r"mashup|loop|ringtone|tiktok version|432 hz|432hz"
    r")\b",
    re.IGNORECASE,
)

_OFFICIAL = re.compile(
    r"\b(official audio|official music video|official video|lyric video|official lyrics)\b",
    re.IGNORECASE,
)


def is_music_content(title: str, duration_sec: int | None) -> bool:
    """True when the row is plausibly a song rather than video content."""
    if duration_sec is not None and duration_sec > MAX_MUSIC_SECONDS:
        return False
    return not _NON_MUSIC.search(title)


def variant_score(title: str) -> int:
    """Lower is better: 0 = clean/official, +1 per remix-flavoured marker."""
    score = len(_VARIANT.findall(title))
    if _OFFICIAL.search(title):
        score -= 2
    return score


def _base_key(title: str, artist: str | None) -> tuple[str, str]:
    """Group key: the same song with/without variant suffixes groups together."""
    base = title.lower()
    base = re.sub(r"[\(\[].*?[\)\]]", " ", base)          # drop (...) and [...]
    base = _VARIANT.sub(" ", base)                        # drop variant words
    base = _OFFICIAL.sub(" ", base)                       # drop official labels
    base = re.sub(r"\b(official|audio|video|lyrics?|hd|hq|visualizer)\b", " ", base)
    base = re.sub(r"[^a-z0-9]+", " ", base).strip()
    who = re.sub(r"[^a-z0-9]+", " ", (artist or "").lower()).strip()
    if not who or who == "unknown artist":
        # No reliable channel — group duplicates of unknown-artist rows by title alone.
        who = base
    return base, who


def dedupe_variants(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse duplicate/remix variants, keeping the cleanest track per song."""
    best: dict[tuple[str, str], dict[str, Any]] = {}
    order: list[tuple[str, str]] = []
    for row in rows:
        key = _base_key(str(row.get("title") or ""), row.get("artist"))
        if key not in best:
            best[key] = row
            order.append(key)
            continue
        current = best[key]
        current_rank = variant_score(str(current.get("title") or ""))
        new_rank = variant_score(str(row.get("title") or ""))
        # Tie-break: shorter duration is likelier the studio track, not a mix.
        if (new_rank, row.get("durationSec") or 0) < (current_rank, current.get("durationSec") or 0):
            best[key] = row
    return [best[key] for key in order]


def _pick(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def _duration_seconds(row: dict[str, Any]) -> int | None:
    raw = _pick(row, "durationSec", "durationSeconds", "duration")
    if isinstance(raw, (int, float)) and raw > 0:
        return int(raw)
    if isinstance(raw, str) and ":" in raw:
        try:
            parts = [int(p) for p in raw.split(":")]
        except ValueError:
            return None
        if len(parts) >= 2:
            seconds = 0
            for part in parts:
                seconds = seconds * 60 + part
            return seconds
    return None


def _image(row: dict[str, Any]) -> str | None:
    direct = _pick(row, "thumbnail", "thumb", "coverUrl", "imageUrl", "artworkUrl")
    if isinstance(direct, str):
        return direct
    thumbs = row.get("thumbnails")
    if isinstance(thumbs, list) and thumbs:
        last = thumbs[-1]
        if isinstance(last, dict):
            url = last.get("url") or last.get("src")
            if isinstance(url, str):
                return url
    return None


def search_catalogue(query: str, limit: int = 12) -> list[dict[str, Any]]:
    """Normalised, music-only, variant-deduped track dicts.

    Every BFF shelf ("Trending now", "Because you played …", guest cold start)
    and any server-side search reply funnels through here, so the sanitizer and
    the duplicate collapse apply to the whole server-driven feed.
    """
    if not query.strip():
        return []
    try:
        # Over-fetch: sanitizer + dedupe drop rows before the limit is met.
        want = min(max(limit * 2, 20), 50)
        response = httpx.get(
            f"{CATALOGUE_BASE}/api/v1/search",
            params={"query": query, "limit": str(want)},
            timeout=7.0,
            follow_redirects=True,
        )
        response.raise_for_status()
        data = response.json()
    except Exception:
        return []

    rows: list[Any] = []
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        for key in _ENVELOPE_KEYS:
            value = data.get(key)
            if isinstance(value, list):
                rows = value
                break

    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        video_id = _pick(row, "videoId", "video_id", "id")
        title = _pick(row, "title", "name")
        if not isinstance(video_id, str) or not isinstance(title, str) or not title:
            continue
        if video_id in seen:
            continue
        seen.add(video_id)
        artist = _pick(row, "artist", "artistName", "uploader", "channel", "channelTitle")
        artist_str = artist if isinstance(artist, str) else "Unknown artist"
        duration = _duration_seconds(row)
        # Strict music-only: no films, trailers, broadcasts or 12-minute+ videos.
        if not is_music_content(title, duration):
            continue
        candidates.append(
            {
                "id": video_id,
                "videoId": video_id,
                "title": title,
                "artist": artist_str,
                "durationSec": duration,
                "imageUrl": _image(row),
            }
        )
    return dedupe_variants(candidates)[:limit]
