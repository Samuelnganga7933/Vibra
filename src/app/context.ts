/**
 * context.ts — shared types, colour tokens and the app context.
 *
 * Extracted from App.tsx so screens and shell components (player bar, right
 * panel, full-screen player) can import them without a module cycle.
 */

import { createContext, useContext } from "react";
import { type ApiTrack, getStreamUrl } from "./services/api";
import type { HomeShelf, HomeItem } from "./services/home";
import type { OutputDevice } from "./services/devices";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface User {
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
    weeklyMinutes: string;
    tracksLiked: number;
    topArtists: number;
  };
}

export interface Track {
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

export interface PlaylistItem {
  id: string;
  name: string;
  description?: string;
  bg: string;
  imageUrl?: string;
  trackCount: number;
  creator?: string;
  tracks: Track[];
}

export interface AlbumItem {
  id: string;
  title: string;
  artist: string;
  year: string;
  bg: string;
  imageUrl?: string;
  trackCount: number;
}

export interface ArtistItem {
  id: string;
  name: string;
  genre: string;
  bg: string;
  imageUrl?: string;
  followers?: string;
}

export type LibTab = "playlists" | "liked" | "albums" | "artists" | "downloaded";

export type Screen =
  | { id: "home" }
  | { id: "search"; q?: string }
  | { id: "discover" }
  | { id: "library"; tab?: LibTab }
  | { id: "playlist"; item: PlaylistItem }
  | { id: "settings" }
  | { id: "profile" }
  | { id: "auth"; mode: "login" | "signup" }
  | { id: "notfound" };

export type RepeatMode = "off" | "one" | "all";

export interface Colors {
  bg: string; pane: string; surf: string; surfDark: string;
  accent: string; text: string; muted: string; dim: string; border: string;
}

/** The right panel's open tab — `null` means the panel is closed. */
export type PanelTab = "nowplaying" | "queue";

/** Failure surfaced in the main area (shell, sidebar and bar stay intact). */
export interface AppError {
  variant: "error" | "offline" | "notfound";
  code: string;
  message: string;
  requestId: string;
  at: number;
  retry?: () => void;
}

/**
 * The single derivation every conditional render reads from — see the
 * contextual-UI table in the spec. Nothing disabled or unusable ever renders.
 */
export interface UiState {
  /** The bottom bar exists: the user has started playback this session. */
  hasPlayback: boolean;
  /** Shuffle/repeat/next/prev and the queue icon: 2+ tracks in the queue. */
  hasQueue: boolean;
  /** Jump back in / Recently played: the user has play history. */
  hasHistory: boolean;
  /** Output chip: something is actually playing right now. */
  isPlaying: boolean;
  deviceCount: number;
  signedIn: boolean;
}

export interface AppCtxType {
  C: Colors;
  navigate: (s: Screen) => void;
  goBack: () => void;
  canGoBack: boolean;
  screen: Screen;

  // Playback — the bar owns every transport control.
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  elapsed: number;
  audioDuration: number;
  playTrack: (t: Track, newQueue?: Track[], sourceShelfId?: string) => void;
  togglePlay: () => void;
  playNext: () => void;
  playPrev: () => void;
  handleSeek: (p: number) => void;
  queue: Track[];
  /** Appends to the end of the queue (starts playback if nothing is playing). */
  addToQueue: (t: Track) => void;
  /** Appends a whole list to Up Next in one update (starts playback when idle). */
  queueAll: (items: Track[]) => void;
  /** Inserts directly after the current track (starts playback if idle). */
  playNextInQueue: (t: Track) => void;
  /** Moves a queue entry to a new index, keeping the playing track in sync. */
  moveQueueItem: (from: number, to: number) => void;
  /** Removes a queue entry by index; advances playback if it was the playing track. */
  removeFromQueue: (index: number) => void;
  /** Opens the create-playlist modal; when given, the track is added once created. */
  openCreatePlaylist: (track?: Track) => void;
  shuffleOn: boolean;
  toggleShuffle: () => void;
  repeatMode: RepeatMode;
  cycleRepeat: () => void;
  volume: number;
  setVolume: (v: number) => void;

  // Contextual UI
  uiState: UiState;
  panelTab: PanelTab | null;
  openPanel: (tab: PanelTab) => void;
  togglePanel: (tab: PanelTab) => void;
  playerPageOpen: boolean;
  setPlayerPageOpen: (open: boolean) => void;
  errorState: AppError | null;
  showError: (error: AppError) => void;
  clearError: () => void;

  // User & library
  user: User | null;
  userLoading: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  register: (name: string, email: string, password: string) => Promise<string | null>;
  logout: (reason?: "idle") => Promise<void>;
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
  refreshDownloads: () => Promise<void>;
  discoveryLoading: boolean;

  // Server-driven home feed + feedback
  shelves: HomeShelf[];
  homeLoading: boolean;
  refreshHome: () => void;
  hiddenIds: Record<string, boolean>;
  /** Upcoming matches from recently-played artists — the queue's continuation. */
  vibePool: Track[];
  /** Optimistic removal + POST /api/events (not_interested). */
  hideItem: (opts: { id: string; kind: "track" | "artist"; artist?: string; shelfId?: string; title?: string }) => void;

  // Output devices
  outputDevice: OutputDevice;
  devices: OutputDevice[];
  refreshDevices: (requestLabels?: boolean) => void;
  selectOutput: (deviceId: string) => void;

  // Settings
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
  historyPaused: boolean; setHistoryPaused: (v: boolean) => void;
  resetRecommendations: () => Promise<void>;

  // Social
  following: Set<string>;
  toggleFollow: (id: string) => void;

