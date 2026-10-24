import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search as SearchIcon, Heart, Play, Pause, Plus, Settings,
  ChevronLeft, ChevronRight, Clock, Download, Music2, X,
  Check, MoreVertical, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useApp, toTrackItem, fromApiTrack, BROWSE_CATEGORIES,
  type Screen, type Track, type LibTab, type ArtistItem, type ActiveDownload,
} from "../context";
import type { HomeShelf, HomeItem } from "../services/home";
import { TrackCard } from "../components/ui/cards";
import { CoverArt } from "../components/CoverArt";
import { searchTracks } from "../services/api";
import { sanitizeMusicItems } from "../services/smartQueue";
import { getRecentSearches, pushRecentSearch } from "../services/store";
import { sendEvent } from "../services/events";
import { marketLabel, marketChartQuery } from "../services/locale";
import { clearOfflineTracks, readOfflineTracks, type OfflineTrack } from "../services/offlineStorage";
import {
  isNativeMediaAvailable, listLocalMusic, requestLocalMusicPermission, localSongToTrack,
  type LocalSong,
} from "../services/localMusic";
import { bffJson } from "../services/bff";

/* ────────────────────────────────────────────────────────────────────────────
   Mobile screens — the <1200px layouts from docs/design/boards/mobile.
   Colours/radii all come from the theme context (C); no hex except the fixed
   browse-category palette and the offline-green semantic.
   ──────────────────────────────────────────────────────────────────────────── */

/** Fallback clearance while MobileLayout measures the real dock height. */
const DOCK_PAD = "var(--vibra-dock-h, 176px)";
const OFFLINE_GREEN = "#1ED760";

const pad = (px: number): React.CSSProperties => ({ paddingLeft: px, paddingRight: px });

/** Scrollable page wrapper — top safe-area + bottom dock clearance. */
function MPage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", paddingBottom: DOCK_PAD }}>
      {children}
    </div>
  );
}

function MEmpty({ icon: Icon = Music2, title, sub, action }: {
  icon?: React.ElementType; title: string; sub?: string; action?: React.ReactNode;
}) {
  const { C } = useApp();
  return (
    <div style={{ margin: "28px 24px 0", borderRadius: 18, border: `1px dashed ${C.border}`, background: C.surf, padding: "36px 22px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.bg, border: `1px solid ${C.border}`, display: "grid", placeItems: "center" }}>
        <Icon size={22} color={C.accent} />
      </div>
      <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: C.muted, maxWidth: 280, lineHeight: 1.5 }}>{sub}</div>}
      {action}
    </div>
  );
}

function MSkelRow() {
  const { C } = useApp();
  const sk = (w: number | string, h: number, r = 8): React.CSSProperties => ({ width: w, height: h, borderRadius: r, background: C.surf, flexShrink: 0, opacity: 0.7 });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
      <div style={sk(52, 52, 12)} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={sk("58%", 13)} />
        <div style={sk("36%", 11)} />
      </div>
    </div>
  );
}

function MSkelCard() {
  const { C } = useApp();
  return (
    <div style={{ width: 148, flexShrink: 0 }}>
      <div style={{ width: 148, height: 148, borderRadius: 16, background: C.surf, opacity: 0.7 }} />
      <div style={{ width: "80%", height: 13, borderRadius: 6, background: C.surf, marginTop: 10, opacity: 0.7 }} />
    </div>
  );
}

/** Section heading — board spacing (title 19px 800, rows 24 apart). */
function MSectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const { C } = useApp();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
      <h2 style={{ fontSize: 19, fontWeight: 800, color: C.text, margin: 0, letterSpacing: -0.3 }}>{children}</h2>
      {right}
    </div>
  );
}

