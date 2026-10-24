"""Vibra User BFF — FastAPI + SQLAlchemy.

Run:
    cd backend
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Set DATABASE_URL to PostgreSQL in production; local development falls back to SQLite.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import re
import threading
import time
import urllib.parse
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import jwt
from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse, StreamingResponse
from sqlalchemy import distinct, func, select, text
from sqlalchemy.orm import Session

from audio_source import LAST_DIAG, engine_stream_url, resolve_audio_url
from catalogue import search_catalogue
from database import Base, SessionLocal, engine, get_db
from market import market_label, market_queries, merged_catalogue, region_query, scene_queries
from models import (
    ArtistScore,
    BlockedItem,
    Feedback,
    FollowedArtist,
    LikedTrack,
    PlayEvent as PlayEventRow,
    PlayHistory,
    Playlist,
    PlaylistTrack,
    User,
)
from schemas import (
    AlbumLookupIn,
    AlbumQueryIn,
    ArtistDiscoveryOut,
    ArtistOut,
    AuthOut,
    DiscoveredArtistsOut,
    DiscoverTrackOut,
    FeedbackIn,
    FollowIn,
    HistoryPauseIn,
    HomeItemOut,
    HomeOut,
    HomeShelfOut,
    LikeToggle,
    LikeToggleOut,
    LikedIdsOut,
    LikedTrackOut,
    LoginIn,
    NeonSessionIn,
    NewReleaseOut,
    PlayEvent,
    PlaylistCreate,
    PlaylistCreator,
    PlaylistOut,
    PlaylistTrackIn,
    PlaylistTrackOrderIn,
    PlaylistTrackOut,
    ProfileUpdate,
    RegisterIn,
    SettingsUpdate,
    Stats,
    TrackOut,
    UserOut,
    VibraEventIn,
)

COVER_COLOR_FALLBACK = "#2C4A5E"

LISTENING_TYPES = {"play", "skip", "complete", "replay"}
# One play (1.5) or one like (2.0) is enough to move an artist's affinity —
# /api/home reads these scores immediately after the event commits.
EVENT_WEIGHTS = {"play": 1.5, "complete": 3.0, "replay": 2.0, "skip": -1.0, "like": 2.0}


def _initials(name: str) -> str:
    parts = [p for p in name.strip().split() if p]
    return "".join(p[0].upper() for p in parts[:2]) or "VU"


DEFAULT_USER_EMAIL = "user@vibra.local"


def _ensure_default_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == DEFAULT_USER_EMAIL))
    if user is None:
        user = User(
            name="Vybra User",
            email=DEFAULT_USER_EMAIL,
            username="vibrauser",
            initials="VU",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def get_current_user(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    vibra_session: Optional[str] = Cookie(default=None),
) -> User:
    """Bearer session first, then the session cookie, then the dev default.

    A signed-in user always operates on their own rows; anonymous traffic
    falls back to the provisioned default so guest browsing works. A token
    (header or cookie) that matches no live session is an expired login —
    401, never the default user's data. The old X-User-Id header is gone:
    it let any client pick someone else's id.
    """
    token = _bearer(authorization) or vibra_session
    if token:
        user = db.scalar(select(User).where(User.session_token == token))
        if user is None:
            raise HTTPException(status_code=401, detail="Session expired")
        return user
    return _ensure_default_user(db)

# ── Auth (bearer session) ─────────────────────────────────────────────────────


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${digest.hex()}"


def _verify_password(password: str, stored: Optional[str]) -> bool:
    if not stored or "$" not in stored:
        return False
    salt, _, digest_hex = stored.partition("$")
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return secrets.compare_digest(candidate.hex(), digest_hex)


# ── Password strength (registration only) ─────────────────────────────────────
# Length + variety + a blocklist of the passwords credential-stuffing runs
# try first. Never applied at login — old accounts keep working.

_COMMON_PASSWORDS = frozenset({
    "password", "password1", "password123", "passw0rd", "p@ssw0rd", "p@ssword",
    "12345678", "123456789", "1234567890", "11111111", "00000000", "87654321",
    "qwerty123", "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "asdfghjkl",
    "iloveyou", "iloveyou1", "letmein1", "letmein123", "welcome1", "welcome123",
    "admin123", "root123", "abc12345", "abcd1234", "monkey123", "dragon123",
    "sunshine1", "princess1", "football1", "baseball1", "superman1", "trustno1",
    "starwars1", "whatever1", "qwerty12", "michael1", "shadow123", "master123",
    "jennifer1", "jordan123", "harley123", "ranger123", "buster123", "soccer123",
    "internet1", "computer1", "secret123", "summer2024", "summer2025", "winter2024",
    "winter2025", "spring2025", "january1", "february1", "chocolate1",
    "changeme1", "letmein12", "test1234", "demo1234", "temp1234", "user1234",
})


def _validate_password(password: str, email: str = "") -> None:
    """Raise 400 unless the password clears the registration policy."""
    if len(password) < 8 or len(password) > 128:
        raise HTTPException(status_code=400, detail="Password must be 8–128 characters long.")
    classes = sum((
        any(c.islower() for c in password),
        any(c.isupper() for c in password),
        any(c.isdigit() for c in password),
        any(not c.isalnum() for c in password),
    ))
    if classes < 2:
        raise HTTPException(
            status_code=400,
            detail="Password must mix letter case, a number or a symbol.",
        )
    if len(set(password)) <= 2:
        raise HTTPException(status_code=400, detail="Password is too easy to guess.")
    lowered = password.strip().lower()
    if lowered in _COMMON_PASSWORDS:
        raise HTTPException(status_code=400, detail="That password is too common — please pick another.")
    local = email.split("@")[0].strip().lower() if email else ""
    if local and len(local) >= 3 and local in lowered:
        raise HTTPException(status_code=400, detail="Password shouldn't contain your email address.")


# ── Rate limiting (per-IP sliding window) ─────────────────────────────────────
# In-memory, per-process — right for the single uvicorn worker the BFF runs
# as today; swap for Redis if the service is ever scaled out. Client IPs come
# from X-Forwarded-For when behind Render/proxy, else the socket peer.

_RATE_LOCK = threading.Lock()
_RATE_HITS: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


def _rate_limit(bucket: str, limit: int, window_sec: int, retry_detail: str = "Too many attempts. Please wait a few minutes and try again.") -> None:
    now = time.monotonic()
    with _RATE_LOCK:
        hits = _RATE_HITS[bucket]
        while hits and now - hits[0] >= window_sec:
            hits.popleft()
        if len(hits) >= limit:
            raise HTTPException(status_code=429, detail=retry_detail)
        hits.append(now)


def _auth_rate_limit(scope: str, limit: int, window_sec: int):
    """FastAPI dependency: per-IP cap on one auth endpoint."""

    def dependency(request: Request) -> None:
        _rate_limit(f"{scope}:{_client_ip(request)}", limit, window_sec)

    return dependency


def _bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        "vibra_session",
        token,
        httponly=True,
        secure=os.getenv("ENVIRONMENT", "development").lower() == "production",
        samesite="lax",
        max_age=60 * 60 * 24 * 30,
        path="/",
    )


def _user_out(db: Session, user: User) -> UserOut:
    playlist_count = db.scalar(
        select(func.count()).select_from(Playlist).where(Playlist.user_id == user.id)
    )
    liked_count = db.scalar(
        select(func.count()).select_from(LikedTrack).where(LikedTrack.user_id == user.id)
    )
    top_artists = db.scalar(
        select(func.count(distinct(ArtistScore.artist))).where(ArtistScore.user_id == user.id)
    )
    since = datetime.now(timezone.utc) - timedelta(days=7)
    total_ms = db.scalar(
        select(func.coalesce(func.sum(PlayHistory.duration_ms), 0)).where(
            PlayHistory.user_id == user.id,
            PlayHistory.played_at >= since,
        )
    )
    hours = (total_ms or 0) / 3_600_000
    weekly = "0h" if hours == 0 else "<1h" if hours < 1 else f"{hours:.0f}h"
    return UserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        username=user.username,
        initials=user.initials,
        avatarUrl=user.avatar_url,
        subscription=user.subscription,  # type: ignore[arg-type]
        stats=Stats(
            following=user.following,
            followers=user.followers,
            playlists=playlist_count or 0,
            weeklyHours=weekly,
            tracksLiked=liked_count or 0,
            topArtists=top_artists or 0,
        ),
    )


def get_token_user(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    vibra_session: Optional[str] = Cookie(default=None),
) -> User:
    """Requires a valid bearer or HttpOnly cookie session."""
    token = _bearer(authorization) or vibra_session
    user = db.scalar(select(User).where(User.session_token == token)) if token else None
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user


def get_optional_user(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    vibra_session: Optional[str] = Cookie(default=None),
) -> Optional[User]:
    token = _bearer(authorization) or vibra_session
    if not token:
        return None
    return db.scalar(select(User).where(User.session_token == token))


@asynccontextmanager
def _migrate_playlist_tracks() -> None:
    """Add track-metadata columns to pre-existing SQLite installs."""
    import sqlite3
    from database import BASE_DIR
    db_path = BASE_DIR / "vibra_users.db"
    if not db_path.exists():
        return
    conn = sqlite3.connect(db_path)
    try:
        existing = {row[1] for row in conn.execute("PRAGMA table_info(playlist_tracks)")}
        for column, ddl in [
            ("title", "ALTER TABLE playlist_tracks ADD COLUMN title TEXT"),
            ("artist", "ALTER TABLE playlist_tracks ADD COLUMN artist TEXT"),
            ("image_url", "ALTER TABLE playlist_tracks ADD COLUMN image_url TEXT"),
            ("cover_color", "ALTER TABLE playlist_tracks ADD COLUMN cover_color TEXT"),
            ("duration_ms", "ALTER TABLE playlist_tracks ADD COLUMN duration_ms INTEGER"),
            ("video_id", "ALTER TABLE playlist_tracks ADD COLUMN video_id TEXT"),
        ]:
            if column not in existing:
                conn.execute(ddl)
        conn.commit()
    finally:
        conn.close()


def _migrate_liked_tracks() -> None:
    """Add track-metadata columns to pre-existing liked_tracks installs."""
    columns = {
        "title": "TEXT",
        "artist": "TEXT",
        "image_url": "TEXT",
        "cover_color": "TEXT",
        "duration_ms": "INTEGER",
        "video_id": "TEXT",
    }
    if engine.dialect.name == "postgresql":
        # Production runs Postgres — it supports IF NOT EXISTS, SQLite doesn't.
        with engine.begin() as conn:
            for column, ddl_type in columns.items():
                conn.execute(text(
                    f"ALTER TABLE liked_tracks ADD COLUMN IF NOT EXISTS {column} {ddl_type}"
                ))
        return
    import sqlite3
    from database import BASE_DIR
    db_path = BASE_DIR / "vibra_users.db"
    if not db_path.exists():
        return
    conn = sqlite3.connect(db_path)
    try:
        existing = {row[1] for row in conn.execute("PRAGMA table_info(liked_tracks)")}
        for column, ddl_type in columns.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE liked_tracks ADD COLUMN {column} {ddl_type}")
        conn.commit()
    finally:
        conn.close()


def _engine_keepalive() -> None:
    """Pings the audio engine every 7 minutes (and once at startup) so the
    free-tier instance never sleeps — playback, radio queues, search, trending
    and every new-music shelf live there, and a cold start costs the client
    ~15s of dead UI plus an empty discovery feed."""
    from catalogue import CATALOGUE_BASE
    while True:
        try:
            httpx.get(f"{CATALOGUE_BASE}/", timeout=10.0)
        except Exception:
            pass  # transient — the next tick retries
        time.sleep(7 * 60)


async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_playlist_tracks()
    _migrate_liked_tracks()
    db = SessionLocal()
    try:
        _ensure_default_user(db)
    finally:
        db.close()
    threading.Thread(target=_engine_keepalive, daemon=True).start()
    yield


app = FastAPI(title="Vybra User BFF", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://localhost,https://localhost,capacitor://localhost,https://vybra.streamvy.me,https://vibra-ni152h4cn-samuelnganga7933s-projects.vercel.app",
    ).split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth routes ───────────────────────────────────────────────────────────────


@app.post("/auth/register", response_model=AuthOut)
def register(
    payload: RegisterIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    _limit: None = Depends(_auth_rate_limit("register", 10, 15 * 60)),
):
    email = payload.email.strip().lower()
    _validate_password(payload.password, email)
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    username_base = email.split("@")[0].replace(".", "")[:40] or "listener"
    username = username_base
    if db.scalar(select(User).where(User.username == username)) is not None:
        username = f"{username_base}{secrets.token_hex(2)}"
    name = payload.name.strip()
    user = User(
        name=name,
        email=email,
        username=username,
        initials=_initials(name),
        password_hash=_hash_password(payload.password),
        session_token=secrets.token_hex(24),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _set_session_cookie(response, user.session_token or "")
    return AuthOut(token=user.session_token or "", user=UserOut(
        id=user.id, name=user.name, email=user.email, username=user.username,
        initials=user.initials, avatarUrl=user.avatar_url,
        subscription="free",  # type: ignore[arg-type]
    ))


@app.post("/auth/login", response_model=AuthOut)
def login(
    payload: LoginIn,
    response: Response,
    db: Session = Depends(get_db),
    _limit: None = Depends(_auth_rate_limit("login", 15, 5 * 60)),
):
    email = payload.email.strip().lower()
    # Per-account cap on top of the per-IP one: a distributed guessing run
    # still can't outpace a single victim's inbox.
    _rate_limit(f"login-email:{email}", 8, 5 * 60)
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        raise HTTPException(status_code=401, detail="Wrong email or password")
    if not user.password_hash:
        # Signed up through the Streamvy SSO: there is no password to check,
        # and a generic "wrong password" reads as a broken login form.
        raise HTTPException(
            status_code=403,
            detail='This account signs in with Streamvy — tap "Continue with Streamvy" instead.',
        )
    if not _verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Wrong email or password")
    user.session_token = secrets.token_hex(24)
    db.add(user)
    db.commit()
    db.refresh(user)
    _set_session_cookie(response, user.session_token or "")
    return AuthOut(token=user.session_token or "", user=UserOut(
        id=user.id, name=user.name, email=user.email, username=user.username,
        initials=user.initials, avatarUrl=user.avatar_url,
        subscription=user.subscription,  # type: ignore[arg-type]
    ))


@app.post("/auth/logout", status_code=204)
def logout(response: Response, user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    user.session_token = None
    db.add(user)
    db.commit()
    response.delete_cookie("vibra_session", path="/")
    response.status_code = 204
    return response


def _identity_user(
    db: Session,
    email: str,
    name: str,
    avatar_url: Optional[str] = None,
) -> User:
    """Find-or-create an identity-provider user and mint a fresh Vibra session.

    Shared by the Neon and Google exchanges: same email always lands on the
    same Vibra account (a password account keeps its password).
    """
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        username_base = email.split("@")[0].replace(".", "")[:40] or "listener"
        username = username_base
        if db.scalar(select(User).where(User.username == username)) is not None:
            username = f"{username_base}{secrets.token_hex(2)}"
        user = User(
            name=name,
            email=email,
            username=username,
            initials=_initials(name),
        )
    else:
        # Keep the profile fresh from the identity provider on every sign-in.
        user.name = name
    if avatar_url:
        user.avatar_url = avatar_url[:512]
    user.session_token = secrets.token_hex(24)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/neon", response_model=AuthOut)
def auth_neon(
    payload: NeonSessionIn,
    response: Response,
    db: Session = Depends(get_db),
    # Also shields the per-call JWKS fetch from being hammered.
    _limit: None = Depends(_auth_rate_limit("neon", 30, 5 * 60)),
):
    """Exchange a Neon Auth (Better Auth) JWT for a Vibra BFF session.

    The client finishes Google OAuth against NEON_AUTH_BASE_URL, then posts
    the session JWT from GET /token here. The signature is verified against
    the branch's JWKS (EdDSA); the matching Vibra user is looked up by email
    (created on first sign-in) and issued a normal Vibra bearer so every
    existing endpoint keeps working unchanged.
    """
    jwks_url = (os.getenv("NEON_AUTH_JWKS_URL") or "").strip()
    if not jwks_url:
        raise HTTPException(status_code=503, detail="Neon Auth is not configured")
    try:
        jwks = httpx.get(jwks_url, timeout=10.0)
        jwks.raise_for_status()
        keys = jwks.json().get("keys") or []
    except Exception:
        raise HTTPException(status_code=502, detail="Could not fetch Neon Auth keys")

    try:
        header = jwt.get_unverified_header(payload.token)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Neon Auth session is invalid or expired")
    key_data = next((k for k in keys if k.get("kid") == header.get("kid")), None)
    if key_data is None and len(keys) == 1:
        key_data = keys[0]
    if key_data is None:
        raise HTTPException(status_code=401, detail="Neon Auth session is invalid or expired")
    try:
        # Only EdDSA is ever issued by Neon Auth; never trust the header's alg.
        if header.get("alg") != "EdDSA":
            raise jwt.InvalidTokenError("unexpected algorithm")
        jwk = jwt.PyJWK.from_dict(key_data).key
        claims = jwt.decode(
            payload.token,
            jwk,
            algorithms=["EdDSA"],
            options={"verify_aud": False},
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Neon Auth session is invalid or expired")

    email = str(claims.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="Neon Auth session is invalid or expired")

    name = str(claims.get("name") or "").strip() or email.split("@")[0][:60]
    picture = str(claims.get("picture") or "").strip() or None
    user = _identity_user(db, email, name, picture)
    _set_session_cookie(response, user.session_token or "")
    return AuthOut(token=user.session_token or "", user=UserOut(
        id=user.id, name=user.name, email=user.email, username=user.username,
        initials=user.initials, avatar_url=user.avatar_url,
        subscription=user.subscription,  # type: ignore[arg-type]
    ))


# ── Google sign-in (our own OAuth client — Vybra owns the consent screen) ──────
# The Neon proxy made the whole dance live on neon.tech: the address bar and
# Google's consent screen both said "neon.tech". With GOOGLE_CLIENT_ID /
# GOOGLE_CLIENT_SECRET registered under *our* Google Cloud project, the flow
# runs app → accounts.google.com → bff.vybra.streamvy.me → app, and the
# consent screen says Vibra. Without credentials the client falls back to Neon.

_GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
_DEFAULT_RETURN = "https://vybra.streamvy.me"


def _google_credentials() -> tuple[str, str]:
    return (
        (os.getenv("GOOGLE_CLIENT_ID") or "").strip(),
        (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip(),
    )


def _google_redirect_uri() -> str:
    """One fixed redirect URI for every request, web or in-app WebView.

    Deriving it from the incoming request (`url_for`) can produce a
    different scheme/host per client (Android WebView requests behind the
    Vercel proxy) and Google rejects the mismatch. Build it from
    PUBLIC_BFF_URL instead; GOOGLE_REDIRECT_URI is only honoured when it
    already points at our callback path, so an old /auth/callback guess
    can never poison the flow.
    """
    cand = (os.getenv("GOOGLE_REDIRECT_URI") or "").strip()
    if cand:
        try:
            p = urllib.parse.urlsplit(cand)
            if (
                p.scheme == "https"
                and p.netloc
                and p.path.rstrip("/").endswith("/auth/google/callback")
            ):
                return cand.rstrip("/")
        except ValueError:
            pass
    base = (os.getenv("PUBLIC_BFF_URL") or "https://bff.vybra.streamvy.me").rstrip("/")
    return f"{base}/auth/google/callback"


def _allowed_return_origins() -> set[str]:
    raw = os.getenv(
        "AUTH_RETURN_ALLOW",
        "https://vybra.streamvy.me,http://localhost:5173,http://localhost,https://localhost",
    )
    out: set[str] = set()
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            p = urllib.parse.urlsplit(part)
            if p.scheme and p.netloc:
                out.add(f"{p.scheme}://{p.netloc}")
        except ValueError:
            continue
    return out or {_DEFAULT_RETURN}


def _safe_return(raw: Optional[str]) -> str:
    """Allowlisted app URL to bounce back to — never an open redirect."""
    if raw:
        try:
            p = urllib.parse.urlsplit(raw)
            if f"{p.scheme}://{p.netloc}" in _allowed_return_origins():
                return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path or "/", "", ""))
        except ValueError:
            pass
    return _DEFAULT_RETURN


@app.get("/auth/capabilities")
def auth_capabilities():
    """What the client should offer on the sign-in screen."""
    cid, secret = _google_credentials()
    return {"google": bool(cid and secret)}


@app.get("/auth/google/start")
def google_start(
    request: Request,
    app: Optional[str] = None,
    _limit: None = Depends(_auth_rate_limit("google-start", 30, 5 * 60)),
):
    cid, secret = _google_credentials()
    if not cid or not secret:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    return_to = _safe_return(app)
    state = secrets.token_urlsafe(24)
    redirect_uri = _google_redirect_uri()
    params = urllib.parse.urlencode({
        "client_id": cid,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        # Always let people pick the account — switching Google accounts
        # mid-session is the common case on a shared phone.
        "prompt": "select_account",
    })
    response = RedirectResponse(f"{_GOOGLE_AUTHORIZE}?{params}", status_code=302)
    response.set_cookie(
        "vibra_gstate",
        f"{state}|{urllib.parse.quote(return_to, safe='')}",
        max_age=600,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )
    return response


@app.get("/auth/google/callback")
def google_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: Session = Depends(get_db),
    _limit: None = Depends(_auth_rate_limit("google-callback", 30, 5 * 60)),
):
    gstate = request.cookies.get("vibra_gstate") or ""
    stored_state, _, stored_return = gstate.partition("|")
    return_to = _safe_return(urllib.parse.unquote(stored_return) if stored_return else None)
    if error or not code:
        return PlainTextResponse(
            "Google sign-in was cancelled or failed. Go back and try again.",
            status_code=200,
        )
    if not stored_state or not state or not secrets.compare_digest(stored_state, state):
        return PlainTextResponse("Sign-in state mismatch. Go back and try again.", status_code=403)

    cid, secret = _google_credentials()
    redirect_uri = _google_redirect_uri()
    try:
        token_response = httpx.post(
            _GOOGLE_TOKEN,
            data={
                "code": code,
                "client_id": cid,
                "client_secret": secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=15.0,
        )
        token_response.raise_for_status()
        id_token = (token_response.json() or {}).get("id_token")
        if not id_token:
            raise ValueError("Google returned no id_token")
        # Received directly from Google's token endpoint over TLS — decode the
        # claims without a second JWKS round-trip.
        claims = jwt.decode(id_token, options={"verify_signature": False})
    except Exception:
        return PlainTextResponse(
            "Google sign-in could not be verified. Go back and try again.",
            status_code=502,
        )

    email = str(claims.get("email") or "").strip().lower()
    verified = claims.get("email_verified")
    if not email or verified not in (True, "true", "1", 1):
        return PlainTextResponse("That Google account's email is not verified.", status_code=403)
    name = str(claims.get("name") or "").strip() or email.split("@")[0][:60]
    picture = str(claims.get("picture") or "").strip() or None
    user = _identity_user(db, email, name, picture)
    # One hop back into the app with the bearer in the fragment (fragments
    # never reach a server log); the SPA consumes it before React boots.
    response = RedirectResponse(f"{return_to}#vibra_token={user.session_token}", status_code=302)
    response.delete_cookie("vibra_gstate", path="/")
    return response


def _playlist_track_out(row: PlaylistTrack) -> PlaylistTrackOut:
    return PlaylistTrackOut(
        id=row.track_id,
        title=row.title,
        artist=row.artist,
        imageUrl=row.image_url,
        coverColor=row.cover_color or COVER_COLOR_FALLBACK,
        durationMs=row.duration_ms or 0,
        videoId=row.video_id,
    )


def _playlist_out(db: Session, playlist: Playlist, with_tracks: bool = False) -> PlaylistOut:
    track_rows = db.scalars(
        select(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist.id)
        .order_by(PlaylistTrack.position)
    ).all()
    # The playlist's cover is its first song's artwork: an explicit cover wins,
    # otherwise the first stored track image (tracks are position-ordered).
    cover_url = playlist.cover_url or next(
        (r.image_url for r in track_rows if r.image_url), None
    )
    return PlaylistOut(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        coverColor=playlist.cover_color,
        coverUrl=cover_url,
        trackCount=len(track_rows),
        creator=PlaylistCreator(id=playlist.user_id, name=playlist.owner.name) if playlist.owner else None,
        tracks=[_playlist_track_out(r) for r in track_rows] if with_tracks else [],
    )


def _weekly_minutes(db: Session, user_id: str) -> str:
    since = datetime.now(timezone.utc) - timedelta(days=7)
    total_ms = db.scalar(
        select(func.coalesce(func.sum(PlayHistory.duration_ms), 0)).where(
            PlayHistory.user_id == user_id,
            PlayHistory.played_at >= since,
        )
    )
    minutes = (total_ms or 0) / 60_000
    if minutes == 0:
        return "0m"
    if minutes < 1:
        return "<1m"
    total_min = int(round(minutes))
    hours, mins = divmod(total_min, 60)
    if hours == 0:
        return f"{mins}m"
    return f"{hours}h {mins}m" if mins else f"{hours}h"


def _me_out(db: Session, user: User) -> UserOut:
    playlist_count = db.scalar(
        select(func.count()).select_from(Playlist).where(Playlist.user_id == user.id)
    )
    liked_count = db.scalar(
        select(func.count()).select_from(LikedTrack).where(LikedTrack.user_id == user.id)
    )
    top_artists = db.scalar(
        select(func.count(distinct(PlayHistory.artist_id))).where(
            PlayHistory.user_id == user.id,
            PlayHistory.artist_id.is_not(None),
            PlayHistory.artist_id != "",
        )
    )
    stats = Stats(
        following=user.following,
        followers=user.followers,
        playlists=playlist_count or 0,
        weeklyMinutes=_weekly_minutes(db, user.id),
        tracksLiked=liked_count or 0,
        topArtists=top_artists or 0,
    )
    return UserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        username=user.username,
        initials=user.initials,
        avatarUrl=user.avatar_url,
        subscription=user.subscription,  # type: ignore[arg-type]
        stats=stats,
    )


@app.get("/auth/me", response_model=UserOut)
def read_me(user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    return _me_out(db, user)


@app.put("/auth/me", response_model=UserOut)
def update_me(
    payload: ProfileUpdate,
    user: User = Depends(get_token_user),
    db: Session = Depends(get_db),
):
    """Persists profile edits so the name survives logout, other devices, reloads."""
    if payload.name is not None:
        stripped = payload.name.strip()
        if not stripped:
            raise HTTPException(status_code=422, detail="Name can't be empty")
        user.name = stripped
        user.initials = _initials(stripped)
    if payload.username is not None:
        user.username = payload.username.strip()
    if payload.avatarUrl is not None:
        user.avatar_url = payload.avatarUrl
    db.commit()
    db.refresh(user)
    return _me_out(db, user)


@app.get("/library/playlists", response_model=list[PlaylistOut])
def list_playlists(user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Playlist).where(Playlist.user_id == user.id).order_by(Playlist.created_at.desc())
    ).all()
    return [_playlist_out(db, p) for p in rows]


@app.post("/library/playlists", response_model=PlaylistOut, status_code=201)
def create_playlist(
    payload: PlaylistCreate,
    user: User = Depends(get_token_user),
    db: Session = Depends(get_db),
):
    playlist = Playlist(
        user_id=user.id,
        name=payload.name.strip(),
        description=payload.description,
    )
    db.add(playlist)
    db.commit()
    db.refresh(playlist)
    return _playlist_out(db, playlist)


def _get_owned_playlist(db: Session, playlist_id: str, user: User) -> Playlist:
    playlist = db.scalar(select(Playlist).where(
        Playlist.id == playlist_id, Playlist.user_id == user.id
    ))
    if playlist is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@app.get("/library/playlists/{playlist_id}", response_model=PlaylistOut)
def get_playlist(playlist_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _playlist_out(db, _get_owned_playlist(db, playlist_id, user), with_tracks=True)


@app.post("/library/playlists/{playlist_id}/tracks", response_model=PlaylistOut, status_code=201)
def add_playlist_track(
    playlist_id: str,
    payload: PlaylistTrackIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    playlist = _get_owned_playlist(db, playlist_id, user)
    existing = db.scalar(select(PlaylistTrack).where(
        PlaylistTrack.playlist_id == playlist.id,
        PlaylistTrack.track_id == payload.track_id,
    ))
    if existing is not None:
        return _playlist_out(db, playlist, with_tracks=True)
    max_pos = db.scalar(
        select(func.coalesce(func.max(PlaylistTrack.position), -1)).where(PlaylistTrack.playlist_id == playlist.id)
    )
    db.add(PlaylistTrack(
        playlist_id=playlist.id,
        track_id=payload.track_id,
        position=(max_pos or -1) + 1,
        title=payload.title,
        artist=payload.artist,
        image_url=payload.imageUrl,
        cover_color=payload.coverColor or COVER_COLOR_FALLBACK,
        duration_ms=payload.durationMs,
        video_id=payload.videoId,
    ))
    db.commit()
    return _playlist_out(db, playlist, with_tracks=True)


@app.put("/library/playlists/{playlist_id}/tracks", response_model=PlaylistOut)
def reorder_playlist_tracks(
    playlist_id: str,
    payload: PlaylistTrackOrderIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Drag-and-drop: rewrite positions from the submitted id order."""
    playlist = _get_owned_playlist(db, playlist_id, user)
    rows = db.scalars(
        select(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist.id)
    ).all()
    by_id = {r.track_id: r for r in rows}
    # Unknown ids are ignored; existing ids not in the payload keep their tail order.
    ordered = [by_id.pop(tid) for tid in payload.track_ids if tid in by_id]
    ordered.extend(sorted(by_id.values(), key=lambda r: r.position))
    for position, row in enumerate(ordered):
        row.position = position
    db.commit()
    return _playlist_out(db, playlist, with_tracks=True)


