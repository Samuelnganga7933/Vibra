import React, { useEffect, useRef } from "react";
import { useApp, type LyricLine } from "../../context";

/**
 * Synced/plain lyrics scroller — shared by the right panel, the full-screen
 * player and the mobile lyrics sheet so all three render identically.
 */
export function LyricsPanel({ lyrics, plain, loading, elapsed }: { lyrics: LyricLine[]; plain: string; loading: boolean; elapsed: number }) {
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