/** The list row from the boards: 52px cover, title/artist, duration trailing. */
function MRow({ track, queue, trailing, onClick, sub }: {
  track: Track;
  queue?: Track[];
  trailing?: React.ReactNode;
  onClick?: () => void;
  /** Overrides the artist line (e.g. "artist · 4.8 MB" on Downloads). */
  sub?: React.ReactNode;
}) {
  const { C, playTrack, currentTrack, isPlaying } = useApp();
  const active = currentTrack?.id === track.id;
  // A custom onClick (mix resolution) owns playback entirely.
  const play = () => { if (onClick) { onClick(); return; } playTrack(track, queue); };
  return (
    <div role="button" tabIndex={0} onClick={play} onKeyDown={e => e.key === "Enter" && play()}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 8px", margin: "0 -8px", borderRadius: 12, background: active ? C.surf : "transparent", cursor: "pointer", minWidth: 0 }}>
      <CoverArt bg={track.bg} imageUrl={track.imageUrl} size={52} radius={12} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: active ? C.accent : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub ?? track.artist}</div>
      </div>
      {trailing ?? (
        <span style={{ fontSize: 12, color: C.dim, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
          {active && isPlaying ? <Pause size={13} color={C.accent} fill={C.accent} /> : track.duration}
        </span>
      )}
    </div>
  );
}

/** Chip pill — active = light-on-dark inverse per the boards. */
function MChip({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  const { C } = useApp();
  return (
    <button onClick={onClick}
      style={{ border: "none", borderRadius: 999, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, transition: "all .15s", background: active ? C.text : C.surf, color: active ? C.pane : C.muted }}>
      {label}
    </button>
  );
}

/** Bare fluid cover card (library grid) — full-bleed square like the boards. */
function MBareCard({ bg, imageUrl, title, subtitle, onClick, dashed, children }: {
  bg?: string; imageUrl?: string; title: string; subtitle?: string; onClick?: () => void; dashed?: boolean; children?: React.ReactNode;
}) {
  const { C } = useApp();
  return (
    <button onClick={onClick} disabled={!onClick}
      style={{ background: "none", border: "none", padding: 0, cursor: onClick ? "pointer" : "default", textAlign: "left", minWidth: 0, fontFamily: "inherit" }}>
      <div style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 16, background: dashed ? "transparent" : bg ?? C.surf, border: dashed ? `1.5px dashed ${C.border}` : "none", overflow: "hidden", display: "grid", placeItems: "center", position: "relative" }}>
        {imageUrl && !dashed && <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        {children}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginTop: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</div>}
    </button>
  );
}

/* ─── Home ─────────────────────────────────────────────────────────────────── */

