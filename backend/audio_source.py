"""
audio_source — resolve a playable, direct audio URL for a YouTube video id.

The Lenium engine (`/api/v1/tracks/stream`) runs yt-dlp without cookies and
currently dies with YouTube's bot-check ("Sign in to confirm you're not a
bot"), so every stream request falls back to the hidden YouTube IFrame —
which stops the moment the screen locks. This module restores real audio:

1. YouTube innertube `player` with the ANDROID client. The android app
   clients return plain (unciphered) streamingData URLs and have historically
   been exempt from the web bot wall. Proven working with the android key,
   playbackContext and the youtube android UA.
2. Lenium engine stream endpoint as a redirect fallback (it 302s itself when
   yt-dlp succeeds).

Resolution results are cached briefly so a queue of seeks doesn't hammer
YouTube's player endpoint.
"""

from __future__ import annotations

import os
import time

import httpx

# The android key — the WEB key (AIzaSyAO_FJ2Sl…) 400s on android clients.
_INNERTUBE_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM37w"
_INNERTUBE_URL = f"https://www.youtube.com/youtubei/v1/player?key={_INNERTUBE_KEY}"
_YT_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip"
_CLIENT_NAME = "ANDROID"
_CLIENT_VERSION = "20.10.38"

_ENGINE = (os.environ.get("CATALOGUE_BASE") or "https://music.vybra.streamvy.me").rstrip("/")

_TTL = 15 * 60.0          # googlevideo URLs live ~6h; 15 min is plenty
_CACHE: dict[str, tuple[float, str, str]] = {}   # video_id -> (ts, url, mime)


def _resolve_innertube(video_id: str) -> tuple[str | None, str]:
    payload = {
        "videoId": video_id,
        "contentCheckOk": True,
        "racyCheckOk": True,
        "playbackContext": {"contentPlaybackContext": {"html5Preference": "HTML5_PREF_WANTS"}},
        "context": {
            "client": {
                "clientName": _CLIENT_NAME,
                "clientVersion": _CLIENT_VERSION,
                "androidSdkVersion": 30,
                "hl": "en",
                "gl": "US",
            }
        },
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": _YT_UA,
        "X-Youtube-Client-Name": "3",
        "X-Youtube-Client-Version": _CLIENT_VERSION,
        "Origin": "https://www.youtube.com",
        "Referer": "https://www.youtube.com/",
    }
    try:
        response = httpx.post(
            _INNERTUBE_URL, json=payload, headers=headers, timeout=12.0
        )
        if response.status_code != 200:
            return None, ""
        data = response.json()
    except Exception:
        return None, ""

    if (data.get("playabilityStatus") or {}).get("status") != "OK":
        return None, ""
    streaming = data.get("streamingData") or {}
    formats = [
        f
        for f in streaming.get("adaptiveFormats", [])
        if str(f.get("mimeType", "")).startswith("audio/")
    ]
    if not formats:
        return None, ""
    # m4a first — WebView decodes mp4a everywhere; opus-in-webm is shakier
    # on older Android builds.
    mp4 = [f for f in formats if "mp4" in str(f.get("mimeType", ""))]
    best = max(mp4 or formats, key=lambda f: int(f.get("bitrate") or 0))
    url = best.get("url")
    if not url:
        return None, ""
    mime = str(best.get("mimeType", "")).split(";")[0].strip() or "audio/mp4"
    return str(url), mime


def resolve_audio_url(video_id: str) -> tuple[str, str] | None:
    """(direct_url, mime) for a video id, or None when nothing can play."""
    vid = (video_id or "").strip()
    if not vid or not vid.isalnum() or len(vid) > 20:
        return None
    hit = _CACHE.get(vid)
    now = time.monotonic()
    if hit is not None and now - hit[0] < _TTL:
        return hit[1], hit[2]

    url, mime = _resolve_innertube(vid)
    if not url:
        return None

    if len(_CACHE) > 512:
        _CACHE.clear()
    _CACHE[vid] = (time.monotonic(), url, mime)
    return url, mime


def engine_stream_url(video_id: str) -> str:
    """Lenium engine fallback — plays when yt-dlp has no bot wall that day."""
    return f"{_ENGINE}/api/v1/tracks/stream/{video_id}"