  // Modals
  openTrackOptions: (t: Track) => void;
  addPlaylist: (p: PlaylistItem) => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  reorderPlaylist: (playlistId: string, from: number, to: number) => void;
  updateProfile: (patch: Partial<{ name: string; username: string; initials: string; email: string; avatarUrl: string; subscription: "premium" | "free"; accentColor: string; audioQuality: string }>) => void;
}

// ─── Colour themes ─────────────────────────────────────────────────────────────
// Spec tokens (src/styles/theme.css): --bg --panel --raised --hover --border
// --text --muted --dim --accent --accent2 --online.
export const BASE_COLORS: Record<string, Omit<Colors, "accent">> = {
  dark:  { bg: "#0b0a10", pane: "#14131c", surf: "#1f1e2b", surfDark: "#1d1c29", text: "#f4f3f8", muted: "#a9a7bd", dim: "#8886a0", border: "#2c2a3e" },
  oled:  { bg: "#000000", pane: "#0c0c0c", surf: "#161616", surfDark: "#0f0f0f", text: "#f5f2ff", muted: "#9896b2", dim: "#7d7b94", border: "#1c1c1c" },
  light: { bg: "#f2f0fa", pane: "#ffffff", surf: "#e8e5f4", surfDark: "#eeeaf8", text: "#1a1628", muted: "#5e5a7a", dim: "#7a7594", border: "#ddd8f0" },
};

export const makeColors = (theme: string, acc: string): Colors =>
  ({ ...(BASE_COLORS[theme] ?? BASE_COLORS.dark), accent: acc });

export const ACCENT_OPTIONS = [
  { label: "Spotify green", value: "#1ED760" },
  { label: "Violet",  value: "#A78BFA" },
  { label: "Red",     value: "#E8334F" },
  { label: "Emerald", value: "#34C759" },
  { label: "Blue",    value: "#3B82F6" },
  { label: "Orange",  value: "#F97316" },
  { label: "Cyan",    value: "#06B6D4" },
];

export const BROWSE_CATEGORIES = [
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

export const BG_PALETTE = ["#2C4A5E", "#4A3280", "#8A3A1F", "#1F4E5F", "#9B3B63", "#2F5A3A", "#7A2438", "#B0587A", "#3A3A3A", "#3A2F55", "#5A3A10", "#2A2A3A"];

// ─── Context ──────────────────────────────────────────────────────────────────
export const AppCtx = createContext<AppCtxType>(null!);
export const useApp = () => useContext(AppCtx);

// ─── Mappers ──────────────────────────────────────────────────────────────────
export const fmtSec = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

/** Long-form duration — "73m" under an hour, "1h 13m" after. */
export const fmtDur = (totalSec: number): string => {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return "0m";
  const totalMin = Math.round(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

/**
 * Strips noisy catalogue suffixes — "(Official Video)", "(Official Audio)",
 * "[HQ]", " - Topic" — so result rows read like titles.
 */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[\(\[][^)\]]*(official|lyric|lyrics|audio|video|hd|hq|4k|visualizer|remastered|explicit|clean|version|feat)[^)\]]*[\)\]]\s*/gi, " ")
    .replace(/\s*-\s*Topic\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim() || title;
}

/** Resolves the HTML5 audio URL for a track — never throws, may be undefined. */
export function audioUrlFor(t: Track | null | undefined): string | undefined {
  if (!t) return undefined;
  if (t.previewUrl) return t.previewUrl;
  if (t.streamUrl) return t.streamUrl;
  const videoId = t.videoId ?? (typeof t.id === "string" ? t.id : undefined);
  return videoId ? getStreamUrl(videoId) : undefined;
}

export const fromApiTrack = (t: ApiTrack, i = 0): Track => ({
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
export const mapAPITrack = (t: any): Track => ({
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

export const mapAPIPlaylist = (p: any): PlaylistItem => ({
  id: String(p.id),
  name: p.name ?? p.title,
  description: p.description,
  bg: p.coverColor ?? p.bg ?? BG_PALETTE[0],
  imageUrl: p.coverUrl ?? p.imageUrl,
  trackCount: p.trackCount ?? p.tracks?.length ?? 0,
  creator: p.creator?.name ?? p.creatorName ?? p.owner?.name,
  tracks: (p.tracks ?? []).map(mapAPITrack),
});

export const mapAPIAlbum = (a: any): AlbumItem => ({
  id: String(a.id),
  title: a.title ?? a.name,
  artist: a.artist ?? a.artistName,
  year: String(a.year ?? a.releaseYear ?? ""),
  bg: a.coverColor ?? a.bg ?? BG_PALETTE[0],
  imageUrl: a.coverUrl ?? a.imageUrl,
  trackCount: a.trackCount ?? a.tracks?.length ?? 0,
});

export const mapAPIArtist = (a: any): ArtistItem => ({
  id: String(a.id),
  name: a.name,
  genre: a.genre ?? a.genres?.[0] ?? "",
  bg: a.coverColor ?? a.bg ?? BG_PALETTE[0],
  imageUrl: a.imageUrl ?? a.avatarUrl,
  followers: a.followers ? String(a.followers) : undefined,
});

/** Converts a BFF home item into the playable Track shape (same id space). */
export const toTrackItem = (h: HomeItem): Track => ({
  id: h.id,
  videoId: h.videoId ?? h.id,
  title: h.title,
  artist: h.artist ?? "Unknown",
  durationSec: h.durationSec,
  duration: h.durationSec !== undefined ? fmtSec(h.durationSec) : undefined,
  bg: h.bg ?? BG_PALETTE[0],
  imageUrl: h.imageUrl,
});