@app.get("/library/liked", response_model=LikedIdsOut)
def list_liked(user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(LikedTrack).where(LikedTrack.user_id == user.id).order_by(LikedTrack.liked_at.desc())
    ).all()
    # Rows liked before snapshots existed carry only the id — the client fills
    # those from its own known tracks.
    tracks = [
        LikedTrackOut(
            id=row.track_id,
            title=row.title,
            artist=row.artist,
            imageUrl=row.image_url,
            coverColor=row.cover_color or COVER_COLOR_FALLBACK,
            durationMs=row.duration_ms or 0,
            videoId=row.video_id,
        )
        for row in rows
        if row.title
    ]
    return LikedIdsOut(ids=[r.track_id for r in rows], tracks=tracks)


@app.post("/library/liked/{track_id}", response_model=LikeToggleOut)
def toggle_like(
    track_id: str,
    payload: LikeToggle,
    user: User = Depends(get_token_user),
    db: Session = Depends(get_db),
):
    existing = db.scalar(
        select(LikedTrack).where(LikedTrack.user_id == user.id, LikedTrack.track_id == track_id)
    )
    if payload.liked:
        meta = payload.track
        if existing is None:
            db.add(LikedTrack(
                user_id=user.id,
                track_id=track_id,
                title=meta.title if meta else None,
                artist=meta.artist if meta else None,
                image_url=meta.imageUrl if meta else None,
                cover_color=meta.coverColor if meta else None,
                duration_ms=meta.durationMs if meta else None,
                video_id=meta.videoId if meta else None,
            ))
            db.commit()
        elif meta is not None and not existing.title and meta.title:
            # Backfill metadata for rows liked before snapshots existed.
            existing.title = meta.title
            existing.artist = meta.artist
            existing.image_url = meta.imageUrl
            existing.cover_color = meta.coverColor
            existing.duration_ms = meta.durationMs
            existing.video_id = meta.videoId
            db.commit()
        return LikeToggleOut(liked=True)
    if existing is not None:
        db.delete(existing)
        db.commit()
    return LikeToggleOut(liked=False)


