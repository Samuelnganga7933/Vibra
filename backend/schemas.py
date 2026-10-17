from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Stats(BaseModel):
    following: int = 0
    followers: int = 0
    playlists: int = 0
    weeklyHours: str = "0h"
    tracksLiked: int = 0
    topArtists: int = 0


class UserOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    email: str
    username: str
    initials: str
    avatarUrl: Optional[str] = None
    subscription: Literal["free", "premium"] = "free"
    stats: Optional[Stats] = None


class PlaylistCreator(BaseModel):
    id: str
    name: str


class PlaylistOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    coverColor: str = "#2C4A5E"
    coverUrl: Optional[str] = None
    trackCount: int = 0
    creator: Optional[PlaylistCreator] = None


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=500)


class LikedIdsOut(BaseModel):
    ids: list[str] = []


class LikeToggle(BaseModel):
    liked: bool


class LikeToggleOut(BaseModel):
    liked: bool


class TrackOut(BaseModel):
    """Minimal track shape for recent history (catalogue data lives elsewhere)."""

    id: str
    durationMs: int = 0
    coverColor: str = "#2C4A5E"


class PlayEvent(BaseModel):
    trackId: str
    artistId: Optional[str] = None
    durationMs: int = 0


class SettingsUpdate(BaseModel):
    theme: Optional[Literal["dark", "oled", "light"]] = None
    accent: Optional[str] = None
    audioQuality: Optional[Literal["low", "normal", "high", "lossless"]] = None
    normalizeVolume: Optional[bool] = None
    autoplay: Optional[bool] = None
    crossfade: Optional[bool] = None
    notifNewReleases: Optional[bool] = None
    notifRecommendations: Optional[bool] = None
    notifFollowers: Optional[bool] = None
    shareListening: Optional[bool] = None
    shareData: Optional[bool] = None
