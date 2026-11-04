"""
audio_source — resolve a playable, direct audio URL for a YouTube video id.

The Lenium engine (`/api/v1/tracks/stream`) runs yt-dlp without cookies and
dies with YouTube's bot-check, so this module resolves audio itself:

1. YouTube innertube `player` with the ANDROID client first (android app
   clients return plain, unciphered streamingData URLs and are the most
   bot-wall tolerant), then the IOS client — across two Google hosts
   (`youtubei.googleapis.com` answers a different bot policy than
   `www.youtube.com`, so a rejection on one host is worth retrying on the
   other). Serverless egress IPs rotate through YouTube's reputation pools;
   trying several combinations is what keeps browser downloads and playback
   redirects alive when one combination is flagged.
2. Lenium engine stream endpoint as a redirect fallback (it 302s itself when
   yt-dlp succeeds).

Resolution results are cached briefly so a queue of seeks doesn't hammer
YouTube's player endpoint.
"""

from __future__ import annotations

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

# The android key — the WEB key (AIzaSyAO_FJ2Sl…) 400s on android clients.
_INNERTUBE_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM37w"
_INNERTUBE_PATH = f"/youtubei/v1/player?key={_INNERTUBE_KEY}"
_YT_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip"
_IOS_UA = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)"

# Two hosts × two clients: first plain-URL win. Every combination historically
# returns unciphered `url` fields when it answers OK at all.
_HOSTS = ("https://youtubei.googleapis.com", "https://www.youtube.com")
_CLIENTS: tuple[tuple[str, str, dict, str, str], ...] = (
    ("ANDROID", "20.10.38", {"androidSdkVersion": 30}, _YT_UA, "3"),
    ("IOS", "20.10.4",
     {"deviceMake": "Apple", "deviceModel": "iPhone16,2",
      "osName": "iPhone", "osVersion": "17.5.1.21F90"},
     _IOS_UA, "5"),
)

_ENGINE = (os.environ.get("CATALOGUE_BASE") or "https://music.vybra.streamvy.me").rstrip("/")

_TTL = 15 * 60.0          # googlevideo/Piped URLs live ~6h; 15 min is plenty
_CACHE: dict[str, tuple[float, str, str]] = {}   # video_id -> (ts, url, mime)
LAST_DIAG: dict[str, str] = {}                   # video_id -> why it failed
_NEGATIVE_TTL = 8.0
_NEGATIVE: dict[str, float] = {}

# Piped exposes audioStreams without requiring a YouTube session. Keep this
# list configurable because public instances can disappear; the resolver races
# the first few hosts and uses the first valid audio URL. The official API
# documentation defines /streams/:videoId and audioStreams.url.
_PIPED_APIS = tuple(
    item.strip().rstrip("/")
    for item in (os.getenv("PIPED_API_URLS") or ",".join((
        "https://pipedapi.kavin.rocks",
        "https://pipedapi.leptons.xyz",
        "https://api.piped.private.coffee",
    ))).split(",")
    if item.strip()
)

# Video ids carry `-` and `_` constantly (e.g. `57__wGDUzig`); an isalnum()
# check silently rejected those and made their downloads fail outright.
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{6,20}$")

# Whole-resolution budget — the playback redirect waits on this.
_BUDGET_S = 5.0
_ATTEMPT_TIMEOUT_S = 2.0
_PIPED_TIMEOUT_S = 2.5


def _attempt(host: str, client: tuple[str, str, dict, str, str], video_id: str) -> tuple[str, str] | None:
    name, version, extra, ua, x_num = client
    payload = {
        "videoId": video_id,
        "contentCheckOk": True,
        "racyCheckOk": True,
        "playbackContext": {"contentPlaybackContext": {"html5Preference": "HTML5_PREF_WANTS"}},
        "context": {"client": {"clientName": name, "clientVersion": version,
                               "hl": "en", "gl": "US", **extra}},
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": ua,
        "X-Youtube-Client-Name": x_num,
        "X-Youtube-Client-Version": version,
        "Origin": "https://www.youtube.com",
        "Referer": "https://www.youtube.com/",
    }
    label = f"{host.split('/')[2]}/{name}"
    try:
        response = httpx.post(
            host + _INNERTUBE_PATH, json=payload, headers=headers,
            timeout=_ATTEMPT_TIMEOUT_S,
        )
        if response.status_code != 200:
            LAST_DIAG[video_id] = f"{label}:post_{response.status_code}:{response.text[:120]}"
            return None
        data = response.json()
    except Exception as exc:
        LAST_DIAG[video_id] = f"{label}:post_error:{type(exc).__name__}:{exc}"
        return None

    status = (data.get("playabilityStatus") or {})
    if status.get("status") != "OK":
        LAST_DIAG[video_id] = (
            f"{label}:playability:{status.get('status')}:{status.get('reason', '')[:120]}"
        )
        return None
    streaming = data.get("streamingData") or {}
    formats = [
        f
        for f in streaming.get("adaptiveFormats", [])
        if str(f.get("mimeType", "")).startswith("audio/")
    ]
    if not formats:
        LAST_DIAG[video_id] = f"{label}:no_audio_formats"
        return None
    # m4a first — WebView decodes mp4a everywhere; opus-in-webm is shakier
    # on older Android builds.
    mp4 = [f for f in formats if "mp4" in str(f.get("mimeType", ""))]
    best = max(mp4 or formats, key=lambda f: int(f.get("bitrate") or 0))
    url = best.get("url")
    if not url:
        LAST_DIAG[video_id] = f"{label}:ciphered_no_url"
        return None
    mime = str(best.get("mimeType", "")).split(";")[0].strip() or "audio/mp4"
    return str(url), mime


