import React, {
  useState, useEffect, useRef, useCallback, createContext, useContext, useMemo,
} from "react";
import {
  Home, Search, Compass, Library, Heart,
  Shuffle, SkipBack, SkipForward, Repeat2, Volume2, VolumeX,
  Mic2, Play, Pause, Settings, ChevronLeft, ChevronRight,
  MoreHorizontal, Plus, Download, Check, X, LogOut, Music2,
  Eye, EyeOff, ArrowRight, Sparkles, User, HardDrive, RefreshCw,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { ErrorBoundary, installRuntimeGuards } from "./components/ErrorBoundary";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { safeJson, getConnectionStatus, subscribeConnection, startConnectionMonitor, type ConnectionStatus } from "./services/safeFetch";
import {
  YTAudioEngine,
  describePlaybackFailure,
  failureFromError,
  type PlaybackHandle,
  type PlaybackFailure,
} from "./services/playbackEngine";
import { addOfflineTrack, readOfflineTracks, clearOfflineTracks, unmarkOfflineCleared, wasOfflineCleared, type OfflineTrack } from "./services/offlineStorage";
import {
  getUserProfile,
  updateUserProfile,
  getHistory,
  addHistoryTrack,
  mergeHistory,
  getPlaylists as getStoredPlaylists,
  savePlaylist,
  createCustomPlaylist,
  addTrackToPlaylist as addTrackToStoredPlaylist,
  getDevices,
  getActiveDevice,
  setActiveDevice as setActiveStoredDevice,
  type StoredPlaylist,
  type StoredTrack,
  type StoredDevice,
} from "./services/store";
import {
  API_BASE,
  searchTracks,
  getStreamUrl,
  fetchLyrics as fetchLyricsFromApi,
  type ApiTrack,
} from "./services/api";
import { ImageWithFallback } from "./components/ui/ImageWithFallback";
import { EmptyStateCard } from "./components/ui/EmptyStateCard";
import { UiThemeContext } from "./components/ui/ui-theme";
import { TrackCard, AlbumCard, PlaylistItemCard } from "./components/ui/cards";
import { DownloadsView } from "./components/vibra/DownloadsView";
import { NotFound } from "./components/vibra/NotFound";

// ─── Environment ──────────────────────────────────────────────────────────────
// The audio engine defaults to the production Vibra API and can be overridden
// with VITE_API_BASE_URL. Every request goes through safeFetch, so a missing
// or unreachable backend degrades to cached/local content — never a crash.
const LEGACY_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// ─── Backend API helper ────────────────────────────────────────────────────────
// Optional library/auth endpoints (see docs/BACKEND_API.md). All calls resolve
// through safeFetch (8s timeout, never throws) — failures return null quietly.
async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!LEGACY_API_BASE) return null;
  return safeJson<T>(`${LEGACY_API_BASE}${path}`, {
    ...init,
    quiet: true,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

// Neutralise unhandled promise rejections / global errors (idempotent).
installRuntimeGuards();

// ─── Types ─────────────────────────────────────────────────────────────────────
interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  initials: string;
  avatarUrl?: string;
  subscription: "free" | "premium";
  stats?: {
    following: number;
    followers: number;
    playlists: number;
    weeklyHours: string;
    tracksLiked: number;
    topArtists: number;
  };
}

interface Track {
  id: string | number;
  title: string;
  artist: string;
  album?: string;
  duration?: string;
  durationSec?: number;
  bg: string;
  imageUrl?: string;
  previewUrl?: string;
  streamUrl?: string;
  /** Audio-engine video id used to build stream/download URLs. */
  videoId?: string;
}

interface PlaylistItem {
  id: string;
  name: string;
  description?: string;
  bg: string;
  imageUrl?: string;
  trackCount: number;
  creator?: string;
  tracks: Track[];
}

interface AlbumItem {
  id: string;
  title: string;
  artist: string;
  year: string;
  bg: string;
  imageUrl?: string;
  trackCount: number;
}

interface ArtistItem {
  id: string;
  name: string;
  genre: string;
  bg: string;
  imageUrl?: string;
  followers?: string;
}

interface LyricLine { time: number; text: string; }

type LibTab = "playlists" | "liked" | "albums" | "artists" | "downloaded";

type Screen =
  | { id: "home" }
  | { id: "search" }
  | { id: "discover" }
  | { id: "library"; tab?: LibTab }
  | { id: "playlist"; item: PlaylistItem }
  | { id: "settings" }
  | { id: "profile" }
  | { id: "notfound" };

type RepeatMode = "off" | "one" | "all";

interface Colors {
  bg: string; pane: string; surf: string; surfDark: string;
  accent: string; text: string; muted: string; border: string;
}

interface AppCtxType {
  C: Colors;
  navigate: (s: Screen) => void;
  goBack: () => void;
  canGoBack: boolean;
  screen: Screen;
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  elapsed: number;
  audioDuration: number;
  playTrack: (t: Track, newQueue?: Track[]) => void;
  togglePlay: () => void;
  playNext: () => void;
  playPrev: () => void;
  handleSeek: (p: number) => void;
  queue: Track[];
  shuffleOn: boolean;
  toggleShuffle: () => void;
  repeatMode: RepeatMode;
  cycleRepeat: () => void;
  volume: number;
  setVolume: (v: number) => void;
  showLyrics: boolean;
  toggleLyrics: () => void;
  lyrics: LyricLine[];
  plainLyrics: string;
  lyricsLoading: boolean;
  user: User | null;
  userLoading: boolean;
  playlists: PlaylistItem[];
  playlistsLoading: boolean;
  likedTrackIds: Set<string | number>;
  toggleLike: (id: string | number) => void;
  discoveryTracks: Track[];
  recentTracks: Track[];
  trendingTracks: Track[];
  newReleases: AlbumItem[];
  artists: ArtistItem[];
  likedTracks: Track[];
  downloadedTracks: Track[];
  /** Re-fetches server-side downloads (powers "Sync Library"). */
  refreshDownloads: () => Promise<void>;
  discoveryLoading: boolean;
  theme: string; setTheme: (t: string) => void;
  accent: string; setAccent: (a: string) => void;
  audioQuality: string; setAudioQuality: (q: string) => void;
  normalizeVolume: boolean; setNormalizeVolume: (v: boolean) => void;
  autoplay: boolean; setAutoplay: (v: boolean) => void;
  crossfade: boolean; setCrossfade: (v: boolean) => void;
  notifNewReleases: boolean; setNotifNewReleases: (v: boolean) => void;
  notifRecommendations: boolean; setNotifRecommendations: (v: boolean) => void;
  notifFollowers: boolean; setNotifFollowers: (v: boolean) => void;
  shareListening: boolean; setShareListening: (v: boolean) => void;
  shareData: boolean; setShareData: (v: boolean) => void;
  // Social
  following: Set<string>;
  toggleFollow: (id: string) => void;
  // Modals
  openTrackOptions: (t: Track) => void;
  openCreatePlaylist: () => void;
  // Persistent client state engines (services/store.ts)
  addPlaylist: (p: PlaylistItem) => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  updateProfile: (patch: Partial<{ name: string; username: string; initials: string; email: string; avatarUrl: string; subscription: "premium" | "free" }>) => void;
}

// ─── Color themes ──────────────────────────────────────────────────────────────
const BASE_COLORS: Record<string, Omit<Colors, "accent">> = {
  dark:  { bg: "#0B0A12", pane: "#14121F", surf: "#1F1B30", surfDark: "#1B1829", text: "#F2F0FA", muted: "#A9A6BD", border: "#26223A" },
  oled:  { bg: "#000000", pane: "#0C0C0C", surf: "#161616", surfDark: "#0F0F0F", text: "#F5F2FF", muted: "#9896B2", border: "#1C1C1C" },
  light: { bg: "#F2F0FA", pane: "#FFFFFF", surf: "#E8E5F4", surfDark: "#EEEAF8", text: "#1A1628", muted: "#5E5A7A", border: "#DDD8F0" },
};
const makeColors = (theme: string, acc: string): Colors => ({ ...(BASE_COLORS[theme] ?? BASE_COLORS.dark), accent: acc });

const ACCENT_OPTIONS = [
  { label: "Red",     value: "#E8354D" },
  { label: "Violet",  value: "#A78BFA" },
  { label: "Emerald", value: "#34C759" },
  { label: "Blue",    value: "#3B82F6" },
  { label: "Orange",  value: "#F97316" },
  { label: "Cyan",    value: "#06B6D4" },
];

const BROWSE_CATEGORIES = [
  { id: "trending",   label: "Trending",     bg: "#7A2438" },
  { id: "new",        label: "New releases", bg: "#1F4E5F" },
  { id: "pop",        label: "Pop",          bg: "#5B3FD0" },
  { id: "hiphop",     label: "Hip-hop",      bg: "#8A3A1F" },
  { id: "electronic", label: "Electronic",   bg: "#2F5A3A" },
  { id: "rnb",        label: "R&B",          bg: "#9B3B63" },
  { id: "rock",       label: "Rock",         bg: "#3A3A3A" },
  { id: "jazz",       label: "Jazz",         bg: "#2C4A5E" },
  { id: "classical",  label: "Classical",    bg: "#4A3280" },
  { id: "podcasts",   label: "Podcasts",     bg: "#6E2A2A" },
  { id: "ambient",    label: "Ambient",      bg: "#1B4A6A" },
  { id: "workout",    label: "Workout",      bg: "#8A4A1F" },
];

const BG_PALETTE = ["#2C4A5E","#4A3280","#8A3A1F","#1F4E5F","#9B3B63","#2F5A3A","#7A2438","#B0587A","#3A3A3A","#3A2F55","#5A3A10","#2A2A3A"];

// ─── Context ──────────────────────────────────────────────────────────────────
const AppCtx = createContext<AppCtxType>(null!);
const useApp = () => useContext(AppCtx);

// ─── Mappers ──────────────────────────────────────────────────────────────────
const fromApiTrack = (t: ApiTrack, i = 0): Track => ({
  id: t.id,
  videoId: t.videoId ?? t.id,
  title: t.title ?? "Unknown",
  artist: t.artist ?? "Unknown",
  album: t.album,
  duration: t.durationSec !== undefined ? fmtSec(t.durationSec) : undefined,
  durationSec: t.durationSec,
  bg: BG_PALETTE[i % BG_PALETTE.length],
  imageUrl: t.imageUrl,
  previewUrl: undefined,
  streamUrl: t.streamUrl,
});

// Adjust these field names to match your backend schema
const mapAPITrack = (t: any): Track => ({
  id: String(t.id),
  videoId: t.videoId ?? t.video_id ?? undefined,
  title: t.title,
  artist: t.artist ?? t.artistName,
  album: t.album ?? t.albumTitle,
  duration: t.duration,
  durationSec: t.durationMs ? t.durationMs / 1000 : t.durationSec,
  bg: t.coverColor ?? t.bg ?? BG_PALETTE[0],
  imageUrl: t.coverUrl ?? t.imageUrl ?? t.artworkUrl,
  previewUrl: t.previewUrl,
  streamUrl: t.streamUrl,
});

const mapAPIPlaylist = (p: any): PlaylistItem => ({
  id: String(p.id),
  name: p.name ?? p.title,
  description: p.description,
  bg: p.coverColor ?? p.bg ?? BG_PALETTE[0],
  imageUrl: p.coverUrl ?? p.imageUrl,
  trackCount: p.trackCount ?? p.tracks?.length ?? 0,
  creator: p.creator?.name ?? p.creatorName ?? p.owner?.name,
  tracks: (p.tracks ?? []).map(mapAPITrack),
});

const mapAPIAlbum = (a: any): AlbumItem => ({
  id: String(a.id),
  title: a.title ?? a.name,
  artist: a.artist ?? a.artistName,
  year: String(a.year ?? a.releaseYear ?? ""),
  bg: a.coverColor ?? a.bg ?? BG_PALETTE[0],
  imageUrl: a.coverUrl ?? a.imageUrl,
  trackCount: a.trackCount ?? a.tracks?.length ?? 0,
});

const mapAPIArtist = (a: any): ArtistItem => ({
  id: String(a.id),
  name: a.name,
  genre: a.genre ?? a.genres?.[0] ?? "",
  bg: a.coverColor ?? a.bg ?? BG_PALETTE[0],
  imageUrl: a.imageUrl ?? a.avatarUrl,
  followers: a.followers ? String(a.followers) : undefined,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

/** Resolves the HTML5 audio URL for a track — never throws, may be undefined. */
function audioUrlFor(t: Track | null | undefined): string | undefined {
  if (!t) return undefined;
  if (t.previewUrl) return t.previewUrl;
  if (t.streamUrl) return t.streamUrl;
  const videoId = t.videoId ?? (typeof t.id === "string" ? t.id : undefined);
  return videoId ? getStreamUrl(videoId) : undefined;
}

/** Converts an engine track into the offline-cache shape. */
function toOfflineTrack(t: Track): OfflineTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    duration: t.duration,
    bg: t.bg,
    imageUrl: t.imageUrl,
    previewUrl: t.previewUrl,
    streamUrl: t.streamUrl,
  };
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Sk({ w = "100%", h = 16, r = 8 }: { w?: number | string; h?: number; r?: number }) {
  const { C } = useApp();
  return <div style={{ width: w, height: h, borderRadius: r, background: C.surf, flexShrink: 0, opacity: 0.7 }} />;
}

function TrackSkeleton() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px" }}>
      <Sk w={20} h={12} />
      <Sk w={44} h={44} r={8} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Sk w="60%" h={13} />
        <Sk w="40%" h={11} />
      </div>
      <Sk w={32} h={12} />
    </div>
  );
}

function CardSkeleton({ size = 140 }: { size?: number }) {
  return (
    <div style={{ width: size, flexShrink: 0 }}>
      <Sk w={size} h={size} r={12} />
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
        <Sk w="70%" h={13} />
        <Sk w="50%" h={11} />
      </div>
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon = Music2, title, sub, action }: { icon?: React.ElementType; title: string; sub?: string; action?: React.ReactNode }) {
  const { C } = useApp();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px", textAlign: "center", gap: 12 }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.surf, display: "grid", placeItems: "center", color: C.muted }}>
        <Icon size={24} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: C.muted, maxWidth: 260 }}>{sub}</div>}
      {action}
    </div>
  );
}

