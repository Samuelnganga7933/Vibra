from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Stats(BaseModel):
    following: int = 0
    followers: int = 0
    playlists: int = 0
    weeklyMinutes: str = "0m"
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
    tracks: list["PlaylistTrackOut"] = []


class PlaylistTrackOut(BaseModel):
    id: str
    title: Optional[str] = None
    artist: Optional[str] = None
    imageUrl: Optional[str] = None
    coverColor: str = "#2C4A5E"
    durationMs: int = 0
    videoId: Optional[str] = None


class PlaylistTrackIn(BaseModel):
    track_id: str = Field(min_length=1, max_length=64)
    title: Optional[str] = Field(default=None, max_length=300)
    artist: Optional[str] = Field(default=None, max_length=200)
    imageUrl: Optional[str] = Field(default=None, max_length=512)
    coverColor: Optional[str] = Field(default=None, max_length=16)
    durationMs: Optional[int] = None
    videoId: Optional[str] = Field(default=None, max_length=64)


class PlaylistTrackOrderIn(BaseModel):
    """New track-id order for the playlist (drag-and-drop reorder)."""

    track_ids: list[str] = Field(min_length=1, max_length=500)


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=500)


class LikedIdsOut(BaseModel):
    ids: list[str] = []
    tracks: list["LikedTrackOut"] = []


class ProfileUpdate(BaseModel):
    """Profile fields the app can edit (omitted fields are left untouched)."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    username: Optional[str] = Field(default=None, min_length=1, max_length=60)
    avatarUrl: Optional[str] = Field(default=None, max_length=512)


class TrackMetaIn(BaseModel):
    """Track snapshot sent when liking, so the liked list renders anywhere."""

    title: Optional[str] = None
    artist: Optional[str] = None
    imageUrl: Optional[str] = None
    coverColor: Optional[str] = None
    durationMs: Optional[int] = None
    videoId: Optional[str] = None


class LikedTrackOut(BaseModel):
    id: str
    title: Optional[str] = None
    artist: Optional[str] = None
    imageUrl: Optional[str] = None
    coverColor: Optional[str] = "#2C4A5E"
    durationMs: int = 0
    videoId: Optional[str] = None


class ArtistDiscoveryOut(BaseModel):
    """An artist surfaced from listening history (name-keyed id space)."""

    name: str
    plays: int = 0
    imageUrl: Optional[str] = None
    coverColor: str = "#2C4A5E"


class DiscoveredArtistsOut(BaseModel):
    count: int = 0
    artists: list[ArtistDiscoveryOut] = []


class FollowIn(BaseModel):
    follow: bool


class ArtistOut(BaseModel):
    """Artist in the library id space (id == artist name key)."""

    id: str
    name: str
    genre: Optional[str] = None
    coverColor: str = "#2C4A5E"
    imageUrl: Optional[str] = None
    followers: Optional[int] = None


class NewReleaseOut(BaseModel):
    id: str
    title: str
    artist: Optional[str] = None
    year: Optional[str] = None
    coverColor: str = "#2C4A5E"
    coverUrl: Optional[str] = None
    trackCount: int = 1


class DiscoverTrackOut(BaseModel):
    """A market-aligned discovery row (engine shape, snake-free keys)."""

    id: str
    videoId: Optional[str] = None
    title: str
    artist: Optional[str] = None
    album: Optional[str] = None
    durationSec: Optional[int] = None
    imageUrl: Optional[str] = None
    coverColor: str = "#2C4A5E"


class AlbumQueryIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=300)
    artist: Optional[str] = Field(default=None, max_length=200)


class AlbumLookupIn(BaseModel):
    """Batch album enrichment for table rows — the engine search carries no
    album field, so the BFF resolves collection names from public metadata."""

    tracks: list[AlbumQueryIn] = Field(default_factory=list, max_length=30)


class LikeToggle(BaseModel):
    liked: bool
    track: Optional[TrackMetaIn] = None


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


# ── Auth ──────────────────────────────────────────────────────────────────────


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class AuthOut(BaseModel):
    token: str
    user: UserOut


class NeonSessionIn(BaseModel):
    """Neon Auth (Better Auth) session token presented by the client."""
    token: str = Field(min_length=8, max_length=4096)


class HistoryPauseIn(BaseModel):
    paused: bool


# ── Telemetry & home feed ─────────────────────────────────────────────────────


class DeviceInfo(BaseModel):
    type: str = "computer"
    name: str = "This computer"


class VibraEventIn(BaseModel):
    type: Literal[
        "play", "skip", "complete", "replay", "like", "unlike",
        "add_to_playlist", "search", "not_interested",
    ]
    track_id: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    image: Optional[str] = None
    position_ms: Optional[int] = None
    source_shelf_id: Optional[str] = None
    device: DeviceInfo = DeviceInfo()
    ts: Optional[int] = None


class HomeItemOut(BaseModel):
    id: str
    title: str
    artist: Optional[str] = None
    subtitle: Optional[str] = None
    durationSec: Optional[int] = None
    imageUrl: Optional[str] = None
    videoId: Optional[str] = None
    query: Optional[str] = None


class HomeShelfOut(BaseModel):
    id: str
    type: Literal["jump_back_in", "mix_row", "shelf", "recent"]
    title: str
    subtitle: Optional[str] = None
    items: list[HomeItemOut] = []


class HomeOut(BaseModel):
    shelves: list[HomeShelfOut] = []