@app.get("/library/recent", response_model=list[TrackOut])
def list_recent(user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(PlayHistory)
        .where(PlayHistory.user_id == user.id)
        .order_by(PlayHistory.played_at.desc())
        .limit(20)
    ).all()
    return [
        TrackOut(id=r.track_id, durationMs=r.duration_ms, coverColor=COVER_COLOR_FALLBACK) for r in rows
    ]


@app.post("/library/recent", status_code=204)
def record_play(
    payload: PlayEvent,
    user: User = Depends(get_token_user),
    db: Session = Depends(get_db),
):
    db.add(
        PlayHistory(
            user_id=user.id,
            track_id=payload.trackId,
            artist_id=payload.artistId,
            duration_ms=payload.durationMs,
        )
    )
    db.commit()
    return Response(status_code=204)


@app.put("/settings", status_code=204)
def update_settings(
    payload: SettingsUpdate,
    user: User = Depends(get_token_user),
    db: Session = Depends(get_db),
):
    fields = {
        "theme": payload.theme,
        "accent": payload.accent,
        "audio_quality": payload.audioQuality,
        "normalize_volume": payload.normalizeVolume,
        "autoplay": payload.autoplay,
        "crossfade": payload.crossfade,
        "notif_new_releases": payload.notifNewReleases,
        "notif_recommendations": payload.notifRecommendations,
        "notif_followers": payload.notifFollowers,
        "share_listening": payload.shareListening,
        "share_data": payload.shareData,
    }
    for attr, value in fields.items():
        if value is not None:
            setattr(user, attr, value)
    db.add(user)
    db.commit()
    return Response(status_code=204)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root_ping():
    """Root ping — load balancers and uptime checks hit / first."""
    return {"status": "ok", "service": "vibra-bff"}