// ─── CoverArt ─────────────────────────────────────────────────────────────────
function CoverArt({ bg, imageUrl, size = 48, radius = 12 }: { bg: string; imageUrl?: string; size?: number; radius?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: "hidden", position: "relative" }}>
      <ImageWithFallback src={imageUrl} coverColor={bg} alt="" highlight />
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { C } = useApp();
  return (
    <button role="switch" aria-checked={value} onClick={() => onChange(!value)}
      style={{ width: 44, height: 26, borderRadius: 13, border: "none", cursor: "pointer", background: value ? C.accent : C.border, position: "relative", transition: "background .2s", flexShrink: 0 }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", background: value ? "#fff" : C.muted, position: "absolute", top: 3, left: value ? 21 : 3, transition: "left .2s" }} />
    </button>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────────
function Chip({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  const { C } = useApp();
  return (
    <button onClick={onClick}
      style={{ height: 36, padding: "0 16px", borderRadius: 18, border: `1px solid ${active ? "transparent" : C.border}`, background: active ? C.text : "transparent", color: active ? C.bg : C.muted, fontSize: 14, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, transition: "all .15s" }}>
      {label}
    </button>
  );
}

// ─── LyricsPanel ──────────────────────────────────────────────────────────────
function LyricsPanel({ lyrics, plain, loading, elapsed }: { lyrics: LyricLine[]; plain: string; loading: boolean; elapsed: number }) {
  const { C } = useApp();
  const activeIdx = lyrics.reduce((best, line, i) => (line.time <= elapsed ? i : best), -1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (activeIdx >= 0) refs.current[activeIdx]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIdx]);

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 160, color: C.muted, fontSize: 14 }}>Loading lyrics…</div>;
  if (lyrics.length > 0) return (
    <div style={{ overflowY: "auto", maxHeight: 380, scrollbarWidth: "none" }}>
      {lyrics.map((line, i) => (
        <div key={i} ref={el => { refs.current[i] = el; }}
          style={{ padding: "5px 0", fontSize: i === activeIdx ? 16 : 14, fontWeight: i === activeIdx ? 700 : 400, color: i === activeIdx ? C.text : C.muted, lineHeight: 1.55, transition: "all .3s" }}>
          {line.text}
        </div>
      ))}
    </div>
  );
  if (plain) return <div style={{ overflowY: "auto", maxHeight: 380, scrollbarWidth: "none", fontSize: 14, color: C.muted, lineHeight: 1.8, whiteSpace: "pre-line" }}>{plain}</div>;
  return <div style={{ textAlign: "center", color: C.muted, fontSize: 14, padding: "32px 0" }}>No lyrics available</div>;
}

// ─── TrackRow ─────────────────────────────────────────────────────────────────
function TrackRow({ track, index, queue, showLike = false }: { track: Track; index?: number; queue?: Track[]; showLike?: boolean }) {
  const { C, playTrack, currentTrack, isPlaying, likedTrackIds, toggleLike, openTrackOptions } = useApp();
  const isActive = currentTrack?.id === track.id;
  const isLiked  = likedTrackIds.has(track.id);

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 10px", borderRadius: 10, background: isActive ? C.surf : "transparent", transition: "background .15s" }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.surf; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
    >
      <div role="button" tabIndex={0} onClick={() => playTrack(track, queue)} onKeyDown={e => e.key === "Enter" && playTrack(track, queue)}
        style={{ width: 22, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}>
        {isActive && isPlaying
          ? <Pause size={13} color={C.accent} fill={C.accent} />
          : <span style={{ fontSize: 12, color: isActive ? C.accent : C.muted }}>{index !== undefined ? index + 1 : "▶"}</span>}
      </div>
      <div role="button" tabIndex={0} onClick={() => playTrack(track, queue)} onKeyDown={e => e.key === "Enter" && playTrack(track, queue)}
        style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, cursor: "pointer" }}>
        <CoverArt bg={track.bg} imageUrl={track.imageUrl} size={44} radius={8} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: isActive ? C.accent : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{track.artist}</div>
        </div>
      </div>
      {showLike && (
        <button onClick={e => { e.stopPropagation(); toggleLike(track.id); }}
          style={{ width: 30, height: 30, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: isLiked ? C.accent : C.muted, flexShrink: 0 }}>
          <Heart size={13} fill={isLiked ? C.accent : "none"} />
        </button>
      )}
      <span style={{ fontSize: 12, color: C.muted, flexShrink: 0, minWidth: 36, textAlign: "right" }}>{track.duration}</span>
      <button onClick={e => { e.stopPropagation(); openTrackOptions(track); }}
        style={{ width: 28, height: 28, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted, flexShrink: 0 }}>
        <MoreHorizontal size={13} />
      </button>
    </div>
  );
}