def _resolve_innertube(video_id: str) -> tuple[str | None, str]:
    deadline = time.monotonic() + _BUDGET_S
    for host in _HOSTS:
        for client in _CLIENTS:
            if time.monotonic() > deadline:
                LAST_DIAG.setdefault(video_id, "budget_exhausted")
                return None, ""
            hit = _attempt(host, client, video_id)
            if hit:
                return hit
    return None, ""


def _piped_attempt(base: str, video_id: str) -> tuple[str, str] | None:
    """Resolve one Piped instance; never raises into the request handler."""
    try:
        response = httpx.get(
            f"{base}/streams/{video_id}",
            headers={"Accept": "application/json", "User-Agent": "VybraAudioResolver/1.0"},
            timeout=_PIPED_TIMEOUT_S,
        )
        if response.status_code != 200:
            LAST_DIAG[video_id] = f"piped:{base}:http_{response.status_code}"
            return None
        streams = response.json().get("audioStreams") or []
        usable = [
            row for row in streams
            if isinstance(row, dict) and isinstance(row.get("url"), str) and row.get("url")
            and str(row.get("mimeType", "")).startswith("audio/")
        ]
        if not usable:
            LAST_DIAG[video_id] = f"piped:{base}:no_audio_streams"
            return None
        best = max(usable, key=lambda row: int(row.get("bitrate") or 0))
        return str(best["url"]), str(best.get("mimeType") or "audio/mp4").split(";", 1)[0]
    except Exception as exc:
        LAST_DIAG[video_id] = f"piped:{base}:{type(exc).__name__}"
        return None


def _resolve_piped(video_id: str) -> tuple[str | None, str]:
    if not _PIPED_APIS:
        return None, ""
    pool = ThreadPoolExecutor(max_workers=min(3, len(_PIPED_APIS)))
    try:
        futures = {pool.submit(_piped_attempt, base, video_id): base for base in _PIPED_APIS}
        for future in as_completed(futures):
            hit = future.result()
            if hit:
                return hit
        return None, ""
    finally:
        # Do not make a successful fast instance wait for slower/dead public
        # instances to time out before returning to the audio route.
        pool.shutdown(wait=False, cancel_futures=True)


def resolve_audio_url(video_id: str) -> tuple[str, str] | None:
    """(direct_url, mime) for a video id, or None when nothing can play."""
    vid = (video_id or "").strip()
    if not vid or not _VIDEO_ID.match(vid):
        return None
    hit = _CACHE.get(vid)
    now = time.monotonic()
    if hit is not None and now - hit[0] < _TTL:
        return hit[1], hit[2]
    negative_at = _NEGATIVE.get(vid)
    if negative_at is not None and now - negative_at < _NEGATIVE_TTL:
        return None

    # LOGIN_REQUIRED is common on serverless YouTube egress. Race the direct
    # resolver and the alternate proxy path so either one can win quickly.
    race = ThreadPoolExecutor(max_workers=2)
    try:
        futures = [race.submit(_resolve_innertube, vid), race.submit(_resolve_piped, vid)]
        url, mime = None, ""
        for future in as_completed(futures):
            candidate_url, candidate_mime = future.result()
            if candidate_url:
                url, mime = candidate_url, candidate_mime
                break
    finally:
        race.shutdown(wait=False, cancel_futures=True)
    if not url:
        _NEGATIVE[vid] = time.monotonic()
        return None

    if len(_CACHE) > 512:
        _CACHE.clear()
    _CACHE[vid] = (time.monotonic(), url, mime)
    _NEGATIVE.pop(vid, None)
    return url, mime


def engine_stream_url(video_id: str) -> str:
    """Lenium engine fallback — plays when yt-dlp has no bot wall that day."""
    return f"{_ENGINE}/api/v1/tracks/stream/{video_id}"
