import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, Heart, Headphones, ListMusic, Mic2, MoreHorizontal,
  Pause, Play, Repeat, Repeat1, Send, Shuffle, SkipBack, SkipForward,
  Download, Check, Link2, MessageCircle, Mail,
} from "lucide-react";
import { toast } from "sonner";
import { useApp, fmtSec } from "../../context";
import { CoverArt } from "../CoverArt";
import { LyricsPanel } from "./LyricsPanel";
import { removeDownload } from "../../services/localAudio";

/** Green of the output-device chip — same semantic green as the Offline pills. */
const DEVICE_GREEN = "#1ED760";

/**
 * Full-screen player — artwork, metadata, seek and queue context.
 * Transport lives in the bottom bar on desktop (which stays visible below
 * this overlay); below the shell breakpoint the player covers the dock, so
 * its own transport row + footer render there (CSS in index.css).
 *
 * Compact (<1200px) follows docs/design boards Player + PlayerLyrics:
 * a Song|Lyrics pill (video stays desktop-only), blurred art backdrop,
 * red play button, waveform seek with a white current bar, and a
 * full-bleed lyrics view with a floating transport card.
 */
export function PlayerPage() {
  const {
    C, currentTrack, progress, elapsed, audioDuration, handleSeek,
    likedTrackIds, toggleLike, queue, playTrack,
    setPlayerPageOpen,
    playerPageMode: mediaMode, setPlayerPageMode: setMediaMode,
    openTrackOptions,
    isPlaying, togglePlay,
    lyrics, plainLyrics, lyricsLoading, uiState,
    playPrev, playNext, shuffleOn, toggleShuffle, repeatMode, cycleRepeat,
    outputDevice,
    downloadedTracks, downloadTrack, refreshDownloads,
  } = useApp();
  const scrubRef = useRef<HTMLDivElement | null>(null);
  /** Mobile footer's queue icon opens the TOP queue sheet (per the ask). */
  const [queueOpen, setQueueOpen] = useState(false);
  /** Social share sheet — opened by the footer's share action. */
  const [shareOpen, setShareOpen] = useState(false);
  const hasLyricsOption = uiState.hasLyrics || lyricsLoading;

  /** Pull-down to close — tracks the finger from the grabber/header zone. */
  const [drag, setDrag] = useState({ active: false, y: 0 });
  const dragStartY = useRef<number | null>(null);
  /** Compact layout: waveform seek + full-bleed (the boards' mobile player). */
  const [isCompact, setIsCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1199.98px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1199.98px)");
    const on = () => setIsCompact(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  /** Deterministic bar heights per track — the waveform look of the boards. */
  const waveBars = useMemo(() => {
    const id = String(currentTrack?.id ?? "");
    const seed = id.split("").reduce((a, c) => (a + c.charCodeAt(0)) % 9973, 17);
    return Array.from({ length: 56 }, (_, i) => {
      const x = Math.sin((seed + 1) * (i + 1) * 12.9898) * 43758.5453;
      const frac = x - Math.floor(x);
      return 6 + Math.round(frac * 22);
    });
  }, [currentTrack?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPlayerPageOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPlayerPageOpen]);

  // A track without lyrics can't keep a lyrics view open; video is desktop-only.
  useEffect(() => {
    if (mediaMode === "lyrics" && !hasLyricsOption) setMediaMode("song");
    if (mediaMode === "video" && isCompact) setMediaMode("song");
  }, [mediaMode, hasLyricsOption, isCompact]);

  if (!currentTrack) return null;
  const isLiked = likedTrackIds.has(currentTrack.id);
  const isDownloaded = downloadedTracks.some(t => String(t.id) === String(currentTrack.id));
  const total = audioDuration > 0 ? audioDuration : currentTrack.durationSec ?? 0;

  const seekFromEvent = (clientX: number) => {
    const el = scrubRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    handleSeek((clientX - r.left) / r.width);
  };

  /** Drag starts only in the grabber/header band and never off a control. */
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest("button, a, [role='button'], iframe, input")) return;
    if (e.clientY - e.currentTarget.getBoundingClientRect().top > 110) return;
    dragStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ active: true, y: 0 });
  };
  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current == null) return;
    setDrag({ active: true, y: Math.max(0, e.clientY - dragStartY.current) });
  };
  const endDrag = () => {
    if (dragStartY.current == null) return;
    const past = drag.y > 120;
    dragStartY.current = null;
    setDrag({ active: false, y: 0 });
    if (past) setPlayerPageOpen(false);
  };
  const cancelDrag = () => {
    dragStartY.current = null;
    setDrag({ active: false, y: 0 });
  };

  const shareUrl = currentTrack.videoId
    ? `https://www.youtube.com/watch?v=${currentTrack.videoId}`
    : window.location.href;
  const shareText = `${currentTrack.title} — ${currentTrack.artist}`;

  /** Social share options — Spotify-style sheet, one tap per network. */
  const shareTargets = [
    { key: "copy", label: "Copy link", Icon: Link2, href: null },
    { key: "whatsapp", label: "WhatsApp", Icon: MessageCircle,
      href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}` },
    { key: "x", label: "X", Icon: Send,
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}` },
    { key: "telegram", label: "Telegram", Icon: Send,
      href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}` },
    { key: "facebook", label: "Facebook", Icon: Send,
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}` },
    { key: "email", label: "Email", Icon: Mail,
      href: `mailto:?subject=${encodeURIComponent(currentTrack.title)}&body=${encodeURIComponent(`${shareText}\n${shareUrl}`)}` },
    { key: "more", label: "More…", Icon: Send, href: "native" as const },
  ];

  const shareVia = (target: typeof shareTargets[number]) => {
    if (target.key === "copy") {
      void navigator.clipboard?.writeText(shareUrl)
        .then(() => toast("Link copied"))
        .catch(() => toast.error("Couldn't copy the link"));
    } else if (target.href === "native") {
      if (navigator.share) void navigator.share({ title: currentTrack.title, text: shareText, url: shareUrl }).catch(() => { /* dismissed */ });
      else toast.error("Sharing isn't available here");
    } else if (target.href) {
      window.open(target.href, "_blank");
    }
    setShareOpen(false);
  };

  const onDownloadPress = () => {
    if (!currentTrack) return;
    if (isDownloaded) {
      void removeDownload(String(currentTrack.id)).then(() => refreshDownloads());
      toast("Removed download");
    } else {
      void downloadTrack(currentTrack);
    }
  };

  /**
   * Single source of truth for the playhead — derived from the clock, so the
   * dragger can never drift away from the elapsed time (the "halfway at 0:02"
   * bug was a separate progress state guessing during buffering).
   */
  const seekPct = total > 0 ? Math.max(0, Math.min(elapsed / total, 1)) : Math.min(progress, 1);

  /** Waveform coloring: played = accent, the bar at the playhead = white, rest dim. */
  const barColor = (i: number): string => {
    const p = seekPct;
    const before = (i + 1) / waveBars.length <= p;
    const atHead = !before && i / waveBars.length <= p;
    if (before) return C.accent;
    if (atHead) return "#ffffff";
    return `color-mix(in srgb, ${C.text} 22%, transparent)`;
  };

  /** The next track in the deck — the compact player's "Up next" glimpse. */
  const qIdx = queue.findIndex(t => t.id === currentTrack?.id);
  const nextUp = queue.length > 1 && qIdx >= 0 ? (queue[qIdx + 1] ?? queue[0]) : null;

  /** Shared deck list — the desktop context column and the compact top sheet
      both render exactly this; rows stop pointer propagation so the player's
      pull-down drag can never swallow a tap-to-play. */
  const queueRows = queue.length > 0 ? (
    queue.map((t, i) => (
      <div key={`${t.id}-${i}`} role="button" tabIndex={0}
        onPointerDown={e => e.stopPropagation()}
        onClick={() => { playTrack(t, queue); if (isCompact) setQueueOpen(false); }}
        onKeyDown={e => e.key === "Enter" && playTrack(t, queue)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "7px 8px",
          borderRadius: 10, cursor: "pointer",
          background: t.id === currentTrack?.id ? C.surf : "transparent",
        }}>
        <div style={{ width: 20, fontSize: 12, color: t.id === currentTrack?.id ? C.accent : C.muted, textAlign: "center", flexShrink: 0 }}>
          {i + 1}
        </div>
        <CoverArt bg={t.bg} imageUrl={t.imageUrl} size={38} radius={8} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: t.id === currentTrack?.id ? C.accent : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
          <div style={{ fontSize: 11.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.artist}</div>
        </div>
        <span style={{ fontSize: 11.5, color: C.muted, flexShrink: 0 }}>{t.duration}</span>
      </div>
    ))
  ) : (
    <div style={{ textAlign: "center", color: C.muted, fontSize: 13.5, padding: "28px 8px", lineHeight: 1.6 }}>
      Play an album or playlist to fill your queue.
    </div>
  );

  /** Compact deck — a TOP sheet under the header, visible in both Song and
      Lyrics modes (the ask: the queue lives up top with the lyrics, never
      as a bottom panel). */
  const compactQueuePanel = isCompact && queueOpen && (
    <>
      <div onClick={() => setQueueOpen(false)} aria-hidden
        style={{ position: "absolute", inset: 0, top: 108, background: "rgba(0,0,0,0.5)", zIndex: 5, animation: "fadeIn .15s ease" }} />
      <div role="dialog" aria-label="Queue"
        onPointerDown={e => e.stopPropagation()}
        style={{ position: "absolute", left: 0, right: 0, top: 108, zIndex: 6, maxHeight: "46dvh", overflowY: "auto", scrollbarWidth: "none", background: `color-mix(in srgb, ${C.pane} 94%, transparent)`, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderTop: `1px solid ${C.border}`, padding: "8px 10px 14px", boxShadow: "0 18px 44px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 8px 8px" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Queue</span>
          <button onClick={() => setQueueOpen(false)} aria-label="Close queue"
            style={{ border: "none", background: "none", color: C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 4 }}>
            Done
          </button>
        </div>
        {queueRows}
      </div>
    </>
  );

  /** The mode pill — compact: Song|Lyrics only, active = accent red per the boards. */
  const modes: ReadonlyArray<"song" | "lyrics" | "video"> = isCompact
    ? (hasLyricsOption ? (["song", "lyrics"] as const) : (["song"] as const))
    : (hasLyricsOption ? (["song", "lyrics", "video"] as const) : (["song", "video"] as const));

  const modePill = (
    <div className="player-page-modes" style={{ display: "flex", background: C.surf, borderRadius: 999, padding: 3, fontWeight: 600, fontSize: 12.5 }}>
      {modes.map(mode => (
        <button key={mode} onClick={() => {
          if (mode === "video" && isPlaying) togglePlay(); // audio hands off to the embed
          setMediaMode(mode);
        }}
          style={{
            border: "none", borderRadius: 999, padding: "6px 16px", cursor: "pointer", fontFamily: "inherit",
            background: mediaMode === mode ? (isCompact ? C.accent : C.text) : "transparent",
            color: mediaMode === mode ? "#fff" : C.muted,
            fontSize: 12.5, fontWeight: 700, textTransform: "capitalize",
            display: "inline-flex", alignItems: "center", gap: 6,
            transition: "background .15s, color .15s",
          }}>
          {mode === "lyrics" && <Mic2 size={13} />}
          {mode}
        </button>
      ))}
    </div>
  );

  /* ── Compact lyrics: full-bleed scroller + floating transport card ───────── */
  if (isCompact && mediaMode === "lyrics") {
    return (
      <div className="player-page"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        style={{
        position: "fixed", left: 0, right: 0, top: 0, bottom: 0,
        zIndex: 40, background: C.bg,
        display: "flex", flexDirection: "column", overflow: "hidden",
        animation: "fadeIn .18s ease",
        transform: drag.y ? `translateY(${drag.y}px)` : undefined,
        opacity: drag.y ? Math.max(0.6, 1 - drag.y / 520) : 1,
        transition: drag.active ? "none" : "transform .26s cubic-bezier(.2,.8,.24,1), opacity .26s ease",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}>
        <div aria-hidden style={{ width: 46, height: 5, borderRadius: 3, background: C.border, margin: "9px auto 0", flexShrink: 0, touchAction: "none" }} />
        <div className="player-page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", flexShrink: 0, touchAction: "none" }}>
          <div style={{ width: 36 }} />
          {modePill}
          <button onClick={() => openTrackOptions(currentTrack)} aria-label="Track options"
            style={{ width: 36, height: 36, borderRadius: "50%", background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
            <MoreHorizontal size={20} />
          </button>
        </div>

        {/* Full-bleed lyrics — oversized lines, edge fade (the board). */}
        <div style={{ flex: 1, minHeight: 0, padding: "0 22px", overflow: "hidden" }}>
          <LyricsPanel lyrics={lyrics} plain={plainLyrics} loading={lyricsLoading} elapsed={elapsed} full />
        </div>

        {/* Floating transport card */}
        <div style={{ margin: "10px 14px 8px", borderRadius: 26, background: `color-mix(in srgb, ${C.pane} 74%, transparent)`, backdropFilter: "blur(26px) saturate(1.4)", WebkitBackdropFilter: "blur(26px) saturate(1.4)", border: `1px solid color-mix(in srgb, ${C.text} 10%, transparent)`, padding: "12px 16px", flexShrink: 0, boxShadow: "0 14px 44px rgba(0,0,0,0.5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CoverArt bg={currentTrack.bg} imageUrl={currentTrack.imageUrl} size={44} radius={12} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTrack.title}</div>
              <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentTrack.artist}</div>
            </div>
            <button onClick={playPrev} aria-label="Previous track"
              style={{ width: 40, height: 40, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, padding: 0, flexShrink: 0 }}>
              <SkipBack size={22} fill="currentColor" />
            </button>
            <button onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}
              style={{ width: 46, height: 46, borderRadius: "50%", background: C.accent, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "#fff", padding: 0, flexShrink: 0, boxShadow: "0 8px 22px rgba(0,0,0,0.4)" }}>
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
            <button onClick={playNext} aria-label="Next track"
              style={{ width: 40, height: 40, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, padding: 0, flexShrink: 0 }}>
              <SkipForward size={22} fill="currentColor" />
            </button>
          </div>
          {/* Mini waveform strip + times */}
          <div ref={scrubRef} onClick={e => seekFromEvent(e.clientX)}
            role="slider" aria-label="Seek"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(seekPct * 100)}
            style={{ height: 22, display: "flex", alignItems: "center", gap: 2, cursor: "pointer", marginTop: 10 }}>
            {waveBars.map((h, i) => (
              <div key={i} style={{ flex: 1, minWidth: 0, height: Math.max(4, Math.round(h * 0.72)), borderRadius: 2, background: barColor(i), transition: "background .2s linear" }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 11, color: C.muted }}>{fmtSec(elapsed)}</span>
            <span style={{ fontSize: 11, color: C.muted }}>{total > 0 ? fmtSec(total) : "--:--"}</span>
          </div>
        </div>
        {compactQueuePanel}
      </div>
    );
  }

  return (
    <div className="player-page"
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      style={{
      position: "fixed", left: 12, right: 12, top: 12, bottom: 112,
      zIndex: 40, borderRadius: 18, border: `1px solid ${C.border}`,
      background: `linear-gradient(180deg, ${C.pane} 0%, ${C.bg} 130%)`,
      display: "flex", flexDirection: "column", overflow: "hidden",
      boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
      animation: "fadeIn .18s ease",
      transform: drag.y ? `translateY(${drag.y}px)` : undefined,
      opacity: drag.y ? Math.max(0.6, 1 - drag.y / 520) : 1,
      transition: drag.active ? "none" : "transform .26s cubic-bezier(.2,.8,.24,1), opacity .26s ease",
    }}>
      {/* Grabber — the boards' drag handle; pulling it (or the header) down closes */}
      <div aria-hidden style={{ width: 46, height: 5, borderRadius: 3, background: C.border, margin: "9px auto 0", flexShrink: 0, touchAction: "none" }} />
      {/* Header — compact: pill + more (close lives in the footer chevron) */}
      <div className="player-page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", flexShrink: 0, touchAction: "none" }}>
        {isCompact ? (
          <div style={{ width: 36 }} />
        ) : (
          <button onClick={() => setPlayerPageOpen(false)} aria-label="Close full-screen player"
            style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text }}>
            <ChevronDown size={18} />
          </button>
        )}
        {modePill}
        <button onClick={() => openTrackOptions(currentTrack)} aria-label="Track options"
          style={{ width: 36, height: 36, borderRadius: "50%", background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
          <MoreHorizontal size={17} />
        </button>
      </div>

      {/* Body: artwork, title, seek (stacks under 1200px — see index.css) */}
      <div className="player-page-body" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(300px, 420px)", gap: 24, padding: "4px 28px 20px" }}>
        {/* Left: artwork, title, seek */}
        <div className="player-page-main" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, minWidth: 0 }}>
          {/* Art card — compact wraps it in a blurred backdrop, radius 28 + glass sheen */}
          <div className="player-page-art-wrap" style={{ position: "relative", width: "min(46vh, 100%)", maxWidth: isCompact ? 340 : 440, display: "flex", justifyContent: "center", flexShrink: 0 }}>
            {isCompact && currentTrack.imageUrl && mediaMode === "song" && (
              <img src={currentTrack.imageUrl} alt="" aria-hidden
                style={{ position: "absolute", inset: -28, width: "calc(100% + 56px)", height: "calc(100% + 56px)", objectFit: "cover", filter: "blur(48px) saturate(1.3)", opacity: 0.55, borderRadius: 40, pointerEvents: "none" }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            )}
            <div className="player-page-art" style={{
              position: "relative",
              width: mediaMode === "lyrics" ? "100%" : undefined,
              ...(mediaMode === "lyrics"
                ? { height: "min(42vh, 440px)" }
                : { aspectRatio: "1 / 1" }),
              borderRadius: isCompact && mediaMode === "song" ? 28 : 16,
              background: mediaMode === "lyrics" ? `${C.pane}cc` : currentTrack.bg,
              overflow: "hidden", flexShrink: 0,
              boxShadow: mediaMode === "lyrics" ? "none" : `0 28px 80px ${currentTrack.bg}66`,
              border: mediaMode === "lyrics" ? `1px solid ${C.border}` : "none",
              padding: mediaMode === "lyrics" ? "18px 22px" : 0,
              display: mediaMode === "lyrics" ? "block" : undefined,
            }}>
              {mediaMode === "lyrics" ? (
                <LyricsPanel lyrics={lyrics} plain={plainLyrics} loading={lyricsLoading} elapsed={elapsed} full />
              ) : mediaMode === "video" ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${currentTrack.videoId}?autoplay=1&playsinline=1`}
                  title={currentTrack.title}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                />
              ) : (
                <>
                  {currentTrack.imageUrl && (
                    <img src={currentTrack.imageUrl} alt="" loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", aspectRatio: "1 / 1" }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
                  )}
                  {/* Glass sheen over the art (compact song mode) */}
                  {isCompact && (
                    <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,0.14), transparent 42%)", pointerEvents: "none" }} />
                  )}
                </>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", maxWidth: 560 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: isCompact ? 22 : 24, fontWeight: 800, color: C.text, letterSpacing: -0.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {currentTrack.title}
              </div>
              <div style={{ fontSize: 15, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {currentTrack.artist}
              </div>
            </div>
            <button onClick={() => toggleLike(currentTrack.id)} aria-label={isLiked ? "Unlike" : "Like"}
              style={{ width: 42, height: 42, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: isLiked ? C.accent : C.muted, flexShrink: 0 }}>
              <Heart size={22} fill={isLiked ? C.accent : "none"} />
            </button>
            {/* Download sits right beside Like — same row, same weight. */}
            <button onClick={onDownloadPress} aria-label={isDownloaded ? "Remove download" : "Download"}
              style={{ width: 42, height: 42, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: isDownloaded ? DEVICE_GREEN : C.muted, flexShrink: 0 }}>
              {isDownloaded ? <Check size={22} /> : <Download size={22} />}
            </button>
          </div>

          {/* Seek — waveform bars on compact, a clean progress line on desktop */}
          <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: isCompact ? "column" : "row", alignItems: isCompact ? "stretch" : "center", gap: isCompact ? 4 : 10 }}>
            {isCompact ? (
              <>
                <div ref={scrubRef} onClick={e => seekFromEvent(e.clientX)}
                  role="slider" aria-label="Seek"
                  aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(seekPct * 100)}
                  style={{ width: "100%", height: 34, display: "flex", alignItems: "center", gap: 2, cursor: "pointer" }}>
                  {waveBars.map((h, i) => (
                    <div key={i}
                      style={{
                        flex: 1, minWidth: 0, height: h, borderRadius: 2,
                        background: barColor(i),
                        transition: "background .2s linear",
                      }} />
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: C.muted }}>{fmtSec(elapsed)}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{total > 0 ? fmtSec(total) : "--:--"}</span>
                </div>
              </>
            ) : (
              <>
                <span style={{ fontSize: 11.5, color: C.muted, width: 38, textAlign: "right", flexShrink: 0 }}>{fmtSec(elapsed)}</span>
                <div ref={scrubRef}
                  onClick={e => seekFromEvent(e.clientX)}
                  role="slider" aria-label="Seek"
                  aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(seekPct * 100)}
                  style={{ flex: 1, height: 5, borderRadius: 3, background: C.border, cursor: "pointer", position: "relative" }}>
                  <div style={{ width: `${seekPct * 100}%`, height: "100%", borderRadius: 3, background: C.accent, transition: "width .4s linear" }} />
                </div>
                <span style={{ fontSize: 11.5, color: C.muted, width: 38, flexShrink: 0 }}>{total > 0 ? fmtSec(total) : "--:--"}</span>
              </>
            )}
          </div>
        </div>

        {/* Transport — rendered for the mobile overlay (the dock underneath is
            covered); index.css hides it where the bottom bar owns transport.
            Compact play button is the boards' red. */}
        <div className="player-page-transport">
          <button onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffleOn}
            style={{ width: 44, height: 44, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: shuffleOn ? C.accent : C.muted, padding: 0 }}>
            <Shuffle size={22} />
          </button>
          <button onClick={playPrev} aria-label="Previous track"
            style={{ width: 48, height: 48, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, padding: 0 }}>
            <SkipBack size={30} fill="currentColor" />
          </button>
          <button onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}
            style={{ width: isCompact ? 70 : 72, height: isCompact ? 70 : 72, borderRadius: "50%", background: isCompact ? C.accent : C.text, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: isCompact ? "#fff" : C.pane, padding: 0, boxShadow: isCompact ? `0 12px 34px ${C.accent}59` : "0 12px 34px rgba(0,0,0,0.45)" }}>
            {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
          </button>
          <button onClick={playNext} aria-label="Next track"
            style={{ width: 48, height: 48, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text, padding: 0 }}>
            <SkipForward size={30} fill="currentColor" />
          </button>
          <button onClick={cycleRepeat} aria-label={`Repeat: ${repeatMode}`}
            style={{ width: 44, height: 44, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: repeatMode !== "off" ? C.accent : C.muted, padding: 0 }}>
            {repeatMode === "one" ? <Repeat1 size={22} /> : <Repeat size={22} />}
          </button>
        </div>

        {/* Up-next glimpse — compact only, one tappable line under transport. */}
        {isCompact && nextUp && (
          <button onClick={playNext} aria-label={`Up next: ${nextUp.title}`}
            style={{ display: "flex", alignItems: "center", gap: 8, margin: "-6px auto 0", maxWidth: 420, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.muted, fontSize: 12.5, padding: "2px 10px", minWidth: 0 }}>
            <span style={{ fontWeight: 800, color: C.accent, flexShrink: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Up next</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nextUp.title} — {nextUp.artist}</span>
            <SkipForward size={13} style={{ flexShrink: 0 }} />
          </button>
        )}

        {/* Right: the deck. Lyrics is NOT a tab here — the single lyrics
            control is the Song|Lyrics pill at the top of the player. */}
        <div className="player-page-context" style={{ display: "flex", flexDirection: "column", minHeight: 0, background: C.pane, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "12px 14px 4px", flexShrink: 0, color: C.text, fontSize: 12.5, fontWeight: 800 }}>
            <ListMusic size={14} /> Queue
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none", padding: "8px 14px 16px" }}>
            {queueRows}
          </div>
        </div>
      </div>

      {/* Footer — mobile only (hidden by index.css above the shell breakpoint),
          per the boards' bottom row: queue, share, output device, collapse. */}
      {/* Compact deck — TOP sheet, works in Song AND Lyrics modes. */}
      {compactQueuePanel}

      <div className="player-page-foot">
        <button onClick={() => setQueueOpen(v => !v)} aria-label="Queue" aria-pressed={queueOpen}
          style={{ width: 44, height: 44, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: queueOpen ? C.accent : C.muted, padding: 0 }}>
          <ListMusic size={21} />
        </button>
        <button onClick={() => setShareOpen(true)} aria-label="Share track"
          style={{ width: 44, height: 44, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted, padding: 0 }}>
          <Send size={19} />
        </button>
        {/* Output device chip — only when a real device name is known */}
        {outputDevice.label && (
          <button onClick={() => setPlayerPageOpen(false)} aria-label={`Output: ${outputDevice.name}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 14px", borderRadius: 999, background: `color-mix(in srgb, ${DEVICE_GREEN} 14%, transparent)`, border: "none", cursor: "pointer", color: DEVICE_GREEN, fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", flexShrink: 0 }}>
            <Headphones size={14} />
            <span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{outputDevice.name}</span>
          </button>
        )}
        <button onClick={() => setPlayerPageOpen(false)} aria-label="Close full-screen player"
          style={{ width: 44, height: 44, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted, padding: 0 }}>
          <ChevronDown size={22} />
        </button>
      </div>

      {/* Social share sheet — one tap per network, like Spotify's share row. */}
      {shareOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 70 }}>
          <div onClick={() => setShareOpen(false)} aria-hidden
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", animation: "fadeIn .15s ease" }} />
          <div role="dialog" aria-label="Share"
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: C.pane, borderRadius: "20px 20px 0 0", border: `1px solid ${C.border}`, borderBottom: "none", padding: "10px 18px calc(18px + env(safe-area-inset-bottom, 0px))", animation: "slideUp .22s ease", boxShadow: "0 -16px 50px rgba(0,0,0,0.5)" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border, margin: "0 auto 12px" }} />
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 2 }}>{currentTrack.title}</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Share this track</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {shareTargets.map(({ key, label, Icon, href }) => (
                <button key={key} onClick={() => shareVia({ key, label, Icon, href } as typeof shareTargets[number])}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, padding: "12px 4px", borderRadius: 14, background: C.surf, border: "none", cursor: "pointer", color: C.text, fontFamily: "inherit" }}>
                  <span style={{ width: 40, height: 40, borderRadius: "50%", background: key === "copy" ? `color-mix(in srgb, ${C.accent} 16%, transparent)` : C.pane, display: "grid", placeItems: "center", color: key === "copy" ? C.accent : C.text }}>
                    <Icon size={18} />
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
