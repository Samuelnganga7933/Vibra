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
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import jwt
from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from catalogue import search_catalogue
from database import Base, SessionLocal, engine, get_db
from market import market_label, market_queries, merged_catalogue, region_query, scene_queries
from models import (
    ArtistScore,
    BlockedItem,
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
    ArtistOut,
    AuthOut,
    DiscoverTrackOut,
    FollowIn,
    HistoryPauseIn,
    HomeItemOut,
    HomeOut,
    HomeShelfOut,
    LikeToggle,
    LikeToggleOut,
    LikedIdsOut,
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
            name="Vibra User",
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


async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_playlist_tracks()
    db = SessionLocal()
    try:
        _ensure_default_user(db)
    finally:
        db.close()
    yield


app = FastAPI(title="Vibra User BFF", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth routes ───────────────────────────────────────────────────────────────


@app.post("/auth/register", response_model=AuthOut)
def register(payload: RegisterIn, response: Response, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
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
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
    if user is None or not _verify_password(payload.password, user.password_hash):
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


@app.post("/auth/neon", response_model=AuthOut)
def auth_neon(payload: NeonSessionIn, response: Response, db: Session = Depends(get_db)):
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
    user.session_token = secrets.token_hex(24)
    db.add(user)
    db.commit()
    db.refresh(user)
    _set_session_cookie(response, user.session_token or "")
    return AuthOut(token=user.session_token or "", user=UserOut(
        id=user.id, name=user.name, email=user.email, username=user.username,
        initials=user.initials, avatar_url=user.avatar_url,
        subscription=user.subscription,  # type: ignore[arg-type]
    ))


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
    return PlaylistOut(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        coverColor=playlist.cover_color,
        coverUrl=playlist.cover_url,
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


@app.get("/auth/me", response_model=UserOut)
def read_me(user: User = Depends(get_token_user), db: Session = Depends(get_db)):
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
    ids = db.scalars(
        select(LikedTrack.track_id).where(LikedTrack.user_id == user.id).order_by(LikedTrack.liked_at.desc())
    ).all()
    return LikedIdsOut(ids=list(ids))


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
        if existing is None:
            db.add(LikedTrack(user_id=user.id, track_id=track_id))
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
    return out


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
    return Response(status_code=204)


# ── Server-driven home feed ───────────────────────────────────────────────────


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


def _guest_shelves(locale: Optional[str] = None) -> list[HomeShelfOut]:
    """Cold start / signed out: region and trending shelves, same components.

    `locale` (navigator.language from the client) picks the region market —
    no fixed language: ko-KR gets Korean charts, en-KE gets Kenya, and a
    locale-less client keeps the product default market.
    """
    market = market_label(locale)
    region = _items_from_tracks(search_catalogue(region_query(locale), 10))
    trending = _items_from_tracks(merged_catalogue(scene_queries(locale) + ["trending music"], 10))
    fresh = _items_from_tracks(search_catalogue("new music releases", 10))

    shelves: list[HomeShelfOut] = []
    if region:
        shelves.append(HomeShelfOut(
            id=f"region-{market.lower().replace(' ', '-')}",
            type="shelf", title=f"Popular in {market}", items=region,
        ))
    if trending:
        shelves.append(HomeShelfOut(id="trending-now", type="shelf", title="Trending now", items=trending))
    if fresh:
        shelves.append(HomeShelfOut(id="new-releases", type="shelf", title="New releases", items=fresh))
    return shelves


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

    shelves: list[HomeShelfOut] = [
        HomeShelfOut(
            id="jump-back-in",
            type="jump_back_in",
            title="Jump back in",
            items=_items_from_events(recent[:4]),
        )
    ]

    # Artist affinity → "Because you played X" + mixes. A single play or like
    # already produced a score > 0, so this shelf appears from the first listen.
    scores = db.scalars(
        select(ArtistScore)
        .where(ArtistScore.user_id == user.id, ArtistScore.artist.notin_(blocked_artists))
        .order_by(ArtistScore.score.desc())
        .limit(6)
    ).all()
    top_artists = [s.artist for s in scores if s.score > 0][:6]

    if top_artists:
        # Dynamic shelf FIRST — personalized beats generic trending.
        top = top_artists[0]
        because_tracks = [
            t for t in search_catalogue(top, 12)
            if t.get("artist") is None or t["artist"] not in blocked_artists
        ][:10]
        if not because_tracks:
            because_tracks = [
                {"id": e.track_id, "videoId": e.track_id, "title": e.title, "artist": e.artist, "imageUrl": e.image_url}
                for e in recent if e.artist == top
            ][:10]
        if because_tracks:
            shelves.append(HomeShelfOut(
                id=f"because-{top.lower().replace(' ', '-')[:40]}",
                type="shelf",
                title=f"Because you played {top}",
                items=_items_from_tracks(because_tracks),
            ))

    shelves.append(HomeShelfOut(
        id="recently-played", type="recent", title="Recently played",
        items=_items_from_events(recent[:10]),
    ))

    # Generic trending only when there is nothing learned yet — never next to
    # a personalized shelf.
    if not top_artists:
        shelves.extend(s for s in _guest_shelves(locale) if not s.id.startswith("region-"))
    return shelves


@app.get("/api/home", response_model=HomeOut)
def home(
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
    locale: Optional[str] = None,
):
    shelves = _home_for_user(db, user, locale) if user is not None else _guest_shelves(locale)
    return HomeOut(shelves=shelves)


@app.delete("/api/home", status_code=204)
def reset_recommendations(user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    """Settings → Privacy → Reset recommendations."""
    for model in (PlayEventRow, ArtistScore, BlockedItem):
        db.query(model).filter(model.user_id == user.id).delete()
    db.query(PlayHistory).filter(PlayHistory.user_id == user.id).delete()
    db.commit()
    return Response(status_code=204)


@app.put("/api/settings/history", status_code=204)
def set_history_pause(payload: HistoryPauseIn, user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    """Settings → Privacy → Pause history."""
    user.history_paused = payload.paused
    db.add(user)
    db.commit()
    return Response(status_code=204)
