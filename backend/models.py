from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(60), unique=True)
    initials: Mapped[str] = mapped_column(String(4))
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    subscription: Mapped[str] = mapped_column(String(16), default="free")

    following: Mapped[int] = mapped_column(Integer, default=0)
    followers: Mapped[int] = mapped_column(Integer, default=0)
    top_artists: Mapped[int] = mapped_column(Integer, default=0)

    theme: Mapped[str] = mapped_column(String(16), default="dark")
    accent: Mapped[str] = mapped_column(String(16), default="#E8354D")
    audio_quality: Mapped[str] = mapped_column(String(16), default="high")
    normalize_volume: Mapped[bool] = mapped_column(Boolean, default=True)
    autoplay: Mapped[bool] = mapped_column(Boolean, default=True)
    crossfade: Mapped[bool] = mapped_column(Boolean, default=False)
    notif_new_releases: Mapped[bool] = mapped_column(Boolean, default=True)
    notif_recommendations: Mapped[bool] = mapped_column(Boolean, default=True)
    notif_followers: Mapped[bool] = mapped_column(Boolean, default=False)
    share_listening: Mapped[bool] = mapped_column(Boolean, default=True)
    share_data: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    playlists: Mapped[list["Playlist"]] = relationship(back_populates="owner", cascade="all, delete-orphan")


class Playlist(Base):
    __tablename__ = "playlists"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    cover_color: Mapped[str] = mapped_column(String(16), default="#2C4A5E")
    cover_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    owner: Mapped["User"] = relationship(back_populates="playlists")
    tracks: Mapped[list["PlaylistTrack"]] = relationship(
        back_populates="playlist", cascade="all, delete-orphan", order_by="PlaylistTrack.position"
    )


class PlaylistTrack(Base):
    __tablename__ = "playlist_tracks"
    __table_args__ = (UniqueConstraint("playlist_id", "track_id", name="uq_playlist_track"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    playlist_id: Mapped[str] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"), index=True)
    track_id: Mapped[str] = mapped_column(String(64))
    position: Mapped[int] = mapped_column(Integer, default=0)

    playlist: Mapped["Playlist"] = relationship(back_populates="tracks")


class LikedTrack(Base):
    __tablename__ = "liked_tracks"
    __table_args__ = (UniqueConstraint("user_id", "track_id", name="uq_user_liked_track"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    track_id: Mapped[str] = mapped_column(String(64))
    liked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PlayHistory(Base):
    __tablename__ = "play_history"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    track_id: Mapped[str] = mapped_column(String(64), index=True)
    artist_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    played_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
