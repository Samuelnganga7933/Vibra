"""Vibra User BFF — FastAPI + SQLAlchemy (SQLite).

Run:
    cd backend
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import hashlib
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from catalogue import search_catalogue
from database import Base, SessionLocal, engine, get_db
from models import (
    ArtistScore,
    BlockedItem,
    LikedTrack,
    PlayEvent as PlayEventRow,
    PlayHistory,
    Playlist,
    PlaylistTrack,
    User,
)
from schemas import (
    AuthOut,
    HistoryPauseIn,
    HomeItemOut,
    HomeOut,
    HomeShelfOut,
    LikeToggle,
    LikeToggleOut,
    LikedIdsOut,
    LoginIn,
    PlayEvent,
    PlaylistCreate,
    PlaylistCreator,
    PlaylistOut,
    RegisterIn,
    SettingsUpdate,
    Stats,
    TrackOut,
    UserOut,
    VibraEventIn,
)

DEFAULT_USER_EMAIL = "user@vibra.local"
COVER_COLOR_FALLBACK = "#2C4A5E"

LISTENING_TYPES = {"play", "skip", "complete", "replay"}
# One play (1.5) or one like (2.0) is enough to move an artist's affinity —
# /api/home reads these scores immediately after the event commits.
EVENT_WEIGHTS = {"play": 1.5, "complete": 3.0, "replay": 2.0, "skip": -1.0, "like": 2.0}

DEFAULT_USER_EMAIL = "user@vibra.local"
COVER_COLOR_FALLBACK = "#2C4A5E"


def _initials(name: str) -> str:
    parts = [p for p in name.strip().split() if p]
    return "".join(p[0].upper() for p in parts[:2]) or "VU"


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
    x_user_id: Optional[str] = Header(default=None),
) -> User:
    """Cookie-session friendly: defaults to a single provisioned user.

    Pass an `X-User-Id` header to act as a specific user (multi-user ready).
    """
    if x_user_id:
        user = db.get(User, x_user_id)
        if user is not None:
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
) -> User:
    """Requires a valid bearer session — raises 401 otherwise."""
    token = _bearer(authorization)
    user = db.scalar(select(User).where(User.session_token == token)) if token else None
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user


def get_optional_user(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
) -> Optional[User]:
    token = _bearer(authorization)
    if not token:
        return None
    return db.scalar(select(User).where(User.session_token == token))


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        _ensure_default_user(db)
    finally:
        db.close()
    yield


app = FastAPI(title="Vibra User BFF", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth routes ───────────────────────────────────────────────────────────────


@app.post("/auth/register", response_model=AuthOut)
def register(payload: RegisterIn, db: Session = Depends(get_db)):
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
    return AuthOut(token=user.session_token or "", user=UserOut(
        id=user.id, name=user.name, email=user.email, username=user.username,
        initials=user.initials, avatarUrl=user.avatar_url,
        subscription="free",  # type: ignore[arg-type]
    ))


@app.post("/auth/login", response_model=AuthOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
    if user is None or not _verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Wrong email or password")
    user.session_token = secrets.token_hex(24)
    db.add(user)
    db.commit()
    db.refresh(user)
    return AuthOut(token=user.session_token or "", user=UserOut(
        id=user.id, name=user.name, email=user.email, username=user.username,
        initials=user.initials, avatarUrl=user.avatar_url,
        subscription=user.subscription,  # type: ignore[arg-type]
    ))


@app.post("/auth/logout", status_code=204)
def logout(user: User = Depends(get_token_user), db: Session = Depends(get_db)):
    user.session_token = None
    db.add(user)
    db.commit()
    return Response(status_code=204)


def _playlist_out(db: Session, playlist: Playlist) -> PlaylistOut:
    track_count = db.scalar(
        select(func.count()).select_from(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist.id)
    )
    return PlaylistOut(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        coverColor=playlist.cover_color,
        coverUrl=playlist.cover_url,
        trackCount=track_count or 0,
        creator=PlaylistCreator(id=playlist.user_id, name=playlist.owner.name) if playlist.owner else None,
    )


def _weekly_hours(db: Session, user_id: str) -> str:
    since = datetime.now(timezone.utc) - timedelta(days=7)
    total_ms = db.scalar(
        select(func.coalesce(func.sum(PlayHistory.duration_ms), 0)).where(
            PlayHistory.user_id == user_id,
            PlayHistory.played_at >= since,
        )
    )
    hours = (total_ms or 0) / 3_600_000
    if hours == 0:
        return "0h"
    if hours < 1:
        return "<1h"
    return f"{hours:.0f}h"


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
        weeklyHours=_weekly_hours(db, user.id),
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
def list_playlists(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Playlist).where(Playlist.user_id == user.id).order_by(Playlist.created_at.desc())
    ).all()
    return [_playlist_out(db, p) for p in rows]


@app.post("/library/playlists", response_model=PlaylistOut, status_code=201)
def create_playlist(
    payload: PlaylistCreate,
    user: User = Depends(get_current_user),
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


@app.get("/library/liked", response_model=LikedIdsOut)
def list_liked(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ids = db.scalars(
        select(LikedTrack.track_id).where(LikedTrack.user_id == user.id).order_by(LikedTrack.liked_at.desc())
    ).all()
    return LikedIdsOut(ids=list(ids))


@app.post("/library/liked/{track_id}", response_model=LikeToggleOut)
def toggle_like(
    track_id: str,
    payload: LikeToggle,
    user: User = Depends(get_current_user),
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
def list_recent(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
    user: User = Depends(get_current_user),
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
    user: User = Depends(get_current_user),
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


def _guest_shelves() -> list[HomeShelfOut]:
    """Cold start / signed out: region and trending shelves, same components."""
    kenya = _items_from_tracks(search_catalogue("popular in kenya", 10))
    trending = _items_from_tracks(search_catalogue("trending music", 10))
    fresh = _items_from_tracks(search_catalogue("new releases", 10))

    shelves: list[HomeShelfOut] = []
    if kenya:
        shelves.append(HomeShelfOut(id="region-kenya", type="shelf", title="Popular in Kenya", items=kenya))
    if trending:
        shelves.append(HomeShelfOut(id="trending-now", type="shelf", title="Trending now", items=trending))
    if fresh:
        shelves.append(HomeShelfOut(id="new-releases", type="shelf", title="New releases", items=fresh))
    return shelves


def _home_for_user(db: Session, user: User) -> list[HomeShelfOut]:
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
        return _guest_shelves()

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
        shelves.extend(s for s in _guest_shelves() if s.id != "region-kenya")
    return shelves


@app.get("/api/home", response_model=HomeOut)
def home(user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    shelves = _home_for_user(db, user) if user is not None else _guest_shelves()
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