# ── Library: artists, downloads, following ────────────────────────────────────


# ── Artist photos ─────────────────────────────────────────────────────────────
# Artists are name-keyed and the engine carries audio metadata only, so photos
# come from Deezer's keyless public search behind a small process cache.
_ARTIST_IMG_TTL = 6 * 3600.0
_ARTIST_IMG_CACHE: dict[str, tuple[float, Optional[str]]] = {}


def _norm_name(value: str) -> str:
    return " ".join(value.casefold().split())


def _artist_image(name: str) -> Optional[str]:
    key = _norm_name(name)
    hit = _ARTIST_IMG_CACHE.get(key)
    if hit is not None and time.time() - hit[0] < _ARTIST_IMG_TTL:
        return hit[1]
    picture: Optional[str] = None
    try:
        response = httpx.get(
            "https://api.deezer.com/search/artist",
            params={"q": name, "limit": 5},
            timeout=3.0,
        )
        if response.status_code == 200:
            for row in response.json().get("data") or []:
                candidate = _norm_name(str(row.get("name") or ""))
                if candidate and (candidate == key or key in candidate or candidate in key):
                    pic = row.get("picture_big") or row.get("picture_medium")
                    if isinstance(pic, str) and pic.startswith("http"):
                        picture = pic
                        break
    except Exception:
        picture = None
    if len(_ARTIST_IMG_CACHE) > 400:
        _ARTIST_IMG_CACHE.clear()
    _ARTIST_IMG_CACHE[key] = (time.time(), picture)
    return picture


