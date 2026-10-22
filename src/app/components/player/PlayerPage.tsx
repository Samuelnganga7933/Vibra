import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, Heart, ListMusic, Mic2, MoreHorizontal,
  Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward,
} from "lucide-react";
import { useApp, fmtSec } from "../../context";
import { CoverArt } from "../CoverArt";
import { LyricsPanel } from "./LyricsPanel";

/**
 * Full-screen player — artwork, metadata, seek and queue context.
 * Transport lives in the bottom bar on desktop (which stays visible below
 * this overlay); below the shell breakpoint the player covers the dock, so
 * its own transport row + footer render there (CSS in index.css).
 */
export function PlayerPage() {
  const {
    C, currentTrack, progress, elapsed, audioDuration, handleSeek,
    likedTrackIds, toggleLike, queue, playTrack,
    setPlayerPageOpen,
    openTrackOptions,
    isPlaying, togglePlay,
    lyrics, plainLyrics, lyricsLoading, uiState,
    playPrev, playNext, shuffleOn, toggleShuffle, repeatMode, cycleRepeat,
  } = useApp();
  const scrubRef = useRef<HTMLDivElement | null>(null);
  const [mediaMode, setMediaMode] = useState<"song" | "video" | "lyrics">("song");
  const [ctxTab, setCtxTab] = useState<"queue" | "lyrics">("queue");
  /** Mobile footer's queue icon swaps the artwork body for the queue list. */
  const [queueOpen, setQueueOpen] = useState(false);
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

  // A track without lyrics can't keep a lyrics view open.
  useEffect(() => {
    if (mediaMode === "lyrics" && !hasLyricsOption) setMediaMode("song");
    if (ctxTab === "lyrics" && !hasLyricsOption) setCtxTab("queue");
  }, [mediaMode, ctxTab, hasLyricsOption]);

  if (!currentTrack) return null;
  const isLiked = likedTrackIds.has(currentTrack.id);
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

  return (
    <div className={`player-page${queueOpen ? " show-queue" : ""}`}
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
      {/* Header */}
      <div className="player-page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", flexShrink: 0, touchAction: "none" }}>
        <button onClick={() => setPlayerPageOpen(false)} aria-label="Close full-screen player"
          style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text }}>
          <ChevronDown size={18} />
        </button>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>
          {/* Song/Lyrics/Video toggle — video hands the canvas to the YouTube embed */}
          <div className="player-page-modes" style={{ display: "flex", background: C.surf, borderRadius: 999, padding: 3, fontWeight: 600, fontSize: 12.5, textTransform: "none", letterSpacing: 0 }}>
            {(hasLyricsOption ? (["song", "lyrics", "video"] as const) : (["song", "video"] as const)).map(mode => (
              <button key={mode} onClick={() => {
                if (mode === "video" && isPlaying) togglePlay(); // audio hands off to the embed
                setMediaMode(mode);
              }}
                style={{
                  border: "none", borderRadius: 999, padding: "6px 18px", cursor: "pointer", fontFamily: "inherit",
                  background: mediaMode === mode ? C.text : "transparent",
                  color: mediaMode === mode ? C.pane : C.muted,
                  fontSize: 12.5, fontWeight: 700, textTransform: "capitalize",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                {mode === "lyrics" && <Mic2 size={13} />}
                {mode}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => openTrackOptions(currentTrack)} aria-label="Track options"
          style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
          <MoreHorizontal size={17} />
        </button>
      </div>

      {/* Body: artwork + meta + context (stacks under 1200px — see index.css) */}
      <div className="player-page-body" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(300px, 420px)", gap: 24, padding: "4px 28px 20px" }}>
        {/* Left: artwork, title, seek */}
        <div className="player-page-main" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, minWidth: 0 }}>
          <div className="player-page-art" style={{
            width: "min(46vh, 100%)", maxWidth: 440,
            ...(mediaMode === "lyrics"
              ? { height: "min(42vh, 440px)" }
              : { aspectRatio: "1 / 1" }),
            borderRadius: 16,
            background: mediaMode === "lyrics" ? `${C.pane}cc` : currentTrack.bg,
            overflow: "hidden", flexShrink: 0,
            boxShadow: mediaMode === "lyrics" ? "none" : `0 28px 80px ${currentTrack.bg}66`,
            border: `1px solid ${C.border}`,
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
              currentTrack.imageUrl && (
                <img src={currentTrack.imageUrl} alt="" loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", aspectRatio: "1 / 1" }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
              )
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", maxWidth: 560 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: -0.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
          </div>

          {/* Seek — waveform bars on compact, a clean progress line on desktop */}
          <div style={{ width: "100%", maxWidth: 560, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11.5, color: C.muted, width: 38, textAlign: "right", flexShrink: 0 }}>{fmtSec(elapsed)}</span>
            {isCompact ? (
              <div ref={scrubRef} onClick={e => seekFromEvent(e.clientX)}
                role="slider" aria-label="Seek"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(progress, 1) * 100)}
                style={{ flex: 1, minWidth: 0, height: 30, display: "flex", alignItems: "center", gap: 2, cursor: "pointer" }}>
                {waveBars.map((h, i) => (
                  <div key={i}
                    style={{
                      flex: 1, minWidth: 0, height: h, borderRadius: 2,
                      background: (i + 1) / waveBars.length <= Math.min(progress, 1) ? C.accent : C.border,
                      transition: "background .2s linear",
                    }} />
                ))}
              </div>
            ) : (
              <div ref={scrubRef}
                onClick={e => seekFromEvent(e.clientX)}
                role="slider" aria-label="Seek"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(progress, 1) * 100)}
                style={{ flex: 1, height: 5, borderRadius: 3, background: C.border, cursor: "pointer", position: "relative" }}>
                <div style={{ width: `${Math.min(progress, 1) * 100}%`, height: "100%", borderRadius: 3, background: C.accent, transition: "width .4s linear" }} />
              </div>
            )}
            <span style={{ fontSize: 11.5, color: C.muted, width: 38, flexShrink: 0 }}>{total > 0 ? fmtSec(total) : "--:--"}</span>
          </div>
        </div>

        {/* Transport — rendered for the mobile overlay (the dock underneath is
            covered); index.css hides it where the bottom bar owns transport. */}
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
            style={{ width: 72, height: 72, borderRadius: "50%", background: C.text, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.pane, padding: 0, boxShadow: "0 12px 34px rgba(0,0,0,0.45)" }}>
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

        {/* Right: context tabs */}
        <div className="player-page-context" style={{ display: "flex", flexDirection: "column", minHeight: 0, background: C.pane, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 4, padding: "12px 12px 0", flexShrink: 0 }}>
            <button onClick={() => setCtxTab("queue")} style={{
              flex: 1, height: 34, borderRadius: 9, border: "none", cursor: "pointer",
              background: ctxTab === "queue" ? C.text : C.surf,
              color: ctxTab === "queue" ? C.pane : C.text, fontSize: 12.5, fontWeight: 700,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
              <ListMusic size={14} /> Queue
            </button>
            {hasLyricsOption && (
              <button onClick={() => setCtxTab("lyrics")} className="player-page-ctx-lyrics" style={{
                flex: 1, height: 34, borderRadius: 9, border: "none", cursor: "pointer",
                background: ctxTab === "lyrics" ? C.text : C.surf,
                color: ctxTab === "lyrics" ? C.pane : C.text, fontSize: 12.5, fontWeight: 700,
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}>
                <Mic2 size={14} /> Lyrics
              </button>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none", padding: "12px 14px 16px" }}>
            {ctxTab === "lyrics" ? (
              <LyricsPanel lyrics={lyrics} plain={plainLyrics} loading={lyricsLoading} elapsed={elapsed} />
            ) : queue.length > 0 ? (
                queue.map((t, i) => (
                  <div key={`${t.id}-${i}`} role="button" tabIndex={0}
                    onClick={() => playTrack(t, queue)}
                    onKeyDown={e => e.key === "Enter" && playTrack(t, queue)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "7px 8px",
                      borderRadius: 10, cursor: "pointer",
                      background: t.id === currentTrack.id ? C.surf : "transparent",
                    }}>
                    <div style={{ width: 20, fontSize: 12, color: t.id === currentTrack.id ? C.accent : C.muted, textAlign: "center", flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <CoverArt bg={t.bg} imageUrl={t.imageUrl} size={38} radius={8} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: t.id === currentTrack.id ? C.accent : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                      <div style={{ fontSize: 11.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.artist}</div>
                    </div>
                    <span style={{ fontSize: 11.5, color: C.muted, flexShrink: 0 }}>{t.duration}</span>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: "center", color: C.muted, fontSize: 13.5, padding: "28px 8px", lineHeight: 1.6 }}>
                  Play an album or playlist to fill your queue.
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Footer — queue toggle + close; mobile only (hidden by index.css
          above the shell breakpoint), per the boards' bottom row. */}
      <div className="player-page-foot">
        <button onClick={() => setQueueOpen(v => !v)} aria-label="Queue" aria-pressed={queueOpen}
          style={{ width: 44, height: 44, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: queueOpen ? C.accent : C.muted, padding: 0 }}>
          <ListMusic size={21} />
        </button>
        <button onClick={() => setPlayerPageOpen(false)} aria-label="Close full-screen player"
          style={{ width: 44, height: 44, background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted, padding: 0 }}>
          <ChevronDown size={22} />
        </button>
      </div>
    </div>
  );
}
