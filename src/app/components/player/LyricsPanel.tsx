import React, { useEffect, useRef } from "react";
import { useApp, type LyricLine } from "../../context";

/**
 * Synced/plain lyrics scroller — shared by the right panel, the full-screen
 * player and the mobile lyrics sheet so all three render identically.
 * `full` is the PlayerLyrics board treatment: oversized lines, edge fade.
 */
export function LyricsPanel({ lyrics, plain, loading, elapsed, full = false }: { lyrics: LyricLine[]; plain: string; loading: boolean; elapsed: number; full?: boolean }) {
  const { C } = useApp();
  const activeIdx = lyrics.reduce((best, line, i) => (line.time <= elapsed ? i : best), -1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (activeIdx >= 0) refs.current[activeIdx]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIdx]);

  const fadeMask = "linear-gradient(transparent, #000 16%, #000 84%, transparent)";
  const scroller: React.CSSProperties = full
    ? { overflowY: "auto", height: "100%", scrollbarWidth: "none", maskImage: fadeMask, WebkitMaskImage: fadeMask, padding: "8px 4px" }
    : { overflowY: "auto", maxHeight: 380, scrollbarWidth: "none" };

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: full ? "100%" : 160, color: C.muted, fontSize: full ? 17 : 14 }}>Loading lyrics…</div>;
  if (lyrics.length > 0) return (
    <div style={scroller}>
      {lyrics.map((line, i) => {
        const active = i === activeIdx;
        const past = i < activeIdx;
        return (
          <div key={i} ref={el => { refs.current[i] = el; }}
            style={{
              padding: full ? "8px 0" : "5px 0",
              fontSize: full ? (active ? 30 : 20) : (active ? 16 : 14),
              fontWeight: active ? 800 : 400,
              color: full && !active ? C.text : (active ? C.text : C.muted),
              opacity: full && !active ? (past ? 0.4 : 0.32) : 1,
              lineHeight: full ? 1.28 : 1.55,
              transition: "all .3s",
            }}>
            {line.text}
          </div>
        );
      })}
    </div>
  );
  if (plain) return <div style={{ ...scroller, fontSize: full ? 22 : 14, color: full ? C.text : C.muted, opacity: full ? 0.85 : 1, lineHeight: full ? 1.5 : 1.8, whiteSpace: "pre-line" }}>{plain}</div>;
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: full ? "100%" : "auto", textAlign: "center", color: C.muted, fontSize: full ? 16 : 14, padding: full ? 0 : "32px 0" }}>No lyrics for this song yet.</div>;
}