function MobileHome() {
  const { C, navigate, playTrack, shelves, homeLoading, hiddenIds, user, playlists } = useApp();
  const [chip, setChip] = useState("All");
  const CHIPS = ["All", "Music", "Made for you", "New"] as const;
  const chipMatch = (s: HomeShelf) =>
    chip === "All" ? true
    : chip === "Music" ? (s.type === "shelf" || s.type === "recent")
    : chip === "Made for you" ? (s.type === "mix_row" || s.type === "recent" || s.id.startsWith("because"))
    : s.id === "new-releases";

  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const dayStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  /** Mixes resolve through search first; tracks play straight away. */
  const openItem = async (item: HomeItem) => {
    if (item.query && !item.videoId) {
      let results = await searchTracks(item.query, 10);
      if (results.length === 0 && item.artist) results = await searchTracks(item.artist, 10);
      const clean = sanitizeMusicItems(results);
      if (clean.length === 0) { toast.error("Couldn't start that mix — try again."); return; }
      const tracks = clean.map((t, i) => fromApiTrack(t, i));
      playTrack(tracks[0], tracks.slice(1));
      return;
    }
    playTrack(toTrackItem(item));
  };

  const section = (shelf: HomeShelf) => {
    const items = shelf.items.filter(i => !hiddenIds[i.id]).slice(0, 24);
    if (items.length === 0) return null;
    const rows = shelf.type === "recent" || shelf.type === "mix_row";
    return (
      <section key={shelf.id} style={{ marginTop: 24 }}>
        <div style={pad(24)}>
          <MSectionTitle>{shelf.title}</MSectionTitle>
        </div>
        {rows ? (
          <div style={pad(24)}>
            {items.slice(0, 8).map(item => (
              <MRow key={item.id} track={toTrackItem(item)} onClick={() => void openItem(item)} />
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12, overflowX: "auto", scrollbarWidth: "none", padding: "0 24px 4px" }}>
            {items.map(item => (
              <div key={item.id} style={{ position: "relative", flexShrink: 0 }}>
                <TrackCard track={toTrackItem(item)} size={148} radius={16} onPlay={() => void openItem(item)} />
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <MPage>
      <div style={{ padding: "20px 24px 0", display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.muted, marginBottom: 4 }}>{dayStr}</div>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: C.text, margin: 0, lineHeight: 1.2, letterSpacing: -0.6 }}>
            {greeting}{user ? <><br />{user.name.split(" ")[0]}</> : ""}
          </h1>
        </div>
        {user && (
          <button onClick={() => navigate({ id: "profile" })} aria-label="Open profile"
            style={{ width: 40, height: 40, borderRadius: "50%", display: "grid", placeItems: "center", background: C.accent, color: "#fff", fontSize: 13, fontWeight: 800, overflow: "hidden", flexShrink: 0, border: "none", cursor: "pointer", boxShadow: `0 0 0 2px ${C.bg}, 0 0 0 4px ${C.accent}59`, padding: 0 }}>
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : user.initials}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", padding: "18px 24px 2px" }}>
        {CHIPS.map(l => <MChip key={l} label={l} active={chip === l} onClick={() => setChip(l)} />)}
      </div>

      {homeLoading ? (
        <div style={{ display: "flex", gap: 12, padding: "24px 24px 0", overflow: "hidden" }}>
          {[...Array(4)].map((_, i) => <MSkelCard key={i} />)}
        </div>
      ) : shelves.length > 0 ? (
        shelves.filter(chipMatch).map(section)
      ) : (
        <MEmpty title="Your home is ready when you are"
          sub="Search for an artist or song and press play — everything you listen to lands here."
          action={
            <button onClick={() => navigate({ id: "search" })}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 20px", borderRadius: 999, border: "none", background: C.accent, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", marginTop: 4 }}>
              <SearchIcon size={15} /> Search music
            </button>
          } />
      )}

      {chip === "All" && playlists.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div style={pad(24)}>
            <MSectionTitle right={
              <button onClick={() => navigate({ id: "library" })} style={{ fontSize: 13, fontWeight: 600, color: C.muted, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>See all</button>
            }>From your library</MSectionTitle>
          </div>
          <div style={{ display: "flex", gap: 12, overflowX: "auto", scrollbarWidth: "none", padding: "0 24px 4px" }}>
            {playlists.slice(0, 8).map(pl => (
              <div key={pl.id} style={{ width: 148, flexShrink: 0 }}>
                <MBareCard bg={pl.bg} imageUrl={pl.imageUrl} title={pl.name} subtitle={pl.creator}
                  onClick={() => navigate({ id: "playlist", item: pl })} />
              </div>
            ))}
          </div>
        </section>
      )}
    </MPage>
  );
}

/* ─── Discover ─────────────────────────────────────────────────────────────── */

function MobileDiscover() {
  const { C, playTrack, navigate, trendingTracks, playlists, discoveryLoading, queueAll } = useApp();

  const featured = playlists[0]
    ? { kind: "playlist" as const, bg: playlists[0].bg, imageUrl: playlists[0].imageUrl, title: playlists[0].name, meta: `Playlist · ${playlists[0].trackCount || playlists[0].tracks.length} songs` }
    : trendingTracks.length > 0
      ? { kind: "trending" as const, bg: trendingTracks[0].bg, imageUrl: trendingTracks[0].imageUrl, title: "Trending now", meta: `Chart · ${trendingTracks.length} songs` }
      : null;

  const featuredPlay = () => {
    if (!featured) return;
    if (featured.kind === "playlist") {
      const pl = playlists[0];
      pl.tracks.length > 0 ? playTrack(pl.tracks[0], pl.tracks) : navigate({ id: "playlist", item: pl });
    } else playTrack(trendingTracks[0], trendingTracks);
  };
  const featuredQueue = () => {
    if (!featured) return;
    if (featured.kind === "playlist") playlists[0].tracks.length > 0 ? queueAll(playlists[0].tracks) : navigate({ id: "playlist", item: playlists[0] });
    else queueAll(trendingTracks);
  };

  return (
    <MPage>
      <div style={{ padding: "20px 24px 0" }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: C.text, margin: 0, letterSpacing: -0.6 }}>Discover</h1>
      </div>

      {featured ? (
        <div style={{ margin: "20px 24px 0", borderRadius: 16, overflow: "hidden", position: "relative", height: 196, background: featured.bg }}>
          {featured.imageUrl && (
            <img src={featured.imageUrl} alt="" style={{ position: "absolute", right: -16, top: 30, width: 140, height: 140, borderRadius: 12, objectFit: "cover", transform: "rotate(14deg)", opacity: 0.92, boxShadow: "0 18px 40px rgba(0,0,0,0.5)" }} />
          )}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(100deg, rgba(8,6,14,0.88) 34%, rgba(8,6,14,0.25) 78%)", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 18 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.accent, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 }}>Featured</div>
            <h2 style={{ fontSize: 21, fontWeight: 800, color: "#fff", margin: "0 0 4px", maxWidth: "70%", lineHeight: 1.15 }}>{featured.title}</h2>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)", margin: "0 0 12px" }}>{featured.meta}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={featuredPlay}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 40, padding: "0 20px", borderRadius: 20, background: C.accent, border: "none", color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>
                <Play size={15} fill="currentColor" /> Play
              </button>
              <button onClick={featuredQueue} aria-label="Add to queue"
                style={{ width: 42, height: 42, borderRadius: "50%", background: "rgba(10,9,16,0.4)", border: "1px solid rgba(255,255,255,0.35)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
                <Plus size={19} />
              </button>
            </div>
          </div>
        </div>
      ) : discoveryLoading ? (
        <div style={{ margin: "20px 24px 0", borderRadius: 16, height: 196, background: C.surf, opacity: 0.7 }} />
      ) : null}

      <div style={{ padding: "24px 24px 0" }}>
        <MSectionTitle>Trending now</MSectionTitle>
        {discoveryLoading
          ? [...Array(6)].map((_, i) => <MSkelRow key={i} />)
          : trendingTracks.length > 0
            ? trendingTracks.slice(0, 12).map((t, i) => (
                <MRow key={t.id} track={t} queue={trendingTracks.slice(i + 1)} />
              ))
            : <EmptyDiscover onSearch={() => navigate({ id: "search" })} />}
      </div>
    </MPage>
  );
}

function EmptyDiscover({ onSearch }: { onSearch: () => void }) {
  const { C } = useApp();
  return (
    <div style={{ borderRadius: 16, border: `1px dashed ${C.border}`, background: C.surf, padding: "30px 20px", textAlign: "center" }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>Nothing trending yet</div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>Search for a song and press play — it shows up here.</div>
      <button onClick={onSearch} style={{ marginTop: 14, height: 36, padding: "0 16px", borderRadius: 18, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Search music</button>
    </div>
  );
}

/* ─── Search ───────────────────────────────────────────────────────────────── */

function MobileSearch({ seed }: { seed?: string }) {
  const { C, playTrack, discoveryTracks, navigate, user } = useApp();
  const [query, setQuery] = useState(seed ?? "");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const market = marketLabel();
  // Recomputed after each settle — a new query may have been pushed.
  const [recentTick, setRecentTick] = useState(0);
  const recentSeeds = useMemo(() => getRecentSearches(), [query, recentTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const browseTiles = useMemo(
    () => [
      { id: "market", label: `Popular in ${market}`, query: marketChartQuery(), bg: C.accent },
      ...BROWSE_CATEGORIES,
    ],
    [market, C.accent],
  );

  /** No autofocus on mount — tapping the Search tab must not pop the
      keyboard; it opens only when the field itself is tapped. */
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("vibra:focus-search", focus);
    return () => window.removeEventListener("vibra:focus-search", focus);
  }, []);
  useEffect(() => { if (seed) setQuery(seed); }, [seed]);

  const discoveryRef = useRef(discoveryTracks);
  discoveryRef.current = discoveryTracks;

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      const tracks = await searchTracks(query, 20);
      if (tracks.length > 0) {
        setResults(sanitizeMusicItems(tracks.map((t, i) => fromApiTrack(t, i))));
        setSearching(false);
        pushRecentSearch(query);
        sendEvent({ type: "search" });
        setRecentTick(n => n + 1);
        return;
      }
      const q = query.toLowerCase();
      const local = discoveryRef.current.filter(t =>
        t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
      );
      setResults(local);
      setSearching(false);
      if (local.length > 0) { pushRecentSearch(query); setRecentTick(n => n + 1); }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  return (
    <MPage>
      <div style={{ padding: "16px 24px 0" }}>
        {/* Board header: avatar chip + page title */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <button onClick={() => navigate({ id: "profile" })} aria-label="Your profile"
            style={{ width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer", padding: 0, overflow: "hidden", flexShrink: 0, background: C.accent, display: "grid", placeItems: "center" }}>
            {user?.avatarUrl
              ? <img src={user.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <span style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>{user?.initials ?? "?"}</span>}
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: 0, letterSpacing: -0.4 }}>Search</h1>
        </div>

        <div style={{ position: "relative", marginBottom: 22 }}>
          <div style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: C.muted, pointerEvents: "none", display: "grid", placeItems: "center" }}>
            <SearchIcon size={20} />
          </div>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Songs, artists, albums…"
            style={{ width: "100%", height: 50, borderRadius: 999, border: "none", background: C.surf, color: C.text, fontSize: 15, padding: "0 48px 0 50px", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search"
              style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.muted, display: "grid", placeItems: "center", padding: 4 }}>
              <X size={17} />
            </button>
          )}
        </div>

        {query ? (
          searching ? (
            [...Array(6)].map((_, i) => <MSkelRow key={i} />)
          ) : results.length > 0 ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.dim, marginBottom: 8 }}>{results.length} result{results.length !== 1 ? "s" : ""}</div>
              {results.slice(0, 25).map((t, i) => (
                <MRow key={t.id} track={t} queue={results.slice(i + 1)} />
              ))}
            </>
          ) : (
            <MEmpty icon={SearchIcon} title="No results" sub={`Nothing matched “${query}”. Try an artist, album, or a different spelling.`} />
          )
        ) : (
          <>
            {recentSeeds.length > 0 && (
              <section style={{ marginBottom: 26 }}>
                <MSectionTitle>Recent searches</MSectionTitle>
                {/* Horizontal scroll row — one line, edge-to-edge bleed */}
                <div style={{ display: "flex", flexWrap: "nowrap", gap: 8, overflowX: "auto", scrollbarWidth: "none", margin: "0 -24px", padding: "2px 24px" }}>
                  {recentSeeds.map(q => (
                    <button key={q} onClick={() => setQuery(q)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 15px", borderRadius: 19, border: `1px solid ${C.border}`, background: C.surf, color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
                      <Clock size={13} color={C.muted} /> {q}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <MSectionTitle>Browse all</MSectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {browseTiles.map(tile => (
                <button key={tile.id} onClick={() => setQuery("query" in tile ? (tile as { query: string }).query : tile.label)}
                  style={{ position: "relative", height: 88, borderRadius: 10, border: "none", cursor: "pointer", overflow: "hidden", background: `linear-gradient(135deg, ${tile.bg}, color-mix(in srgb, ${tile.bg} 55%, #000))`, padding: "12px 14px", display: "flex", alignItems: "flex-start", textAlign: "left", transition: "transform .15s", fontFamily: "inherit" }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.02)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}>
                  <span style={{ fontWeight: 800, fontSize: 15, color: "#fff", lineHeight: 1.2 }}>{tile.label}</span>
                </button>
              ))}
            </div>

            {recentSeeds.length === 0 && (
              <div style={{ marginTop: 20, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
                Search for a song, or tap a category above — trending charts for your region are ready to play.
              </div>
            )}
          </>
        )}
      </div>
    </MPage>
  );
}

/* ─── Library ──────────────────────────────────────────────────────────────── */

function MobileLibrary({ tab: initTab = "playlists" }: { tab?: LibTab }) {
  const { C, navigate, playTrack, playlists, playlistsLoading, likedTracks, artists, openCreatePlaylist, uiState, following, toggleFollow } = useApp();
  const [tab, setTab] = useState<LibTab>(initTab === "liked" || initTab === "artists" ? initTab : "playlists");

  const TABS: { id: LibTab; label: string }[] = [
    { id: "playlists", label: "Playlists" },
    { id: "liked",     label: "Liked"     },
    { id: "artists",   label: "Artists"   },
  ];

  return (
    <MPage>
      <div style={{ padding: "20px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: 0, flex: 1, letterSpacing: -0.4 }}>Your Library</h1>
          <button onClick={() => navigate({ id: "downloads" })} aria-label="Downloads"
            style={{ width: 40, height: 40, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted, padding: 0 }}>
            <Download size={18} />
          </button>
          {uiState.signedIn && (
            <button onClick={() => openCreatePlaylist()} aria-label="Create playlist"
              style={{ width: 40, height: 40, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, padding: 0 }}>
              <Plus size={19} />
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 16 }}>
          {TABS.map(t => <MChip key={t.id} label={t.label} active={tab === t.id} onClick={() => setTab(t.id)} />)}
        </div>
      </div>

      <div style={pad(24)}>
        {tab === "playlists" && (
          playlistsLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[...Array(6)].map((_, i) => <div key={i} style={{ aspectRatio: "1 / 1", borderRadius: 16, background: C.surf, opacity: 0.7 }} />)}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, paddingBottom: 6 }}>
              <MBareCard title="Liked songs" subtitle={`${likedTracks.length} songs`}
                bg="linear-gradient(135deg,#7a4ae8,#e8334f)" onClick={() => setTab("liked")}>
                <Heart size={40} color="#fff" fill="#fff" />
              </MBareCard>
              {playlists.map(pl => (
                <MBareCard key={pl.id} bg={pl.bg} imageUrl={pl.imageUrl} title={pl.name}
                  subtitle={pl.creator ?? `${pl.trackCount} songs`}
                  onClick={() => navigate({ id: "playlist", item: pl })} />
              ))}
              <MBareCard dashed title="New playlist" subtitle="Build your own"
                onClick={uiState.signedIn ? () => openCreatePlaylist() : undefined} />
            </div>
          )
        )}

        {tab === "liked" && (
          likedTracks.length > 0 ? (
            likedTracks.map((t, i) => <MRow key={t.id} track={t} queue={likedTracks.slice(i + 1)} />)
          ) : (
            <MEmpty icon={Heart} title="No liked songs" sub="Songs you heart will appear here." />
          )
        )}

        {tab === "artists" && (
          artists.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {artists.map(a => <MArtistRow key={a.id} artist={a} following={following.has(a.id)} onToggle={() => toggleFollow(a.id)} />)}
            </div>
          ) : <MEmpty title="No artists" sub="Artists you follow will appear here." />
        )}
      </div>
    </MPage>
  );
}

function MArtistRow({ artist, following, onToggle }: { artist: ArtistItem; following: boolean; onToggle: () => void }) {
  const { C } = useApp();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", background: artist.bg, flexShrink: 0, overflow: "hidden" }}>
        {artist.imageUrl
          ? <img src={artist.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{artist.name[0]}</div>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artist.name}</div>
        <div style={{ fontSize: 12, color: C.muted }}>{artist.genre}{artist.followers ? ` · ${artist.followers}` : ""}</div>
      </div>
      <button onClick={onToggle}
        style={{ height: 32, padding: "0 14px", borderRadius: 16, fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: "transparent", border: `1px solid ${following ? C.border : C.accent}`, color: following ? C.muted : C.accent, flexShrink: 0 }}>
        {following ? "Following" : "Follow"}
      </button>
    </div>
  );
}

/* ─── Profile ──────────────────────────────────────────────────────────────── */

function MobileProfile() {
  const { C, navigate, canGoBack, goBack, user, userLoading, recentTracks, playlists, likedTrackIds, uiState } = useApp();
  const uniqueArtists = new Set(recentTracks.map(t => t.artist).filter(Boolean)).size;
  const playlistCount = playlists.filter(p => p.id !== "liked").length;

  const [discOpen, setDiscOpen] = useState(false);
  const [discLoading, setDiscLoading] = useState(false);
  const [discovered, setDiscovered] = useState<{ count: number; artists: { name: string; plays: number; imageUrl?: string }[] } | null>(null);

  const toggleDiscovered = async () => {
    if (discOpen) { setDiscOpen(false); return; }
    setDiscOpen(true);
    if (discovered) return;
    setDiscLoading(true);
    try {
      const d = await bffJson<{ count?: number; artists?: { name: string; plays: number; imageUrl?: string }[] }>(
        "/auth/me/discovered-artists",
      );
      setDiscovered({ count: d?.count ?? 0, artists: d?.artists ?? [] });
    } catch {
      toast.error("Couldn't load your artists — try again.");
    } finally {
      setDiscLoading(false);
    }
  };

  if (userLoading) return (
    <MPage>
      <div style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ width: 104, height: 104, borderRadius: "50%", background: C.surf, opacity: 0.7 }} />
        <div style={{ width: 160, height: 20, borderRadius: 10, background: C.surf, opacity: 0.7 }} />
      </div>
    </MPage>
  );

  return (
    <MPage>
      <div style={{ display: "flex", alignItems: "center", padding: "16px 24px 0" }}>
        {canGoBack && (
          <button onClick={goBack} aria-label="Back"
            style={{ width: 40, height: 40, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, padding: 0, marginRight: 8 }}>
            <ChevronLeft size={20} />
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => navigate({ id: "settings" })} aria-label="Settings"
          style={{ width: 40, height: 40, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted, padding: 0 }}>
          <Settings size={18} />
        </button>
      </div>

      {user ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 24px 0", textAlign: "center" }}>
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt="" style={{ width: 104, height: 104, borderRadius: "50%", objectFit: "cover", marginBottom: 14, boxShadow: `0 0 0 3px ${C.bg}, 0 0 0 5px ${C.accent}4d` }} />
              : <div style={{ width: 104, height: 104, borderRadius: "50%", background: C.accent, color: "#fff", display: "grid", placeItems: "center", fontSize: 32, fontWeight: 800, marginBottom: 14, boxShadow: `0 0 0 3px ${C.bg}, 0 0 0 5px ${C.accent}4d` }}>{user.initials}</div>}
            <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: 0, letterSpacing: -0.4 }}>{user.name}</h1>
            <p style={{ fontSize: 13.5, color: C.muted, margin: "5px 0 0" }}>
              {user.username ? `@${user.username} · ` : ""}{user.subscription === "premium" ? "Premium" : "Free plan"}
            </p>

            <div style={{ display: "flex", alignItems: "center", marginTop: 20 }}>
              {([
                [String(playlistCount), "Playlists", () => navigate({ id: "library" })],
                [String(likedTrackIds.size), "Liked", () => navigate({ id: "library", tab: "liked" })],
                [String(uniqueArtists), "Artists", () => navigate({ id: "library", tab: "artists" })],
              ] as [string, string, () => void][]).map(([count, label, go], i) => (
                <React.Fragment key={label}>
                  {i > 0 && <div style={{ width: 1, height: 26, background: C.border, margin: "0 20px" }} />}
                  <button onClick={go} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "center", padding: 0, fontFamily: "inherit" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>{count}</div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{label}</div>
                  </button>
                </React.Fragment>
              ))}
            </div>

            <button onClick={() => navigate({ id: "settings" })}
              style={{ marginTop: 18, height: 40, padding: "0 22px", borderRadius: 20, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Edit profile
            </button>
          </div>

          <div style={{ padding: "26px 24px 0" }}>
            <div style={{ background: C.pane, border: `1px solid ${C.border}`, borderRadius: 20, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>Listened this week</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: C.accent, marginTop: 6, letterSpacing: -0.5 }}>{user.stats?.weeklyMinutes ?? "0m"}</div>
                </div>
                <button onClick={toggleDiscovered}
                  style={{ background: "none", border: "none", cursor: "pointer", textAlign: "right", padding: 0, fontFamily: "inherit", maxWidth: 130 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{String(user.stats?.topArtists ?? uniqueArtists)} artists</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>discovered</div>
                </button>
              </div>
              {discOpen && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                  {discLoading ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {[0, 1, 2].map(i => <div key={i} style={{ height: 38, borderRadius: 10, background: C.surf, opacity: 0.7 }} />)}
                    </div>
                  ) : discovered && discovered.artists.length > 0 ? (
                    discovered.artists.slice(0, 8).map(a => (
                      <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", background: C.surf, flexShrink: 0 }}>
                          {a.imageUrl
                            ? <img src={a.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 800, color: C.muted }}>{a.name[0]}</div>}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                          <div style={{ fontSize: 11, color: C.muted }}>{a.plays} {a.plays === 1 ? "play" : "plays"}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: "10px 0", fontSize: 12.5, color: C.muted, textAlign: "center" }}>
                      Artists will show up here once your history has a few plays.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {recentTracks.length > 0 && (
            <div style={{ padding: "26px 24px 0" }}>
              <MSectionTitle>Recently played</MSectionTitle>
              {recentTracks.slice(0, 8).map((t, i) => (
                <MRow key={t.id} track={t} queue={recentTracks.slice(i + 1)} />
              ))}
            </div>
          )}
        </>
      ) : (
        <MEmpty title="Make Vybra yours" sub="Sign in to keep your library, likes, and listening history across devices."
          action={
            <button onClick={() => navigate({ id: "auth", mode: "login" })}
              style={{ height: 40, padding: "0 20px", borderRadius: 20, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Sign in
            </button>
          } />
      )}
    </MPage>
  );
}

/* ─── Downloads ────────────────────────────────────────────────────────────── */

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** One in-flight save — cover, artist · percent, progress bar, ring. */
function MActiveDownloadRow({ d }: { d: ActiveDownload }) {
  const { C } = useApp();
  const pct = Math.round(Math.min(1, Math.max(0, d.progress)) * 100);
  const R = 15.5, CIRC = 2 * Math.PI * R;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", minWidth: 0 }}>
      <CoverArt bg={d.bg} imageUrl={d.imageUrl} size={52} radius={12} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.artist} · {pct}%</div>
        <div style={{ height: 3, borderRadius: 2, background: C.border, marginTop: 7, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: C.accent, transition: "width .3s linear" }} />
        </div>
      </div>
      <div style={{ position: "relative", width: 36, height: 36, flexShrink: 0 }}>
        <svg viewBox="0 0 36 36" width={36} height={36} style={{ transform: "rotate(-90deg)" }} aria-hidden>
          <circle cx="18" cy="18" r={R} fill="none" stroke={C.border} strokeWidth="3" />
          <circle cx="18" cy="18" r={R} fill="none" stroke={C.accent} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - d.progress)}
            style={{ transition: "stroke-dashoffset .3s linear" }} />
        </svg>
      </div>
    </div>
  );
}

function MobileDownloads() {
  const { C, navigate, canGoBack, goBack, downloadedTracks, refreshDownloads, activeDownloads } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  // Local metadata carries exact byte sizes beside the server list.
  const [localMeta, setLocalMeta] = useState<OfflineTrack[]>([]);
  const total = downloadedTracks.length + activeDownloads.length;

  // "On this phone" — the device's own files (YT Music style).
  // null = unknown yet (web, native loading, or permission not granted).
  const [localSongs, setLocalSongs] = useState<LocalSong[] | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const loadLocal = async (): Promise<LocalSong[] | null> => {
    if (!isNativeMediaAvailable()) { setLocalSongs(null); setLocalLoading(false); return null; }
    const songs = await listLocalMusic();
    setLocalSongs(songs);
    setLocalLoading(false);
    return songs;
  };
  useEffect(() => { void loadLocal(); }, []);
  const localTracks = useMemo(() => (localSongs ?? []).map(localSongToTrack), [localSongs]);
  const grantLocal = async () => {
    const granted = await requestLocalMusicPermission();
    const songs = await loadLocal();
    if (!granted) toast("Permission denied — device music stays hidden");
    else if (songs === null) toast("Couldn't read music on this device");
  };

  useEffect(() => { setLocalMeta(readOfflineTracks()); }, [downloadedTracks.length, activeDownloads.length]);

  const sizeOf = (id: string | number): string | null => {
    const bytes = localMeta.find(t => String(t.id) === String(id))?.sizeBytes;
    return bytes ? fmtBytes(bytes) : null;
  };

  const clearAll = () => {
    clearOfflineTracks();
    void refreshDownloads();
    setMenuOpen(false);
    toast.success("Downloads cleared");
  };

  return (
    <MPage>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 24px 0", position: "relative" }}>
        {canGoBack && (
          <button onClick={goBack} aria-label="Back"
            style={{ width: 40, height: 40, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, padding: 0, marginLeft: -6 }}>
            <ChevronLeft size={20} />
          </button>
        )}
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0, flex: 1, letterSpacing: -0.3 }}>Downloads</h1>
        {total > 0 && (
          <button onClick={() => setMenuOpen(v => !v)} aria-label="Downloads options" aria-expanded={menuOpen}
            style={{ width: 40, height: 40, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted, padding: 0 }}>
            <MoreVertical size={18} />
          </button>
        )}
        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} aria-hidden style={{ position: "fixed", inset: 0, zIndex: 5 }} />
            <div role="menu" style={{ position: "absolute", right: 24, top: 60, zIndex: 6, minWidth: 210, background: C.pane, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 14px 40px rgba(0,0,0,0.5)", overflow: "hidden" }}>
              <button role="menuitem" onClick={clearAll}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "13px 16px", background: "none", border: "none", color: "#E5484D", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <Trash2 size={16} /> Clear all downloads
              </button>
            </div>
          </>
        )}
      </div>

      {activeDownloads.length > 0 && (
        <div style={{ padding: "22px 24px 0" }}>
          <MSectionTitle right={<span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>{activeDownloads.length} {activeDownloads.length === 1 ? "song" : "songs"}</span>}>
            Downloading
          </MSectionTitle>
          {activeDownloads.map(d => <MActiveDownloadRow key={d.id} d={d} />)}
        </div>
      )}

      {downloadedTracks.length > 0 ? (
        <div style={{ padding: `${activeDownloads.length > 0 ? 26 : 22}px 24px 0` }}>
          <MSectionTitle right={<span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>{downloadedTracks.length} {downloadedTracks.length === 1 ? "song" : "songs"}</span>}>
            Downloaded
          </MSectionTitle>
          {downloadedTracks.map((t, i) => {
            const size = sizeOf(t.id);
            return (
              <MRow key={t.id} track={t} queue={downloadedTracks.slice(i + 1)}
                sub={`${t.artist}${size ? ` · ${size}` : ""}`}
                trailing={
                  <span title="Available offline" aria-label="Available offline"
                    style={{ width: 30, height: 30, borderRadius: "50%", background: `${OFFLINE_GREEN}1f`, display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Check size={15} color={OFFLINE_GREEN} />
                  </span>
                } />
            );
          })}
        </div>
      ) : activeDownloads.length === 0 ? (
        <MEmpty icon={Download} title="No downloads yet" sub="Save songs from any track's menu to listen offline."
          action={
            <button onClick={() => navigate({ id: "search" })}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 20px", borderRadius: 999, border: "none", background: C.accent, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", marginTop: 4 }}>
              <SearchIcon size={15} /> Find music
            </button>
          } />
      ) : null}

      {/* On this phone — the device's own audio files, playable offline. */}
      {localTracks.length > 0 && (
        <div style={{ padding: "26px 24px 0" }}>
          <MSectionTitle right={<span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>{localTracks.length} {localTracks.length === 1 ? "song" : "songs"}</span>}>
            On this phone
          </MSectionTitle>
          {localTracks.map((t, i) => (
            <MRow key={String(t.id)} track={t} queue={localTracks.slice(i + 1)} />
          ))}
        </div>
      )}

      {/* Permission not granted yet — one tap to hand the list over. */}
      {isNativeMediaAvailable() && !localLoading && localSongs === null && (
        <div style={{ padding: "26px 24px 0" }}>
          <MSectionTitle>On this phone</MSectionTitle>
          <button onClick={() => void grantLocal()}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
              background: C.pane, border: `1px dashed ${C.border}`, borderRadius: 14,
              cursor: "pointer", fontFamily: "inherit", textAlign: "left",
            }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, background: C.surf, display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Music2 size={18} color={C.accent} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 700, fontSize: 14, color: C.text }}>Allow access to music on this phone</span>
              <span style={{ display: "block", fontSize: 12, color: C.muted, marginTop: 2 }}>See and play the songs already stored on this device</span>
            </span>
          </button>
        </div>
      )}
    </MPage>
  );
}

/* ─── Dispatcher ───────────────────────────────────────────────────────────── */

/** The mobile counterpart of ScreenView — only screens the boards define. */
export function MobileScreenView({ s }: { s: Screen }) {
  switch (s.id) {
    case "home":      return <MobileHome />;
    case "search":    return <MobileSearch seed={s.q} />;
    case "discover":  return <MobileDiscover />;
    case "library":   return s.tab === "downloaded" ? <MobileDownloads /> : <MobileLibrary tab={s.tab} />;
    case "profile":   return <MobileProfile />;
    case "downloads": return <MobileDownloads />;
    default:          return null;
  }
}