def _fill_artist_images(outs: list, limit: int = 12) -> None:
    """Attach photos to the first rows; the rest fall back to initials."""
    todo = [o for o in outs[:limit] if not o.imageUrl]
    if not todo:
        return
    with ThreadPoolExecutor(max_workers=min(6, len(todo))) as pool:
        for artist, picture in zip(todo, pool.map(_artist_image, [a.name for a in todo])):
            artist.imageUrl = picture


def _artist_out(name: str, followers: int | None = None) -> ArtistOut:
    """Artists are name-keyed (same id space as telemetry and follow routes)."""
    return ArtistOut(id=name, name=name, followers=followers)


@app.get("/library/artists", response_model=list[ArtistOut])
def list_artists(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Followed artists first, then affinity-ranked artists from listening."""
    followed = db.scalars(
        select(FollowedArtist).where(FollowedArtist.user_id == user.id)
        .order_by(FollowedArtist.created_at.desc())
    ).all()
    seen = {f.artist for f in followed}
    out = [_artist_out(f.artist) for f in followed]

    scores = db.scalars(
        select(ArtistScore).where(ArtistScore.user_id == user.id)
        .order_by(ArtistScore.score.desc()).limit(20)
    ).all()
    for s in scores:
        if s.artist in seen or s.score <= 0:
            continue
        out.append(_artist_out(s.artist, followers=None))
    _fill_artist_images(out)
    return out


@app.get("/auth/me/discovered-artists", response_model=DiscoveredArtistsOut)
def discovered_artists(user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    """The artists your listening actually surfaced — newest voices first.

    Same source as the `topArtists` stat, so the count and the list agree.
    """
    rows = db.execute(
        select(PlayHistory.artist_id, func.count(), func.max(PlayHistory.played_at))
        .where(
            PlayHistory.user_id == user.id,
            PlayHistory.artist_id.is_not(None),
            PlayHistory.artist_id != "",
        )
        .group_by(PlayHistory.artist_id)
        .order_by(func.max(PlayHistory.played_at).desc())
        .limit(50)
    ).all()
    artists = [ArtistDiscoveryOut(name=name, plays=int(plays)) for name, plays, _ in rows]
    _fill_artist_images(artists)
    count = db.scalar(
        select(func.count(distinct(PlayHistory.artist_id))).where(
            PlayHistory.user_id == user.id,
            PlayHistory.artist_id.is_not(None),
            PlayHistory.artist_id != "",
        )
    ) or 0
    return DiscoveredArtistsOut(count=int(count), artists=artists)


@app.get("/library/downloaded", response_model=list[TrackOut])
def list_downloads(user: User = Depends(get_current_user)):
    """Tracks downloaded for offline playback (kept in the client offline cache)."""
    return []


@app.get("/users/me/following", response_model=LikedIdsOut)
def list_following(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ids = db.scalars(
        select(FollowedArtist.artist).where(FollowedArtist.user_id == user.id)
    ).all()
    return LikedIdsOut(ids=list(ids))


@app.post("/users/{artist_id}/follow", status_code=204)
def follow_artist(artist_id: str, payload: FollowIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    artist_id = artist_id.strip()
    row = db.scalar(select(FollowedArtist).where(
        FollowedArtist.user_id == user.id,
        FollowedArtist.artist == artist_id,
    ))
    if payload.follow and row is None:
        db.add(FollowedArtist(user_id=user.id, artist=artist_id))
    elif not payload.follow and row is not None:
        db.delete(row)
    db.commit()
    return Response(status_code=204)


# ── Discovery ─────────────────────────────────────────────────────────────────


@app.get("/discover/new-releases", response_model=list[NewReleaseOut])
def new_releases():
    """Fresh tracks from the live engine, shaped as single-track releases."""
    rows = search_catalogue("new music releases", 12)
    return [
        NewReleaseOut(
            id=str(r["id"]),
            title=r["title"],
            artist=r.get("artist"),
            year=str(datetime.now(timezone.utc).year),
            coverUrl=r.get("imageUrl"),
        )
        for r in rows
    ]


def _discover_out(rows: list[dict], limit: int) -> list[DiscoverTrackOut]:
    out: list[DiscoverTrackOut] = []
    for row in rows:
        video_id = row.get("videoId") or row.get("id")
        title = row.get("title")
        if not video_id or not title:
            continue
        out.append(DiscoverTrackOut(
            id=str(video_id),
            videoId=str(video_id),
            title=title,
            artist=row.get("artist"),
            album=row.get("album"),
            durationSec=row.get("durationSec"),
            imageUrl=row.get("imageUrl"),
        ))
        if len(out) >= limit:
            break
    return out


@app.get("/discover/trending", response_model=list[DiscoverTrackOut])
def discover_trending(locale: Optional[str] = None, limit: int = 20):
    """First-run trending, blended toward the caller's market.

    The browser passes its initial locale (navigator.language) so a brand-new
    account sees its local charts before any play telemetry exists.
    """
    limit = max(1, min(limit, 50))
    queries = market_queries(locale) + ["trending music"]
    return _discover_out(merged_catalogue(queries, limit), limit)


@app.get("/discover/featured", response_model=list[DiscoverTrackOut])
def discover_featured(locale: Optional[str] = None, limit: int = 16):
    """Fresh picks for the empty state: new releases plus the local market."""
    limit = max(1, min(limit, 50))
    queries = ["new music releases"] + market_queries(locale)
    return _discover_out(merged_catalogue(queries, limit), limit)


# ── Track metadata: album enrichment (public iTunes search, cached) ───────────

_ALBUM_CACHE: dict[str, Optional[str]] = {}
_ALBUM_CACHE_MAX = 2048


def _album_key(title: str, artist: Optional[str]) -> str:
    return f"{(artist or '').strip().lower()}|{title.strip().lower()}"


def _itunes_match(term: str, want_artist: str) -> Optional[str]:
    """First collection whose artist agrees with the query; None if no match."""
    try:
        response = httpx.get(
            "https://itunes.apple.com/search",
            params={"term": term, "entity": "song", "limit": 5},
            timeout=4.0,
            follow_redirects=True,
        )
        results = response.json().get("results", [])
    except Exception:
        return None
    if not isinstance(results, list):
        return None
    want = (want_artist or "").strip().lower()
    for row in results:
        if not isinstance(row, dict):
            continue
        collection = row.get("collectionName")
        if not isinstance(collection, str) or not collection:
            continue
        if not want:
            return collection
        got = str(row.get("artistName") or "").strip().lower()
        if want in got or got in want:
            return collection
    return None


def _lookup_album(title: str, artist: Optional[str]) -> Optional[str]:
    """Best-effort collection name for one track; None when unmatchable.

    The artist must agree with the result — a bare title match (songs named
    after common words) would invent wrong albums, and we never invent.
    Engine rows also carry YouTube channel names as the artist, so a miss
    retries with the real artist embedded in "Artist - Title" upload names.
    """
    direct = _itunes_match(
        f"{artist} {title}".strip() if artist else title, artist or ""
    )
    if direct or not artist or " - " not in title:
        return direct
    pre, _, post = title.partition(" - ")
    pre, post = pre.strip(), post.strip()
    if not pre or not post:
        return direct
    return _itunes_match(f"{pre} {post}", pre)


@app.post("/meta/albums")
def lookup_albums(payload: AlbumLookupIn) -> dict[str, Optional[str]]:
    """{trackId: album} for the requested rows; null when metadata has none."""
    out: dict[str, Optional[str]] = {}
    pending: list[AlbumQueryIn] = []
    for track in payload.tracks[:30]:
        key = _album_key(track.title, track.artist)
        if key in _ALBUM_CACHE:
            out[track.id] = _ALBUM_CACHE[key]
        else:
            pending.append(track)

    if pending:
        with ThreadPoolExecutor(max_workers=min(6, len(pending))) as pool:
            found = list(pool.map(
                lambda t: _lookup_album(t.title, t.artist),
                pending,
            ))
        for track, album in zip(pending, found):
            _ALBUM_CACHE[_album_key(track.title, track.artist)] = album
            while len(_ALBUM_CACHE) > _ALBUM_CACHE_MAX:
                _ALBUM_CACHE.pop(next(iter(_ALBUM_CACHE)))
            out[track.id] = album
    return out


# ── Telemetry ─────────────────────────────────────────────────────────────────


@app.post("/api/events", status_code=204)
def ingest_event(payload: VibraEventIn, user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    """Silent frontend telemetry: logs the action, scores artists, applies feedback."""
    listening = payload.type in LISTENING_TYPES

    if listening and user.history_paused:
        return Response(status_code=204)

    db.add(PlayEventRow(
        user_id=user.id,
        type=payload.type,
        track_id=payload.track_id,
        title=payload.title,
        artist=payload.artist,
        image_url=payload.image,
        position_ms=payload.position_ms or 0,
        source_shelf_id=payload.source_shelf_id,
        device_type=payload.device.type,
        device_name=payload.device.name,
    ))

    # Score artist affinity on listens AND likes — any of them, even once.
    weight = EVENT_WEIGHTS.get(payload.type)
    if payload.artist and weight is not None:
        row = db.scalar(select(ArtistScore).where(
            ArtistScore.user_id == user.id,
            ArtistScore.artist == payload.artist,
        ))
        if row is None:
            row = ArtistScore(user_id=user.id, artist=payload.artist, score=weight, plays=1)
        else:
            row.score += weight
            row.plays += 1
            row.last_played_at = datetime.now(timezone.utc)
        db.add(row)

    if payload.type == "not_interested":
        if payload.artist:
            db.add(BlockedItem(user_id=user.id, kind="artist", value=payload.artist))
        if payload.track_id:
            db.add(BlockedItem(user_id=user.id, kind="track", value=payload.track_id))

    db.commit()
    _invalidate_home(user.id)
    return Response(status_code=204)


# ── Server-driven home feed ───────────────────────────────────────────────────

# A finished shelf build is expensive (several external catalogue searches), so
# it is reused for a short window; anything the learner consumes drops it first.
_HOME_CACHE: dict[tuple[Optional[str], Optional[str]], tuple[float, list["HomeShelfOut"], float]] = {}
_HOME_CACHE_TTL = 120.0


def _invalidate_home(user_id: Optional[str]) -> None:
    for key in [k for k in _HOME_CACHE if k[0] == user_id]:
        _HOME_CACHE.pop(key, None)


def _items_from_tracks(tracks: list[dict]) -> list[HomeItemOut]:
    return [
        HomeItemOut(
            id=track["id"],
            title=track["title"],
            artist=track.get("artist"),
            durationSec=track.get("durationSec"),
            imageUrl=track.get("imageUrl"),
            videoId=track.get("videoId"),
        )
        for track in tracks
    ]


def _items_from_events(events: list[PlayEventRow]) -> list[HomeItemOut]:
    return [
        HomeItemOut(
            id=event.track_id or event.id,
            title=event.title or "Unknown track",
            artist=event.artist,
            imageUrl=event.image_url,
            videoId=event.track_id,
        )
        for event in events
        if event.track_id and event.title
    ]


def _guest_shelves_from(
    locale: Optional[str],
    region_rows: list[dict],
    trending_rows: list[dict],
    fresh_rows: list[dict],
) -> list[HomeShelfOut]:
    """Shelf objects from pre-fetched region/trending/new rows."""
    market = market_label(locale)
    region = _items_from_tracks(region_rows)
    trending = _items_from_tracks(trending_rows)
    fresh = _items_from_tracks(fresh_rows)

    shelves: list[HomeShelfOut] = []
    if region:
        shelves.append(HomeShelfOut(
            id=f"region-{market.lower().replace(' ', '-')}",
            type="shelf", title=f"Popular in {market}", items=region,
        ))
    if trending:
        shelves.append(HomeShelfOut(id="trending-now", type="shelf", title="Trending now", items=trending))
    # Mood mixes are query seeds — the client resolves them on open, so a
    # cold-start feed carries real depth without extra engine round-trips.
    shelves.append(HomeShelfOut(
        id="moment-mixes", type="mix_row", title="Mixes for the moment",
        items=_moment_mixes(),
    ))
    if fresh:
        shelves.append(HomeShelfOut(id="new-releases", type="shelf", title="New releases", items=fresh))
    return shelves


def _moment_mixes() -> list[HomeItemOut]:
    """Mood/time-of-day mixes — pure query seeds, no engine cost until opened."""
    return [
        HomeItemOut(id="mix-morning", title="Morning Mix", subtitle="Ease into the day",
                    query="feel good songs upbeat morning"),
        HomeItemOut(id="mix-focus", title="Focus Mix", subtitle="Deep work, no skips",
                    query="lofi hip hop radio beats to study"),
        HomeItemOut(id="mix-workout", title="Workout Mix", subtitle="Keep the pace up",
                    query="workout motivation hype songs"),
        HomeItemOut(id="mix-chill", title="Chill Mix", subtitle="Slow it all down",
                    query="chill r&b slow jams relaxed songs"),
        HomeItemOut(id="mix-throwback", title="Throwback Mix", subtitle="The ones you forgot you loved",
                    query="greatest hits throwback songs"),
        HomeItemOut(id="mix-late-night-card", title="Late Night Mix", subtitle="After-hours energy",
                    query="late night vibes r&b"),
    ]


def _guest_shelves(locale: Optional[str] = None) -> list[HomeShelfOut]:
    """Cold start / signed out: region and trending shelves, same components.

    `locale` (navigator.language from the client) picks the region market —
    no fixed language: ko-KR gets Korean charts, en-KE gets Kenya, and a
    locale-less client keeps the product default market.
    """
    with ThreadPoolExecutor(max_workers=3) as pool:
        region_rows = pool.submit(search_catalogue, region_query(locale), 10)
        trending_rows = pool.submit(
            lambda: merged_catalogue(scene_queries(locale) + ["trending music"], 10)
        )
        fresh_rows = pool.submit(search_catalogue, "new music releases", 10)
        return _guest_shelves_from(
            locale, region_rows.result(), trending_rows.result(), fresh_rows.result(),
        )


def _diverse_rows(rows: list[dict], limit: int = 10, per_artist: int = 3) -> list[dict]:
    """Cap how much of a shelf one artist may occupy; order stays intact."""
    out: list[dict] = []
    counts: dict[str, int] = {}
    for row in rows:
        who = str(row.get("artist") or "").strip().lower() or "?"
        if counts.get(who, 0) >= per_artist:
            continue
        counts[who] = counts.get(who, 0) + 1
        out.append(row)
        if len(out) >= limit:
            break
    return out


def _because_rows(
    artist: str,
    recent: list[PlayEventRow],
    blocked_artists: set[str],
    siblings: Optional[list[str]] = None,
) -> list[dict]:
    """Catalogue rows for one "Because you played …" shelf, history as fallback.

    The seed artist leads; rows from the listener's other top artists are
    interleaved after it (each artist capped at three) so the shelf reads as a
    mix instead of a single artist's search echo. History fills the hole when
    the engine has nothing.
    """

    def run(query: str) -> list[dict]:
        return [
            t for t in search_catalogue(query, 8)
            if t.get("artist") is None or t["artist"] not in blocked_artists
        ]

    queries = [artist, *(a for a in (siblings or []) if a and a != artist)][:3]
    if len(queries) == 1:
        batches = [run(queries[0])]
    else:
        with ThreadPoolExecutor(max_workers=min(3, len(queries))) as pool:
            batches = list(pool.map(run, queries))

    # Round-robin across the batches: the seed artist comes first, siblings
    # land right behind its first rows instead of at the very end. The same
    # song often exists as several uploads — dedupe by id AND cleaned title.
    merged: list[dict] = []
    seen: set[str] = set()
    seen_titles: set[str] = set()

    def title_key(row: dict) -> str:
        return re.sub(r"[^a-z0-9]+", " ", str(row.get("title") or "").lower()).strip()

    for depth in range(max((len(b) for b in batches), default=0)):
        for batch in batches:
            if depth >= len(batch):
                continue
            row = batch[depth]
            key = str(row.get("id") or "")
            tkey = title_key(row)
            if not key or key in seen or (tkey and tkey in seen_titles):
                continue
            seen.add(key)
            if tkey:
                seen_titles.add(tkey)
            merged.append(row)

    rows = _diverse_rows(merged, limit=10, per_artist=3)
    if rows:
        return rows
    return [
        {"id": e.track_id, "videoId": e.track_id, "title": e.title, "artist": e.artist, "imageUrl": e.image_url}
        for e in recent if e.artist == artist and e.track_id and e.title
    ]


def _home_for_user(db: Session, user: User, locale: Optional[str] = None) -> list[HomeShelfOut]:
    blocked_tracks = set(db.scalars(
        select(BlockedItem.value).where(BlockedItem.user_id == user.id, BlockedItem.kind == "track")
    ).all())
    blocked_artists = set(db.scalars(
        select(BlockedItem.value).where(BlockedItem.user_id == user.id, BlockedItem.kind == "artist")
    ).all())

    events = db.scalars(
        select(PlayEventRow)
        .where(PlayEventRow.user_id == user.id)
        .order_by(PlayEventRow.created_at.desc())
        .limit(300)
    ).all()

    played = [
        e for e in events
        if e.type in {"play", "complete", "replay"}
        and e.track_id and e.title
        and e.track_id not in blocked_tracks
        and (e.artist is None or e.artist not in blocked_artists)
    ]
    if not played:
        return _guest_shelves(locale)

    # Distinct, newest-first plays.
    seen: set[str] = set()
    recent: list[PlayEventRow] = []
    for event in played:
        if event.track_id in seen:
            continue
        seen.add(event.track_id)
        recent.append(event)

    # Artist affinity → mixes and "Because you played X" shelves. A single play
    # or like already produced a score > 0, so these appear from the first listen.
    scores = db.scalars(
        select(ArtistScore)
        .where(ArtistScore.user_id == user.id, ArtistScore.artist.notin_(blocked_artists))
        .order_by(ArtistScore.score.desc())
        .limit(6)
    ).all()
    top_artists = [s.artist for s in scores if s.score > 0][:6]
    focus = top_artists[:3]

    # One pool: the "Because you played" search plus the guest/scene shelves
    # we keep alongside personalization — the shared pool caps how many
    # catalogue requests we burst at the external engine.
    with ThreadPoolExecutor(max_workers=6) as pool:
        because_future = (
            pool.submit(_because_rows, focus[0], recent, blocked_artists, focus[1:3])
            if focus else None
        )
        region_future = pool.submit(search_catalogue, region_query(locale), 10)
        trending_future = pool.submit(
            lambda: merged_catalogue(scene_queries(locale) + ["trending music"], 10)
        )
        fresh_future = pool.submit(search_catalogue, "new music releases", 10)
        scenes = scene_queries(locale)
        scene_future = pool.submit(search_catalogue, scenes[0], 10) if scenes else None

        # ── History-derived shelves (DB only, no engine) ────────────────────
        # Play counts across the 300-event window.
        play_counts: dict[str, int] = {}
        newest_play: dict[str, PlayEventRow] = {}
        for event in played:
            tid = event.track_id or ""
            play_counts[tid] = play_counts.get(tid, 0) + 1
            newest_play.setdefault(tid, event)
        top_events = sorted(
            (newest_play[tid] for tid in play_counts if tid in newest_play),
            key=lambda e: play_counts.get(e.track_id or "", 0),
            reverse=True,
        )

        week_ago = datetime.now(timezone.utc) - timedelta(days=7)
        month_ago = datetime.now(timezone.utc) - timedelta(days=30)
        heavy = [e for e in recent if (e.created_at or week_ago) >= week_ago][:10]
        # Rediscover: played a while ago, not among the newest listens.
        rediscover = [
            e for e in played
            if (e.created_at or month_ago) <= month_ago
            and e.track_id not in {r.track_id for r in recent[:10]}
        ]
        seen_redis: set[str] = set()
        rediscover_uniq: list[PlayEventRow] = []
        for event in rediscover:
            tid = event.track_id or ""
            if tid in seen_redis:
                continue
            seen_redis.add(tid)
            rediscover_uniq.append(event)

        # Liked-snapshot shelves — "Because you liked" + forgotten favorites.
        liked_rows = db.scalars(
            select(LikedTrack)
            .where(LikedTrack.user_id == user.id, LikedTrack.track_id.notin_(blocked_tracks))
            .order_by(LikedTrack.liked_at.desc())
            .limit(60)
        ).all()
        liked_artist_counts: dict[str, int] = {}
        for row in liked_rows:
            if row.artist and row.artist not in blocked_artists:
                liked_artist_counts[row.artist] = liked_artist_counts.get(row.artist, 0) + 1
        liked_focus = max(liked_artist_counts, key=liked_artist_counts.get) if liked_artist_counts else None
        forgotten = [
            row for row in liked_rows
            if row.track_id not in {e.track_id for e in recent[:10]}
        ][:10]

        shelves: list[HomeShelfOut] = [
            HomeShelfOut(
                id="jump-back-in",
                type="jump_back_in",
                title="Jump back in",
                items=_items_from_events(recent[:4]),
            )
        ]
        taken = {item.id for item in shelves[0].items}

        def add_track_shelf(shelf_id: str, title: str, items: list[HomeItemOut], shelf_type: str = "shelf") -> None:
            fresh_items = [item for item in items if item.id not in taken][:10]
            if not fresh_items:
                return
            taken.update(item.id for item in fresh_items)
            shelves.append(HomeShelfOut(
                id=shelf_id, type=shelf_type, title=title, items=fresh_items,
            ))

        # "Made for you" mixes — seed queries the client resolves on open.
        # Radio/greatest-hits seeds pull the artist plus similar artists.
        mixes: list[HomeItemOut] = []
        for position, artist in enumerate(focus, start=1):
            art = next((e.image_url for e in recent if e.artist == artist and e.image_url), None)
            mixes.append(HomeItemOut(
                id=f"mix-your-{position}",
                title=f"{artist} Mix",
                artist=artist,
                subtitle=artist,
                imageUrl=art,
                query=f"{artist} radio",
            ))
        last_art = next((e.image_url for e in recent if e.image_url), None)
        mixes.append(HomeItemOut(
            id="mix-late-night",
            title="Late Night Mix",
            imageUrl=last_art,
            query="lofi hip hop radio",
        ))
        shelves.append(HomeShelfOut(
            id="made-for-you", type="mix_row", title="Made for you", items=mixes,
        ))

        # One "Because you played" shelf for the strongest affinity — a row
        # per artist would repeat the same songs under three headings.
        if because_future is not None and focus:
            rows = [t for t in because_future.result() if str(t.get("id"))][:10]
            add_track_shelf(
                f"because-{focus[0].lower().replace(' ', '-')[:40]}",
                f"Because you played {focus[0]}",
                _items_from_tracks(rows),
            )

        # Top songs / heavy rotation / rediscover — all from the event window.
        add_track_shelf("your-top-songs", "Your top songs", _items_from_events(top_events[:10]))
        if heavy:
            add_track_shelf("heavy-rotation", "Heavy rotation", _items_from_events(heavy), "recent")
        shelves.append(HomeShelfOut(
            id="recently-played", type="recent", title="Recently played",
            items=_items_from_events(recent[:10]),
        ))
        taken.update(item.id for item in shelves[-1].items)
        if rediscover_uniq:
            add_track_shelf("rediscover", "Rediscover", _items_from_events(rediscover_uniq[:10]))

        # Mood mixes sit between history and the wider world.
        shelves.append(HomeShelfOut(
            id="moment-mixes", type="mix_row", title="Mixes for the moment",
            items=_moment_mixes(),
        ))

        # "Because you liked" — strongest like-affinity, engine-backed.
        if liked_focus and liked_focus not in focus:
            liked_mix = HomeItemOut(
                id="mix-liked-artist",
                title=f"{liked_focus} Mix",
                artist=liked_focus,
                subtitle=liked_focus,
                imageUrl=next((r.image_url for r in liked_rows if r.artist == liked_focus and r.image_url), None),
                query=f"{liked_focus} radio",
            )
            shelves.append(HomeShelfOut(
                id="made-from-likes", type="mix_row", title="Made from your likes",
                items=[liked_mix, *_moment_mixes()[:2]],
            ))

        # Forgotten favorites — liked songs that missed the recent window.
        if forgotten:
            add_track_shelf(
                "forgotten-favorites", "Forgotten favorites",
                [HomeItemOut(
                    id=row.track_id,
                    title=row.title or "Unknown track",
                    artist=row.artist,
                    imageUrl=row.image_url,
                    videoId=row.video_id or row.track_id,
                ) for row in forgotten if row.title],
            )

        # Keep Trending (and the region/new shelves) next to personalization;
        # drop only the items an earlier shelf already shows.
        guest = _guest_shelves_from(
            locale, region_future.result(), trending_future.result(), fresh_future.result(),
        )
        for shelf in guest:
            if shelf.type == "mix_row":
                # Mood mixes already added above for signed-in listeners.
                continue
            items = [item for item in shelf.items if item.id not in taken]
            if not items:
                continue
            taken.update(item.id for item in items)
            shelves.append(HomeShelfOut(
                id=shelf.id, type=shelf.type, title=shelf.title,
                subtitle=shelf.subtitle, items=items,
            ))

        # Scene spotlight (ko → K-pop, etc.) — the locale's own sound.
        if scene_future is not None and scenes:
            scene_rows = [t for t in scene_future.result() if str(t.get("id"))][:10]
            label = scenes[0].split(" music")[0].split(" hits")[0].strip().title()
            add_track_shelf("scene-spotlight", f"{label} spotlight", _items_from_tracks(scene_rows))

        return shelves


@app.get("/api/home", response_model=HomeOut)
def home(
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
    locale: Optional[str] = None,
):
    key = (user.id if user is not None else None, locale)
    cached = _HOME_CACHE.get(key)
    if cached is not None and time.monotonic() - cached[0] < cached[2]:
        return HomeOut(shelves=cached[1])
    shelves = _home_for_user(db, user, locale) if user is not None else _guest_shelves(locale)
    if len(_HOME_CACHE) > 64:
        _HOME_CACHE.clear()
    # A thin feed means the catalogue searches timed out mid-build — hold it
    # only briefly so the full shelf set returns as soon as the engine is back.
    ttl = _HOME_CACHE_TTL if len(shelves) >= 6 else 15.0
    _HOME_CACHE[key] = (time.monotonic(), shelves, ttl)
    return HomeOut(shelves=shelves)


@app.delete("/api/home", status_code=204)
def reset_recommendations(user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    """Settings → Privacy → Reset recommendations."""
    for model in (PlayEventRow, ArtistScore, BlockedItem):
        db.query(model).filter(model.user_id == user.id).delete()
    db.query(PlayHistory).filter(PlayHistory.user_id == user.id).delete()
    db.commit()
    _invalidate_home(user.id)
    return Response(status_code=204)


@app.post("/api/feedback", status_code=201)
def submit_feedback(
    payload: FeedbackIn,
    request: Request,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Settings → Send feedback: a star rating plus an optional note.
    Signed-in rows keep the user id; guests can still send with an email."""
    _rate_limit(f"feedback:{_client_ip(request)}", 5, 10 * 60)
    row = Feedback(
        user_id=user.id if user is not None else None,
        email=payload.email or (user.email if user is not None else None),
        rating=payload.rating,
        message=(payload.message or "").strip()[:4000] or None,
        platform=payload.platform,
        app_version=payload.appVersion,
    )
    db.add(row)
    db.commit()
    return Response(status_code=201)


@app.put("/api/settings/history", status_code=204)
def set_history_pause(payload: HistoryPauseIn, user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    """Settings → Privacy → Pause history."""
    user.history_paused = payload.paused
    db.add(user)
    db.commit()
    return Response(status_code=204)


# ── Audio ──────────────────────────────────────────────────────────────────────


@app.get("/api/audio/{video_id}")
def stream_audio(video_id: str, request: Request, proxy: int = 0, debug: int = 0):
    """Direct audio for one track.

    Playback (default): 302 to a real audio URL — `<audio>` follows redirects
    cross-origin for free, so no CORS and no bandwidth through this function.

    Downloads (`?proxy=1`): stream the bytes back ourselves, because
    googlevideo only sends `Access-Control-Allow-Origin` to youtube.com and a
    browser fetch would otherwise be blocked. Range requests pass through so
    resume/partial fetches keep working.
    """
    resolved = resolve_audio_url(video_id)
    if resolved is None:
        if debug:
            return JSONResponse({
                "resolved": False,
                "diag": LAST_DIAG.get(video_id, "no_diag"),
                "engine": engine_stream_url(video_id),
            })
        if proxy:
            # Only verified audio may be saved — never store an error body.
            raise HTTPException(status_code=502, detail="No playable audio source for this track")
        # Playback: let <audio> follow Lenium; if it errors the player falls
        # back to the IFrame engine exactly as before.
        return RedirectResponse(engine_stream_url(video_id), status_code=302)
    url, mime = resolved
    if not proxy:
        return RedirectResponse(url, status_code=302)

    upstream_headers = {}
    range_header = request.headers.get("range")
    if range_header:
        upstream_headers["Range"] = range_header

    context = httpx.stream(
        "GET",
        url,
        headers=upstream_headers,
        timeout=httpx.Timeout(30.0, connect=10.0),
        follow_redirects=True,
    )
    upstream = context.__enter__()

    def body():
        try:
            for chunk in upstream.iter_bytes(chunk_size=65536):
                if chunk:
                    yield chunk
        finally:
            context.__exit__(None, None, None)

    out_headers = {}
    content_type = upstream.headers.get("content-type", "")
    if not content_type.startswith("audio/"):
        context.__exit__(None, None, None)
        raise HTTPException(status_code=502, detail="Upstream did not return audio")
    out_headers["Accept-Ranges"] = "bytes"
    for name in ("content-length", "content-range", "etag", "last-modified"):
        value = upstream.headers.get(name)
        if value:
            out_headers[name] = value
    return StreamingResponse(
        body(),
        status_code=upstream.status_code if upstream.status_code in (200, 206) else 200,
        media_type=content_type,
        headers=out_headers,
    )
