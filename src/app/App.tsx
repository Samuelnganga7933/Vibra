import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from "react";
import {
  Home, Search, Compass, Library, Heart,
  Shuffle, SkipBack, SkipForward, Repeat2, Repeat1, Volume2, VolumeX,
  Play, Pause, Settings, ChevronLeft, ChevronRight, ChevronDown,
  MoreHorizontal, Plus, Download, Check, X, LogOut, Music2,
  Eye, EyeOff, ArrowRight, Sparkles, HardDrive, RefreshCw,
  ListMusic,
  AlertCircle, Copy, ListPlus, MinusCircle, PauseCircle, RotateCcw,
  HelpCircle, ChevronUp, Maximize2, CalendarDays, Mic, ListStart,
  Moon, Sun, Contrast, WifiOff, Lock,
  Share2, Link2, MessageCircle, Send, Mail,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { ErrorBoundary, installRuntimeGuards } from "./components/ErrorBoundary";
import { getConnectionStatus, subscribeConnection, startConnectionMonitor, type ConnectionStatus } from "./services/safeFetch";
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
  clearUserProfile,
  getHistory,
  addHistoryTrack,
  mergeHistory,
  getPlaylists as getStoredPlaylists,
  savePlaylist,
  createCustomPlaylist,
  addTrackToPlaylist as addTrackToStoredPlaylist,
  reorderPlaylistTracks as reorderStoredPlaylistTracks,
  clearHistory as clearStoredHistory,
  getRecentSearches,
  pushRecentSearch,
  type StoredPlaylist,
  type StoredTrack,
} from "./services/store";
import {
  searchTracks,
  toApiTracks,
  fetchLyrics as fetchLyricsFromApi,
} from "./services/api";
import { bffJson, BFF_BASE, isSignedIn, onSessionExpired } from "./services/bff";
import { sendEvent, isHistoryPaused, setHistoryPaused as persistHistoryPaused } from "./services/events";
import { sanitizeMusicItems } from "./services/smartQueue";
import { fetchHome, readCachedShelves, writeCachedShelves, type HomeShelf, type HomeItem } from "./services/home";
import { localeParam, marketChartQuery, marketLabel } from "./services/locale";
import { fetchAlbums } from "./services/metadata";
import {
  listOutputDevices, refreshOutput, switchOutput, primeOutput,
  getActiveOutput, subscribeOutput, registerSinkElement,
  type OutputDevice,
} from "./services/devices";
import { loginUser, registerUser, logoutUser } from "./services/auth";
import { exchangeNeonSession, signOutNeon, clearOAuthQueryParams } from "./services/neonAuth";
import {
  useApp, AppCtx, makeColors, fmtSec, fmtDur, cleanTitle, audioUrlFor, toTrackItem,
  fromApiTrack, mapAPITrack, mapAPIPlaylist, mapAPIAlbum, mapAPIArtist,
  ACCENT_OPTIONS, BROWSE_CATEGORIES, BG_PALETTE,
  type Screen, type Track, type PlaylistItem, type AlbumItem, type ArtistItem,
  type LibTab, type Colors, type User, type RepeatMode,
  type PanelTab, type AppError, type AppCtxType, type UiState, type LyricLine,
} from "./context";
import { ImageWithFallback } from "./components/ui/ImageWithFallback";
import { UiThemeContext } from "./components/ui/ui-theme";
import { TrackCard, AlbumCard, PlaylistItemCard } from "./components/ui/cards";
import { DownloadsView } from "./components/vibra/DownloadsView";
import { CoverArt } from "./components/CoverArt";
import { PlayerPage } from "./components/player/PlayerPage";
import { LyricsPanel } from "./components/player/LyricsPanel";
import { ErrorScreen } from "./screens/ErrorScreen";
import { AuthScreen } from "./screens/AuthScreen";

// ─── Backend API helper ────────────────────────────────────────────────────────
// User-BFF endpoints (see backend/main.py): everything resolves through
// safeFetch (8s timeout, never throws) — failures return null quietly.
const api = bffJson;

// Neutralise unhandled promise rejections / global errors (idempotent).
installRuntimeGuards();

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

// ─── queueRest ────────────────────────────────────────────────────────────────
/**
 * Seeds the Up Next queue from a list the way Spotify does: the clicked track
 * first, then every track after it in that list, in order. Tracks before the
 * clicked one are not part of the queue.
 */
function queueRest<T extends { id: string | number }>(list: T[], clicked: T): T[] {
  const idx = list.findIndex(x => String(x.id) === String(clicked.id));
  return idx < 0 ? [clicked] : [clicked, ...list.slice(idx + 1)];
}

// ─── TrackRow ─────────────────────────────────────────────────────────────────
function TrackRow({ track, index, queue, showLike = false, showAlbum = false, album, sourceShelfId }: { track: Track; index?: number; queue?: Track[]; showLike?: boolean; showAlbum?: boolean; album?: string; sourceShelfId?: string }) {
  const { C, playTrack, currentTrack, isPlaying, likedTrackIds, toggleLike, openTrackOptions } = useApp();
  const isActive = currentTrack?.id === track.id;
  const isLiked  = likedTrackIds.has(track.id);
  const albumName = album ?? track.album;

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 10px", borderRadius: 10, background: isActive ? C.surf : "transparent", transition: "background .15s" }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.surf; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
    >
      <div role="button" tabIndex={0} onClick={() => playTrack(track, queue, sourceShelfId)} onKeyDown={e => e.key === "Enter" && playTrack(track, queue, sourceShelfId)}
        style={{ width: 22, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}>
        {isActive && isPlaying
          ? <Pause size={13} color={C.accent} fill={C.accent} />
          : <span style={{ fontSize: 12, color: isActive ? C.accent : C.muted, fontWeight: 600 }}>{index !== undefined ? index + 1 : <Play size={12} />}</span>}
      </div>
      <div role="button" tabIndex={0} onClick={() => playTrack(track, queue, sourceShelfId)} onKeyDown={e => e.key === "Enter" && playTrack(track, queue, sourceShelfId)}
        style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, cursor: "pointer" }}>
        <CoverArt bg={track.bg} imageUrl={track.imageUrl} size={44} radius={8} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: isActive ? C.accent : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
          <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.artist}</div>
        </div>
      </div>
      {showAlbum && (
        <div style={{ flex: "0 1 200px", minWidth: 0, fontSize: 12.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {albumName || "—"}
        </div>
      )}
      {showLike && (
        <button onClick={e => { e.stopPropagation(); toggleLike(track.id); }}
          style={{ width: 30, height: 30, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: isLiked ? C.accent : C.muted, flexShrink: 0 }}>
          <Heart size={13} fill={isLiked ? C.accent : "none"} />
        </button>
      )}
      <span style={{ fontSize: 12, color: C.muted, flexShrink: 0, minWidth: showAlbum ? 64 : 36, textAlign: "right" }}>{track.duration}</span>
      <button onClick={e => { e.stopPropagation(); openTrackOptions(track); }}
        style={{ width: 28, height: 28, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted, flexShrink: 0 }}>
        <MoreHorizontal size={13} />
      </button>
    </div>
  );
}

/** Column header for tabular tracklists (# · Title · Album · Duration). */
function TrackTableHead({ showLike = false }: { showLike?: boolean }) {
  const { C } = useApp();
  const cell: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase",
    letterSpacing: "0.06em", overflow: "hidden", textOverflow: "ellipsis",
    whiteSpace: "nowrap", flexShrink: 0,
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 10px", borderBottom: `1px solid ${C.border}`, margin: "4px 0 6px" }}>
      <span style={{ ...cell, width: 22, textAlign: "center" }}>#</span>
      <span style={{ ...cell, flex: 1, minWidth: 0 }}>Title</span>
      <span style={{ ...cell, flex: "0 1 200px", minWidth: 0 }}>Album</span>
      {showLike && <span style={{ width: 30, flexShrink: 0 }} />}
      <span style={{ ...cell, width: 64, textAlign: "right" }}>Duration</span>
      <span style={{ width: 28, flexShrink: 0 }} />
    </div>
  );
}

/**
 * Album names for table rows, keyed by track id. The engine carries no album
 * field, so this asks the BFF's cached enrichment once per row set; misses
 * resolve to an em dash in the cell.
 */
