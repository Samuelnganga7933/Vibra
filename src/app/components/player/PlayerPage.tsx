import React, { useEffect, useRef } from "react";
import { ChevronDown, Heart, ListMusic, Mic2, MoreHorizontal } from "lucide-react";
import { useApp, fmtSec } from "../../context";
import { LyricsPanel } from "./LyricsPanel";
import { CoverArt } from "../CoverArt";

/**
 * Full-screen player — artwork, metadata, seek and context (queue/lyrics).
 * Transport controls live only in the bottom bar, which stays visible below
 * this overlay, so nothing is duplicated here.
 */
export function PlayerPage() {
  const {
    C, currentTrack, progress, elapsed, audioDuration, handleSeek,
    likedTrackIds, toggleLike, queue, playTrack,
    panelTab, openPanel, setPlayerPageOpen,
    lyrics, plainLyrics, lyricsLoading, uiState, openTrackOptions,
  } = useApp();
  const scrubRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPlayerPageOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPlayerPageOpen]);

  if (!currentTrack) return null;
  const isLiked = likedTrackIds.has(currentTrack.id);
  const tab: "queue" | "lyrics" = panelTab === "lyrics" ? "lyrics" : "queue";
  const total = audioDuration > 0 ? audioDuration : currentTrack.durationSec ?? 0;

  const seekFromEvent = (clientX: number) => {
    const el = scrubRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    handleSeek((clientX - r.left) / r.width);
  };

  return (
    <div style={{
      position: "fixed", left: 12, right: 12, top: 12, bottom: 112,
      zIndex: 40, borderRadius: 18, border: `1px solid ${C.border}`,
      background: `linear-gradient(180deg, ${C.pane} 0%, ${C.bg} 130%)`,
      display: "flex", flexDirection: "column", overflow: "hidden",
      boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
      animation: "fadeIn .18s ease",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", flexShrink: 0 }}>
        <button onClick={() => setPlayerPageOpen(false)} aria-label="Close full-screen player"
          style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.text }}>
          <ChevronDown size={18} />
        </button>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>
          Now playing
        </div>
        <button onClick={() => openTrackOptions(currentTrack)} aria-label="Track options"
          style={{ width: 36, height: 36, borderRadius: "50%", background: C.surf, border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: C.muted }}>
          <MoreHorizontal size={17} />
        </button>
      </div>

      {/* Body: artwork + meta + context */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(300px, 420px)", gap: 24, padding: "4px 28px 20px" }}>
        {/* Left: artwork, title, seek */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, minWidth: 0 }}>
          <div style={{
            width: "min(46vh, 100%)", maxWidth: 440, aspectRatio: "1 / 1", borderRadius: 16,
            background: currentTrack.bg, overflow: "hidden", flexShrink: 0,
            boxShadow: `0 28px 80px ${currentTrack.bg}66`, border: `1px solid ${C.border}`,
          }}>
            {currentTrack.imageUrl && (
              <img src={currentTrack.imageUrl} alt="" loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", aspectRatio: "1 / 1" }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
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

          {/* Seek — display + scrub only; no transport controls here */}
          <div style={{ width: "100%", maxWidth: 560, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11.5, color: C.muted, width: 38, textAlign: "right", flexShrink: 0 }}>{fmtSec(elapsed)}</span>
            <div ref={scrubRef}
              onClick={e => seekFromEvent(e.clientX)}
              style={{ flex: 1, height: 5, borderRadius: 3, background: C.border, cursor: "pointer", position: "relative" }}>
              <div style={{ width: `${Math.min(progress, 1) * 100}%`, height: "100%", borderRadius: 3, background: C.accent, transition: "width .4s linear" }} />
            </div>
            <span style={{ fontSize: 11.5, color: C.muted, width: 38, flexShrink: 0 }}>{total > 0 ? fmtSec(total) : "--:--"}</span>
          </div>
        </div>

        {/* Right: context tabs */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: C.pane, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 4, padding: "12px 12px 0", flexShrink: 0 }}>
            <button onClick={() => openPanel("queue")} style={{
              flex: 1, height: 34, borderRadius: 9, border: "none", cursor: "pointer",
              background: tab === "queue" ? C.surf : "transparent",
              color: tab === "queue" ? C.text : C.muted, fontSize: 12.5, fontWeight: 700,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
              <ListMusic size={14} /> Queue
            </button>
            {uiState.hasLyrics && (
              <button onClick={() => openPanel("lyrics")} style={{
                flex: 1, height: 34, borderRadius: 9, border: "none", cursor: "pointer",
                background: tab === "lyrics" ? C.surf : "transparent",
                color: tab === "lyrics" ? C.text : C.muted, fontSize: 12.5, fontWeight: 700,
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}>
                <Mic2 size={14} /> Lyrics
              </button>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none", padding: "12px 14px 16px" }}>
            {tab === "queue" ? (
              queue.length > 0 ? (
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
              )
            ) : (
              <LyricsPanel lyrics={lyrics} plain={plainLyrics} loading={lyricsLoading} elapsed={elapsed} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