// ─── HomeScreen ───────────────────────────────────────────────────────────────
function HomeScreen() {
  const { C, navigate, playTrack, recentTracks, discoveryTracks, playlists, discoveryLoading, playlistsLoading, user, openCreatePlaylist } = useApp();
  const [chip, setChip] = useState("All");
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const dayStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", paddingBottom: 28 }}>
      <div style={{ padding: "28px 28px 0" }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: C.muted, marginBottom: 4 }}>{dayStr}</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.2 }}>
          {greeting}{user ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "16px 28px", overflowX: "auto", scrollbarWidth: "none" }}>
        {["All", "Music", "Made for you", "New"].map(c => (
          <Chip key={c} label={c} active={chip === c} onClick={() => setChip(c)} />
        ))}
      </div>

      {playlistsLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "0 28px" }}>
          {[...Array(6)].map((_, i) => <Sk key={i} w="100%" h={56} r={10} />)}
        </div>
      ) : playlists.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "0 28px" }}>
          {(playlists || []).slice(0, 6).map(pl => (
            <PlaylistItemCard
              key={pl.id}
              playlist={pl}
              size={56}
              radius={0}
              layout="row"
              onClick={() => navigate({ id: "playlist", item: pl })}
            />
          ))}
        </div>
      ) : !playlistsLoading && (
        <div style={{ padding: "0 28px" }}>
          <EmptyState title="No playlists yet" sub="Playlists you create or save will appear here." action={
            <button onClick={() => openCreatePlaylist()} style={{ height: 36, padding: "0 16px", borderRadius: 18, border: "none", background: C.accent, color: C.bg, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>New playlist</button>
          } />
        </div>
      )}

      {!discoveryLoading && recentTracks.length === 0 && discoveryTracks.length === 0 ? (
        <div style={{ margin: "32px 28px 0", borderRadius: 20, background: C.surf, border: `1px solid ${C.border}`, padding: "48px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.bg, border: `1px solid ${C.border}`, display: "grid", placeItems: "center" }}>
            <Music2 size={32} color={C.accent} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 22, color: C.text, marginBottom: 8 }}>Your queue is wide open</div>
            <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.5, maxWidth: 300 }}>Search for a song, artist, or album to start building your listening history.</div>
          </div>
          <button onClick={() => navigate({ id: "search" })} style={{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 24px", borderRadius: 22, border: "none", background: C.accent, color: C.bg, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
            <Search size={16} />
            Search music
          </button>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
            {["Hip-Hop", "R&B", "Electronic", "Afrobeats", "Pop"].map(genre => (
              <button key={genre} onClick={() => navigate({ id: "search" })} style={{ height: 32, padding: "0 14px", borderRadius: 16, border: `1px solid ${C.border}`, background: "none", color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{genre}</button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div style={{ padding: "24px 28px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>Recently played</h2>
              <button onClick={() => navigate({ id: "library", tab: "playlists" })} style={{ fontSize: 13, fontWeight: 600, color: C.muted, background: "none", border: "none", cursor: "pointer" }}>History</button>
            </div>
            {discoveryLoading ? (
              <div style={{ display: "flex", gap: 14, overflowX: "auto", scrollbarWidth: "none" }}>
                {[...Array(4)].map((_, i) => <CardSkeleton key={i} size={140} />)}
              </div>
            ) : recentTracks.length > 0 ? (
              <div style={{ display: "flex", gap: 14, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
                {(recentTracks || []).map(track => (
                  <TrackCard
                    key={track.id}
                    track={track}
                    size={140}
                    radius={16}
                    onPlay={() => playTrack(track, recentTracks)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState title="No history yet" sub="Tracks you play will appear here." />
            )}
          </div>

          <div style={{ padding: "24px 28px 0" }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>Your rotation</h2>
            {discoveryLoading
              ? [...Array(4)].map((_, i) => <TrackSkeleton key={i} />)
              : discoveryTracks.length > 0
                ? (discoveryTracks || []).map((t, i) => <TrackRow key={t.id} track={t} index={i} queue={discoveryTracks} />)
                : <EmptyState title="Nothing to play" sub="Your rotation fills in as you listen — play a few tracks to get started." />
            }
          </div>
        </>
      )}
    </div>
  );
}

// ─── SearchScreen ─────────────────────────────────────────────────────────────
const SEARCH_EMPTY_GIF =
  "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExc29mcmQ1b3JpZXB0MjJvNTh0MmpvZWFvdm40dzVxeXF4cnV4YmZwOCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3o7aCSPqXE5C6T8tBC/giphy.gif";

function SearchScreen() {
  const { C, playTrack, discoveryTracks } = useApp();
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);

    debounceRef.current = window.setTimeout(async () => {
      // 1. Live catalogue search (safe: resolves to [] on any failure).
      const tracks = await searchTracks(query, 20);
      if (tracks.length > 0) {
        setResults(tracks.map((t, i) => fromApiTrack(t, i)));
        setSearching(false);
        return;
      }
      // 2. Fallback: filter whatever is already cached locally.
      const q = query.toLowerCase();
      setResults(discoveryTracks.filter(t =>
        t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
      ));
      setSearching(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query, discoveryTracks]);

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "24px 28px", paddingBottom: 32 }}>
      <div style={{ position: "relative", marginBottom: 24 }}>
        <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted, pointerEvents: "none" }}>
          <Search size={18} />
        </div>
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Songs, artists, albums…"
          style={{ width: "100%", height: 48, borderRadius: 12, border: `1px solid ${C.border}`, background: C.surf, color: C.text, fontSize: 15, padding: "0 44px 0 46px", outline: "none", boxSizing: "border-box" }} />
        {query && (
          <button onClick={() => setQuery("")}
            style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.muted, display: "grid", placeItems: "center" }}>
            <X size={16} />
          </button>
        )}
      </div>

      {query ? (
        searching ? (
          [...Array(5)].map((_, i) => <TrackSkeleton key={i} />)
        ) : results.length > 0 ? (
          <>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>{results.length} result{results.length !== 1 ? "s" : ""}</h2>
            {results.map((t, i) => <TrackRow key={t.id} track={t} index={i} queue={results} showLike />)}
          </>
        ) : (
          <EmptyState icon={Search} title="No results" sub={`Nothing matched “${query}”. Try an artist, album, or a different spelling.`} />
        )
      ) : (
        <EmptyStateCard
          visual={SEARCH_EMPTY_GIF}
          title="Search Vibra"
          subtitle="Find tracks, artists, albums, or playlists."
          action={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {BROWSE_CATEGORIES.slice(0, 5).map(cat => (
                <button key={cat.id} onClick={() => setQuery(cat.label)}
                  style={{ height: 32, padding: "0 14px", borderRadius: 16, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {cat.label}
                </button>
              ))}
            </div>
          }
        />
      )}
    </div>
  );
}

// ─── DiscoverScreen ───────────────────────────────────────────────────────────
function DiscoverScreen() {
  const { C, playTrack, navigate, trendingTracks, newReleases, playlists, discoveryLoading } = useApp();

  const albumToPlaylist = (a: AlbumItem): PlaylistItem => ({
    id: a.id, name: a.title, description: `${a.artist} · ${a.year}`,
    bg: a.bg, imageUrl: a.imageUrl, trackCount: a.trackCount, creator: a.artist, tracks: [],
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", paddingBottom: 32 }}>
      <div style={{ padding: "24px 28px 0" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: 0 }}>Discover</h1>
        <p style={{ fontSize: 14, color: C.muted, margin: "4px 0 0" }}>Find your next favourite sound</p>
      </div>

      {playlists[0] ? (
        <div style={{ margin: "20px 28px 0", borderRadius: 18, overflow: "hidden", position: "relative", height: 176, background: playlists[0].bg }}>
          {playlists[0].imageUrl && <img src={playlists[0].imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(18,8,42,0.9) 40%, transparent)", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Featured</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "0 0 10px" }}>{playlists[0].name}</h2>
            <button onClick={() => navigate({ id: "playlist", item: playlists[0] })}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 16px", borderRadius: 17, background: C.accent, border: "none", color: C.bg, fontSize: 13, fontWeight: 700, cursor: "pointer", width: "fit-content" }}>
              <Play size={14} fill="currentColor" /> Play now
            </button>
          </div>
        </div>
      ) : (
        <div style={{ margin: "20px 28px 0", borderRadius: 18, height: 176, background: C.surf, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {discoveryLoading ? <Sk w="80%" h={24} /> : <span style={{ color: C.muted, fontSize: 14 }}>Featured content will appear here</span>}
        </div>
      )}

      <div style={{ padding: "24px 28px 0" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: "0 0 10px" }}>Trending now</h2>
        {discoveryLoading
          ? [...Array(5)].map((_, i) => <TrackSkeleton key={i} />)
          : trendingTracks.length > 0
            ? (trendingTracks || []).slice(0, 8).map((t, i) => <TrackRow key={t.id} track={t} index={i} queue={trendingTracks} />)
            : <EmptyState title="Loading trending tracks…" sub="Connecting to music catalogue." />
        }
      </div>

      <div style={{ padding: "24px 28px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>New releases</h2>
          <button onClick={() => navigate({ id: "library", tab: "albums" })} style={{ fontSize: 13, fontWeight: 600, color: C.muted, background: "none", border: "none", cursor: "pointer" }}>See all</button>
        </div>
        {discoveryLoading ? (
          <div style={{ display: "flex", gap: 14, overflowX: "auto", scrollbarWidth: "none" }}>
            {[...Array(4)].map((_, i) => <CardSkeleton key={i} size={140} />)}
          </div>
        ) : newReleases.length > 0 ? (
          <div style={{ display: "flex", gap: 14, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
            {(newReleases || []).map(a => (
              <AlbumCard
                key={a.id}
                album={a}
                size={140}
                radius={12}
                onClick={() => navigate({ id: "playlist", item: albumToPlaylist(a) })}
              />
            ))}
          </div>
        ) : <EmptyState title="No new releases" sub="New releases will appear here." />}
      </div>

      {playlists.length > 1 && (
        <div style={{ padding: "24px 28px 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>From your library</h2>
            <button onClick={() => navigate({ id: "library" })} style={{ fontSize: 13, fontWeight: 600, color: C.muted, background: "none", border: "none", cursor: "pointer" }}>See all</button>
          </div>
          <div style={{ display: "flex", gap: 14, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
            {(playlists || []).slice(1, 6).map(pl => (
              <PlaylistItemCard
                key={pl.id}
                playlist={pl}
                size={150}
                onClick={() => navigate({ id: "playlist", item: pl })}
              />
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: "24px 28px 0" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>Moods & genres</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {BROWSE_CATEGORIES.slice(0, 6).map(cat => (
            <button key={cat.id} style={{ height: 60, borderRadius: 10, background: cat.bg, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#fff" }}>
              {cat.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── LibraryScreen ────────────────────────────────────────────────────────────
function LibraryScreen({ tab: initTab = "playlists" }: { tab?: LibTab }) {
  const { C, navigate, playTrack, playlists, playlistsLoading, likedTracks, artists, newReleases, downloadedTracks, refreshDownloads, openCreatePlaylist } = useApp();
  const [tab, setTab] = useState<LibTab>(initTab);

  const TABS: { id: LibTab; label: string }[] = [
    { id: "playlists",  label: "Playlists"  },
    { id: "liked",      label: "Liked"      },
    { id: "albums",     label: "Albums"     },
    { id: "artists",    label: "Artists"    },
    { id: "downloaded", label: "Downloaded" },
  ];

  const albumToPlaylist = (a: AlbumItem): PlaylistItem => ({
    id: a.id, name: a.title, description: `${a.artist} · ${a.year}`,
    bg: a.bg, imageUrl: a.imageUrl, trackCount: a.trackCount, creator: a.artist, tracks: [],
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "24px 28px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: 0 }}>Your Library</h1>
          <button onClick={openCreatePlaylist}
            style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
            <Plus size={18} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 16 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ height: 34, padding: "0 16px", borderRadius: 17, border: `1px solid ${tab === t.id ? "transparent" : C.border}`, background: tab === t.id ? C.accent : "transparent", color: tab === t.id ? C.bg : C.muted, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, transition: "all .15s" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0 28px 32px" }}>
        {tab === "playlists" && (
          playlistsLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[...Array(6)].map((_, i) => <Sk key={i} w="100%" h={170} r={14} />)}
            </div>
          ) : playlists.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {(playlists || []).map(pl => (
                <PlaylistItemCard
                  key={pl.id}
                  playlist={pl}
                  variant="pane"
                  onClick={() => navigate({ id: "playlist", item: pl })}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="No playlists" sub="Create a playlist to start building your library." action={
              <button onClick={openCreatePlaylist}
                style={{ height: 36, padding: "0 16px", borderRadius: 18, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: 13, cursor: "pointer" }}>
                Create playlist
              </button>
            } />
          )
        )}

        {tab === "liked" && (
          likedTracks.length > 0
            ? (likedTracks || []).map((t, i) => <TrackRow key={t.id} track={t} index={i} queue={likedTracks} showLike />)
            : <EmptyState icon={Heart} title="No liked songs" sub="Songs you heart will appear here." />
        )}

        {tab === "albums" && (
          newReleases.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {(newReleases || []).map(a => (
                <AlbumCard
                  key={a.id}
                  album={a}
                  variant="pane"
                  onClick={() => navigate({ id: "playlist", item: albumToPlaylist(a) })}
                />
              ))}
            </div>
          ) : <EmptyState title="No albums" sub="Albums from your library will appear here." />
        )}

        {tab === "artists" && (
          artists.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {(artists || []).map(a => (
                <div key={a.id}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: 10, borderRadius: 12, cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.surf)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <div style={{ width: 52, height: 52, borderRadius: "50%", background: a.bg, flexShrink: 0, overflow: "hidden" }}>
                    {a.imageUrl
                      ? <img src={a.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{a.name[0]}</div>
                    }
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{a.genre}{a.followers ? ` · ${a.followers} followers` : ""}</div>
                  </div>
                  <FollowButton id={a.id} size="sm" />
                </div>
              ))}
            </div>
          ) : <EmptyState title="No artists" sub="Artists you follow will appear here." />
        )}

        {tab === "downloaded" && (
          <DownloadsView
            tracks={(downloadedTracks || []).map(toOfflineTrack)}
            onPlay={(t, q) => playTrack({ ...t, bg: t.bg ?? BG_PALETTE[0] } as Track, q as Track[])}
            onSync={async () => { await refreshDownloads(); toast("Offline cache synced"); }}
          />
        )}
      </div>
    </div>
  );
}

// ─── PlaylistScreen ────────────────────────────────────────────────────────────
function PlaylistScreen({ item }: { item: PlaylistItem }) {
  const { C, playTrack, canGoBack, goBack, discoveryTracks } = useApp();
  const [fullPlaylist, setFullPlaylist] = useState<PlaylistItem>(item);
  const [loading, setLoading] = useState(item.tracks.length === 0);

  useEffect(() => {
    if (item.tracks.length > 0) { setFullPlaylist(item); setLoading(false); return; }
    setLoading(true);
    api<any>(`/library/playlists/${item.id}`).then(data => {
      if (data) setFullPlaylist(mapAPIPlaylist(data));
      else if (discoveryTracks.length > 0) {
        setFullPlaylist({ ...item, tracks: discoveryTracks.slice(0, 12) });
      }
      setLoading(false);
    });
  }, [item.id]);

  const tracks = fullPlaylist.tracks || [];

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", paddingBottom: 32 }}>
      <div style={{ padding: "16px 28px 0" }}>
        {canGoBack && (
          <button onClick={goBack}
            style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, marginBottom: 12 }}>
            <ChevronLeft size={20} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 24, padding: "0 28px", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ width: 176, height: 176, borderRadius: 16, background: fullPlaylist.bg, flexShrink: 0, overflow: "hidden", boxShadow: `0 8px 32px ${fullPlaylist.bg}66`, position: "relative" }}>
          {fullPlaylist.imageUrl && <img src={fullPlaylist.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          <div style={{ position: "absolute", width: "60%", height: "60%", borderRadius: "50%", right: "-14%", bottom: "-14%", background: "rgba(255,255,255,0.14)" }} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Playlist</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: "0 0 6px", lineHeight: 1.2 }}>{fullPlaylist.name}</h1>
          {fullPlaylist.description && <p style={{ fontSize: 13, color: C.muted, margin: "0 0 6px" }}>{fullPlaylist.description}</p>}
          <div style={{ fontSize: 12, color: C.muted }}>
            {fullPlaylist.creator && <span>{fullPlaylist.creator} · </span>}
            <span>{fullPlaylist.trackCount} songs</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 28px 0" }}>
        <button
          onClick={() => tracks[0] && playTrack(tracks[0], tracks)}
          disabled={tracks.length === 0}
          style={{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 22px", borderRadius: 22, background: C.accent, border: "none", color: C.bg, fontWeight: 700, fontSize: 15, cursor: tracks.length > 0 ? "pointer" : "not-allowed", opacity: tracks.length > 0 ? 1 : 0.5 }}>
          <Play size={18} fill="currentColor" /> Play all
        </button>
        <button
          onClick={() => { const s = [...tracks].sort(() => Math.random() - 0.5); s[0] && playTrack(s[0], s); }}
          disabled={tracks.length === 0}
          style={{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 22px", borderRadius: 22, background: C.surf, border: `1px solid ${C.border}`, color: C.text, fontWeight: 700, fontSize: 15, cursor: tracks.length > 0 ? "pointer" : "not-allowed", opacity: tracks.length > 0 ? 1 : 0.5 }}>
          <Shuffle size={16} /> Shuffle
        </button>
        <button
          aria-label="Share playlist"
          onClick={async () => {
            try {
              if (navigator.share) {
                await navigator.share({ title: fullPlaylist.name, url: window.location.href });
              } else {
                await navigator.clipboard.writeText(window.location.href);
                toast("Link copied");
              }
            } catch { /* share sheet dismissed */ }
          }}
          style={{ width: 44, height: 44, borderRadius: "50%", background: C.surf, border: `1px solid ${C.border}`, cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div style={{ padding: "16px 28px 0" }}>
        {loading
          ? [...Array(6)].map((_, i) => <TrackSkeleton key={i} />)
          : tracks.length > 0
            ? tracks.map((t, i) => <TrackRow key={`${t.id}-${i}`} track={t} index={i} queue={tracks} showLike />)
            : <EmptyState title="No tracks" sub="This playlist is empty." />
        }
      </div>
    </div>
  );
}

// ─── SettingsScreen ────────────────────────────────────────────────────────────
function SettingsScreen() {
  const {
    C, canGoBack, goBack, user, refreshDownloads, updateProfile,
    theme, setTheme, accent, setAccent,
    audioQuality, setAudioQuality,
    normalizeVolume, setNormalizeVolume,
    autoplay, setAutoplay, crossfade, setCrossfade,
    notifNewReleases, setNotifNewReleases,
    notifRecommendations, setNotifRecommendations,
    notifFollowers, setNotifFollowers,
    shareListening, setShareListening,
    shareData, setShareData,
  } = useApp();

  // Live connection status (driven by the safeFetch connection store).
  const [conn, setConn] = useState<ConnectionStatus>(() => getConnectionStatus());
  const [cachedCount, setCachedCount] = useState(0);
  useEffect(() => subscribeConnection(setConn), []);
  useEffect(() => { setCachedCount(readOfflineTracks().length); }, []);

  // Persistent engines: profile name editing + connected devices.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [devices, setDevices] = useState<StoredDevice[]>(() => getDevices());
  const [activeDeviceId, setActiveDeviceId] = useState(() => getActiveDevice().id);

  const saveName = () => {
    const next = nameDraft.trim();
    if (!next) return;
    updateProfile({
      name: next,
      initials: next.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2),
    });
    setEditingName(false);
    toast("Profile updated");
  };

  const switchDevice = (id: string) => {
    const active = setActiveStoredDevice(id);
    setActiveDeviceId(active.id);
    setDevices(getDevices());
    toast(`Output → ${active.name}`);
  };

  const saveSettings = async (patch: Record<string, unknown>) => {
    await api("/settings", { method: "PUT", body: JSON.stringify(patch) });
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: 1, padding: "0 0 8px" }}>{title}</div>
      <div style={{ background: C.pane, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden" }}>{children}</div>
    </div>
  );

  const Row = ({ label, sub, right, onClick, last }: { label: string; sub?: string; right?: React.ReactNode; onClick?: () => void; last?: boolean }) => (
    <div onClick={onClick}
      style={{ display: "flex", alignItems: "center", padding: "14px 16px", borderBottom: last ? "none" : `1px solid ${C.border}`, cursor: onClick ? "pointer" : "default", gap: 12 }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = C.surf; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.background = "transparent"; }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, color: C.text, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );

  const THEME_OPT = [
    { id: "dark",  emoji: "🌙", label: "Dark",  desc: "Deep violet" },
    { id: "oled",  emoji: "⬛", label: "OLED",  desc: "True black"  },
    { id: "light", emoji: "☀️", label: "Light", desc: "Airy & soft"  },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", paddingBottom: 48 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 28px 20px" }}>
        {canGoBack && (
          <button onClick={goBack}
            style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, flexShrink: 0 }}>
            <ChevronLeft size={20} />
          </button>
        )}
        <h1 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: 0 }}>Settings</h1>
      </div>

      <div style={{ padding: "0 28px" }}>
        <Section title="Account">
          {editingName ? (
            <div style={{ display: "flex", gap: 8, padding: "14px 16px", borderBottom: `1px solid ${C.border}`, alignItems: "center" }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                placeholder="Display name"
                style={{ flex: 1, minWidth: 0, height: 38, borderRadius: 10, border: `1px solid ${C.accent}`, background: C.surf, color: C.text, padding: "0 12px", fontSize: 14, outline: "none" }}
              />
              <button
                onClick={saveName}
                disabled={!nameDraft.trim()}
                style={{ height: 34, padding: "0 14px", borderRadius: 17, border: "none", background: nameDraft.trim() ? C.accent : C.surf, color: nameDraft.trim() ? C.bg : C.muted, fontSize: 13, fontWeight: 700, cursor: nameDraft.trim() ? "pointer" : "not-allowed" }}>
                Save
              </button>
              <button
                onClick={() => setEditingName(false)}
                style={{ height: 34, padding: "0 14px", borderRadius: 17, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          ) : (
            <Row
              label={user?.name ?? "Not signed in"}
              sub={user?.email ?? "Sign in to sync your listening history"}
              onClick={() => { setNameDraft(user?.name ?? ""); setEditingName(true); }}
              right={
                user ? (
                  user.avatarUrl
                    ? <img src={user.avatarUrl} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
                    : <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.accent, color: C.bg, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{user.initials}</div>
                ) : <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.surf, display: "grid", placeItems: "center", flexShrink: 0, color: C.muted }}><Settings size={18} /></div>
              } />
          )}
          <Row label="Subscription"
            sub={user ? `${user.subscription === "premium" ? "Vibra Premium" : "Free"} plan` : "No account connected"}
            onClick={() => toast("Manage subscription")} last
            right={user?.subscription === "premium"
              ? <div style={{ height: 24, padding: "0 10px", borderRadius: 12, background: C.accent + "33", color: C.accent, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center" }}>PREMIUM</div>
              : <ChevronRight size={16} color={C.muted} />} />
        </Section>

        <Section title="Appearance">
          <div style={{ padding: 16, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 15, color: C.text, fontWeight: 500, marginBottom: 12 }}>Theme</div>
            <div style={{ display: "flex", gap: 10 }}>
              {THEME_OPT.map(t => (
                <button key={t.id} onClick={() => { setTheme(t.id); saveSettings({ theme: t.id }); toast(`Switched to ${t.label} theme`); }}
                  style={{ flex: 1, padding: "10px 8px", borderRadius: 12, border: `2px solid ${theme === t.id ? C.accent : C.border}`, background: theme === t.id ? C.accent + "1A" : C.surf, cursor: "pointer", textAlign: "center", transition: "all .15s" }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{t.emoji}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: theme === t.id ? C.accent : C.text }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 15, color: C.text, fontWeight: 500, marginBottom: 12 }}>Accent colour</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {ACCENT_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => { setAccent(opt.value); updateProfile({ accentColor: opt.value }); saveSettings({ accent: opt.value }); toast(`Accent → ${opt.label}`); }} title={opt.label}
                  style={{ width: 36, height: 36, borderRadius: "50%", background: opt.value, border: `3px solid ${accent === opt.value ? C.text : "transparent"}`, cursor: "pointer", position: "relative", transition: "border .15s" }}>
                  {accent === opt.value && <Check size={14} color="#fff" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }} />}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Playback">
          <div style={{ padding: 16, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 15, color: C.text, fontWeight: 500, marginBottom: 12 }}>Audio quality</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["Low", "Normal", "High", "Lossless"].map(q => (
                <button key={q} onClick={() => { setAudioQuality(q.toLowerCase()); updateProfile({ audioQuality: q.toLowerCase() }); saveSettings({ audioQuality: q.toLowerCase() }); toast(`Quality → ${q}`); }}
                  style={{ height: 34, padding: "0 14px", borderRadius: 17, border: `1px solid ${audioQuality === q.toLowerCase() ? C.accent : C.border}`, background: audioQuality === q.toLowerCase() ? C.accent + "1A" : "transparent", color: audioQuality === q.toLowerCase() ? C.accent : C.muted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
          <Row label="Normalize volume" sub="Keep consistent levels" right={<Toggle value={normalizeVolume} onChange={v => { setNormalizeVolume(v); saveSettings({ normalizeVolume: v }); }} />} />
          <Row label="Crossfade" sub="Smooth transitions between tracks" right={<Toggle value={crossfade} onChange={v => { setCrossfade(v); saveSettings({ crossfade: v }); }} />} />
          <Row label="Autoplay" sub="Continue with similar songs" last right={<Toggle value={autoplay} onChange={v => { setAutoplay(v); saveSettings({ autoplay: v }); }} />} />
        </Section>

        <Section title="Notifications">
          <Row label="New releases" sub="From artists you follow" right={<Toggle value={notifNewReleases} onChange={v => { setNotifNewReleases(v); saveSettings({ notifNewReleases: v }); }} />} />
          <Row label="Recommendations" sub="Personalised suggestions" right={<Toggle value={notifRecommendations} onChange={v => { setNotifRecommendations(v); saveSettings({ notifRecommendations: v }); }} />} />
          <Row label="New followers" last right={<Toggle value={notifFollowers} onChange={v => { setNotifFollowers(v); saveSettings({ notifFollowers: v }); }} />} />
        </Section>

        <Section title="Privacy">
          <Row label="Listening activity" sub="Let others see what you are playing" right={<Toggle value={shareListening} onChange={v => { setShareListening(v); saveSettings({ shareListening: v }); }} />} />
          <Row label="Share usage data" sub="Help improve Vibra" last right={<Toggle value={shareData} onChange={v => { setShareData(v); saveSettings({ shareData: v }); }} />} />
        </Section>

        <Section title="Offline & Sync">
          <Row
            label="Offline Storage"
            sub={`${cachedCount} track${cachedCount === 1 ? "" : "s"} saved on this device`}
            right={<HardDrive size={16} color={C.accent} />}
          />
          <Row
            label="Cached Audio"
            sub={wasOfflineCleared() ? "Cache cleared — sync to rebuild" : "Kept ready for offline playback"}
            right={
              <button
                type="button"
                onClick={() => {
                  clearOfflineTracks();
                  setCachedCount(0);
                  toast("Offline cache cleared");
                }}
                disabled={cachedCount === 0}
                style={{
                  height: 30, padding: "0 12px", borderRadius: 15,
                  border: `1px solid ${cachedCount ? "#E5484D55" : C.border}`,
                  background: cachedCount ? "#E5484D1A" : "transparent",
                  color: cachedCount ? "#E5484D" : C.muted,
                  fontSize: 12, fontWeight: 600,
                  cursor: cachedCount ? "pointer" : "not-allowed",
                  opacity: cachedCount ? 1 : 0.5,
                }}
              >
                Clear
              </button>
            }
          />
          <Row
            label="Sync Library"
            sub="Pull your latest downloads into offline storage"
            onClick={async () => {
              await refreshDownloads();
              unmarkOfflineCleared();
              setCachedCount(readOfflineTracks().length);
              toast("Library synced");
            }}
            last
            right={<RefreshCw size={16} color={C.muted} />}
          />
        </Section>

        <Section title="Connected Devices">
          {devices.map((d, i) => (
            <Row
              key={d.id}
              label={d.name}
              sub={`${d.type === "browser" ? "Web player" : d.type === "phone" ? "Phone" : d.type === "desktop" ? "Desktop" : "Speaker"}${d.id === activeDeviceId ? " · Active output" : ""}`}
              onClick={() => switchDevice(d.id)}
              last={i === devices.length - 1}
              right={
                d.id === activeDeviceId
                  ? <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34C759", flexShrink: 0 }} />
                  : <ChevronRight size={16} color={C.muted} />
              }
            />
          ))}
        </Section>

        <Section title="About">
          <Row label="Connection"
            sub={conn === "online" ? "Audio nodes online" : conn === "degraded" ? "Weak signal — using cached content" : "Offline — downloaded tracks still play"}
            right={<div style={{ width: 8, height: 8, borderRadius: "50%", background: conn === "online" ? "#34C759" : conn === "degraded" ? "#FF9F0A" : "#E5484D", flexShrink: 0 }} />} />
          <Row label="Version" sub="Vibra 2.1.0" right={<span style={{ fontSize: 13, color: C.accent, fontWeight: 600 }}>Latest</span>} />
          <Row label="Terms of service" onClick={() => toast("Opening terms…")} right={<ChevronRight size={16} color={C.muted} />} />
          <Row label="Privacy policy" onClick={() => toast("Opening privacy policy…")} last right={<ChevronRight size={16} color={C.muted} />} />
        </Section>

        <button
          onClick={() => { localStorage.removeItem("vibra_onboarded"); window.location.reload(); }}
          style={{ width: "100%", height: 48, borderRadius: 12, background: C.surf, border: `1px solid ${C.border}`, color: C.muted, fontWeight: 600, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
          Replay onboarding
        </button>

        <button
          onClick={async () => { await api("/auth/logout", { method: "POST" }); toast("Signed out"); }}
          style={{ width: "100%", height: 48, borderRadius: 12, background: "#E5484D1A", border: "1px solid #E5484D44", color: "#E5484D", fontWeight: 700, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <LogOut size={18} /> Sign out
        </button>
      </div>
    </div>
  );
}

// ─── ProfileScreen ─────────────────────────────────────────────────────────────
function ProfileScreen() {
  const { C, navigate, canGoBack, goBack, user, userLoading, recentTracks } = useApp();

  if (userLoading) return (
    <div style={{ flex: 1, padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 0" }}>
        <Sk w={96} h={96} r={48} />
        <Sk w={160} h={20} />
        <Sk w={120} h={14} />
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "20px 28px 0" }}>
        {canGoBack && (
          <button onClick={goBack}
            style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text }}>
            <ChevronLeft size={20} />
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => navigate({ id: "settings" })}
          style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
          <Settings size={18} />
        </button>
      </div>

      {user ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 28px 0", textAlign: "center" }}>
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt="" style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover", boxShadow: `0 0 0 4px ${C.accent}44`, marginBottom: 14 }} />
              : <div style={{ width: 96, height: 96, borderRadius: "50%", background: C.accent, color: C.bg, display: "grid", placeItems: "center", fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 30, fontWeight: 700, marginBottom: 14, boxShadow: `0 0 0 4px ${C.accent}44` }}>{user.initials}</div>
            }
            <h1 style={{ fontSize: 24, fontWeight: 700, color: C.text, margin: 0 }}>{user.name}</h1>
            <p style={{ fontSize: 14, color: C.muted, margin: "4px 0 0" }}>
              @{user.username} · {user.subscription === "premium" ? "Vibra Premium" : "Free plan"}
            </p>

            {user.stats && (
              <div style={{ display: "flex", gap: 32, marginTop: 20 }}>
                {[
                  [String(user.stats.following), "Following",  "/users/me/following"],
                  [String(user.stats.followers), "Followers",  "/users/me/followers"],
                  [String(user.stats.playlists), "Playlists",  "/library/playlists"],
                ].map(([count, label, _route]) => (
                  <button key={label} onClick={() => toast(`${label} will appear once your library grows`)}
                    style={{ background: "none", border: "none", cursor: "pointer", textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{count}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
                  </button>
                ))}
              </div>
            )}

            <button onClick={() => navigate({ id: "settings" })}
              style={{ marginTop: 16, height: 40, padding: "0 20px", borderRadius: 20, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Edit profile
            </button>
          </div>

          {user.stats && (
            <div style={{ padding: "24px 28px 0" }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>Listening stats</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  [user.stats.weeklyHours,         "This week"],
                  [String(user.stats.topArtists),  "Artists"],
                  [String(user.stats.tracksLiked), "Liked"],
                ].map(([val, label]) => (
                  <div key={label} style={{ background: C.pane, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: C.accent }}>{val}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: "24px 28px 0" }}>
          <EmptyState title="Not signed in" sub="Sign in to sync your library, likes, and listening history across devices." action={
            <button onClick={() => navigate({ id: "settings" })}
              style={{ height: 40, padding: "0 20px", borderRadius: 20, border: "none", background: C.accent, color: C.bg, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Open Settings
            </button>
          } />
        </div>
      )}

      {recentTracks.length > 0 && (
        <div style={{ padding: "24px 28px 0" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>Recently played</h2>
            {(recentTracks || []).slice(0, 5).map((t, i) => <TrackRow key={t.id} track={t} index={i} queue={recentTracks} />)}
        </div>
      )}
    </div>
  );
}

// ─── Onboarding data ──────────────────────────────────────────────────────────
interface OnboardingData {
  name: string;
  email: string;
  password: string;
  genres: string[];
  artistIds: string[];
  likedTrackIds: (string | number)[];
}

const ONBOARDING_GENRES = [
  { id: "hiphop",     label: "Hip-hop",      bg: "#8A3A1F", emoji: "🎤" },
  { id: "rnb",        label: "R&B",          bg: "#9B3B63", emoji: "💜" },
  { id: "pop",        label: "Pop",          bg: "#5B3FD0", emoji: "✨" },
  { id: "electronic", label: "Electronic",   bg: "#2F5A3A", emoji: "🎛" },
  { id: "indie",      label: "Indie",        bg: "#4A3280", emoji: "🌿" },
  { id: "rock",       label: "Rock",         bg: "#3A3A3A", emoji: "🎸" },
  { id: "jazz",       label: "Jazz",         bg: "#2C4A5E", emoji: "🎷" },
  { id: "classical",  label: "Classical",    bg: "#4A3280", emoji: "🎻" },
  { id: "ambient",    label: "Ambient",      bg: "#1B4A6A", emoji: "🌊" },
  { id: "afrobeats",  label: "Afrobeats",    bg: "#7A2438", emoji: "🥁" },
  { id: "latin",      label: "Latin",        bg: "#B0587A", emoji: "💃" },
  { id: "workout",    label: "Workout",      bg: "#8A4A1F", emoji: "🔥" },
];

const ONBOARDING_ARTISTS = [
  { id: "weeknd",    name: "The Weeknd",       genre: "R&B",       bg: "#7A2438" },
  { id: "sza",       name: "SZA",              genre: "R&B",       bg: "#4A3280" },
  { id: "kendrick",  name: "Kendrick Lamar",   genre: "Hip-hop",   bg: "#2C4A5E" },
  { id: "drake",     name: "Drake",            genre: "Hip-hop",   bg: "#2F5A3A" },
  { id: "frank",     name: "Frank Ocean",      genre: "R&B",       bg: "#5B3FD0" },
  { id: "beyonce",   name: "Beyoncé",          genre: "Pop",       bg: "#9B3B63" },
  { id: "taylor",    name: "Taylor Swift",     genre: "Pop",       bg: "#3A2F55" },
  { id: "billie",    name: "Billie Eilish",    genre: "Alt-pop",   bg: "#1F4E5F" },
  { id: "tyler",     name: "Tyler the Creator", genre: "Hip-hop",  bg: "#8A3A1F" },
  { id: "doja",      name: "Doja Cat",         genre: "Pop/Rap",   bg: "#7A2438" },
  { id: "jcole",     name: "J. Cole",          genre: "Hip-hop",   bg: "#3A3A3A" },
  { id: "ariana",    name: "Ariana Grande",    genre: "Pop",       bg: "#9B3B63" },
  { id: "post",      name: "Post Malone",      genre: "Pop/Rap",   bg: "#2C4A5E" },
  { id: "dua",       name: "Dua Lipa",         genre: "Pop",       bg: "#B0587A" },
  { id: "tame",      name: "Tame Impala",      genre: "Indie",     bg: "#4A3280" },
  { id: "bon_iver",  name: "Bon Iver",         genre: "Folk",      bg: "#2F5A3A" },
  { id: "james",     name: "James Blake",      genre: "Electronic", bg: "#1B4A6A" },
  { id: "harry",     name: "Harry Styles",     genre: "Pop",       bg: "#8A4A1F" },
  { id: "lorde",     name: "Lorde",            genre: "Alt-pop",   bg: "#3A2F55" },
  { id: "fka",       name: "FKA twigs",        genre: "Art pop",   bg: "#7A2438" },
  { id: "beach",     name: "Beach House",      genre: "Dream pop", bg: "#1F4E5F" },
  { id: "olivia",    name: "Olivia Rodrigo",   genre: "Pop",       bg: "#9B3B63" },
  { id: "radiohead", name: "Radiohead",        genre: "Rock",      bg: "#2C4A5E" },
  { id: "mac",       name: "Mac Miller",       genre: "Hip-hop",   bg: "#5A3A10" },
  { id: "bad",       name: "Bad Bunny",        genre: "Latin",     bg: "#3A2F55" },
  { id: "burna",     name: "Burna Boy",        genre: "Afrobeats", bg: "#8A3A1F" },
  { id: "wizkid",    name: "WizKid",           genre: "Afrobeats", bg: "#2F5A3A" },
  { id: "coldplay",  name: "Coldplay",         genre: "Rock",      bg: "#1F4E5F" },
  { id: "hozier",    name: "Hozier",           genre: "Folk rock", bg: "#2C4A5E" },
  { id: "dvsn",      name: "dvsn",             genre: "R&B",       bg: "#4A3280" },
];

// ─── OnboardingFlow ────────────────────────────────────────────────────────────
function OnboardingFlow({ onComplete }: { onComplete: (data: OnboardingData) => void }) {
  const C = useMemo(() => makeColors("dark", "#A78BFA"), []);
  const [step, setStep]   = useState(0);
  const [dir, setDir]     = useState<1 | -1>(1);
  const [animating, setAnimating] = useState(false);

  // Form state
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [formError, setFormError] = useState("");

  // Preferences
  const [genres, setGenres]     = useState<string[]>([]);
  const [artistIds, setArtistIds] = useState<string[]>([]);
  const [likedTrackIds, setLikedOB] = useState<(string | number)[]>([]);

  // Tracks for the taste step (from the live audio engine)
  const [tasteTracks, setTasteTracks] = useState<Track[]>([]);
  const [tasteLoading, setTasteLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    searchTracks("popular right now", 12).then(list => {
      if (cancelled) return;
      setTasteTracks(list.map((t, i) => fromApiTrack(t, i)));
      setTasteLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const TOTAL_STEPS = 6;

  const goTo = (next: number) => {
    if (animating) return;
    setDir(next > step ? 1 : -1);
    setAnimating(true);
    setTimeout(() => { setStep(next); setAnimating(false); }, 180);
  };

  const validateAccount = () => {
    if (!name.trim()) { setFormError("Please enter your name."); return false; }
    if (!email.includes("@") || !email.includes(".")) { setFormError("Enter a valid email address."); return false; }
    if (password.length < 8) { setFormError("Password must be at least 8 characters."); return false; }
    setFormError("");
    return true;
  };

  const handleNext = () => {
    if (step === 1 && !validateAccount()) return;
    if (step < TOTAL_STEPS - 1) goTo(step + 1);
    else {
      onComplete({ name: name.trim(), email: email.trim(), password, genres, artistIds, likedTrackIds });
    }
  };

  const toggleGenre = (id: string) => setGenres(g => g.includes(id) ? g.filter(x => x !== id) : [...g, id]);
  const toggleArtist = (id: string) => setArtistIds(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);
  const toggleTrackLike = (id: string | number) => setLikedOB(l => l.includes(id) ? l.filter(x => x !== id) : [...l, id]);

  const progress = (step / (TOTAL_STEPS - 1)) * 100;

  // Shared field style
  const inputStyle: React.CSSProperties = {
    width: "100%", height: 52, borderRadius: 14, border: `1.5px solid ${C.border}`,
    background: C.surf, color: C.text, fontSize: 15, padding: "0 16px",
    outline: "none", boxSizing: "border-box", transition: "border .15s",
  };

  const canContinue = [
    true,                       // step 0 — welcome
    name && email && password.length >= 8, // step 1 — account
    genres.length >= 1,         // step 2 — genres
    artistIds.length >= 3,      // step 3 — artists
    true,                       // step 4 — taste tracks
    true,                       // step 5 — done
  ][step];

  return (
    <div style={{ position: "fixed", inset: 0, background: C.bg, display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", zIndex: 999 }}>

      {/* Ambient gradient blob */}
      <div style={{ position: "absolute", top: "-20%", left: "50%", transform: "translateX(-50%)", width: 600, height: 600, borderRadius: "50%", background: `radial-gradient(circle, ${C.accent}18 0%, transparent 70%)`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "0", right: "-10%", width: 400, height: 400, borderRadius: "50%", background: `radial-gradient(circle, #9B3B6318 0%, transparent 70%)`, pointerEvents: "none" }} />

      {/* Progress bar + back */}
      {step > 0 && (
        <div style={{ padding: "20px 28px 0", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, position: "relative", zIndex: 2 }}>
          {step > 0 && step < TOTAL_STEPS - 1 && (
            <button onClick={() => goTo(step - 1)}
              style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, flexShrink: 0 }}>
              <ChevronLeft size={20} />
            </button>
          )}
          <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: C.accent, borderRadius: 2, transition: "width .4s ease" }} />
          </div>
          <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{step} / {TOTAL_STEPS - 1}</span>
        </div>
      )}

      {/* Step content */}
      <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 24px 32px", position: "relative", zIndex: 2 }}>
        <div style={{ width: "100%", maxWidth: 480, paddingTop: step === 0 ? 80 : 36 }}>

          {/* ── Step 0: Welcome ── */}
          {step === 0 && (
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
              <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 72, fontWeight: 700, color: C.text, letterSpacing: -2, lineHeight: 1, marginBottom: 16 }}>
                vibra<span style={{ color: C.accent }}>.</span>
              </div>
              <p style={{ fontSize: 18, color: C.muted, fontWeight: 400, margin: 0 }}>
                welcome
              </p>
            </div>
          )}

          {/* ── Step 1: Account ── */}
          {step === 1 && (
            <div>
              <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 32, fontWeight: 700, color: C.text, margin: "0 0 6px" }}>Create your account</h2>
              <p style={{ fontSize: 15, color: C.muted, marginBottom: 32 }}>We keep your data private — no spam, ever.</p>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6 }}>Full name</label>
                  <div style={{ position: "relative" }}>
                    <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted, pointerEvents: "none" }}><User size={16} /></div>
                    <input value={name} onChange={e => { setName(e.target.value); setFormError(""); }}
                      placeholder="Your full name"
                      style={{ ...inputStyle, paddingLeft: 44 }}
                      onFocus={e => (e.target.style.borderColor = C.accent)}
                      onBlur={e => (e.target.style.borderColor = C.border)} />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6 }}>Email address</label>
                  <input value={email} onChange={e => { setEmail(e.target.value); setFormError(""); }}
                    type="email" placeholder="you@example.com"
                    style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = C.accent)}
                    onBlur={e => (e.target.style.borderColor = C.border)} />
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6 }}>Password</label>
                  <div style={{ position: "relative" }}>
                    <input value={password} onChange={e => { setPassword(e.target.value); setFormError(""); }}
                      type={showPw ? "text" : "password"} placeholder="Minimum 8 characters"
                      style={{ ...inputStyle, paddingRight: 48 }}
                      onFocus={e => (e.target.style.borderColor = C.accent)}
                      onBlur={e => (e.target.style.borderColor = C.border)} />
                    <button onClick={() => setShowPw(p => !p)}
                      style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.muted, display: "grid", placeItems: "center" }}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {password.length > 0 && (
                    <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                      {[0,1,2,3].map(i => (
                        <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < Math.min(Math.floor(password.length / 3), 4) ? (password.length >= 12 ? "#34C759" : password.length >= 8 ? C.accent : "#F97316") : C.border, transition: "background .3s" }} />
                      ))}
                    </div>
                  )}
                </div>

                {formError && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: "#E5484D1A", border: "1px solid #E5484D44" }}>
                    <X size={14} color="#E5484D" />
                    <span style={{ fontSize: 13, color: "#E5484D" }}>{formError}</span>
                  </div>
                )}
              </div>

              <p style={{ fontSize: 12, color: C.muted, marginTop: 16, lineHeight: 1.6 }}>
                By continuing you agree to Vibra's <span style={{ color: C.accent, cursor: "pointer" }}>Terms of Service</span> and <span style={{ color: C.accent, cursor: "pointer" }}>Privacy Policy</span>.
              </p>
            </div>
          )}

          {/* ── Step 2: Genres ── */}
          {step === 2 && (
            <div>
              <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 32, fontWeight: 700, color: C.text, margin: "0 0 6px" }}>What moves you?</h2>
              <p style={{ fontSize: 15, color: C.muted, marginBottom: 24 }}>Pick the genres you love — select as many as you like.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {ONBOARDING_GENRES.map(g => {
                  const sel = genres.includes(g.id);
                  return (
                    <button key={g.id} onClick={() => toggleGenre(g.id)}
                      style={{ height: 76, borderRadius: 14, background: sel ? g.bg : C.surf, border: `2px solid ${sel ? "transparent" : C.border}`, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, transition: "all .15s", position: "relative", overflow: "hidden" }}>
                      {sel && <div style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.9)", display: "grid", placeItems: "center" }}><Check size={10} color={g.bg} /></div>}
                      <span style={{ fontSize: 22 }}>{g.emoji}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: sel ? "#fff" : C.text }}>{g.label}</span>
                    </button>
                  );
                })}
              </div>
              {genres.length > 0 && <p style={{ fontSize: 13, color: C.accent, marginTop: 14, textAlign: "center", fontWeight: 600 }}>{genres.length} selected</p>}
            </div>
          )}

          {/* ── Step 3: Artists ── */}
          {step === 3 && (
            <div>
              <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 32, fontWeight: 700, color: C.text, margin: "0 0 6px" }}>Who do you vibe with?</h2>
              <p style={{ fontSize: 15, color: C.muted, marginBottom: 24 }}>Pick at least 3 artists. This tunes your entire feed.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {ONBOARDING_ARTISTS.map(a => {
                  const sel = artistIds.includes(a.id);
                  return (
                    <button key={a.id} onClick={() => toggleArtist(a.id)}
                      style={{ padding: "12px 8px", borderRadius: 14, background: sel ? a.bg : C.surf, border: `2px solid ${sel ? "transparent" : C.border}`, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, transition: "all .15s", position: "relative" }}>
                      {sel && <div style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.9)", display: "grid", placeItems: "center" }}><Check size={10} color={a.bg} /></div>}
                      <div style={{ width: 44, height: 44, borderRadius: "50%", background: sel ? "rgba(255,255,255,0.2)" : C.border, display: "grid", placeItems: "center", fontSize: 18, fontWeight: 700, color: sel ? "#fff" : C.text }}>
                        {a.name[0]}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: sel ? "#fff" : C.text, textAlign: "center", lineHeight: 1.3 }}>{a.name}</div>
                      <div style={{ fontSize: 10, color: sel ? "rgba(255,255,255,0.7)" : C.muted }}>{a.genre}</div>
                    </button>
                  );
                })}
              </div>
              {artistIds.length > 0 && <p style={{ fontSize: 13, color: C.accent, marginTop: 14, textAlign: "center", fontWeight: 600 }}>{artistIds.length} selected {artistIds.length < 3 ? `— pick ${3 - artistIds.length} more` : "— great choice!"}</p>}
            </div>
          )}

          {/* ── Step 4: Taste tracks ── */}
          {step === 4 && (
            <div>
              <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 32, fontWeight: 700, color: C.text, margin: "0 0 6px" }}>Heart what you love</h2>
              <p style={{ fontSize: 15, color: C.muted, marginBottom: 24 }}>Tap the heart on any track that catches your ear. Even one helps.</p>
              {tasteLoading ? (
                <div style={{ textAlign: "center", color: C.muted, padding: "48px 0", fontSize: 14 }}>Loading tracks…</div>
              ) : tasteTracks.length === 0 ? (
                <div style={{ textAlign: "center", color: C.muted, padding: "48px 0", fontSize: 14, lineHeight: 1.6 }}>
                  Suggestions are tuning up right now.<br />You can skip this step — your feed sharpens as you listen.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {tasteTracks.map(track => {
                    const liked = likedTrackIds.includes(track.id);
                    return (
                      <div key={track.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 12, background: liked ? C.accent + "18" : C.surf, border: `1.5px solid ${liked ? C.accent + "55" : "transparent"}`, transition: "all .15s" }}>
                        <CoverArt bg={track.bg} imageUrl={track.imageUrl} size={46} radius={10} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
                          <div style={{ fontSize: 12, color: C.muted }}>{track.artist}</div>
                        </div>
                        <button onClick={() => toggleTrackLike(track.id)}
                          style={{ width: 40, height: 40, borderRadius: "50%", background: liked ? C.accent : C.border, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: liked ? C.bg : C.muted, flexShrink: 0, transition: "all .15s" }}>
                          <Heart size={16} fill={liked ? C.bg : "none"} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {likedTrackIds.length > 0 && <p style={{ fontSize: 13, color: C.accent, marginTop: 14, textAlign: "center", fontWeight: 600 }}>{likedTrackIds.length} track{likedTrackIds.length !== 1 ? "s" : ""} hearted</p>}
            </div>
          )}

          {/* ── Step 5: All set ── */}
          {step === 5 && (
            <div style={{ textAlign: "center", paddingTop: 32 }}>
              <div style={{ width: 100, height: 100, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent}, #9B3B63)`, display: "grid", placeItems: "center", margin: "0 auto 28px", boxShadow: `0 0 80px ${C.accent}44` }}>
                <Sparkles size={44} color="#fff" />
              </div>
              <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 36, fontWeight: 700, color: C.text, margin: "0 0 12px", lineHeight: 1.15 }}>
                {name.split(" ")[0]}, your<br />station is ready
              </h2>
              <p style={{ fontSize: 16, color: C.muted, lineHeight: 1.7, marginBottom: 40, maxWidth: 340, margin: "0 auto 40px" }}>
                We have tuned Vibra using your <b style={{ color: C.text }}>{genres.length} genres</b>, <b style={{ color: C.text }}>{artistIds.length} artists</b>, and <b style={{ color: C.text }}>{likedTrackIds.length} tracks</b>. Your feed will get sharper as you keep listening.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 40 }}>
                {[
                  { n: genres.length,       label: "Genres",  icon: "🎵" },
                  { n: artistIds.length,    label: "Artists", icon: "🎤" },
                  { n: likedTrackIds.length, label: "Tracks",  icon: "❤️" },
                ].map(stat => (
                  <div key={stat.label} style={{ padding: "16px 10px", borderRadius: 14, background: C.surf, textAlign: "center" }}>
                    <div style={{ fontSize: 24, marginBottom: 4 }}>{stat.icon}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: C.accent }}>{stat.n}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* CTA button */}
      <div style={{ padding: "16px 24px 32px", flexShrink: 0, position: "relative", zIndex: 2 }}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <button
            onClick={handleNext}
            disabled={!canContinue}
            style={{ width: "100%", height: 56, borderRadius: 16, background: canContinue ? C.accent : C.surf, border: "none", color: canContinue ? C.bg : C.muted, fontSize: 16, fontWeight: 700, cursor: canContinue ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "all .2s", fontFamily: "'DM Sans', sans-serif" }}>
            {step === 0 ? "Get started" : step === 5 ? "Open Vibra" : step === 4 ? (likedTrackIds.length === 0 ? "Skip this step" : "Continue") : "Continue"}
            {step < 5 && <ArrowRight size={20} />}
          </button>
          {step === 0 && (
            <button onClick={() => onComplete({ name: "", email: "", password: "", genres: [], artistIds: [], likedTrackIds: [] })}
              style={{ width: "100%", height: 44, background: "none", border: "none", color: C.muted, fontSize: 14, cursor: "pointer", marginTop: 8 }}>
              I already have an account
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FollowButton ──────────────────────────────────────────────────────────────
function FollowButton({ id, size = "md" }: { id: string; size?: "sm" | "md" }) {
  const { C, following, toggleFollow } = useApp();
  const isFollowing = following.has(id);
  const h = size === "sm" ? 30 : 38;
  const px = size === "sm" ? 12 : 18;
  const fs = size === "sm" ? 12 : 14;
  return (
    <button onClick={e => { e.stopPropagation(); toggleFollow(id); }}
      style={{ height: h, padding: `0 ${px}px`, borderRadius: h / 2, border: `1.5px solid ${isFollowing ? C.border : C.accent}`, background: isFollowing ? "transparent" : C.accent, color: isFollowing ? C.muted : C.bg, fontSize: fs, fontWeight: 700, cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap", flexShrink: 0 }}>
      {isFollowing ? "Following" : "Follow"}
    </button>
  );
}

// ─── TrackOptionsSheet ─────────────────────────────────────────────────────────
function TrackOptionsSheet({ track, onClose }: { track: Track; onClose: () => void }) {
  const { C, toggleLike, likedTrackIds, navigate, playlists, addTrackToPlaylist } = useApp();
  const isLiked = likedTrackIds.has(track.id);

  const options: { icon: React.ReactNode; label: string; action: () => void; danger?: boolean }[] = [
    { icon: <Heart size={18} fill={isLiked ? C.accent : "none"} />, label: isLiked ? "Remove from liked" : "Add to liked", action: () => { toggleLike(track.id); onClose(); } },
    {
      icon: <Plus size={18} />,
      label: "Add to playlist",
      action: () => {
        onClose();
        // Prefer the newest locally created playlist, then any real playlist.
        const custom = getStoredPlaylists();
        const target = custom[0] ?? playlists.find(p => p.id !== "liked");
        if (!target) {
          toast("Create a playlist first — tap + in the sidebar");
          return;
        }
        addTrackToPlaylist(target.id, track);
        toast(`Added to "${target.name}"`);
      },
    },
    { icon: <Download size={18} />, label: "Download", action: () => { addOfflineTrack(toOfflineTrack(track)); onClose(); toast("Saved for offline playback"); } },
    { icon: <Compass size={18} />, label: `More from ${track.artist}`, action: () => { onClose(); /* GET /artists/:id/tracks */ toast(`Loading ${track.artist}…`); } },
    { icon: <MoreHorizontal size={18} />, label: "Share track", action: () => { onClose(); /* navigator.share or copy link */ toast("Link copied"); } },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div style={{ position: "relative", background: C.pane, borderRadius: "20px 20px 0 0", padding: "8px 0 32px", animation: "slideUp .22s ease" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border, margin: "8px auto 16px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 20px 16px", borderBottom: `1px solid ${C.border}` }}>
          <CoverArt bg={track.bg} imageUrl={track.imageUrl} size={52} radius={10} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
            <div style={{ fontSize: 13, color: C.muted }}>{track.artist}</div>
          </div>
        </div>
        {options.map(opt => (
          <button key={opt.label} onClick={opt.action}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", background: "none", border: "none", cursor: "pointer", color: opt.danger ? "#E5484D" : C.text, fontSize: 15, fontWeight: 500, textAlign: "left" }}
            onMouseEnter={e => (e.currentTarget.style.background = C.surf)}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}>
            <span style={{ color: opt.danger ? "#E5484D" : C.muted }}>{opt.icon}</span>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── CreatePlaylistModal ───────────────────────────────────────────────────────
function CreatePlaylistModal({ onClose }: { onClose: () => void }) {
  const { C, addPlaylist } = useApp();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    // POST /library/playlists → { name, description }
    const result = await api<any>("/library/playlists", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), description: desc.trim() }),
    });
    setLoading(false);
    if (result) {
      const created = mapAPIPlaylist(result);
      savePlaylist({ ...(created as unknown as StoredPlaylist), createdAt: Date.now() });
      addPlaylist(created);
      toast(`"${created.name}" created`);
    } else {
      // Offline / no backend: create locally so it still lands in the sidebar.
      const local = createCustomPlaylist(name, desc);
      addPlaylist(local as unknown as PlaylistItem);
      toast(`"${local.name}" saved locally`);
    }
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", height: 48, borderRadius: 12, border: `1.5px solid ${C.border}`,
    background: C.surf, color: C.text, fontSize: 15, padding: "0 14px",
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} onClick={onClose} />
      <div style={{ position: "relative", background: C.pane, borderRadius: 20, padding: 28, width: "calc(100% - 48px)", maxWidth: 400, border: `1px solid ${C.border}`, animation: "scaleIn .2s ease" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>New playlist</h2>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6 }}>Playlist name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="My playlist"
              style={inputStyle} onKeyDown={e => e.key === "Enter" && handleCreate()}
              onFocus={e => (e.target.style.borderColor = C.accent)}
              onBlur={e => (e.target.style.borderColor = C.border)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6 }}>Description <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Add a description"
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = C.accent)}
              onBlur={e => (e.target.style.borderColor = C.border)} />
          </div>
        </div>
        <button onClick={handleCreate} disabled={!name.trim() || loading}
          style={{ width: "100%", height: 48, borderRadius: 12, background: name.trim() ? C.accent : C.surf, border: "none", color: name.trim() ? C.bg : C.muted, fontSize: 15, fontWeight: 700, cursor: name.trim() ? "pointer" : "not-allowed", transition: "all .15s" }}>
          {loading ? "Creating…" : "Create playlist"}
        </button>
      </div>
    </div>
  );
}

// ─── Screen Router ─────────────────────────────────────────────────────────────
function ScreenView({ s }: { s: Screen }) {
  const { navigate } = useApp();
  switch (s.id) {
    case "home":     return <HomeScreen />;
    case "search":   return <SearchScreen />;
    case "discover": return <DiscoverScreen />;
    case "library":  return <LibraryScreen tab={s.tab} />;
    case "playlist": return <PlaylistScreen item={s.item} />;
    case "settings": return <SettingsScreen />;
    case "profile":  return <ProfileScreen />;
    case "notfound":
    default:         return <NotFound onReturn={() => navigate({ id: "discover" })} />;
  }
}

// ─── LeftSidebar ──────────────────────────────────────────────────────────────
function LeftSidebar() {
  const { C, screen, navigate, playlists, user, likedTrackIds, openCreatePlaylist } = useApp();

  const NAV = [
    { id: "home",     label: "Home",     Icon: Home },
    { id: "search",   label: "Search",   Icon: Search },
    { id: "discover", label: "Discover", Icon: Compass },
  ] as const;

  const activePl = screen.id === "playlist" ? (screen as Extract<Screen, { id: "playlist" }>).item.id : null;

  return (
    <div style={{ background: C.pane, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
      <div style={{ padding: "20px 20px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>
          vibra<span style={{ color: C.accent }}>.</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => navigate({ id: "profile" })}
            style={{ width: 32, height: 32, borderRadius: "50%", background: user ? C.accent : C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: user ? C.bg : C.muted, fontSize: 12, fontWeight: 700, overflow: "hidden" }}>
            {user?.avatarUrl
              ? <img src={user.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : user?.initials ?? "?"}
          </button>
          <button onClick={() => navigate({ id: "settings" })}
            style={{ width: 32, height: 32, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
            <Settings size={15} />
          </button>
        </div>
      </div>

      <div style={{ padding: "0 12px 4px" }}>
        {NAV.map(({ id, label, Icon }) => {
          const active = screen.id === id;
          return (
            <button key={id} onClick={() => navigate({ id } as Screen)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, height: 42, padding: "0 12px", borderRadius: 10, border: "none", cursor: "pointer", background: active ? C.surf : "transparent", color: active ? C.text : C.muted, fontWeight: active ? 700 : 500, fontSize: 14, textAlign: "left", transition: "all .15s" }}>
              <Icon size={18} />
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 8px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>Your library</span>
          <button onClick={openCreatePlaylist}
            style={{ width: 26, height: 26, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
            <Plus size={13} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0 12px" }}>
          {playlists.length === 0 && (
            <div style={{ padding: "12px 10px", color: C.muted, fontSize: 12 }}>
              No playlists yet — tap + to create one
            </div>
          )}
          {(playlists || []).map(pl => (
            <button key={pl.id} onClick={() => navigate({ id: "playlist", item: pl })}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, height: 52, padding: "0 10px", borderRadius: 10, border: "none", cursor: "pointer", background: activePl === pl.id ? C.surf : "transparent", transition: "background .15s", textAlign: "left" }}
              onMouseEnter={e => (e.currentTarget.style.background = C.surf)}
              onMouseLeave={e => (e.currentTarget.style.background = activePl === pl.id ? C.surf : "transparent")}>
              {pl.id === "liked"
                ? <div style={{ width: 36, height: 36, borderRadius: 8, background: pl.bg, flexShrink: 0, display: "grid", placeItems: "center" }}><Heart size={15} color="#A78BFA" fill="#A78BFA" /></div>
                : <CoverArt bg={pl.bg} imageUrl={pl.imageUrl} size={36} radius={8} />
              }
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl.name}</div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  {pl.id === "liked" ? `${pl.trackCount + likedTrackIds.size} songs` : `Playlist · ${pl.trackCount}`}
                </div>
              </div>
            </button>
          ))}

          <button onClick={() => navigate({ id: "library" })}
            style={{ width: "100%", height: 38, padding: "0 10px", borderRadius: 10, border: "none", cursor: "pointer", background: "transparent", color: C.muted, fontSize: 12, fontWeight: 600, textAlign: "left", display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <Library size={13} /> Browse all
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RightPanel ────────────────────────────────────────────────────────────────
function RightPanel() {
  const { C, currentTrack, isPlaying, togglePlay, playTrack, playNext, playPrev,
    showLyrics, lyrics, plainLyrics, lyricsLoading, elapsed,
    likedTrackIds, toggleLike, shuffleOn, toggleShuffle, repeatMode, cycleRepeat,
    queue, discoveryTracks } = useApp();
  const [tab, setTab] = useState<"nowplaying" | "queue" | "lyrics">("nowplaying");
  const isLiked = currentTrack ? likedTrackIds.has(currentTrack.id) : false;
  const upNext = (queue.length > 0 ? queue : discoveryTracks).slice(0, 5);

  useEffect(() => { if (showLyrics) setTab("lyrics"); }, [showLyrics]);

  return (
    <div style={{ background: C.pane, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
      <div style={{ display: "flex", padding: "16px 16px 0", gap: 4, flexShrink: 0 }}>
        {(["nowplaying", "queue", "lyrics"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, height: 32, borderRadius: 8, border: "none", cursor: "pointer", background: tab === t ? C.surf : "transparent", color: tab === t ? C.text : C.muted, fontSize: 12, fontWeight: 600, transition: "all .15s" }}>
            {t === "nowplaying" ? "Now playing" : t === "queue" ? "Queue" : "Lyrics"}
          </button>
        ))}
      </div>

      {tab === "nowplaying" && (
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "20px 20px 24px" }}>
          {currentTrack ? (
            <>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                <div style={{ width: "100%", maxWidth: 236, aspectRatio: "1", borderRadius: 18, background: currentTrack.bg, overflow: "hidden", boxShadow: `0 12px 40px ${currentTrack.bg}88`, position: "relative" }}>
                  {currentTrack.imageUrl && <img src={currentTrack.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
                  <div style={{ position: "absolute", width: "52%", height: "52%", borderRadius: "50%", right: "-10%", bottom: "-10%", background: "rgba(255,255,255,0.18)" }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 17, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTrack.title}</div>
                  <div style={{ fontSize: 14, color: C.muted }}>{currentTrack.artist}</div>
                </div>
                <button onClick={() => toggleLike(currentTrack.id)}
                  style={{ width: 36, height: 36, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: isLiked ? C.accent : C.muted }}>
                  <Heart size={18} fill={isLiked ? C.accent : "none"} />
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <button onClick={toggleShuffle} style={{ width: 36, height: 36, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: shuffleOn ? C.accent : C.muted }}><Shuffle size={16} /></button>
                <button onClick={playPrev} style={{ width: 36, height: 36, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text }}><SkipBack size={20} /></button>
                <button onClick={togglePlay} style={{ width: 52, height: 52, borderRadius: "50%", background: C.accent, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.bg }}>
                  {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
                </button>
                <button onClick={playNext} style={{ width: 36, height: 36, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text }}><SkipForward size={20} /></button>
                <button onClick={cycleRepeat} style={{ width: 36, height: 36, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: repeatMode !== "off" ? C.accent : C.muted }}>
                  {repeatMode === "one"
                    ? <span style={{ fontSize: 11, fontWeight: 700, color: C.accent }}>1×</span>
                    : <Repeat2 size={16} />}
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "24px 0" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Search music to start listening</div>
              <div style={{ fontSize: 13, color: C.muted }}>Find a song or artist to kick things off</div>
            </div>
          )}
        </div>
      )}

      {tab === "queue" && (
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "12px 16px 24px" }}>
          {upNext.length > 0 ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Up next</div>
              {upNext.map(t => (
                <div key={t.id} role="button" tabIndex={0} onClick={() => playTrack(t, queue.length > 0 ? queue : discoveryTracks)} onKeyDown={e => e.key === "Enter" && playTrack(t)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", cursor: "pointer" }}>
                  <CoverArt bg={t.bg} imageUrl={t.imageUrl} size={36} radius={6} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{t.artist}</div>
                  </div>
                  <span style={{ fontSize: 11, color: C.muted }}>{t.duration}</span>
                </div>
              ))}
            </>
          ) : <EmptyState title="Queue is empty" sub="Play a playlist to fill the queue." />}
        </div>
      )}

      {tab === "lyrics" && (
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "16px 20px 24px" }}>
          {currentTrack && <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>{currentTrack.title} — {currentTrack.artist}</div>}
          <LyricsPanel lyrics={lyrics} plain={plainLyrics} loading={lyricsLoading} elapsed={elapsed} />
        </div>
      )}
    </div>
  );
}

// ─── PlayerBar ─────────────────────────────────────────────────────────────────
function PlayerBar() {
  const { C, currentTrack, isPlaying, togglePlay, playNext, playPrev,
    progress, elapsed, audioDuration, handleSeek,
    showLyrics, toggleLyrics, likedTrackIds, toggleLike,
    shuffleOn, toggleShuffle, repeatMode, cycleRepeat,
    volume, setVolume } = useApp();
  const isLiked = currentTrack ? likedTrackIds.has(currentTrack.id) : false;
  const [showVol, setShowVol] = useState(false);
  const trackColor = currentTrack?.bg ?? C.accent;

  return (
    <div style={{ background: C.pane, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 20px", height: "100%", gap: 16, position: "relative", overflow: "hidden" }}>

      {/* Animated ambient blobs that shift with the current track colour */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", width: 260, height: 260, borderRadius: "50%", background: `radial-gradient(circle, ${trackColor}28 0%, transparent 70%)`, top: "50%", left: "18%", transform: "translate(-50%,-50%)", animation: "blobA 7s ease-in-out infinite", transition: "background 1.5s ease" }} />
        <div style={{ position: "absolute", width: 200, height: 200, borderRadius: "50%", background: `radial-gradient(circle, ${C.accent}1E 0%, transparent 70%)`, top: "50%", left: "50%", transform: "translate(-50%,-50%)", animation: "blobB 9s ease-in-out infinite", transition: "background 1.5s ease" }} />
        <div style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", background: `radial-gradient(circle, ${trackColor}16 0%, transparent 70%)`, top: "50%", right: "10%", transform: "translateY(-50%)", animation: "blobC 11s ease-in-out infinite", transition: "background 1.5s ease" }} />
        {/* Waveform bars — visible only while playing */}
        {isPlaying && (
          <div style={{ position: "absolute", right: 120, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 3, opacity: 0.18 }}>
            {[...Array(18)].map((_, i) => (
              <div key={i} style={{ width: 3, borderRadius: 2, background: C.accent, animation: `wave ${0.6 + (i % 5) * 0.18}s ease-in-out infinite alternate`, animationDelay: `${i * 0.07}s` }} />
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
        {currentTrack ? (
          <>
            <CoverArt bg={currentTrack.bg} imageUrl={currentTrack.imageUrl} size={48} radius={10} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTrack.title}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{currentTrack.artist}</div>
            </div>
            <button onClick={() => toggleLike(currentTrack.id)}
              style={{ width: 32, height: 32, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: isLiked ? C.accent : C.muted, flexShrink: 0 }}>
              <Heart size={15} fill={isLiked ? C.accent : "none"} />
            </button>
          </>
        ) : (
          <span style={{ fontSize: 13, color: C.muted }}>Nothing playing</span>
        )}
      </div>

      <div style={{ flex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={toggleShuffle} style={{ width: 30, height: 30, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: shuffleOn ? C.accent : C.muted }}><Shuffle size={16} /></button>
          <button onClick={playPrev} style={{ width: 30, height: 30, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text }}><SkipBack size={18} /></button>
          <button onClick={togglePlay}
            style={{ width: 40, height: 40, borderRadius: "50%", background: C.accent, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.bg }}>
            {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button onClick={playNext} style={{ width: 30, height: 30, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text }}><SkipForward size={18} /></button>
          <button onClick={cycleRepeat} style={{ width: 30, height: 30, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: repeatMode !== "off" ? C.accent : C.muted }}>
            {repeatMode === "one" ? <span style={{ fontSize: 10, fontWeight: 700, color: C.accent }}>1×</span> : <Repeat2 size={16} />}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <span style={{ fontSize: 11, color: C.muted, width: 34, textAlign: "right", flexShrink: 0 }}>{fmtSec(elapsed)}</span>
          <div
            style={{ flex: 1, height: 4, borderRadius: 2, background: C.border, cursor: "pointer", position: "relative" }}
            onClick={e => { const r = e.currentTarget.getBoundingClientRect(); handleSeek((e.clientX - r.left) / r.width); }}>
            <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: 2, background: C.accent, transition: "width .5s linear" }} />
          </div>
          <span style={{ fontSize: 11, color: C.muted, width: 34, flexShrink: 0 }}>{audioDuration > 0 ? fmtSec(audioDuration) : (currentTrack?.duration ?? "--:--")}</span>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, position: "relative" }}>
        <button onClick={toggleLyrics}
          style={{ width: 32, height: 32, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: showLyrics ? C.accent : C.muted }}>
          <Mic2 size={16} />
        </button>
        <button onClick={() => setShowVol(v => !v)}
          style={{ width: 32, height: 32, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: volume === 0 ? C.accent : C.muted }}>
          {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        {showVol && (
          <div style={{ position: "absolute", bottom: "calc(100% + 8px)", right: 0, background: C.pane, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, zIndex: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
            <Volume2 size={14} color={C.muted} />
            <input type="range" min={0} max={1} step={0.01} value={volume}
              onChange={e => setVolume(parseFloat(e.target.value))}
              style={{ width: 100, accentColor: C.accent }} />
            <span style={{ fontSize: 11, color: C.muted, minWidth: 30 }}>{Math.round(volume * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MobileLayout ──────────────────────────────────────────────────────────────
function MobileLayout() {
  const { C, screen, navigate, currentTrack, isPlaying, togglePlay, progress,
    showLyrics, toggleLyrics, lyrics, plainLyrics, lyricsLoading, elapsed,
    playNext, playPrev } = useApp();
  const [lyricsOpen, setLyricsOpen] = useState(false);

  const TABS = [
    { id: "home",     label: "Home",     Icon: Home },
    { id: "search",   label: "Search",   Icon: Search },
    { id: "discover", label: "Discover", Icon: Compass },
    { id: "library",  label: "Library",  Icon: Library },
  ] as const;

  const activeTab = (["home", "search", "discover", "library"] as const).find(id => id === screen.id) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg, overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <ErrorBoundary colors={C} compact onReset={() => navigate({ id: "home" })}>
          <ScreenView s={screen} />
        </ErrorBoundary>
      </div>

      {currentTrack && (
        <div
          style={{ margin: "0 8px 6px", background: C.pane, borderRadius: 16, padding: "10px 12px 14px", position: "relative", cursor: "pointer", border: `1px solid ${C.border}`, flexShrink: 0 }}
          onClick={() => setLyricsOpen(true)}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CoverArt bg={currentTrack.bg} imageUrl={currentTrack.imageUrl} size={44} radius={10} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTrack.title}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{currentTrack.artist}</div>
            </div>
            <button onClick={e => { e.stopPropagation(); toggleLyrics(); }}
              style={{ width: 40, height: 40, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: showLyrics ? C.accent : C.muted }}>
              <Mic2 size={18} />
            </button>
            <button onClick={e => { e.stopPropagation(); togglePlay(); }}
              style={{ width: 40, height: 40, borderRadius: "50%", background: C.accent, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.bg }}>
              {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
          </div>
          <div style={{ position: "absolute", left: 12, right: 12, bottom: 5, height: 2, background: C.border, borderRadius: 1 }}>
            <div style={{ width: `${progress * 100}%`, height: "100%", background: C.accent, borderRadius: 1, transition: "width .5s linear" }} />
          </div>
        </div>
      )}

      <nav style={{ display: "flex", background: C.pane, borderTop: `1px solid ${C.border}`, paddingBottom: "env(safe-area-inset-bottom, 8px)", flexShrink: 0 }}>
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => navigate({ id } as Screen)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 0 6px", background: "none", border: "none", cursor: "pointer", color: activeTab === id ? C.accent : C.muted, fontSize: 11, fontWeight: 500 }}>
            <Icon size={22} />
            {label}
          </button>
        ))}
      </nav>

      {lyricsOpen && currentTrack && (
        <div style={{ position: "absolute", inset: 0, background: C.bg, zIndex: 100, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 20px 0", flexShrink: 0 }}>
            <button onClick={() => setLyricsOpen(false)}
              style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text }}>
              <ChevronLeft size={20} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{currentTrack.title}</div>
              <div style={{ fontSize: 13, color: C.muted }}>{currentTrack.artist}</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", padding: "20px 40px" }}>
            <div style={{ width: 180, height: 180, borderRadius: 18, background: currentTrack.bg, overflow: "hidden", boxShadow: `0 16px 48px ${currentTrack.bg}88` }}>
              {currentTrack.imageUrl && <img src={currentTrack.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 8px", scrollbarWidth: "none" }}>
            <LyricsPanel lyrics={lyrics} plain={plainLyrics} loading={lyricsLoading} elapsed={elapsed} />
          </div>
          <div style={{ padding: "12px 20px 20px", borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <button onClick={playPrev} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}><SkipBack size={24} /></button>
            <button onClick={togglePlay}
              style={{ width: 56, height: 56, borderRadius: "50%", background: C.accent, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.bg }}>
              {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>
            <button onClick={playNext} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}><SkipForward size={24} /></button>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: C.border }}>
              <div style={{ width: `${progress * 100}%`, height: "100%", background: C.accent, borderRadius: 2, transition: "width .5s linear" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [navStack, setNavStack] = useState<Screen[]>([{ id: "home" }]);
  const screen   = navStack[navStack.length - 1];
  const navigate = useCallback((s: Screen) => setNavStack(p => [...p, s]), []);
  const goBack   = useCallback(() => setNavStack(p => p.length > 1 ? p.slice(0, -1) : p), []);

  // Hash route guard: known deep links (#/search, #/library, …) navigate there;
  // anything else resolves to the NotFound screen instead of a silent home.
  useEffect(() => {
    const KNOWN = new Set(["home", "search", "discover", "library", "settings", "profile"]);
    const applyHash = () => {
      const id = window.location.hash.replace(/^#\/?/, "").split("/")[0].trim();
      if (!id) return;
      if (KNOWN.has(id)) navigate({ id } as Screen);
      else navigate({ id: "notfound" });
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [navigate]);

  // Playback state
  const [currentTrack, setCurrentTrack]   = useState<Track | null>(null);
  const [isPlaying, setIsPlaying]         = useState(false);
  const [progress, setProgress]           = useState(0);
  const [elapsed, setElapsed]             = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef<PlaybackHandle | null>(null);
  const ytEngineRef = useRef<YTAudioEngine | null>(null);
  const playSessionRef = useRef(0);
  const handleTrackEndRef = useRef<() => void>(() => {});
  const timerRef = useRef<number | undefined>(undefined);

  // Queue & controls
  const [queue, setQueue]             = useState<Track[]>([]);
  const [queueIdx, setQueueIdx]       = useState(-1);
  const [history, setHistory]         = useState<Track[]>([]);
  const [shuffleOn, setShuffleOn]     = useState(false);
  const [repeatMode, setRepeatMode]   = useState<RepeatMode>("off");
  const [volume, setVolumeState]      = useState(1);

  // Lyrics
  const [showLyrics, setShowLyrics]         = useState(false);
  const [lyrics, setLyrics]                 = useState<LyricLine[]>([]);
  const [plainLyrics, setPlainLyrics]       = useState("");
  const [lyricsLoading, setLyricsLoading]   = useState(false);

  // User & library
  const [user, setUser]                             = useState<User | null>(null);
  const [userLoading, setUserLoading]               = useState(true);
  const [playlists, setPlaylists]                   = useState<PlaylistItem[]>(() => getStoredPlaylists() as unknown as PlaylistItem[]);
  const [playlistsLoading, setPlaylistsLoading]     = useState(false);
  const [likedTrackIds, setLikedTrackIds]           = useState<Set<string | number>>(new Set());
  const [likedTracks, setLikedTracks]               = useState<Track[]>([]);
  const [downloadedTracks, setDownloadedTracks]     = useState<Track[]>([]);
  const [artists, setArtists]                       = useState<ArtistItem[]>([]);

  // Discovery
  const [discoveryTracks, setDiscoveryTracks]   = useState<Track[]>([]);
  const [recentTracks, setRecentTracks]         = useState<Track[]>(() => getHistory() as unknown as Track[]);
  const [trendingTracks, setTrendingTracks]     = useState<Track[]>([]);
  const [newReleases, setNewReleases]           = useState<AlbumItem[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(true);

  // Social
  const [following, setFollowing] = useState<Set<string>>(new Set());

  // Modals
  const [trackOptionsTrack, setTrackOptionsTrack] = useState<Track | null>(null);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);

  // Settings
  const [theme, setTheme]                               = useState("dark");
  const [accent, setAccent]                             = useState(() => getUserProfile()?.accentColor ?? "#E8354D");
  const [audioQuality, setAudioQuality]                 = useState(() => getUserProfile()?.audioQuality ?? "high");
  const [normalizeVolume, setNormalizeVolume]           = useState(true);
  const [autoplay, setAutoplay]                         = useState(true);
  const [crossfade, setCrossfade]                       = useState(false);
  const [notifNewReleases, setNotifNewReleases]         = useState(true);
  const [notifRecommendations, setNotifRecommendations] = useState(true);
  const [notifFollowers, setNotifFollowers]             = useState(false);
  const [shareListening, setShareListening]             = useState(true);
  const [shareData, setShareData]                       = useState(false);

  const C = useMemo(() => makeColors(theme, accent), [theme, accent]);

  // ── Onboarding ────────────────────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem("vibra_onboarded");
  });

  const handleOnboardingComplete = useCallback(async (data: OnboardingData) => {
    localStorage.setItem("vibra_onboarded", "true");
    setShowOnboarding(false);
    // POST /auth/register with all preferences
    const result = await api<User>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (result) {
      setUser(result);
      updateUserProfile({
        name: result.name,
        username: result.username,
        initials: result.initials,
        email: result.email,
        avatarUrl: result.avatarUrl,
        subscription: result.subscription === "premium" ? "premium" : "free",
      });
    } else if (data.name) {
      // Optimistic local user until backend is connected
      const local: User = {
        id: "local",
        name: data.name,
        email: data.email,
        username: data.email.split("@")[0],
        initials: data.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2),
        subscription: "free",
      };
      setUser(local);
      updateUserProfile({
        name: local.name,
        username: local.username,
        initials: local.initials,
        email: local.email,
        subscription: "free",
      });
    }
    if (data.likedTrackIds.length > 0) {
      setLikedTrackIds(new Set(data.likedTrackIds));
    }
    setUserLoading(false);
  }, []);

  // ── Bootstrap user ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (showOnboarding) { setUserLoading(false); return; }
    api<User>("/auth/me").then(u => {
      if (u) {
        setUser(u);
        updateUserProfile({
          name: u.name,
          username: u.username,
          initials: u.initials,
          email: u.email,
          avatarUrl: u.avatarUrl,
          subscription: u.subscription === "premium" ? "premium" : "free",
        });
      } else {
        // Offline / no session: fall back to the persisted local profile.
        const p = getUserProfile();
        if (p && p.name) {
          setUser({
            id: "local",
            name: p.name,
            email: p.email,
            username: p.username,
            initials: p.initials,
            avatarUrl: p.avatarUrl,
            subscription: p.subscription,
          });
        }
      }
      setUserLoading(false);
    });
  }, [showOnboarding]);

  // ── Bootstrap library ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!API_BASE) { setPlaylistsLoading(false); return; }
    setPlaylistsLoading(true);
    Promise.all([
      api<any[]>("/library/playlists"),
      api<{ ids: string[] }>("/library/liked"),
      api<any[]>("/library/recent"),
      api<any[]>("/library/artists"),
      api<any[]>("/library/downloaded"),
      // GET /users/me/following → { ids: string[] }
      api<{ ids: string[] }>("/users/me/following"),
    ]).then(([pls, liked, recent, arts, dl, followingData]) => {
      if (pls) {
        // Backend playlists first, then locally created ones (deduped by id).
        const backendPls = pls.map(mapAPIPlaylist);
        const stored = getStoredPlaylists() as unknown as PlaylistItem[];
        setPlaylists([
          ...backendPls,
          ...stored.filter(s => !backendPls.some(b => b.id === s.id)),
        ]);
      }
      if (liked)         setLikedTrackIds(new Set(liked.ids));
      if (recent)        setRecentTracks(mergeHistory(recent.map(mapAPITrack) as unknown as StoredTrack[]) as unknown as Track[]);
      if (arts)          setArtists(arts.map(mapAPIArtist));
      if (dl)            setDownloadedTracks(dl.map(mapAPITrack));
      if (followingData) setFollowing(new Set(followingData.ids));
      setPlaylistsLoading(false);
    });
  }, []);

  // ── Fetch discovery from the live audio engine ───────────────────────────────
  useEffect(() => {
    setDiscoveryLoading(true);
    let cancelled = false;
    Promise.all([
      searchTracks("trending music", 20),
      searchTracks("new releases", 12),
      api<any[]>("/discover/new-releases"),
    ]).then(([trendingList, freshList, backendNR]) => {
      if (cancelled) return;
      if (trendingList.length > 0) {
        const all = trendingList.map((t, i) => fromApiTrack(t, i));
        setDiscoveryTracks(all.slice(0, 8));
        setTrendingTracks(all);
        setRecentTracks(prev => prev.length > 0 ? prev : all.slice(8, 12));
        if (!backendNR) {
          setNewReleases(all.slice(0, 6).map((t, i) => ({
            id: String(t.id), title: t.title, artist: t.artist,
            year: String(new Date().getFullYear()), bg: t.bg, imageUrl: t.imageUrl, trackCount: 1,
          })));
        }
      }
      if (freshList.length > 0 && !backendNR) {
        setNewReleases(prev => prev.length > 0 ? prev : freshList.slice(0, 6).map((t, i) => ({
          id: String(t.id), title: t.title, artist: t.artist,
          year: String(new Date().getFullYear()), bg: t.bg, imageUrl: t.imageUrl, trackCount: 1,
        })));
      }
      if (backendNR) setNewReleases(backendNR.map(mapAPIAlbum));
      setDiscoveryLoading(false);
    }).catch(() => { if (!cancelled) setDiscoveryLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Liked tracks list ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (likedTrackIds.size === 0) return;
    setLikedTracks(discoveryTracks.filter(t => likedTrackIds.has(t.id)));
  }, [likedTrackIds, discoveryTracks]);

  // ── Volume sync ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // ── Playback timer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = window.setInterval(() => {
        const a = audioRef.current;
        if (a?.duration) {
          setElapsed(a.currentTime);
          setProgress(a.currentTime / a.duration);
          setAudioDuration(a.duration);
        } else {
          setElapsed(e => e + 0.5);
          setProgress(p => Math.min(p + 0.002, 1));
        }
      }, 500);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isPlaying]);

  // ── Lyrics ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentTrack) return;
    let cancelled = false;
    setLyrics([]); setPlainLyrics(""); setLyricsLoading(true);
    fetchLyricsFromApi(currentTrack.title, currentTrack.artist).then(r => {
      if (cancelled) return;
      setLyrics(r.synced); setPlainLyrics(r.plain); setLyricsLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentTrack?.id]);

  // ── Playback engines ─────────────────────────────────────────────────────────
  /** Engine-level failures: only report them when the failing engine is the live one. */
  const handleEngineFailure = useCallback((failure: PlaybackFailure) => {
    if (audioRef.current !== ytEngineRef.current) return;
    setIsPlaying(false);
    toast(describePlaybackFailure(failure));
  }, []);

  /**
   * Starts a track on the best available engine:
   *   1. direct stream URL via <audio> (used whenever the backend serves bytes);
   *   2. hidden YouTube IFrame fallback the moment the stream errors out.
   * Play-state flips to true immediately and only reverts — with a calm toast —
   * once every engine has genuinely failed. No silent "playing".
   */
  const beginPlayback = useCallback((t: Track) => {
    const session = ++playSessionRef.current;
    setIsPlaying(true);

    const fail = (failure: PlaybackFailure) => {
      if (playSessionRef.current !== session) return;
      setIsPlaying(false);
      toast(describePlaybackFailure(failure));
    };

    const startYouTube = async () => {
      const videoId = t.videoId ?? (typeof t.id === "string" && t.id ? t.id : undefined);
      if (!videoId) {
        fail({ kind: "track", message: "This track has no playable audio source." });
        return;
      }
      try {
        const engine = ytEngineRef.current ?? await YTAudioEngine.create({
          onEnded: () => {
            if (audioRef.current === ytEngineRef.current) handleTrackEndRef.current();
          },
          onFailure: handleEngineFailure,
        });
        if (playSessionRef.current !== session) return;
        ytEngineRef.current = engine;
        engine.volume = volume;
        audioRef.current?.pause();
        audioRef.current = engine;
        await engine.load(videoId, volume);
        if (playSessionRef.current !== session) { engine.pause(); return; }
        setIsPlaying(true);
      } catch (err) {
        fail(failureFromError(err));
      }
    };

    audioRef.current?.pause();

    const url = audioUrlFor(t);
    if (!url) { void startYouTube(); return; }

    const a = new Audio(url);
    a.volume = volume;
    let streamFailed = false;
    let everPlayed = false;
    const fallBackToYouTube = () => {
      if (streamFailed) return;
      streamFailed = true;
      clearTimeout(watchdog);
      a.pause();
      if (playSessionRef.current === session) void startYouTube();
    };
    a.addEventListener("error", fallBackToYouTube);
    a.addEventListener("playing", () => {
      everPlayed = true;
      clearTimeout(watchdog);
      if (streamFailed || playSessionRef.current !== session) return;
      setIsPlaying(true);
    });
    a.addEventListener("ended", () => {
      if (playSessionRef.current === session) handleTrackEndRef.current();
    });
    audioRef.current = a;
    // Watchdog: if the stream neither errors nor actually plays within 5s
    // (the backend sometimes answers 200 with an empty body), switch engines.
    const watchdog = window.setTimeout(() => {
      if (!streamFailed && !everPlayed) fallBackToYouTube();
    }, 5000);
    a.play().catch((err: unknown) => {
      const failure = failureFromError(err);
      if (failure.kind === "blocked") { fail(failure); return; }
      fallBackToYouTube();
    });
  }, [volume, handleEngineFailure]);

  const handleTrackEnd = useCallback(() => {
    if (repeatMode === "one") {
      setProgress(0); setElapsed(0);
      const a = audioRef.current;
      if (a) { a.currentTime = 0; a.play().catch(() => {}); }
      return;
    }
    if (queue.length === 0) { setIsPlaying(false); return; }
    const next = shuffleOn
      ? Math.floor(Math.random() * queue.length)
      : queueIdx + 1 < queue.length ? queueIdx + 1 : repeatMode === "all" ? 0 : -1;
    if (next < 0) { setIsPlaying(false); return; }
    setQueueIdx(next);
    const t = queue[next];
    setCurrentTrack(t);
    setProgress(0); setElapsed(0);
    beginPlayback(t);
  }, [queue, queueIdx, shuffleOn, repeatMode, beginPlayback]);
  handleTrackEndRef.current = handleTrackEnd;

  // ── playTrack ─────────────────────────────────────────────────────────────────
    const playTrack = useCallback((t: Track, newQueue?: Track[]) => {
    if (currentTrack && currentTrack.id !== t.id) {
      setHistory(h => [...h.slice(-19), currentTrack]);
    }
    // Persist to vibra_history (deduped, capped at 50) and refresh the rail.
    setRecentTracks(addHistoryTrack(t as StoredTrack) as unknown as Track[]);
    setCurrentTrack(t);
    setProgress(0); setElapsed(0);
    if (newQueue) {
      setQueue(newQueue);
      setQueueIdx(newQueue.findIndex(x => x.id === t.id));
    }
    beginPlayback(t);
  }, [currentTrack, beginPlayback]);

  // ── playNext ──────────────────────────────────────────────────────────────────
  const playNext = useCallback(() => {
    if (queue.length === 0) return;
    const next = shuffleOn
      ? Math.floor(Math.random() * queue.length)
      : Math.min(queueIdx + 1, queue.length - 1);
    const t = queue[next];
    if (!t || t.id === currentTrack?.id && next === queueIdx) return;
    setHistory(h => currentTrack ? [...h.slice(-19), currentTrack] : h);
    setQueueIdx(next);
    setCurrentTrack(t);
    setProgress(0); setElapsed(0);
    beginPlayback(t);
  }, [queue, queueIdx, shuffleOn, currentTrack, beginPlayback]);

  // ── playPrev ──────────────────────────────────────────────────────────────────
  const playPrev = useCallback(() => {
    if (elapsed > 3) {
      setProgress(0); setElapsed(0);
      if (audioRef.current) audioRef.current.currentTime = 0;
      return;
    }
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory(h => h.slice(0, -1));
      setCurrentTrack(prev);
      setProgress(0); setElapsed(0);
      beginPlayback(prev);
    }
  }, [elapsed, history, beginPlayback]);

  // ── togglePlay ────────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const current = audioRef.current;
    if (!current) {
      if (currentTrack) beginPlayback(currentTrack);
      return;
    }
    if (isPlaying) {
      playSessionRef.current++; // cancel any in-flight engine hand-off
      current.pause();
      setIsPlaying(false);
    } else {
      current.play()
        .then(() => { if (audioRef.current === current) setIsPlaying(true); })
        .catch((err: unknown) => {
          if (audioRef.current !== current) return;
          setIsPlaying(false);
          toast(describePlaybackFailure(failureFromError(err)));
        });
    }
  }, [isPlaying, currentTrack, beginPlayback]);

  // ── handleSeek ────────────────────────────────────────────────────────────────
  const handleSeek = useCallback((pct: number) => {
    const c = Math.max(0, Math.min(1, pct));
    setProgress(c);
    if (audioRef.current?.duration) audioRef.current.currentTime = audioRef.current.duration * c;
    setElapsed(audioDuration * c);
  }, [audioDuration]);

  // ── toggleLike ────────────────────────────────────────────────────────────────
  const toggleLike = useCallback((id: string | number) => {
    setLikedTrackIds(prev => {
      const n = new Set(prev);
      const wasLiked = n.has(id);
      wasLiked ? n.delete(id) : n.add(id);
      api(`/library/liked/${id}`, { method: "POST", body: JSON.stringify({ liked: !wasLiked }) });
      return n;
    });
  }, []);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    if (audioRef.current) audioRef.current.volume = v;
  }, []);

  // ── toggleFollow ──────────────────────────────────────────────────────────────
  const toggleFollow = useCallback((id: string) => {
    setFollowing(prev => {
      const n = new Set(prev);
      const wasFollowing = n.has(id);
      wasFollowing ? n.delete(id) : n.add(id);
      // POST /users/:id/follow — body { follow: bool }
      api(`/users/${id}/follow`, { method: "POST", body: JSON.stringify({ follow: !wasFollowing }) });
      return n;
    });
  }, []);

  // ── refreshDownloads ──────────────────────────────────────────────────────────
  const refreshDownloads = useCallback(async () => {
    const dl = await api<any[]>("/library/downloaded");
    if (dl) setDownloadedTracks(dl.map(mapAPITrack));
  }, []);

  // ── Persistent store actions (services/store.ts) ─────────────────────────────
  /** Appends a playlist to the sidebar immediately (local or backend-made). */
  const addPlaylist = useCallback((p: PlaylistItem) => {
    setPlaylists(prev => (prev.some(x => x.id === p.id) ? prev : [p, ...prev]));
  }, []);

  /** Persists a track into a playlist (vibra_playlists) and updates state. */
  const addTrackToPlaylist = useCallback((playlistId: string, track: Track) => {
    addTrackToStoredPlaylist(playlistId, track as unknown as StoredTrack);
    setPlaylists(prev => prev.map(pl => {
      if (pl.id !== playlistId) return pl;
      if (pl.tracks.some(t => String(t.id) === String(track.id))) return pl;
      return { ...pl, tracks: [track, ...pl.tracks], trackCount: pl.trackCount + 1 };
    }));
  }, []);

  /** Writes profile edits to vibra_user_profile and mirrors them into UI state. */
  const updateProfile = useCallback((
    patch: Partial<{ name: string; username: string; initials: string; email: string; avatarUrl: string; subscription: "premium" | "free" }>,
  ) => {
    updateUserProfile(patch);
    setUser(prev => {
      if (prev) return { ...prev, ...patch };
      if (!patch.name) return prev;
      return {
        id: "local",
        name: patch.name,
        email: patch.email ?? "",
        username: patch.username ?? "",
        initials: patch.initials ?? patch.name.slice(0, 2).toUpperCase(),
        avatarUrl: patch.avatarUrl,
        subscription: patch.subscription ?? "free",
      };
    });
  }, []);

  // Quiet background pings — the banner only appears after 3 consecutive
  // failures or an active request timeout (see services/safeFetch.ts).
  useEffect(() => startConnectionMonitor(API_BASE), []);

  const ctxValue: AppCtxType = {
    C, navigate, goBack, canGoBack: navStack.length > 1, screen,
    currentTrack, isPlaying, progress, elapsed, audioDuration,
    playTrack, togglePlay, playNext, playPrev, handleSeek,
    queue, shuffleOn, toggleShuffle: () => setShuffleOn(s => !s),
    repeatMode, cycleRepeat: () => setRepeatMode(m => m === "off" ? "one" : m === "one" ? "all" : "off"),
    volume, setVolume,
    showLyrics, toggleLyrics: () => setShowLyrics(s => !s), lyrics, plainLyrics, lyricsLoading,
    user, userLoading,
    playlists, playlistsLoading,
    likedTrackIds, toggleLike,
    discoveryTracks, recentTracks, trendingTracks, newReleases,
    artists, likedTracks, downloadedTracks, refreshDownloads,
    discoveryLoading,
    theme, setTheme, accent, setAccent,
    audioQuality, setAudioQuality,
    normalizeVolume, setNormalizeVolume,
    autoplay, setAutoplay, crossfade, setCrossfade,
    notifNewReleases, setNotifNewReleases,
    notifRecommendations, setNotifRecommendations,
    notifFollowers, setNotifFollowers,
    shareListening, setShareListening,
    shareData, setShareData,
    following, toggleFollow,
    openTrackOptions: setTrackOptionsTrack,
    openCreatePlaylist: () => setCreatePlaylistOpen(true),
    addPlaylist,
    addTrackToPlaylist,
    updateProfile,
  };

  if (showOnboarding) {
    return (
      <UiThemeContext.Provider value={C}>
        <ErrorBoundary colors={C}>
          <OnboardingFlow onComplete={handleOnboardingComplete} />
        </ErrorBoundary>
      </UiThemeContext.Provider>
    );
  }

  return (
    <UiThemeContext.Provider value={C}>
    <ErrorBoundary colors={C} title="Vibra hit an unexpected signal">
    <AppCtx.Provider value={ctxValue}>
      <ConnectionBanner />
      <Toaster position="top-center" theme={theme === "light" ? "light" : "dark"} />

      {/* Global animation keyframes */}
      <style>{`
        @keyframes blobA { 0%,100%{transform:translate(-50%,-50%) scale(1)} 33%{transform:translate(-44%,-58%) scale(1.12)} 66%{transform:translate(-56%,-44%) scale(0.92)} }
        @keyframes blobB { 0%,100%{transform:translate(-50%,-50%) scale(1)} 40%{transform:translate(-44%,-56%) scale(1.08)} 70%{transform:translate(-56%,-44%) scale(0.94)} }
        @keyframes blobC { 0%,100%{transform:translateY(-50%) scale(1)} 50%{transform:translateY(-44%) scale(1.1)} }
        @keyframes wave  { from{height:6px} to{height:28px} }
        @keyframes slideUp { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes scaleIn { from{transform:scale(.94);opacity:0} to{transform:scale(1);opacity:1} }
        @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
      `}</style>

      {/* Global modals */}
      {trackOptionsTrack && <TrackOptionsSheet track={trackOptionsTrack} onClose={() => setTrackOptionsTrack(null)} />}
      {createPlaylistOpen && <CreatePlaylistModal onClose={() => setCreatePlaylistOpen(false)} />}

      {/* Desktop */}
      <div className="hidden md:grid"
        style={{ height: "100dvh", gridTemplateColumns: "300px minmax(0,1fr) 320px", gridTemplateRows: "minmax(0,1fr) 88px", gap: 8, padding: 8, background: C.bg }}>
        <div style={{ gridRow: "1/2", gridColumn: "1/2", borderRadius: 14, overflow: "hidden" }}>
          <LeftSidebar />
        </div>
        <div style={{ gridRow: "1/2", gridColumn: "2/3", borderRadius: 14, overflow: "hidden", background: C.pane, display: "flex", flexDirection: "column" }}>
          <ErrorBoundary colors={C} compact onReset={() => navigate({ id: "home" })}>
            <ScreenView s={screen} />
          </ErrorBoundary>
        </div>
        <div style={{ gridRow: "1/2", gridColumn: "3/4", borderRadius: 14, overflow: "hidden" }}>
          <ErrorBoundary colors={C} compact onReset={() => navigate({ id: "home" })}>
            <RightPanel />
          </ErrorBoundary>
        </div>
        <div style={{ gridRow: "2/3", gridColumn: "1/4", borderRadius: 14, overflow: "hidden" }}>
          <PlayerBar />
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden" style={{ height: "100dvh", position: "relative", overflow: "hidden", background: C.bg }}>
        <MobileLayout />
      </div>
    </AppCtx.Provider>
    </ErrorBoundary>
    </UiThemeContext.Provider>
  );
}