function useAlbums(rows: Track[]): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = rows.map(r => String(r.id)).join("|");
  useEffect(() => {
    const missing = rows.filter(t => !t.album);
    if (missing.length === 0) return;
    let cancelled = false;
    void fetchAlbums(missing.map(t => ({ id: String(t.id), title: t.title, artist: t.artist }))).then(found => {
      if (!cancelled && Object.keys(found).length > 0) {
        setMap(prev => ({ ...prev, ...found }));
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

// ─── HomeScreen ───────────────────────────────────────────────────────────────
function HomeScreen() {
  const { C, navigate, playTrack, shelves, homeLoading, hiddenIds, hideItem, user, openTrackOptions, uiState, openCreatePlaylist, playlists, artists } = useApp();

  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const dayStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // Filter chips (design: All / Music / Made for you / New) + per-shelf "more".
  const [chip, setChip] = useState("All");
  const [moreShelves, setMoreShelves] = useState<Record<string, HomeItem[]>>({});
  const CHIPS = ["All", "Music", "Made for you", "New"] as const;
  const chipMatch = (s: HomeShelf) =>
    chip === "All" ? true
    : chip === "Music" ? (s.type === "shelf" || s.type === "recent")
    : chip === "Made for you" ? (s.type === "jump_back_in" || s.type === "recent" || s.id.startsWith("because-"))
    : s.id === "new-releases";

  /** Extra items for a shelf ("See all" / "Show more") come from the live engine. */
  const moreQuery = (s: HomeShelf): string | null =>
    s.id.startsWith("because-") ? s.title.replace(/^Because you played\s*/i, "")
    : s.id.startsWith("region-") ? `${s.title.replace(/^Popular in\s*/i, "")} top songs`
    : s.id === "trending-now" ? "trending music"
    : s.id === "new-releases" ? "new music releases"
    : null;

  const loadMore = async (shelf: HomeShelf) => {
    const q = moreQuery(shelf);
    if (!q) return;
    const res = await searchTracks(q, 20);
    const items: HomeItem[] = res.slice(0, 20).map((t, i) => {
      const tr = fromApiTrack(t, i);
      return { id: String(tr.id), title: tr.title, artist: tr.artist, imageUrl: tr.imageUrl, videoId: tr.videoId ?? String(tr.id), durationSec: tr.durationSec, bg: tr.bg };
    });
    setMoreShelves(prev => ({ ...prev, [shelf.id]: items }));
  };

  /** Opens a shelf item: tracks play directly; seeded mixes resolve via search. */
  const openItem = async (item: HomeItem, shelf: HomeShelf) => {
    if (item.query && !item.videoId) {
      const results = await searchTracks(item.query, 10);
      if (results.length === 0) { toast.error("Couldn\'t start that mix — try again."); return; }
      const tracks = results.map((t, i) => fromApiTrack(t, i));
      playTrack(tracks[0], tracks, shelf.id);
      return;
    }
    const playable = shelf.items.filter(i => i.videoId || !i.query).map(toTrackItem);
    const track = toTrackItem(item);
    // Up Next = the rest of this shelf after the clicked card, in order.
    playTrack(track, playable.length > 0 ? queueRest(playable, track) : [track], shelf.id);
  };

  const visible = (shelf: HomeShelf) => shelf.items.filter(i => !hiddenIds[i.id]);

  const dismiss = (item: HomeItem, shelf: HomeShelf) => (
    <button
      data-dismiss
      onClick={() => hideItem({ id: item.id, kind: "track", artist: item.artist, shelfId: shelf.id, title: item.title })}
      aria-label={`Not interested in ${item.title}`}
      style={{ position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: "50%", background: "rgba(10,9,16,0.78)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "#fff", opacity: 0, transition: "opacity .15s", zIndex: 2 }}>
      <MinusCircle size={15} />
    </button>
  );

  const revealOnHover: React.HTMLAttributes<HTMLDivElement> = {
    onMouseEnter: e => { e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-dismiss], button[data-options]").forEach(b => { b.style.opacity = "1"; }); },
    onMouseLeave: e => { e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-dismiss], button[data-options]").forEach(b => { b.style.opacity = "0"; }); },
  };

  const cardRow = (shelf: HomeShelf, items: HomeItem[]) => (
    <div style={{ display: "flex", gap: 14, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 6 }}>
      {items.map(item => (
        <div key={item.id} style={{ position: "relative", flexShrink: 0 }} {...revealOnHover}>
          <TrackCard track={toTrackItem(item)} size={140} radius={14} onPlay={() => openItem(item, shelf)} />
          <button
            data-dismiss
            onClick={() => hideItem({ id: item.id, kind: "track", artist: item.artist, shelfId: shelf.id, title: item.title })}
            aria-label={`Not interested in ${item.title}`}
            style={{ position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: "50%", background: "rgba(10,9,16,0.78)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "#fff", opacity: 0, transition: "opacity .15s", zIndex: 2 }}>
            <MinusCircle size={15} />
          </button>
          <button
            data-options
            onClick={() => openTrackOptions(toTrackItem(item))}
            aria-label={`Options for ${item.title}`}
            style={{ position: "absolute", top: 6, right: 38, width: 26, height: 26, borderRadius: "50%", background: "rgba(10,9,16,0.78)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "#fff", opacity: 0, transition: "opacity .15s", zIndex: 2 }}>
            <MoreHorizontal size={15} />
          </button>
        </div>
      ))}
    </div>
  );

  const rowList = (shelf: HomeShelf, items: HomeItem[]) => {
    const queueItems = items.filter(i => i.videoId || !i.query).map(toTrackItem);
    return (
      <div>
        {items.map((item, i) => (
          <TrackRow key={item.id} track={toTrackItem(item)} index={i}
            // Up Next = this shelf's tracks from the clicked row onward.
            queue={queueRest(queueItems, toTrackItem(item))} sourceShelfId={shelf.id} />
        ))}
      </div>
    );
  };

  const mixGrid = (shelf: HomeShelf, items: HomeItem[]) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
      {items.map(item => (
        <div key={item.id} role="button" tabIndex={0}
          onClick={() => openItem(item, shelf)}
          onKeyDown={e => e.key === "Enter" && openItem(item, shelf)}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: 8, borderRadius: 12, background: C.surf, border: `1px solid ${C.border}`, cursor: "pointer", textAlign: "left", minWidth: 0, position: "relative" }}>
          <CoverArt bg={item.bg ?? BG_PALETTE[0]} imageUrl={item.imageUrl} size={54} radius={8} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
            <div style={{ fontSize: 11.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.subtitle ?? item.artist ?? "Made for you"}</div>
          </div>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.bg, display: "grid", placeItems: "center", color: C.text, flexShrink: 0 }}>
            <Play size={13} fill="currentColor" />
          </div>
          {dismiss(item, shelf)}
        </div>
      ))}
    </div>
  );

  const section = (shelf: HomeShelf) => {
    const base = visible(shelf);
    const extra = (moreShelves[shelf.id] ?? []).filter(e => !base.some(b => b.id === e.id));
    const items = [...base, ...extra].slice(0, 24);
    if (items.length === 0) return null;
    const q = moreQuery(shelf);
    const moreLabel = shelf.id.startsWith("because-") ? "Show more" : "See all";
    return (
      <section key={shelf.id} style={{ padding: "22px 28px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 19, fontWeight: 800, color: C.text, margin: 0, letterSpacing: -0.3 }}>{shelf.title}</h2>
            {shelf.subtitle && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>{shelf.subtitle}</div>}
          </div>
          {q && !moreShelves[shelf.id] && (
            <button onClick={() => loadMore(shelf)}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", flexShrink: 0, padding: "4px 0" }}
              onMouseEnter={e => (e.currentTarget.style.color = C.text)}
              onMouseLeave={e => (e.currentTarget.style.color = C.muted)}>
              {moreLabel}
            </button>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          {shelf.type === "mix_row" ? mixGrid(shelf, items) : shelf.type === "recent" ? rowList(shelf, items) : cardRow(shelf, items)}
        </div>
      </section>
    );
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", paddingBottom: 32 }}>
      <div style={{ position: "sticky", top: 0, zIndex: 3, display: "flex", alignItems: "center", gap: 14, padding: "14px 28px", background: `${C.pane}f2`, borderBottom: `1px solid ${C.border}`, backdropFilter: "blur(14px)" }}>
        <button onClick={() => navigate({ id: "search" })} aria-label="Search music"
          style={{ flex: 1, maxWidth: 520, height: 42, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.surf, color: C.muted, cursor: "pointer", textAlign: "left", fontSize: 13.5, fontWeight: 500 }}>
          <Search size={17} />
          <span style={{ flex: 1 }}>What do you want to play?</span>
          <span style={{ fontSize: 11, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 6px" }}>⌘⇧L</span>
        </button>
        <div style={{ flex: 1 }} />
        {user && <button onClick={() => navigate({ id: "profile" })} aria-label="Open profile"
          style={{ display: "flex", alignItems: "center", gap: 9, border: "none", background: "transparent", color: C.text, cursor: "pointer", minWidth: 0 }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", background: C.accent, color: C.bg, fontSize: 11, fontWeight: 800, overflow: "hidden" }}>
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : user.initials}
          </span>
          <span style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 700 }}>{user.name}</span>
        </button>}
      </div>

      <div style={{ padding: "28px 28px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.muted, marginBottom: 4 }}>{dayStr}</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, margin: 0, lineHeight: 1.2, letterSpacing: -0.5 }}>
            {greeting}{user ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {CHIPS.map(l => (
            <button key={l} onClick={() => setChip(l)}
              style={{
                border: "none", borderRadius: 999, padding: "9px 18px", fontSize: 13.5, fontWeight: 600,
                fontFamily: "inherit", cursor: "pointer",
                background: chip === l ? C.text : C.surf, color: chip === l ? C.pane : C.muted,
                transition: "all .15s",
              }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {homeLoading ? (
        <div style={{ display: "flex", gap: 14, padding: "26px 28px 0" }}>
          {[...Array(5)].map((_, i) => <CardSkeleton key={i} size={140} />)}
        </div>
      ) : shelves.length > 0 ? (
        shelves.filter(chipMatch).slice(0, 4).map(section)
      ) : (
        /* First run is never an empty room — one line, one action. */
        <div style={{ margin: "36px 28px 0", borderRadius: 18, border: `1px dashed ${C.border}`, background: C.surf, padding: "44px 28px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg, border: `1px solid ${C.border}`, display: "grid", placeItems: "center" }}>
            <Music2 size={26} color={C.accent} />
          </div>
          <div style={{ fontWeight: 800, fontSize: 19, color: C.text }}>Your home is ready when you are</div>
          <div style={{ fontSize: 14, color: C.muted, maxWidth: 330, lineHeight: 1.55 }}>
            Search for an artist or song and press play — everything you listen to lands here.
          </div>
          <button onClick={() => navigate({ id: "search" })}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 42, padding: "0 22px", borderRadius: 999, border: "none", background: C.accent, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            <Search size={16} /> Search music
          </button>
        </div>
      )}

      {/* Sections the earlier Home carried — real data, never filler. */}
      {chip === "All" && artists.length > 0 && (
        <section style={{ padding: "22px 28px 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 19, fontWeight: 800, color: C.text, margin: 0, letterSpacing: -0.3 }}>Artists</h2>
            <button onClick={() => navigate({ id: "library", tab: "artists" })} style={{ fontSize: 13, fontWeight: 600, color: C.muted, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>See all</button>
          </div>
          <div style={{ display: "flex", gap: 18, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
            {artists.slice(0, 8).map(a => (
              <div key={a.id} role="button" tabIndex={0}
                onClick={() => navigate({ id: "search", q: a.name })}
                onKeyDown={e => e.key === "Enter" && navigate({ id: "search", q: a.name })}
                style={{ width: 110, flexShrink: 0, textAlign: "center", cursor: "pointer" }}>
                <div style={{ width: 96, height: 96, borderRadius: "50%", background: a.bg, overflow: "hidden", margin: "0 auto" }}>
                  {a.imageUrl
                    ? <img src={a.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 30, fontWeight: 800, color: "rgba(255,255,255,0.85)" }}>{a.name[0]}</div>}
                </div>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: C.text, marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                <div style={{ fontSize: 11.5, color: C.muted }}>Artist</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {chip === "All" && playlists.length > 0 && (
        <section style={{ padding: "22px 28px 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 19, fontWeight: 800, color: C.text, margin: 0, letterSpacing: -0.3 }}>From your library</h2>
            <button onClick={() => navigate({ id: "library" })} style={{ fontSize: 13, fontWeight: 600, color: C.muted, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>See all</button>
          </div>
          <div style={{ display: "flex", gap: 14, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
            {playlists.slice(0, 6).map(pl => (
              <PlaylistItemCard key={pl.id} playlist={pl} size={150}
                onClick={() => navigate({ id: "playlist", item: pl })} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
// ─── SearchScreen ─────────────────────────────────────────────────────────────
function SearchScreen({ seed }: { seed?: string }) {
  const { C, playTrack, discoveryTracks } = useApp();
  const [query, setQuery]     = useState(seed ?? "");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  // Zero-state seeds: the local market category, recent queries, recent plays.
  const market = marketLabel();
  const recentSeeds = getRecentSearches();
  const recentPlays = useMemo(
    () => (getHistory() as unknown as Track[]).filter(t => t?.id != null).slice(0, 5),
    [query], // refresh after a search settles — history may have grown
  );
  const browseTiles = useMemo(
    () => [
      { id: "market", label: `Popular in ${market}`, query: marketChartQuery(), bg: C.accent },
      ...BROWSE_CATEGORIES,
    ],
    [market, C.accent],
  );
  const albumMap = useAlbums(results);

  useEffect(() => { inputRef.current?.focus(); }, []);
  // ⌘⇧L lands here — focus the field even when this screen stayed mounted.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("vibra:focus-search", focus);
    return () => window.removeEventListener("vibra:focus-search", focus);
  }, []);
  // A genre tile (or any deep-link) can carry a query into this screen.
  useEffect(() => { if (seed) setQuery(seed); }, [seed]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);

    debounceRef.current = window.setTimeout(async () => {
      // 1. Live catalogue search (safe: resolves to [] on any failure).
      // Music-only + variant dedupe: the engine returns slowed/cover dups.
      const tracks = await searchTracks(query, 20);
      if (tracks.length > 0) {
        setResults(sanitizeMusicItems(tracks.map((t, i) => fromApiTrack(t, i))));
        setSearching(false);
        pushRecentSearch(query);
        sendEvent({ type: "search" });
        return;
      }
      // 2. Fallback: filter whatever is already cached locally.
      const q = query.toLowerCase();
      const local = discoveryTracks.filter(t =>
        t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
      );
      setResults(local);
      setSearching(false);
      if (local.length > 0) pushRecentSearch(query);
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

      {/* Typing flips the view with a soft crossfade; the input never moves. */}
      <div key={query.trim() ? "results" : "browse"} style={{ animation: "fadeIn .18s ease" }}>
        {query ? (
          searching ? (
            [...Array(5)].map((_, i) => <TrackSkeleton key={i} />)
          ) : results.length > 0 ? (
            <>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>{results.length} result{results.length !== 1 ? "s" : ""}</h2>
              <TrackTableHead showLike />
              {results.map((t, i) => (
                <TrackRow key={t.id} track={t} index={i} showLike showAlbum album={albumMap[String(t.id)]}
                  // Up Next = the remaining search results after this one, in
                  // order; a vibe match continues the queue once they run out.
                  queue={queueRest(results, t)} />
              ))}
            </>
          ) : (
            <EmptyState icon={Search} title="No results" sub={`Nothing matched “${query}”. Try an artist, album, or a different spelling.`} />
          )
        ) : (
          <>
            {/* Browse all — the local market plus every category/genre tile. */}
            <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>Recommended for you</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 10 }}>
              {browseTiles.map(tile => (
                <button key={tile.id} onClick={() => setQuery("query" in tile ? tile.query : tile.label)}
                  style={{ position: "relative", height: 74, borderRadius: 12, border: "none", cursor: "pointer", overflow: "hidden", background: tile.bg, padding: "0 16px", display: "flex", alignItems: "flex-end", textAlign: "left", transition: "transform .15s" }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.02)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}>
                  <span style={{ fontWeight: 800, fontSize: 15, color: "#fff", textShadow: "0 1px 8px rgba(0,0,0,0.45)", paddingBottom: 2 }}>{tile.label}</span>
                </button>
              ))}
            </div>

            {/* Recent seeds — queries first, then what was last played. */}
            {recentSeeds.length > 0 && (
              <section style={{ marginTop: 28 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>Recent searches</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {recentSeeds.map(q => (
                    <button key={q} onClick={() => setQuery(q)}
                      style={{ height: 34, padding: "0 16px", borderRadius: 17, border: `1px solid ${C.border}`, background: C.surf, color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      {q}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {recentPlays.length > 0 && (
              <section style={{ marginTop: 28 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: "0 0 8px" }}>Recently played</h2>
                {recentPlays.map((t, i) => (
                  <TrackRow key={`${t.id}-${i}`} track={t} index={i} queue={queueRest(recentPlays, t)} />
                ))}
              </section>
            )}
            {recentSeeds.length === 0 && recentPlays.length === 0 && (
              <div style={{ marginTop: 22, fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>
                Search for a song, or tap a category above — trending charts for your region are ready to play.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── DiscoverScreen ───────────────────────────────────────────────────────────
function DiscoverScreen() {
  const { C, playTrack, navigate, trendingTracks, newReleases, playlists, discoveryLoading, artists, queueAll } = useApp();

  const albumToPlaylist = (a: AlbumItem): PlaylistItem => ({
    id: a.id, name: a.title, description: `${a.artist} · ${a.year}`,
    bg: a.bg, imageUrl: a.imageUrl, trackCount: a.trackCount, creator: a.artist, tracks: [],
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", paddingBottom: 32 }}>
      <div style={{ padding: "24px 28px 0" }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: 0 }}>Discover</h1>
        <p style={{ fontSize: 14, color: C.muted, margin: "4px 0 0" }}>Find your next favourite sound</p>
      </div>

      {playlists[0] ? (
        <div style={{ margin: "20px 28px 0", borderRadius: 18, overflow: "hidden", position: "relative", height: 176, background: playlists[0].bg }}>
          {playlists[0].imageUrl && <img src={playlists[0].imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(18,8,42,0.9) 40%, transparent)", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Featured</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "0 0 10px" }}>{playlists[0].name}</h2>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { const pl = playlists[0]; pl.tracks.length > 0 ? playTrack(pl.tracks[0], pl.tracks) : navigate({ id: "playlist", item: pl }); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 16px", borderRadius: 17, background: C.accent, border: "none", color: C.bg, fontSize: 13, fontWeight: 700, cursor: "pointer", width: "fit-content" }}>
                <Play size={14} fill="currentColor" /> Play all
              </button>
              {playlists[0].tracks.length > 0 && (
                <button onClick={() => queueAll(playlists[0].tracks)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 16px", borderRadius: 17, background: "rgba(10,9,16,0.45)", border: "1px solid rgba(255,255,255,0.4)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", width: "fit-content" }}>
                  <ListPlus size={14} /> Add to queue
                </button>
              )}
            </div>
          </div>
        </div>
      ) : trendingTracks.length > 0 ? (
        <div style={{ margin: "20px 28px 0", borderRadius: 18, overflow: "hidden", position: "relative", height: 176, background: trendingTracks[0].bg }}>
          {trendingTracks[0].imageUrl && <img src={trendingTracks[0].imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(18,8,42,0.9) 40%, transparent)", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Featured</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "0 0 10px" }}>Trending now</h2>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => playTrack(trendingTracks[0], trendingTracks)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 16px", borderRadius: 17, background: C.accent, border: "none", color: C.bg, fontSize: 13, fontWeight: 700, cursor: "pointer", width: "fit-content" }}>
                <Play size={14} fill="currentColor" /> Play all
              </button>
              <button onClick={() => queueAll(trendingTracks)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 16px", borderRadius: 17, background: "rgba(10,9,16,0.45)", border: "1px solid rgba(255,255,255,0.4)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", width: "fit-content" }}>
                <ListPlus size={14} /> Add to queue
              </button>
            </div>
          </div>
        </div>
      ) : discoveryLoading ? (
        <div style={{ margin: "20px 28px 0", borderRadius: 18, height: 176, background: C.surf, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Sk w="80%" h={24} />
        </div>
      ) : null}

      <div style={{ padding: "24px 28px 0" }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: "0 0 10px" }}>Trending now</h2>
        {discoveryLoading
          ? [...Array(5)].map((_, i) => <TrackSkeleton key={i} />)
          : trendingTracks.length > 0
            ? (trendingTracks || []).slice(0, 8).map((t, i) => <TrackRow key={t.id} track={t} index={i} queue={queueRest(trendingTracks, t)} />)
            : <EmptyState title="Nothing trending yet" sub="Search for a song or artist and press play — it shows up here." action={
                <button onClick={() => navigate({ id: "search" })}
                  style={{ height: 36, padding: "0 16px", borderRadius: 18, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: 13, cursor: "pointer" }}>
                  Search music
                </button>
              } />
        }
      </div>

      <div style={{ padding: "24px 28px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>New releases</h2>
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

      {artists.length > 0 && (
        <div style={{ padding: "24px 28px 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>Artists</h2>
            <button onClick={() => navigate({ id: "library", tab: "artists" })} style={{ fontSize: 13, fontWeight: 600, color: C.muted, background: "none", border: "none", cursor: "pointer" }}>See all</button>
          </div>
          <div style={{ display: "flex", gap: 18, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
            {(artists || []).slice(0, 8).map(a => (
              <div key={a.id} role="button" tabIndex={0}
                onClick={() => navigate({ id: "search", q: a.name })}
                onKeyDown={e => e.key === "Enter" && navigate({ id: "search", q: a.name })}
                style={{ width: 110, flexShrink: 0, textAlign: "center", cursor: "pointer" }}>
                <div style={{ width: 96, height: 96, borderRadius: "50%", background: a.bg, overflow: "hidden", margin: "0 auto" }}>
                  {a.imageUrl
                    ? <img src={a.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 30, fontWeight: 800, color: "rgba(255,255,255,0.85)" }}>{a.name[0]}</div>
                  }
                </div>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: C.text, marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                <div style={{ fontSize: 11.5, color: C.muted }}>Artist</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {playlists.length > 1 && (
        <div style={{ padding: "24px 28px 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>From your library</h2>
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
        <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: "0 0 12px" }}>Moods & genres</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {BROWSE_CATEGORIES.slice(0, 6).map(cat => (
            <button key={cat.id} onClick={() => navigate({ id: "search", q: cat.label })}
              style={{ height: 60, borderRadius: 10, background: cat.bg, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#fff" }}>
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
  const { C, navigate, playTrack, playlists, playlistsLoading, likedTracks, artists, newReleases, downloadedTracks, refreshDownloads, openCreatePlaylist, uiState } = useApp();
  const [tab, setTab] = useState<LibTab>(initTab);
  const albumMap = useAlbums(likedTracks);

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
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: 0 }}>Your Library</h1>
          {uiState.signedIn && (
            <button onClick={() => openCreatePlaylist()}
              style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
              <Plus size={18} />
            </button>
          )}
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 180px)", gap: 14 }}>
              {[...Array(6)].map((_, i) => <Sk key={i} w={180} h={214} r={16} />)}
            </div>
          ) : playlists.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 180px)", gap: 14 }}>
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
              <button onClick={() => openCreatePlaylist()}
                style={{ height: 36, padding: "0 16px", borderRadius: 18, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: 13, cursor: "pointer" }}>
                Create playlist
              </button>
            } />
          )
        )}

        {tab === "liked" && (
          likedTracks.length > 0
            ? (
              <>
                <TrackTableHead showLike />
                {(likedTracks || []).map((t, i) => <TrackRow key={t.id} track={t} index={i} queue={queueRest(likedTracks, t)} showLike showAlbum album={albumMap[String(t.id)]} />)}
              </>
            )
            : <EmptyState icon={Heart} title="No liked songs" sub="Songs you heart will appear here." />
        )}

        {tab === "albums" && (
          newReleases.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 180px)", gap: 14 }}>
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
            onPlay={(t, q) => {
              const clicked = { ...t, bg: t.bg ?? BG_PALETTE[0] } as Track;
              playTrack(clicked, queueRest(q as Track[], clicked));
            }}
            onSync={async () => { await refreshDownloads(); toast("Offline cache synced"); }}
          />
        )}
      </div>
    </div>
  );
}

// ─── PlaylistScreen ────────────────────────────────────────────────────────────
function PlaylistScreen({ item }: { item: PlaylistItem }) {
  const { C, playTrack, canGoBack, goBack, discoveryTracks, reorderPlaylist } = useApp();
  const [fullPlaylist, setFullPlaylist] = useState<PlaylistItem>(item);
  const [loading, setLoading] = useState(item.tracks.length === 0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

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
  const totalSec = tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0);
  const albumMap = useAlbums(tracks);

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
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: "0 0 6px", lineHeight: 1.2 }}>{fullPlaylist.name}</h1>
          {fullPlaylist.description && <p style={{ fontSize: 13, color: C.muted, margin: "0 0 6px" }}>{fullPlaylist.description}</p>}
          <div style={{ fontSize: 12, color: C.muted }}>
            {fullPlaylist.creator && <span>{fullPlaylist.creator} · </span>}
            <span>{fullPlaylist.trackCount} songs{totalSec > 0 ? ` · ${fmtDur(totalSec)}` : ""}</span>
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
            ? (
              <>
                <TrackTableHead showLike />
                {tracks.map((t, i) => {
                const dropTarget = dragOverIdx === i && dragIdx !== null && dragIdx !== i;
                return (
                  <div key={`${t.id}-${i}`}
                    draggable
                    onDragStart={e => {
                      setDragIdx(i);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(i));
                    }}
                    onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIdx(i); }}
                    onDragLeave={() => setDragOverIdx(prev => (prev === i ? null : prev))}
                    onDrop={e => {
                      e.preventDefault();
                      const from = dragIdx ?? Number(e.dataTransfer.getData("text/plain"));
                      if (Number.isFinite(from) && from !== i) {
                        reorderPlaylist(fullPlaylist.id, from, i);
                        setFullPlaylist(prev => {
                          const nextTracks = [...prev.tracks];
                          const [moved] = nextTracks.splice(from, 1);
                          nextTracks.splice(i, 0, moved);
                          return { ...prev, tracks: nextTracks };
                        });
                      }
                      setDragIdx(null);
                      setDragOverIdx(null);
                    }}
                    style={{
                      opacity: dragIdx === i ? 0.5 : 1,
                      boxShadow: dropTarget ? `inset 0 2px 0 ${C.accent}` : "none",
                      borderRadius: 8,
                      cursor: dragIdx === i ? "grabbing" : "grab",
                      transition: "box-shadow .12s",
                    }}>
                    <TrackRow track={t} index={i} queue={queueRest(tracks, t)} showLike showAlbum album={albumMap[String(t.id)]} />
                  </div>
                );
                })}
              </>
            )
            : <EmptyState title="No tracks" sub="This playlist is empty." />
        }
      </div>
    </div>
  );
}

// ─── SettingsScreen ────────────────────────────────────────────────────────────
function SettingsScreen() {
  const {
    C, canGoBack, goBack, navigate, user, refreshDownloads, updateProfile, uiState, logout,
    theme, setTheme, accent, setAccent,
    audioQuality, setAudioQuality,
    normalizeVolume, setNormalizeVolume,
    autoplay, setAutoplay, crossfade, setCrossfade,
    notifNewReleases, setNotifNewReleases,
    notifRecommendations, setNotifRecommendations,
    notifFollowers, setNotifFollowers,
    shareListening, setShareListening,
    shareData, setShareData,
    outputDevice, devices, refreshDevices, selectOutput,
    historyPaused, setHistoryPaused, resetRecommendations,
  } = useApp();

  // Live connection status (driven by the safeFetch connection store).
  const [conn, setConn] = useState<ConnectionStatus>(() => getConnectionStatus());
  const [cachedCount, setCachedCount] = useState(0);
  useEffect(() => subscribeConnection(setConn), []);
  useEffect(() => { setCachedCount(readOfflineTracks().length); }, []);
  // Device labels need a user gesture — ask once when Settings opens.
  useEffect(() => { refreshDevices(true); }, [refreshDevices]);

  // Persistent engines: profile name editing.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

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
    { id: "dark",  Icon: Moon,     label: "Dark",  desc: "Deep violet" },
    { id: "oled",  Icon: Contrast, label: "OLED",  desc: "True black"  },
    { id: "light", Icon: Sun,      label: "Light", desc: "Airy & soft"  },
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
        <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: 0 }}>Settings</h1>
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
              onClick={() => {
                if (!user) { navigate({ id: "auth", mode: "login" }); return; }
                setNameDraft(user.name ?? "");
                setEditingName(true);
              }}
              right={
                user ? (
                  user.avatarUrl
                    ? <img src={user.avatarUrl} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
                    : <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.accent, color: C.bg, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{user.initials}</div>
                ) : <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.surf, display: "grid", placeItems: "center", flexShrink: 0, color: C.muted }}><Settings size={18} /></div>
              } />
          )}
          <Row label="Subscription"
            sub={user ? `${user.subscription === "premium" ? "Vibra Premium" : "Free"} plan` : "Sign in to manage your plan"}
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
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 4, color: theme === t.id ? C.accent : C.muted }}>
                    <t.Icon size={20} />
                  </div>
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
          <Row label="Pause listening history" sub="New plays stop shaping Home and mixes" right={<Toggle value={historyPaused} onChange={v => setHistoryPaused(v)} />} />
          <Row label="Share usage data" sub="Help improve Vibra" right={<Toggle value={shareData} onChange={v => { setShareData(v); saveSettings({ shareData: v }); }} />} />
          <Row
            label="Reset recommendations"
            sub="Clear listening history and start Home fresh"
            onClick={() => { void resetRecommendations(); }}
            last
            right={<RotateCcw size={16} color={C.muted} />}
          />
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

        <Section title="Output">
          {(devices.length > 0 ? devices : [outputDevice]).map((d, i, arr) => (
            <Row
              key={d.id}
              label={d.name}
              sub={`${d.kind === "headphones" ? "Headphones" : d.kind === "phone" ? "Phone" : d.kind === "speaker" ? "Speaker" : "Computer"}${d.id === outputDevice.id ? " · Active output" : ""}`}
              onClick={() => { selectOutput(d.id); toast(`Output → ${d.name}`); }}
              last={i === arr.length - 1 && devices.length > 0}
              right={
                d.id === outputDevice.id
                  ? <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#3AD07A", flexShrink: 0 }} />
                  : <ChevronRight size={16} color={C.muted} />
              }
            />
          ))}
          {devices.length === 0 && (
            <Row
              label="This computer"
              sub="Browser default · tap to rescan outputs"
              onClick={() => refreshDevices(true)}
              last
              right={<RefreshCw size={15} color={C.muted} />}
            />
          )}
        </Section>

        <Section title="About">
          <Row label="Connection"
            sub={conn === "online" ? "Streaming is ready" : conn === "degraded" ? "A few features may be limited" : "Offline — downloaded tracks still play"}
            right={<div style={{ width: 8, height: 8, borderRadius: "50%", background: conn === "online" ? "#34C759" : conn === "degraded" ? "#FF9F0A" : "#E5484D", flexShrink: 0 }} />} />
          <Row label="Version" sub="Vibra 2.1.0" right={<span style={{ fontSize: 13, color: C.accent, fontWeight: 600 }}>Latest</span>} />
          <Row label="Terms of service" onClick={() => toast("Opening terms…")} right={<ChevronRight size={16} color={C.muted} />} />
          <Row label="Privacy policy" onClick={() => toast("Opening privacy policy…")} last right={<ChevronRight size={16} color={C.muted} />} />
        </Section>

        {uiState.signedIn && (
          <button
            onClick={() => { void logout(); }}
            style={{ width: "100%", height: 48, borderRadius: 12, background: "#E5484D1A", border: "1px solid #E5484D44", color: "#E5484D", fontWeight: 700, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
            <LogOut size={18} /> Sign out
          </button>
        )}
        {!uiState.signedIn && (
          <button
            onClick={() => navigate({ id: "auth", mode: "login" })}
            style={{ width: "100%", height: 48, borderRadius: 12, background: C.accent, border: "none", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
            Sign in to sync your library
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ProfileScreen ─────────────────────────────────────────────────────────────
function ProfileScreen() {
  const { C, navigate, canGoBack, goBack, user, userLoading, recentTracks, playlists, likedTrackIds } = useApp();
  const uniqueArtists = new Set(recentTracks.map(t => t.artist).filter(Boolean)).size;
  const playlistCount = playlists.filter(p => p.id !== "liked").length;

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
              : <div style={{ width: 96, height: 96, borderRadius: "50%", background: C.accent, color: C.bg, display: "grid", placeItems: "center", fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 30, fontWeight: 800, marginBottom: 14, boxShadow: `0 0 0 4px ${C.accent}44` }}>{user.initials}</div>
            }
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: 0 }}>{user.name}</h1>
            <p style={{ fontSize: 14, color: C.muted, margin: "4px 0 0" }}>
              {user.username ? `@${user.username} · ` : ""}{user.subscription === "premium" ? "Vibra Premium" : "Free plan"}
            </p>

            <div style={{ display: "flex", gap: 32, marginTop: 20 }}>
              {([
                [String(playlistCount), "Playlists", () => navigate({ id: "library" })],
                [String(likedTrackIds.size), "Liked", () => navigate({ id: "library", tab: "liked" })],
                [String(uniqueArtists), "Artists", () => navigate({ id: "library", tab: "artists" })],
              ] as [string, string, () => void][]).map(([count, label, go]) => (
                <button key={label} onClick={go}
                  style={{ background: "none", border: "none", cursor: "pointer", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{count}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
                </button>
              ))}
            </div>

            <button onClick={() => navigate({ id: "settings" })}
              style={{ marginTop: 16, height: 40, padding: "0 20px", borderRadius: 20, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Edit profile
            </button>
          </div>

          <div style={{ padding: "24px 28px 0" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>Listening stats</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[
                [user.stats?.weeklyMinutes ?? "0m",  "Listened this week"],
                [String(uniqueArtists),              "Artists discovered"],
                [String(likedTrackIds.size),         "Liked tracks"],
              ].map(([val, label]) => (
                <div key={label} style={{ background: C.pane, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 14px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: C.accent }}>{val}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{ padding: "24px 28px 0" }}>
          <EmptyState title="Make Vibra yours" sub="Sign in to keep your library, likes, and listening history across devices." action={
            <button onClick={() => navigate({ id: "auth", mode: "login" })}
              style={{ height: 40, padding: "0 20px", borderRadius: 20, border: "none", background: C.accent, color: C.bg, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Sign in
            </button>
          } />
        </div>
      )}

      {recentTracks.length > 0 && (
        <div style={{ padding: "24px 28px 0" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>Recently played</h2>
            {(recentTracks || []).slice(0, 5).map((t, i) => <TrackRow key={t.id} track={t} index={i} queue={queueRest(recentTracks, t)} />)}
        </div>
      )}
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
  const {
    C, toggleLike, likedTrackIds, navigate, playlists, addTrackToPlaylist,
    hideItem, playTrack, addToQueue, playNextInQueue,
    openCreatePlaylist, uiState,
  } = useApp();
  const [view, setView] = useState<"root" | "playlists" | "share">("root");
  const isLiked = likedTrackIds.has(track.id);
  const signedIn = uiState.signedIn;

  const shareLink = track.videoId ? `https://www.youtube.com/watch?v=${track.videoId}` : window.location.href;
  const shareText = `${track.title} — ${track.artist}`;

  const shareTargets = [
    {
      label: "Copy link",
      icon: <Link2 size={18} />,
      action: () => {
        void navigator.clipboard?.writeText(shareLink)
          .then(() => toast("Link copied"))
          .catch(() => toast.error("Couldn't copy the link"));
      },
    },
    {
      label: "WhatsApp",
      icon: <MessageCircle size={18} />,
      action: () => window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareLink}`)}`, "_blank", "noopener"),
    },
    {
      label: "Telegram",
      icon: <Send size={18} />,
      action: () => window.open(`https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(shareText)}`, "_blank", "noopener"),
    },
    {
      label: "Email",
      icon: <Mail size={18} />,
      action: () => { window.location.href = `mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(shareLink)}`; },
    },
  ];

  const option = (icon: React.ReactNode, label: string, action: () => void, danger?: boolean) => ({
    icon, label, action, danger,
  });

  const rootOptions = [
    option(<Play size={18} />, "Play now", () => { playTrack(track, [track]); onClose(); }),
    option(<ListStart size={18} />, "Play next", () => { playNextInQueue(track); onClose(); }),
    option(<ListPlus size={18} />, "Add to queue", () => { addToQueue(track); onClose(); }),
    option(<ListMusic size={18} />, "Add to playlist", () => setView("playlists")),
    option(<Heart size={18} fill={isLiked ? C.accent : "none"} />, isLiked ? "Remove from liked" : "Add to liked", () => { toggleLike(track.id); onClose(); }),
    option(<Download size={18} />, "Download", () => { addOfflineTrack(toOfflineTrack(track)); onClose(); toast("Saved for offline playback"); }),
    option(<Compass size={18} />, `More from ${track.artist}`, () => { onClose(); navigate({ id: "search", q: track.artist }); }),
    option(<Share2 size={18} />, "Share track", () => {
      // Prefer the OS share sheet when the browser offers one.
      if (navigator.share) {
        void navigator.share({ title: track.title, text: shareText, url: shareLink })
          .catch(() => { /* user dismissed — stay quiet */ });
        onClose();
        return;
      }
      setView("share");
    }),
    option(<MinusCircle size={18} />, "Not interested", () => {
      hideItem({ id: String(track.id), kind: "track", artist: track.artist, title: track.title });
      onClose();
      toast("Got it — you'll see less of this");
    }),
  ];

  const renderButtons = (opts: typeof rootOptions) => opts.map(opt => (
    <button key={opt.label} onClick={opt.action}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", background: "none", border: "none", cursor: "pointer", color: opt.danger ? "#E5484D" : C.text, fontSize: 15, fontWeight: 500, textAlign: "left" }}
      onMouseEnter={e => (e.currentTarget.style.background = C.surf)}
      onMouseLeave={e => (e.currentTarget.style.background = "none")}>
      <span style={{ color: opt.danger ? "#E5484D" : C.muted, display: "grid", placeItems: "center", flexShrink: 0 }}>{opt.icon}</span>
      {opt.label}
    </button>
  ));

  const realPlaylists = playlists.filter(p => p.id !== "liked");

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div style={{ position: "relative", background: C.pane, borderRadius: "20px 20px 0 0", padding: "8px 0 32px", animation: "slideUp .22s ease", maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border, margin: "8px auto 16px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 20px 16px", borderBottom: `1px solid ${C.border}` }}>
          {view !== "root" && (
            <button onClick={() => setView("root")} aria-label="Back"
              style={{ width: 30, height: 30, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, flexShrink: 0 }}>
              <ChevronLeft size={16} />
            </button>
          )}
          <CoverArt bg={track.bg} imageUrl={track.imageUrl} size={52} radius={10} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
            <div style={{ fontSize: 13, color: C.muted }}>{track.artist}</div>
          </div>
        </div>

        {view === "root" && renderButtons(rootOptions)}

        {view === "share" && (
          <div>
            <div style={{ padding: "4px 20px 8px", fontSize: 12.5, color: C.muted }}>Share “{track.title}”</div>
            {shareTargets.map(t => (
              <button key={t.label} onClick={() => { t.action(); onClose(); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", background: "none", border: "none", cursor: "pointer", color: C.text, fontSize: 15, fontWeight: 500, textAlign: "left" }}
                onMouseEnter={e => (e.currentTarget.style.background = C.surf)}
                onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                <span style={{ color: C.muted, display: "grid", placeItems: "center", flexShrink: 0 }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        )}

        {view === "playlists" && (
          <div>
            <button onClick={() => { onClose(); openCreatePlaylist(track); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 16, padding: "13px 20px", background: "none", border: "none", cursor: "pointer", color: C.text, fontSize: 15, fontWeight: 600, textAlign: "left" }}
              onMouseEnter={e => (e.currentTarget.style.background = C.surf)}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}>
              <span style={{ width: 40, height: 40, borderRadius: 8, border: `1.5px dashed ${C.border}`, display: "grid", placeItems: "center", color: C.accent, flexShrink: 0 }}>
                <Plus size={18} />
              </span>
              New playlist
            </button>
            {realPlaylists.length === 0 && !signedIn && (
              <div style={{ padding: "8px 20px 4px", fontSize: 13, color: C.muted }}>New playlists are saved on this device — sign in to sync.</div>
            )}
            {realPlaylists.map(p => (
              <button key={p.id} onClick={() => { addTrackToPlaylist(p.id, track); onClose(); toast(`Added to "${p.name}"`); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "8px 20px", background: "none", border: "none", cursor: "pointer", color: C.text, fontSize: 14.5, fontWeight: 500, textAlign: "left" }}
                onMouseEnter={e => (e.currentTarget.style.background = C.surf)}
                onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                <CoverArt bg={p.bg} imageUrl={p.imageUrl} size={40} radius={8} />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CreatePlaylistModal ───────────────────────────────────────────────────────
function CreatePlaylistModal({ pendingTrack, onClose }: { pendingTrack?: Track; onClose: () => void }) {
  const { C, addPlaylist, addTrackToPlaylist } = useApp();
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
    let created: PlaylistItem | null = null;
    if (result) {
      created = mapAPIPlaylist(result);
      savePlaylist({ ...(created as unknown as StoredPlaylist), createdAt: Date.now() });
      addPlaylist(created);
      toast(`"${created.name}" created`);
    } else {
      // Offline / no backend: create locally so it still lands in the sidebar.
      const local = createCustomPlaylist(name, desc);
      addPlaylist(local as unknown as PlaylistItem);
      created = local as unknown as PlaylistItem;
      toast(`"${local.name}" saved locally`);
    }
    if (created && pendingTrack) {
      addTrackToPlaylist(created.id, pendingTrack);
      toast(`Added “${pendingTrack.title}” to "${created.name}"`);
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
  switch (s.id) {
    case "home":     return <HomeScreen />;
    case "search":   return <SearchScreen seed={s.q} />;
    case "discover": return <DiscoverScreen />;
    case "library":  return <LibraryScreen tab={s.tab} />;
    case "playlist": return <PlaylistScreen item={s.item} />;
    case "settings": return <SettingsScreen />;
    case "profile":  return <ProfileScreen />;
    // auth/notfound are intercepted by App (main area) before reaching here.
    default:         return null;
  }
}

// ─── LeftSidebar ──────────────────────────────────────────────────────────────
function LeftSidebar() {
  const { C, screen, navigate, playlists, user, likedTrackIds, openCreatePlaylist, uiState } = useApp();

  const NAV = [
    { id: "home",     label: "Home",     Icon: Home },
    { id: "search",   label: "Search",   Icon: Search },
    { id: "discover", label: "Discover", Icon: Compass },
  ] as const;

  const activePl = screen.id === "playlist" ? (screen as Extract<Screen, { id: "playlist" }>).item.id : null;
  const userPlaylists = (playlists ?? []).filter(pl => pl.id !== "liked");
  const rowBg = (active: boolean) => (active ? C.surf : "transparent");

  const profileBlock = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
      <button onClick={() => navigate({ id: "profile" })} aria-label="Your profile"
        style={{ width: 34, height: 34, borderRadius: "50%", background: user ? C.accent : C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: user ? "#fff" : C.muted, fontSize: 12, fontWeight: 800, overflow: "hidden", flexShrink: 0 }}>
        {user?.avatarUrl
          ? <img src={user.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : user?.initials ?? <Music2 size={15} />}
      </button>
      <button onClick={() => navigate({ id: "profile" })}
        style={{ flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {user?.name ?? "Your profile"}
        </div>
        <div style={{ fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {uiState.signedIn ? "Signed in" : "Local profile"}
        </div>
      </button>
      {!uiState.signedIn && (
        <button onClick={() => navigate({ id: "auth", mode: "login" })}
          style={{ height: 26, padding: "0 12px", borderRadius: 999, border: "none", background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
          Sign in
        </button>
      )}
      <button onClick={() => navigate({ id: "settings" })} aria-label="Settings"
        style={{ width: 30, height: 30, borderRadius: "50%", background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted, flexShrink: 0 }}>
        <Settings size={15} />
      </button>
    </div>
  );

  return (
    <div style={{ background: C.pane, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
      {/* Wordmark — nothing else on this row */}
      <div style={{ padding: "22px 20px 16px" }}>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 21, fontWeight: 800, color: C.text, letterSpacing: -0.6, lineHeight: 1 }}>
          vibra<span style={{ color: C.accent }}>.</span>
        </div>
      </div>

      <div style={{ padding: "0 12px" }}>
        {NAV.map(({ id, label, Icon }) => {
          const active = screen.id === id;
          return (
            <button key={id} onClick={() => navigate({ id } as Screen)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, height: 42, padding: "0 12px", borderRadius: 10, border: "none", cursor: "pointer", background: rowBg(active), color: active ? C.text : C.muted, fontWeight: active ? 700 : 500, fontSize: 14, textAlign: "left", transition: "all .15s" }}>
              <Icon size={18} />
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 8px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>Your library</span>
          {uiState.signedIn && (
            <button onClick={() => openCreatePlaylist()} aria-label="Create playlist"
              style={{ width: 26, height: 26, borderRadius: "50%", background: C.surf, border: `1px solid ${C.border}`, cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
              <Plus size={13} />
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0 12px" }}>
          {/* Signed out: one quiet hint at the top — but the library below
              always works locally (likes and playlists need no account). */}
          {!uiState.signedIn && (
            <button onClick={() => navigate({ id: "auth", mode: "login" })}
              style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 12px", borderRadius: 12, border: `1px dashed #34324a`, background: "transparent", cursor: "pointer", fontSize: 12.5, color: C.muted, lineHeight: 1.45, textAlign: "left", marginTop: 4 }}>
              <span style={{ color: C.dim, marginTop: 1 }}><Lock size={15} /></span>
              Log in to sync your library across devices.
            </button>
          )}

          {/* Liked songs — always present */}
          <button onClick={() => navigate({ id: "library", tab: "liked" })}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, height: 52, padding: "0 10px", borderRadius: 10, border: "none", cursor: "pointer", background: rowBg(screen.id === "library" && screen.tab === "liked"), transition: "background .15s", textAlign: "left" }}
            onMouseEnter={e => (e.currentTarget.style.background = C.surf)}
            onMouseLeave={e => (e.currentTarget.style.background = rowBg(screen.id === "library" && screen.tab === "liked"))}>
            <div style={{ width: 36, height: 36, aspectRatio: "1 / 1", borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center", background: "linear-gradient(135deg, #7A4AE8 0%, #E8334F 100%)" }}>
              <Heart size={15} color="#fff" fill="#fff" />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Liked songs</div>
              <div style={{ fontSize: 11, color: C.muted }}>{likedTrackIds.size} {likedTrackIds.size === 1 ? "song" : "songs"}</div>
            </div>
          </button>

          {userPlaylists.length === 0 ? (
            <button onClick={() => openCreatePlaylist()}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, height: 48, padding: "0 12px", marginTop: 4, borderRadius: 10, background: "transparent", border: `1px dashed ${C.border}`, cursor: "pointer", color: C.muted, fontSize: 12.5, fontWeight: 600, textAlign: "left" }}>
              <Plus size={14} /> Create your first playlist
            </button>
          ) : userPlaylists.map(pl => (
            <button key={pl.id} onClick={() => navigate({ id: "playlist", item: pl })}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, height: 52, padding: "0 10px", borderRadius: 10, border: "none", cursor: "pointer", background: rowBg(activePl === pl.id), transition: "background .15s", textAlign: "left" }}
              onMouseEnter={e => (e.currentTarget.style.background = C.surf)}
              onMouseLeave={e => (e.currentTarget.style.background = rowBg(activePl === pl.id))}>
              <CoverArt bg={pl.bg} imageUrl={pl.imageUrl} size={36} radius={8} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl.name}</div>
                <div style={{ fontSize: 11, color: C.muted }}>Playlist · {pl.trackCount}</div>
              </div>
            </button>
          ))}

          <button onClick={() => navigate({ id: "library" })}
            style={{ width: "100%", height: 38, padding: "0 10px", borderRadius: 10, border: "none", cursor: "pointer", background: "transparent", color: C.muted, fontSize: 12, fontWeight: 600, textAlign: "left", display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <Library size={13} /> Show all
          </button>
        </div>
      </div>

      {/* Bottom — profile when we know who you are, otherwise the sign-in card */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 8px 10px" }}>
        {uiState.signedIn || user ? profileBlock : (
          <div style={{ margin: "4px 4px 2px", padding: 14, borderRadius: 14, background: C.surf, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>Save your music</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, margin: "4px 0 12px" }}>
              Sign in to keep playlists, likes and history on every device.
            </div>
            <button onClick={() => navigate({ id: "auth", mode: "signup" })}
              style={{ width: "100%", height: 34, borderRadius: 999, border: "none", background: C.accent, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Sign up free
            </button>
            <button onClick={() => navigate({ id: "auth", mode: "login" })}
              style={{ width: "100%", height: 32, marginTop: 6, borderRadius: 999, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              Sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── RightPanel ────────────────────────────────────────────────────────────────
function RightPanel() {
  const {
    C, currentTrack, isPlaying, playTrack,
    likedTrackIds, toggleLike, queue, discoveryTracks, vibePool,
    moveQueueItem, removeFromQueue, openTrackOptions,
    panelTab, openPanel, uiState, setPlayerPageOpen,
    lyrics, plainLyrics, lyricsLoading, elapsed,
  } = useApp();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const tab: PanelTab = panelTab === "lyrics" && uiState.hasLyrics ? "lyrics" : (panelTab ?? "nowplaying");
  const isLiked = currentTrack ? likedTrackIds.has(currentTrack.id) : false;
  const queued = queue;
  // The suggested continuation prefers vibe matches (recent artists) over the
  // generic discovery set, and never repeats what is already queued.
  const queuedIds = new Set(queued.map(t => String(t.id)));
  const preview = (vibePool.length > 0 ? vibePool : discoveryTracks)
    .filter(t => !queuedIds.has(String(t.id)))
    .slice(0, 8);
  const activeQueueIdx = currentTrack ? queued.findIndex(t => t.id === currentTrack.id) : -1;
  // The track that plays after this one — from the queue when we're in it,
  // otherwise the queue head.
  const nextUp: Track | undefined = currentTrack
    ? activeQueueIdx >= 0 && activeQueueIdx + 1 < queue.length
      ? queue[activeQueueIdx + 1]
      : queue.find(t => t.id !== currentTrack.id)
    : undefined;
  const tabs: { id: PanelTab; label: string }[] = [
    { id: "nowplaying", label: "Now playing" },
    { id: "queue", label: "Queue" },
    ...(uiState.hasLyrics ? [{ id: "lyrics" as PanelTab, label: "Lyrics" }] : []),
  ];

  return (
    <div style={{ background: C.pane, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
      {/* Tabs — the column itself is permanent; transport lives in the bottom bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "14px 14px 0", flexShrink: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => openPanel(t.id)}
            style={{ flex: 1, height: 32, borderRadius: 8, border: "none", cursor: "pointer", background: tab === t.id ? C.surf : "transparent", color: tab === t.id ? C.text : C.muted, fontSize: 12, fontWeight: 700, transition: "all .15s" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "nowplaying" && (
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "20px 20px 24px" }}>
          {currentTrack ? (
            <>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                <button onClick={() => setPlayerPageOpen(true)} aria-label="Open full-screen player"
                  style={{ width: "100%", maxWidth: 236, aspectRatio: "1 / 1", borderRadius: 16, background: currentTrack.bg, overflow: "hidden", boxShadow: `0 12px 40px ${currentTrack.bg}88`, position: "relative", border: "none", padding: 0, cursor: "pointer", display: "block" }}>
                  {currentTrack.imageUrl && (
                    <img src={currentTrack.imageUrl} alt="" loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", aspectRatio: "1 / 1" }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
                  )}
                  {/* Equaliser glyph — only while audio is actually moving */}
                  {isPlaying && (
                    <div style={{ position: "absolute", left: 10, top: 10, display: "flex", alignItems: "flex-end", gap: 2.5, height: 18 }}>
                      {[...Array(4)].map((_, i) => (
                        <div key={i} style={{ width: 3, height: 6, borderRadius: 2, background: "rgba(255,255,255,0.92)", animation: `wave ${0.55 + (i % 3) * 0.2}s ease-in-out infinite alternate`, animationDelay: `${i * 0.12}s` }} />
                      ))}
                    </div>
                  )}
                  <div style={{ position: "absolute", right: 8, bottom: 8, width: 34, height: 34, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", color: "#fff" }}>
                    <Maximize2 size={14} />
                  </div>
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 17, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTrack.title}</div>
                  <div style={{ fontSize: 13.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTrack.artist}</div>
                </div>
                {uiState.signedIn && (
                  <button onClick={() => toggleLike(currentTrack.id)} aria-label={isLiked ? "Unlike" : "Like"}
                    style={{ width: 36, height: 36, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: isLiked ? C.accent : C.muted, flexShrink: 0 }}>
                    <Heart size={18} fill={isLiked ? C.accent : "none"} />
                  </button>
                )}
              </div>
              {/* Lyrics preview — a taste of the sync (or opening lines), full
                  lyrics live behind the Lyrics tab this card opens. */}
              {(uiState.hasLyrics || lyricsLoading) && (
                <button onClick={() => openPanel("lyrics")} aria-label="Open lyrics"
                  style={{ display: "block", width: "100%", textAlign: "left", marginTop: 16, padding: "12px 14px", borderRadius: 12, background: C.surf, border: "none", cursor: "pointer", fontFamily: "inherit", transition: "background .15s" }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.border)}
                  onMouseLeave={e => (e.currentTarget.style.background = C.surf)}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: C.dim, marginBottom: 8 }}>LYRICS</div>
                  {lyricsLoading && lyrics.length === 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {[86, 64, 74].map((w, i) => (
                        <div key={i} style={{ width: `${w}%`, height: 10, borderRadius: 5, background: C.border, animation: "fadeIn .6s ease infinite alternate", animationDelay: `${i * 0.12}s` }} />
                      ))}
                    </div>
                  ) : lyrics.length > 0 ? (
                    (() => {
                      const activeIdx = lyrics.reduce((b, l, i) => (l.time <= elapsed ? i : b), -1);
                      const start = Math.max(activeIdx, 0);
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {lyrics.slice(start, start + 4).map((l, i) => {
                            const current = start + i === activeIdx;
                            return (
                              <div key={start + i}
                                style={{ fontSize: current ? 14 : 13, fontWeight: current ? 700 : 500, color: current ? C.text : C.muted, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {l.text}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()
                  ) : (
                    (() => {
                      const lines = plainLyrics.split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 4);
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {lines.map((l, i) => (
                            <div key={i}
                              style={{ fontSize: 13, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? C.text : C.muted, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {l}
                            </div>
                          ))}
                        </div>
                      );
                    })()
                  )}
                </button>
              )}
              {/* NEXT UP — the design's continuation preview */}
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: C.dim, marginTop: 16, marginBottom: 6 }}>NEXT UP</div>
              {nextUp ? (
                <div role="button" tabIndex={0}
                  onClick={() => playTrack(nextUp, queue)}
                  onKeyDown={e => e.key === "Enter" && playTrack(nextUp, queue)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: 6, borderRadius: 10, cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.surf)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <CoverArt bg={nextUp.bg} imageUrl={nextUp.imageUrl} size={44} radius={8} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nextUp.title}</div>
                    <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nextUp.artist}</div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, padding: "4px 6px" }}>
                  Nothing queued — a vibe match keeps the music going when this ends.
                </div>
              )}
            </>
          ) : (
            <EmptyState title="Nothing playing yet" sub="Choose something from Home to start listening." />
          )}
        </div>
      )}

      {tab === "lyrics" && (
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "20px 20px 24px" }}>
          <LyricsPanel lyrics={lyrics} plain={plainLyrics} loading={lyricsLoading} elapsed={elapsed} />
        </div>
      )}

      {tab === "queue" && (
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "12px 16px 24px" }}>
          {queued.length > 0 ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Queue · {queued.length}</div>
              {queued.map((t, i) => {
                const isActive = i === activeQueueIdx;
                const reveal = {
                  onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.querySelectorAll<HTMLButtonElement>("button.qctl").forEach(b => { b.style.opacity = "1"; }),
                  onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.querySelectorAll<HTMLButtonElement>("button.qctl").forEach(b => { b.style.opacity = "0"; }),
                };
                const ctlBtn: React.CSSProperties = {
                  width: 22, height: 22, background: "none", border: "none", cursor: "pointer",
                  display: "grid", placeItems: "center", color: C.muted, opacity: 0, transition: "opacity .15s", flexShrink: 0,
                };
                const dropTarget = dragOverIdx === i && dragIdx !== null && dragIdx !== i;
                return (
                  <div key={`${t.id}-${i}`} role="button" tabIndex={0}
                    draggable
                    onDragStart={e => {
                      setDragIdx(i);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(i));
                    }}
                    onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIdx(i); }}
                    onDragLeave={() => setDragOverIdx(prev => (prev === i ? null : prev))}
                    onDrop={e => {
                      e.preventDefault();
                      const from = dragIdx ?? Number(e.dataTransfer.getData("text/plain"));
                      if (Number.isFinite(from) && from !== i) moveQueueItem(from, i);
                      setDragIdx(null);
                      setDragOverIdx(null);
                    }}
                    onClick={() => playTrack(t, queue)}
                    onKeyDown={e => e.key === "Enter" && playTrack(t, queue)}
                    {...reveal}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "6px 6px", borderRadius: 8,
                      cursor: dragIdx === i ? "grabbing" : "pointer",
                      background: isActive ? C.surf : "transparent",
                      boxShadow: dropTarget ? `inset 0 2px 0 ${C.accent}` : "none",
                      opacity: dragIdx === i ? 0.5 : 1,
                      transition: "box-shadow .12s",
                    }}>
                    <span style={{ fontSize: 11, color: isActive ? C.accent : C.muted, width: 14, textAlign: "center", flexShrink: 0 }}>
                      {isActive && isPlaying ? <Pause size={11} fill={C.accent} color={C.accent} /> : i + 1}
                    </span>
                    <CoverArt bg={t.bg} imageUrl={t.imageUrl} size={36} radius={6} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: isActive ? C.accent : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{t.artist}</div>
                    </div>
                    <span style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>{t.duration}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                      <button className="qctl" aria-label="Move up"
                        onClick={e => { e.stopPropagation(); moveQueueItem(i, i - 1); }}
                        style={{ ...ctlBtn, visibility: i === 0 ? "hidden" : "visible" }}>
                        <ChevronUp size={14} />
                      </button>
                      <button className="qctl" aria-label="Move down"
                        onClick={e => { e.stopPropagation(); moveQueueItem(i, i + 1); }}
                        style={{ ...ctlBtn, visibility: i === queued.length - 1 ? "hidden" : "visible" }}>
                        <ChevronDown size={14} />
                      </button>
                      <button className="qctl" aria-label="Remove from queue"
                        style={ctlBtn}
                        onClick={e => { e.stopPropagation(); removeFromQueue(i); }}>
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          ) : preview.length > 0 ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Suggested</div>
              {preview.map(t => (
                <div key={t.id} role="button" tabIndex={0}
                  onClick={() => playTrack(t, [t, ...queued])}
                  onKeyDown={e => e.key === "Enter" && playTrack(t, [t, ...queued])}
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
          ) : <EmptyState title="Queue is empty" sub="Add tracks with “Add to queue” — use the ⋯ menu on any song." />}
        </div>
      )}

    </div>
  );
}

// ─── PlayerBar ─────────────────────────────────────────────────────────────────
function PlayerBar() {
  const {
    C, currentTrack, isPlaying, togglePlay, playNext, playPrev,
    progress, elapsed, audioDuration, handleSeek,
    shuffleOn, toggleShuffle, repeatMode, cycleRepeat,
    volume, setVolume, uiState, panelTab, togglePanel,
    setPlayerPageOpen, playerPageOpen,
  } = useApp();
  const [showVol, setShowVol] = useState(false);

  const iconBtn = (active = false): React.CSSProperties => ({
    width: 32, height: 32, background: "none", border: "none", cursor: "pointer",
    display: "grid", placeItems: "center", color: active ? C.accent : C.muted,
  });

  return (
    <div style={{ background: C.pane, display: "flex", alignItems: "center", padding: "0 16px", height: "100%", gap: 16, position: "relative", overflow: "hidden" }}>
      {/* Left — cover/title open the full player */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
        {currentTrack && (
          <>
            <button onClick={() => setPlayerPageOpen(true)} aria-label="Open full-screen player"
              style={{ padding: 0, border: "none", background: "none", cursor: "pointer", flexShrink: 0, display: "block", position: "relative", borderRadius: 10 }}>
              <CoverArt bg={currentTrack.bg} imageUrl={currentTrack.imageUrl} size={48} radius={10} />
              <span style={{ position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 6, background: "rgba(0,0,0,0.65)", display: "grid", placeItems: "center", color: "#fff", pointerEvents: "none" }}>
                <ChevronUp size={12} />
              </span>
            </button>
            <button onClick={() => setPlayerPageOpen(true)}
              style={{ minWidth: 0, flex: 1, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTrack.title}</div>
              <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTrack.artist}</div>
            </button>
          </>
        )}
      </div>

      {/* Center — the app's one and only transport cluster */}
      <div style={{ flex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, maxWidth: 720, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {uiState.hasQueue && (
            <button onClick={toggleShuffle} aria-label="Shuffle" style={{ ...iconBtn(shuffleOn), width: 30, height: 30 }}>
              <Shuffle size={16} />
            </button>
          )}
          <button onClick={playPrev} aria-label="Previous track" style={{ ...iconBtn(), width: 30, height: 30, color: C.text }}>
            <SkipBack size={18} />
          </button>
          <button onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}
            style={{ width: 40, height: 40, borderRadius: "50%", background: "#fff", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "#14131c", boxShadow: "0 2px 10px rgba(0,0,0,0.25)" }}>
            {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button onClick={playNext} aria-label="Next track" style={{ ...iconBtn(), width: 30, height: 30, color: C.text }}>
            <SkipForward size={18} />
          </button>
          {uiState.hasQueue && (
            <button onClick={cycleRepeat} aria-label="Repeat mode" style={{ ...iconBtn(repeatMode !== "off"), width: 30, height: 30 }}>
              {repeatMode === "one" ? <Repeat1 size={16} /> : <Repeat2 size={16} />}
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <span style={{ fontSize: 11, color: C.muted, width: 34, textAlign: "right", flexShrink: 0 }}>{fmtSec(elapsed)}</span>
          <div role="button" tabIndex={0} aria-label="Seek"
            onClick={e => { const r = e.currentTarget.getBoundingClientRect(); handleSeek((e.clientX - r.left) / r.width); }}
            onKeyDown={e => {
              if (e.key === "ArrowRight") { e.preventDefault(); handleSeek(Math.min(1, progress + 0.02)); }
              if (e.key === "ArrowLeft")  { e.preventDefault(); handleSeek(Math.max(0, progress - 0.02)); }
            }}
            style={{ flex: 1, height: 4, borderRadius: 2, background: C.border, cursor: "pointer", position: "relative", minWidth: 0 }}>
            <div style={{ width: `${Math.min(progress, 1) * 100}%`, height: "100%", borderRadius: 2, background: C.accent, transition: "width .5s linear" }} />
          </div>
          <span style={{ fontSize: 11, color: C.muted, width: 34, flexShrink: 0 }}>{audioDuration > 0 ? fmtSec(audioDuration) : (currentTrack?.duration ?? "--:--")}</span>
        </div>
      </div>

      {/* Right — panel openers, volume, expand (never transport) */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2, position: "relative", minWidth: 0 }}>
        {uiState.hasLyrics && (
          <button onClick={() => togglePanel("lyrics")} aria-label="Lyrics" style={iconBtn(panelTab === "lyrics")}>
            <Mic size={16} />
          </button>
        )}
        {uiState.hasQueue && (
          <button onClick={() => togglePanel("queue")} aria-label="Queue" style={iconBtn(panelTab === "queue")}>
            <ListMusic size={16} />
          </button>
        )}
        <button onClick={() => setShowVol(v => !v)} aria-label="Volume" style={iconBtn(volume === 0)}>
          {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        {showVol && (
          <div style={{ position: "absolute", bottom: "calc(100% + 8px)", right: 0, background: C.pane, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, zIndex: 30, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
            <Volume2 size={14} color={C.muted} />
            <input type="range" min={0} max={1} step={0.01} value={volume}
              onChange={e => setVolume(parseFloat(e.target.value))}
              style={{ width: 100, accentColor: C.accent }} />
            <span style={{ fontSize: 11, color: C.muted, minWidth: 30 }}>{Math.round(volume * 100)}%</span>
          </div>
        )}
        <button onClick={() => setPlayerPageOpen(!playerPageOpen)} aria-label="Full-screen player" style={{ ...iconBtn(playerPageOpen), marginLeft: 2 }}>
          {playerPageOpen ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
      </div>
    </div>
  );
}

// ─── MobileLayout ──────────────────────────────────────────────────────────────
function MobileLayout() {
  const { C, screen, navigate, currentTrack, isPlaying, togglePlay, progress,
    uiState, errorState } = useApp();

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
        {errorState ? (
          <ErrorScreen error={errorState} />
        ) : screen.id === "auth" ? (
          <AuthScreen mode={screen.mode} />
        ) : screen.id === "notfound" ? (
          <ErrorScreen error={{
            variant: "notfound", code: "404",
            message: "That page doesn't exist — it may have moved.",
            requestId: `nf-${Date.now()}`, at: Date.now(),
          }} />
        ) : (
          <ErrorBoundary colors={C} compact onReset={() => navigate({ id: "home" })}>
            <ScreenView s={screen} />
          </ErrorBoundary>
        )}
      </div>

      {currentTrack && (
        <div
          style={{ margin: "0 8px 6px", background: C.pane, borderRadius: 16, padding: "10px 12px 14px", position: "relative", border: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CoverArt bg={currentTrack.bg} imageUrl={currentTrack.imageUrl} size={44} radius={10} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTrack.title}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{currentTrack.artist}</div>
            </div>
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

  // ⌘⇧L (Ctrl⇧L) — jump to Search from anywhere and focus the field, the
  // shortcut the Home search pill advertises.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "l") return;
      e.preventDefault();
      if (screen.id !== "search") navigate({ id: "search" });
      // Fire after the screen paints — screens stay mounted, visibility flips.
      requestAnimationFrame(() => window.dispatchEvent(new Event("vibra:focus-search")));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen.id, navigate]);

  // Playback state — the player always opens on the most recently played song.
  const [currentTrack, setCurrentTrack]   = useState<Track | null>(
    () => (getHistory()[0] as unknown as Track) ?? null,
  );
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

  // User & library
  const [user, setUser]                             = useState<User | null>(null);
  const [userLoading, setUserLoading]               = useState(true);
  /**
   * Hard auth gate: the app belongs to a signed-in listener. A live session
   * OR the persisted local profile (someone signed in before, now offline)
   * opens it; everyone else gets the Log in screen and nothing else.
   */
  const authGate = !userLoading && !user;
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
  const [pendingCreateTrack, setPendingCreateTrack] = useState<Track | null>(null);

  // Settings
  const [theme, setTheme]                               = useState("dark");
  const [accent, setAccent]                             = useState(() => getUserProfile()?.accentColor ?? "#1ED760");
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

  // ── Contextual UI ─────────────────────────────────────────────────────────────
  /** Right panel — closed by default; the bar opens it per tab. */
  const [panelTab, setPanelTab] = useState<PanelTab | null>(null);
  const [playerPageOpen, setPlayerPageOpen] = useState(false);
  const [lyrics, setLyrics]                 = useState<LyricLine[]>([]);
  const [plainLyrics, setPlainLyrics]       = useState("");
  const [lyricsLoading, setLyricsLoading]   = useState(false);
  /** Failure shown in the main area; shell/sidebar/bar stay intact. */
  const [errorState, setErrorState] = useState<AppError | null>(null);
  /** Set on the first play this session — the player bar exists only after it. */
  // A loaded track from a previous session shows the bar immediately: it
  // persists across reloads and re-logins, not only until the first play.
  const [hasPlayback, setHasPlayback] = useState(() => getHistory().length > 0);
  /** Bumped on login/logout so auth-derived state recomputes. */
  const [authVersion, setAuthVersion] = useState(0);

  // ── Server-driven home feed ───────────────────────────────────────────────────
  // Shelves hydrate from the last successful fetch so Home paints instantly —
  // never an empty screen while the catalogue is slow.
  const initialShelves = useRef<HomeShelf[]>(readCachedShelves()).current;
  const [shelves, setShelves] = useState<HomeShelf[]>(initialShelves);
  const [homeLoading, setHomeLoading] = useState(initialShelves.length === 0);
  const hasShelvesRef = useRef(initialShelves.length > 0);
  /** Item ids dismissed via “Not interested” (also POSTed to the BFF). */
  const [hiddenIds, setHiddenIds] = useState<Record<string, boolean>>({});

  // ── Output devices (“Playing on”) ─────────────────────────────────────────────
  const [outputDevice, setOutputDevice] = useState<OutputDevice>(() => getActiveOutput());
  const [devices, setDevices] = useState<OutputDevice[]>([]);

  // ── Listening-history privacy ─────────────────────────────────────────────────
  const [historyPaused, setHistoryPausedState] = useState(() => isHistoryPaused());

  const refreshHome = useCallback(() => {
    // Keep what's on screen while refreshing; only show the skeleton on a
    // true first load with nothing cached.
    if (!hasShelvesRef.current) setHomeLoading(true);
    fetchHome()
      .then(s => {
        if (s.length > 0) {
          setShelves(s);
          hasShelvesRef.current = true;
          writeCachedShelves(s);
        }
      })
      .catch(() => { /* fetchHome already degrades to synthesised shelves */ })
      .finally(() => setHomeLoading(false));
  }, []);

  // ── Vibe queue: recent-artist matches that continue the queue ────────────────
  /** Sanitised pool of tracks drawn from what the listener has been playing. */
  const [vibePool, setVibePool] = useState<Track[]>([]);
  const refreshVibes = useCallback(() => {
    const artists: string[] = [];
    for (const t of recentTracks) {
      if (t.artist && !artists.includes(t.artist)) artists.push(t.artist);
      if (artists.length >= 3) break;
    }
    if (artists.length === 0) { setVibePool([]); return; }
    void Promise.all(
      artists.map(a => searchTracks(a, 8).catch(() => [])),
    ).then(results => {
      const flat = results.flat().map((t, i) => fromApiTrack(t, i));
      setVibePool(sanitizeMusicItems(flat).slice(0, 24));
    });
  }, [recentTracks]);

  /**
   * One listen should reshape what the *queue* continues with — refresh the
   * vibe pool a few seconds after a play (debounced). Home itself is never
   * refetched here: it stays put until the user asks for it.
   */
  const vibeTimer = useRef<number | undefined>(undefined);
  const scheduleVibeRefresh = useCallback(() => {
    window.clearTimeout(vibeTimer.current);
    vibeTimer.current = window.setTimeout(() => refreshVibes(), 8000);
  }, [refreshVibes]);
  useEffect(() => () => window.clearTimeout(vibeTimer.current), []);
  // First paint: build the vibe pool from whatever history exists.
  useEffect(() => { refreshVibes(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Re-enumerates outputs; `requestLabels` asks the browser for device names. */
  const refreshDevices = useCallback((requestLabels = false) => {
    listOutputDevices(requestLabels).then(setDevices).catch(() => {});
  }, []);

  const openPanel = useCallback((tab: PanelTab) => setPanelTab(tab), []);
  const togglePanel = useCallback((tab: PanelTab) => setPanelTab(p => (p === tab ? null : tab)), []);
  const showError = useCallback((error: AppError) => setErrorState(error), []);
  const clearError = useCallback(() => setErrorState(null), []);

  // ── Bootstrap user ────────────────────────────────────────────────────────────
  useEffect(() => {
    // Coming back from Google OAuth: trade the Neon Auth session for a Vibra
    // bearer first, so /auth/me below sees the fresh sign-in.
    const bootstrap = async () => {
      clearOAuthQueryParams();
      if (!isSignedIn()) {
        await exchangeNeonSession();
      }
      const u = await api<User>("/auth/me");
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
      } else if (isSignedIn()) {
        // Offline with a live-looking token: keep working from the cached profile.
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
      } else {
        // No token at all — signed out. Drop any cached profile so the gate,
        // not a "Local profile" half-state, owns this screen.
        clearUserProfile();
      }
      setUserLoading(false);
    };
    bootstrap();
  }, []);

  // ── Bootstrap library ─────────────────────────────────────────────────────────
  useEffect(() => {
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
    // Re-runs on login/logout so the library always reflects the active session.
  }, [authVersion]);

  // ── Home feed — server-driven shelves (re-fetches when auth changes) ─────────
  useEffect(() => { refreshHome(); }, [refreshHome, authVersion]);

  // ── Output devices — keep the active device in sync ──────────────────────────
  useEffect(() => {
    const unsub = subscribeOutput(setOutputDevice);
    refreshDevices();
    return unsub;
  }, [refreshDevices]);

  // ── Fetch discovery from the live audio engine ───────────────────────────────
  // The BFF blends these queries with the browser's initial locale, so a
  // first-visit account gets its local charts before any play telemetry.
  useEffect(() => {
    setDiscoveryLoading(true);
    let cancelled = false;
    (async () => {
      try {
        // Serialised on purpose: three parallel BFF calls each fan out into
        // the engine, which serves searches one at a time — together they
        // starve it and the 7s catalogue timeout yields nothing.
        let backendNR: any[] | null = null;
        const trendingRows = await api<unknown[]>(`/discover/trending?${localeParam()}`);
        // BFF unreachable → engine-direct fallback (market chart + generic).
        let trendingList = toApiTracks(trendingRows);
        if (trendingList.length === 0) {
          trendingList = await searchTracks(marketChartQuery(), 20);
          if (trendingList.length === 0) trendingList = await searchTracks("trending music", 20);
        }
        if (cancelled) return;
        // Client fallbacks bypass the BFF's music-only rules — same filter here.
        trendingList = sanitizeMusicItems(trendingList);
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
        // Trending (and with it the featured hero) has its answer now — show
        // it while the new-releases shelf is still being fetched.
        if (!cancelled) setDiscoveryLoading(false);

        const featuredRows = await api<unknown[]>(`/discover/featured?${localeParam()}`);
        backendNR = await api<any[]>("/discover/new-releases");
        if (cancelled) return;
        let freshList = toApiTracks(featuredRows, 12);
        if (freshList.length === 0) freshList = await searchTracks("new music releases", 12);
        freshList = sanitizeMusicItems(freshList);
        if (freshList.length > 0 && !backendNR) {
          setNewReleases(prev => prev.length > 0 ? prev : freshList.slice(0, 6).map((t, i) => ({
            id: String(t.id), title: t.title, artist: t.artist,
            year: String(new Date().getFullYear()), bg: BG_PALETTE[i % BG_PALETTE.length], imageUrl: t.imageUrl, trackCount: 1,
          })));
        }
        if (backendNR && backendNR.length > 0) setNewReleases(backendNR.map(mapAPIAlbum));
        setDiscoveryLoading(false);
      } catch {
        if (!cancelled) setDiscoveryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Liked tracks list ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (likedTrackIds.size === 0) return;
    setLikedTracks(discoveryTracks.filter(t => likedTrackIds.has(t.id)));
  }, [likedTrackIds, discoveryTracks]);

  // ── Lyrics for the current track ──────────────────────────────────────────────
  useEffect(() => {
    if (!currentTrack) { setLyrics([]); setPlainLyrics(""); setLyricsLoading(false); return; }
    let cancelled = false;
    setLyrics([]); setPlainLyrics(""); setLyricsLoading(true);
    fetchLyricsFromApi(currentTrack.title, currentTrack.artist).then(r => {
      if (cancelled) return;
      setLyrics(r.synced); setPlainLyrics(r.plain); setLyricsLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentTrack]);

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
    setHasPlayback(true);

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
      // First audible frame: labels are now requestable, report real output.
      void refreshOutput();
    });
    a.addEventListener("ended", () => {
      if (playSessionRef.current === session) handleTrackEndRef.current();
    });
    audioRef.current = a;
    registerSinkElement(a);
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

  /**
   * The queue ran dry — continue with a vibe match (a recent-artist track not
   * already queued) instead of going silent. Returns false when the pool has
   * nothing new to offer.
   */
  const startVibeIfAny = useCallback((): boolean => {
    const queued = new Set(queue.map(t => String(t.id)));
    const pick = vibePool.find(t => !queued.has(String(t.id)) && t.id !== currentTrack?.id);
    if (!pick) return false;
    setQueueIdx(queue.length);
    setQueue([...queue, pick]);
    setCurrentTrack(pick);
    setProgress(0); setElapsed(0);
    beginPlayback(pick);
    sendEvent({ type: "play", trackId: pick.id, title: pick.title, image: pick.imageUrl, positionMs: 0, artist: pick.artist });
    scheduleVibeRefresh();
    return true;
  }, [queue, vibePool, currentTrack, beginPlayback, scheduleVibeRefresh]);

  const handleTrackEnd = useCallback(() => {
    if (repeatMode === "one") {
      setProgress(0); setElapsed(0);
      const a = audioRef.current;
      if (a) { a.currentTime = 0; a.play().catch(() => {}); }
      return;
    }
    // Natural completion — feeds “Jump back in” / “Because you played …”.
    if (currentTrack) {
      sendEvent({
        type: "complete",
        trackId: currentTrack.id,
        title: currentTrack.title,
        image: currentTrack.imageUrl,
        positionMs: Math.round((audioDuration || currentTrack.durationSec || 0) * 1000),
        artist: currentTrack.artist,
      });
      scheduleVibeRefresh();
    }
    if (queue.length === 0) { if (!startVibeIfAny()) setIsPlaying(false); return; }
    // Invalid queue index (the seeded queue didn't contain the clicked track)
    // → keep going from the first queued item rather than stopping.
    const next = shuffleOn
      ? Math.floor(Math.random() * queue.length)
      : queueIdx < 0 || queueIdx >= queue.length ? 0
      : queueIdx + 1 < queue.length ? queueIdx + 1 : repeatMode === "all" ? 0 : -1;
    if (next < 0) { if (!startVibeIfAny()) setIsPlaying(false); return; }
    setQueueIdx(next);
    const t = queue[next];
    setCurrentTrack(t);
    setProgress(0); setElapsed(0);
    beginPlayback(t);
    sendEvent({ type: "play", trackId: t.id, title: t.title, image: t.imageUrl, positionMs: 0, artist: t.artist });
    scheduleVibeRefresh();
  }, [queue, queueIdx, shuffleOn, repeatMode, beginPlayback, currentTrack, audioDuration, scheduleVibeRefresh, startVibeIfAny]);
  handleTrackEndRef.current = handleTrackEnd;

  // ── playTrack ─────────────────────────────────────────────────────────────────
  const playTrack = useCallback((t: Track, newQueue?: Track[], sourceShelfId?: string) => {
    if (currentTrack && currentTrack.id !== t.id) {
      setHistory(h => [...h.slice(-19), currentTrack]);
    }
    // Persist to vibra_history (deduped, capped at 50) and refresh the rail.
    setRecentTracks(addHistoryTrack(t as StoredTrack) as unknown as Track[]);
    // Mirror to the BFF so weekly minutes and recent plays survive the device.
    if (user) {
      void api("/library/recent", {
        method: "POST",
        body: JSON.stringify({
          trackId: String(t.id),
          artistId: t.artist,
          durationMs: t.durationSec ? Math.round(t.durationSec * 1000) : 0,
        }),
      });
    }
    setCurrentTrack(t);
    setProgress(0); setElapsed(0);
    if (newQueue) {
      setQueue(newQueue);
      setQueueIdx(newQueue.findIndex(x => x.id === t.id));
    }
    beginPlayback(t);
    // Shelf attribution teaches GET /api/home which rows land (title+image
    // let the BFF render "Jump back in" without a second lookup).
    sendEvent({ type: "play", trackId: t.id, title: t.title, image: t.imageUrl, positionMs: 0, sourceShelfId, artist: t.artist });
    // …and the feed itself should learn: refresh Home once the event lands.
    scheduleVibeRefresh();
  }, [currentTrack, beginPlayback, scheduleVibeRefresh, user]);

  // ── addToQueue / playNextInQueue ──────────────────────────────────────────────
  const addToQueue = useCallback((t: Track) => {
    if (!currentTrack) { playTrack(t, [t]); return; }
    if (queue.length === 0) {
      setQueue([currentTrack, t]);
      setQueueIdx(0);
      toast(`Queued “${t.title}”`);
      return;
    }
    setQueue(prev => [...prev, t]);
    toast(`Queued “${t.title}”`);
  }, [currentTrack, queue.length, playTrack]);

  /** Bulk addToQueue — one state update so a shelf's order survives intact. */
  const queueAll = useCallback((items: Track[]) => {
    if (items.length === 0) return;
    if (!currentTrack) { playTrack(items[0], items); return; }
    if (queue.length === 0) {
      setQueue([currentTrack, ...items]);
      setQueueIdx(0);
      toast(`Queued ${items.length} track${items.length === 1 ? "" : "s"}`);
      return;
    }
    const known = new Set(queue.map(t => t.id));
    const add = items.filter(t => !known.has(t.id));
    if (add.length === 0) { toast("Already in your queue"); return; }
    setQueue(prev => [...prev, ...add]);
    toast(`Queued ${add.length} track${add.length === 1 ? "" : "s"}`);
  }, [currentTrack, queue, playTrack]);

  const playNextInQueue = useCallback((t: Track) => {
    if (!currentTrack) { playTrack(t, [t]); return; }
    if (queue.length === 0) {
      setQueue([currentTrack, t]);
      setQueueIdx(0);
      toast(`Playing next: “${t.title}”`);
      return;
    }
    const at = Math.min(Math.max(queueIdx, 0) + 1, queue.length);
    setQueue(prev => { const next = [...prev]; next.splice(at, 0, t); return next; });
    toast(`Playing next: “${t.title}”`);
  }, [currentTrack, queue.length, queueIdx, playTrack]);

  // ── moveQueueItem / removeFromQueue ───────────────────────────────────────────
  const moveQueueItem = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
    const next = [...queue];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setQueue(next);
    if (currentTrack) {
      const idx = next.findIndex(x => x.id === currentTrack.id);
      setQueueIdx(idx >= 0 ? idx : Math.min(queueIdx, next.length - 1));
    }
  }, [queue, currentTrack, queueIdx]);

  const removeFromQueue = useCallback((index: number) => {
    if (index < 0 || index >= queue.length) return;
    const removingCurrent = currentTrack != null && index === queueIdx;
    const next = queue.filter((_, i) => i !== index);
    setQueue(next);
    if (!currentTrack) return;
    const idx = next.findIndex(x => x.id === currentTrack.id);
    if (idx >= 0) { setQueueIdx(idx); return; }
    if (removingCurrent) {
      if (next.length > 0) {
        const at = Math.min(index, next.length - 1);
        const t = next[at];
        setQueueIdx(at);
        setCurrentTrack(t);
        setProgress(0); setElapsed(0);
        beginPlayback(t);
      } else {
        if (audioRef.current) audioRef.current.pause();
        setQueueIdx(-1);
        setCurrentTrack(null);
        setProgress(0); setElapsed(0);
        setIsPlaying(false);
      }
    } else {
      setQueueIdx(Math.min(queueIdx, next.length - 1));
    }
  }, [queue, currentTrack, queueIdx, beginPlayback]);

  // ── Create-playlist modal (optionally seeding it with a track) ───────────────
  const openCreatePlaylist = useCallback((track?: Track) => {
    setPendingCreateTrack(track ?? null);
    setCreatePlaylistOpen(true);
  }, []);

  // ── playNext ──────────────────────────────────────────────────────────────────
  const playNext = useCallback(() => {
    if (queue.length === 0) { startVibeIfAny(); return; }
    const atEnd = !shuffleOn && queueIdx + 1 >= queue.length;
    const next = shuffleOn
      ? Math.floor(Math.random() * queue.length)
      : Math.min(queueIdx + 1, queue.length - 1);
    const t = queue[next];
    // Skip at the very end of the queue → keep going with a vibe match.
    if (!t || (t.id === currentTrack?.id && next === queueIdx)) {
      if (atEnd && startVibeIfAny()) return;
      return;
    }
    // A manual skip — tell the BFF where the user bailed out.
    if (currentTrack) {
      sendEvent({ type: "skip", trackId: currentTrack.id, title: currentTrack.title, image: currentTrack.imageUrl, positionMs: Math.round(elapsed * 1000), artist: currentTrack.artist });
    }
    setHistory(h => currentTrack ? [...h.slice(-19), currentTrack] : h);
    setQueueIdx(next);
    setCurrentTrack(t);
    setProgress(0); setElapsed(0);
    beginPlayback(t);
    // The newly started track is taste too — log the start, refresh Home later.
    sendEvent({ type: "play", trackId: t.id, title: t.title, image: t.imageUrl, positionMs: 0, artist: t.artist });
    scheduleVibeRefresh();
  }, [queue, queueIdx, shuffleOn, currentTrack, beginPlayback, elapsed, scheduleVibeRefresh, startVibeIfAny]);

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
    // Resolve the full track so the BFF like event carries artist/title —
    // one heart is enough to move artist affinity.
    const known = [currentTrack, ...queue, ...likedTracks, ...recentTracks, ...discoveryTracks]
      .find(t => t !== null && String(t.id) === String(id)) ?? null;
    setLikedTrackIds(prev => {
      const n = new Set(prev);
      const wasLiked = n.has(id);
      wasLiked ? n.delete(id) : n.add(id);
      api(`/library/liked/${id}`, { method: "POST", body: JSON.stringify({ liked: !wasLiked }) });
      sendEvent({
        type: wasLiked ? "unlike" : "like",
        trackId: id,
        title: known?.title,
        image: known?.imageUrl,
        artist: known?.artist,
      });
      return n;
    });
  }, [currentTrack, queue, likedTracks, recentTracks, discoveryTracks]);

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
      return {
        ...pl,
        tracks: [track, ...pl.tracks],
        trackCount: pl.trackCount + 1,
        // Cover follows the first song (tracks are prepend-ordered).
        imageUrl: track.imageUrl || pl.imageUrl,
        bg: track.bg || pl.bg,
      };
    }));
    // Mirror to the BFF (silently keeps local-only playlists working).
    if (!playlistId.startsWith("local_")) {
      void api<any>(`/library/playlists/${playlistId}/tracks`, {
        method: "POST",
        body: JSON.stringify({
          track_id: String(track.id),
          title: track.title,
          artist: track.artist,
          imageUrl: track.imageUrl,
          coverColor: track.bg,
          durationMs: track.durationSec ? Math.round(track.durationSec * 1000) : undefined,
          videoId: track.videoId,
        }),
      });
    }
  }, []);

  /** Drag-and-drop playlist reorder — local first, then the BFF order. */
  const reorderPlaylist = useCallback((playlistId: string, from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    reorderStoredPlaylistTracks(playlistId, from, to);
    setPlaylists(prev => prev.map(pl => {
      if (pl.id !== playlistId) return pl;
      const tracks = [...pl.tracks];
      const [moved] = tracks.splice(from, 1);
      tracks.splice(to, 0, moved);
      if (!playlistId.startsWith("local_")) {
        void api<any>(`/library/playlists/${playlistId}/tracks`, {
          method: "PUT",
          body: JSON.stringify({ track_ids: tracks.map(t => String(t.id)) }),
        });
      }
      return { ...pl, tracks };
    }));
  }, []);

  /** Writes profile edits to vibra_user_profile and mirrors them into UI state. */
  const updateProfile = useCallback((
    patch: Partial<{ name: string; username: string; initials: string; email: string; avatarUrl: string; subscription: "premium" | "free"; accentColor: string; audioQuality: string }>,
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

  // ── Session: register / login / logout (services/auth.ts) ─────────────────────
  const applySessionUser = useCallback((u: User) => {
    setUser(u);
    updateUserProfile({
      name: u.name, username: u.username, initials: u.initials, email: u.email,
      avatarUrl: u.avatarUrl, subscription: u.subscription === "premium" ? "premium" : "free",
    });
  }, []);

  /** Resolves `null` on success, or the inline error message to render. */
  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const res = await loginUser({ email, password });
    if (!res) return "We couldn't sign you in. Check your email and password.";
    applySessionUser(res.user);
    setAuthVersion(v => v + 1);
    toast.success(`Welcome back, ${res.user.name.split(" ")[0]}`);
    return null;
  }, [applySessionUser]);

  const register = useCallback(async (name: string, email: string, password: string): Promise<string | null> => {
    const res = await registerUser({ name, email, password });
    if (!res) return "Couldn't create that account. The email may already be registered.";
    applySessionUser(res.user);
    setAuthVersion(v => v + 1);
    toast.success("Account created");
    return null;
  }, [applySessionUser]);

  const logout = useCallback(async (reason?: "idle") => {
    await logoutUser();
    await signOutNeon();
    setUser(null);
    setAuthVersion(v => v + 1);
    toast(reason === "idle"
      ? "Signed out — you were inactive for 30 minutes"
      : "Signed out");
  }, []);

  // ── Home feedback & privacy ───────────────────────────────────────────────────
  /** Optimistic dismissal from any shelf + `not_interested` to the BFF. */
  const hideItem = useCallback((opts: { id: string; kind: "track" | "artist"; artist?: string; shelfId?: string; title?: string }) => {
    setHiddenIds(prev => ({ ...prev, [opts.id]: true }));
    sendEvent({ type: "not_interested", trackId: opts.id, title: opts.title, positionMs: 0, sourceShelfId: opts.shelfId, artist: opts.artist });
  }, []);

  const setHistoryPaused = useCallback((paused: boolean) => {
    setHistoryPausedState(paused);
    persistHistoryPaused(paused);
    void api("/api/settings/history", { method: "PUT", body: JSON.stringify({ paused }) });
  }, []);

  const resetRecommendations = useCallback(async () => {
    await api("/api/home", { method: "DELETE" });
    clearStoredHistory();
    setRecentTracks([]);
    refreshHome();
    toast.success("Listening history and recommendations reset");
  }, [refreshHome]);

  // ── Output switching ─────────────────────────────────────────────────────────
  const selectOutput = useCallback((deviceId: string) => {
    void switchOutput(deviceId).then(() => refreshDevices(true));
  }, [refreshDevices]);

  // Quiet background pings — the banner only appears after 3 consecutive
  // failures or an active request timeout (see services/safeFetch.ts).
  useEffect(() => startConnectionMonitor(BFF_BASE), []);

  // Dead session (rotated/expired token) — drop to signed-out with a clear message.
  useEffect(() => onSessionExpired(() => {
    // The server said this token is dead: drop the cached profile too, so the
    // bootstrap fallback can't mask the gate with a stale "Local profile".
    clearUserProfile();
    setUser(null);
    setAuthVersion(v => v + 1);
    toast("Your session expired — sign in again");
  }), []);

  // ── uiState — the single derivation every conditional render reads ────────────
  const uiState: UiState = useMemo(() => ({
    hasPlayback,
    hasQueue: queue.length >= 2,
    hasLyrics: lyrics.length > 0 || plainLyrics.trim().length > 0,
    hasHistory: recentTracks.length > 0 || history.length > 0,
    isPlaying,
    deviceCount: Math.max(devices.length, 1),
    signedIn: isSignedIn(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [authVersion, hasPlayback, queue.length,
       recentTracks.length, history.length, isPlaying, devices.length,
       lyrics.length, plainLyrics]);

  // ── Inactivity logout ────────────────────────────────────────────────────────
  // 30 minutes with no pointer/keyboard/touch input signs the user out.
  // Playback counts as presence — nobody gets signed out mid-song.
  const lastActivityRef = useRef(Date.now());
  useEffect(() => {
    if (!uiState.signedIn) return;
    lastActivityRef.current = Date.now();
    const markActive = () => { lastActivityRef.current = Date.now(); };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach(ev => window.addEventListener(ev, markActive, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= 30 * 60 * 1000 && !isPlaying) {
        void logout("idle");
      }
    }, 60 * 1000);
    return () => {
      events.forEach(ev => window.removeEventListener(ev, markActive));
      window.clearInterval(timer);
    };
  }, [uiState.signedIn, isPlaying, logout]);

  // ── Leaving the app stops the sound — nothing plays over the gate ────────────
  useEffect(() => {
    if (authGate && isPlaying) togglePlay();
  }, [authGate, isPlaying, togglePlay]);

  const ctxValue: AppCtxType = {
    C, navigate, goBack, canGoBack: navStack.length > 1, screen,
    currentTrack, isPlaying, progress, elapsed, audioDuration,
    playTrack, togglePlay, playNext, playPrev, handleSeek,
    queue, shuffleOn, toggleShuffle: () => setShuffleOn(s => !s),
    addToQueue, queueAll, playNextInQueue, moveQueueItem, removeFromQueue, openCreatePlaylist,
    repeatMode, cycleRepeat: () => setRepeatMode(m => m === "off" ? "one" : m === "one" ? "all" : "off"),
    volume, setVolume,
    lyrics, plainLyrics, lyricsLoading,
    uiState, panelTab, openPanel, togglePanel,
    playerPageOpen, setPlayerPageOpen,
    errorState, showError, clearError,
    user, userLoading, login, register, logout,
    playlists, playlistsLoading,
    likedTrackIds, toggleLike,
    discoveryTracks, recentTracks, trendingTracks, newReleases,
    artists, likedTracks, downloadedTracks, refreshDownloads,
    discoveryLoading,
    shelves, homeLoading, refreshHome, hiddenIds, hideItem, vibePool,
    outputDevice, devices, refreshDevices, selectOutput,
    theme, setTheme, accent, setAccent,
    audioQuality, setAudioQuality,
    normalizeVolume, setNormalizeVolume,
    autoplay, setAutoplay, crossfade, setCrossfade,
    notifNewReleases, setNotifNewReleases,
    notifRecommendations, setNotifRecommendations,
    notifFollowers, setNotifFollowers,
    shareListening, setShareListening,
    shareData, setShareData,
    historyPaused, setHistoryPaused, resetRecommendations,
    following, toggleFollow,
    openTrackOptions: setTrackOptionsTrack,
    addPlaylist,
    addTrackToPlaylist,
    reorderPlaylist,
    updateProfile,
  };

  /** Main area — error/auth/404 replace content, never the shell. */
  const mainContent = errorState
    ? <ErrorScreen error={errorState} />
    : screen.id === "auth"
      ? <AuthScreen mode={screen.mode} />
      : screen.id === "notfound"
        ? <ErrorScreen error={{
            variant: "notfound", code: "404",
            message: "That page doesn't exist — it may have moved.",
            requestId: `nf-${Date.now()}`, at: Date.now(),
          }} />
        : (
          <ErrorBoundary colors={C} compact onReset={() => { clearError(); navigate({ id: "home" }); }}>
            <ScreenView s={screen} />
          </ErrorBoundary>
        );

  return (
    <UiThemeContext.Provider value={C}>
    <ErrorBoundary colors={C} title="Vibra hit an unexpected signal">
    <AppCtx.Provider value={ctxValue}>
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

      {userLoading ? (
        /* Splash — while bootstrap checks the session (including the return
           from Google sign-in), the app shows neither Home nor the gate. */
        <div style={{ position: "fixed", inset: 0, background: C.bg, display: "grid", placeItems: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: C.text, animation: "fadeIn .4s ease" }}>
            vibra<span style={{ color: C.accent }}>.</span>
          </div>
        </div>
      ) : authGate ? (
        /* Hard gate — no shell, no deep links, no escape until signed in. */
        <AuthScreen mode={screen.id === "auth" ? screen.mode : "login"} />
      ) : (
        <>
      {/* Global modals */}
      {trackOptionsTrack && <TrackOptionsSheet track={trackOptionsTrack} onClose={() => setTrackOptionsTrack(null)} />}
      {createPlaylistOpen && (
        <CreatePlaylistModal
          pendingTrack={pendingCreateTrack ?? undefined}
          onClose={() => { setCreatePlaylistOpen(false); setPendingCreateTrack(null); }}
        />
      )}

      {/* Desktop — 240px sidebar · main · 320px panel; bar on its row */}
      <div className="hidden md:grid"
        style={{
          height: "100dvh",
          position: "relative",
          gridTemplateColumns: "240px minmax(0,1fr) 320px",
          gridTemplateRows: uiState.hasPlayback ? "minmax(0,1fr) 88px" : "minmax(0,1fr)",
          gap: 12, padding: 12, background: C.bg,
        }}>
        <div style={{ gridColumn: "1", gridRow: "1", borderRadius: 18, overflow: "hidden", border: `1px solid ${C.border}`, background: C.pane, display: "flex", flexDirection: "column" }}>
          <LeftSidebar />
        </div>
        <main style={{ gridColumn: "2", gridRow: "1", borderRadius: 18, overflow: "hidden", border: `1px solid ${C.border}`, background: C.pane, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {mainContent}
        </main>
        <aside style={{ gridColumn: "3", gridRow: "1", borderRadius: 18, overflow: "hidden", border: `1px solid ${C.border}`, background: C.pane, display: "flex", flexDirection: "column" }}>
          <ErrorBoundary colors={C} compact onReset={() => navigate({ id: "home" })}>
            <RightPanel />
          </ErrorBoundary>
        </aside>
        {uiState.hasPlayback && (
          <div style={{ gridColumn: "1 / -1", gridRow: "2", borderRadius: 18, overflow: "hidden", border: `1px solid ${C.border}`, minWidth: 0 }}>
            <PlayerBar />
          </div>
        )}
      </div>

      {/* Full-screen player — above the shell, never covering the bar */}
      {playerPageOpen && currentTrack && <PlayerPage />}

      {/* Mobile */}
      <div className="md:hidden" style={{ height: "100dvh", position: "relative", overflow: "hidden", background: C.bg }}>
        <MobileLayout />
      </div>
        </>
      )}
    </AppCtx.Provider>
    </ErrorBoundary>
    </UiThemeContext.Provider>
  );
}
