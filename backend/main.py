"""Vibra User BFF — FastAPI + SQLAlchemy (SQLite).

Run:
    cd backend
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine, get_db
from models import LikedTrack, PlayHistory, Playlist, PlaylistTrack, User
from schemas import (
    LikeToggle,
    LikeToggleOut,
    LikedIdsOut,
    PlayEvent,
    PlaylistCreate,
    PlaylistCreator,
    PlaylistOut,
    SettingsUpdate,
    Stats,
    TrackOut,
    UserOut,
)

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
def read_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
