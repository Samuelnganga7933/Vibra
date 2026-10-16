import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CloudOff, HardDrive, Play, RefreshCw, Trash2, X } from "lucide-react";
import { ImageWithFallback } from "../ui/ImageWithFallback";
import { EmptyStateCard } from "../ui/EmptyStateCard";
import { UiThemeContext, type UiColors } from "../ui/ui-theme";
import {
  clearOfflineTracks,
  mergeOfflineTracks,
  readOfflineTracks,
  unmarkOfflineCleared,
  wasOfflineCleared,
  writeOfflineTracks,
  type OfflineTrack,
} from "../../services/offlineStorage";

export type { OfflineTrack };

const EMPTY_GIF =
  "https://media.giphy.com/media/Yq2DaPfhTMb3GEZWju/giphy.gif";

interface DownloadsViewProps {
  /** Offline tracks reported by the library API; merged into the local cache. */
  tracks?: OfflineTrack[];
  onPlay?: (track: OfflineTrack, queue: OfflineTrack[]) => void;
  /** Called after the cache has been re-synced from the library. */
  onSync?: () => void;
  colors?: UiColors;
}

/**
 * Offline storage hub: renders the local `vibra_downloads` cache (seeded from
 * server-side downloads), offers a library sync, and clears the cache behind a
 * confirmation dialog. All storage access is failure-tolerant.
 */
export function DownloadsView({ tracks = [], onPlay, onSync, colors }: DownloadsViewProps) {
  const theme = React.useContext(UiThemeContext);
  const C = colors ?? theme;

  const [cached, setCached] = useState<OfflineTrack[]>([]);
  const [cleared, setCleared] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Mount: safely parse the stored tracks array and previous clear state.
  useEffect(() => {
    setCached(readOfflineTracks());
    setCleared(wasOfflineCleared());
  }, []);

  // Write-through: server downloads become part of the offline cache, unless
  // the user deliberately cleared it (until the next explicit sync).
  useEffect(() => {
    if (cleared || tracks.length === 0) return;
    setCached(prev => {
      const merged = mergeOfflineTracks(prev, tracks);
      writeOfflineTracks(merged);
      return merged;
    });
  }, [tracks, cleared]);

  const items = useMemo(() => (cleared ? [] : mergeOfflineTracks(cached, tracks)), [cleared, cached, tracks]);

  const handleSync = useCallback(() => {
    const merged = mergeOfflineTracks(cached, tracks);
    setCached(merged);
    writeOfflineTracks(merged);
    setCleared(false);
    unmarkOfflineCleared();
    onSync?.();
  }, [cached, tracks, onSync]);

  const handleClear = useCallback(() => {
    clearOfflineTracks();
    setCached([]);
    setCleared(true);
    setConfirming(false);
  }, []);

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 10px",
    borderRadius: 12,
    border: `1px solid ${C.border}`,
    background: C.pane,
    marginBottom: 8,
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Offline storage summary + actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "14px 16px",
          borderRadius: 16,
          border: `1px solid ${C.border}`,
          background: C.surf,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 180 }}>
          <HardDrive size={16} color={C.accent} aria-hidden />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Offline Storage</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              {items.length} track{items.length === 1 ? "" : "s"} in Cached Audio
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleSync}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 36,
              padding: "0 14px",
              borderRadius: 18,
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.text,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <RefreshCw size={13} aria-hidden /> Sync Library
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={items.length === 0}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 36,
              padding: "0 14px",
              borderRadius: 18,
              border: "1px solid rgba(229,72,77,0.4)",
              background: "rgba(229,72,77,0.1)",
              color: "#E5484D",
              fontSize: 13,
              fontWeight: 600,
              cursor: items.length > 0 ? "pointer" : "not-allowed",
              opacity: items.length > 0 ? 1 : 0.5,
            }}
          >
            <Trash2 size={13} aria-hidden /> Clear Offline Cache
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <div>
          {items.map((t, i) => (
            <div key={String(t.id)} style={rowStyle}>
              <button
                type="button"
                aria-label={`Play ${t.title}`}
                onClick={() => onPlay?.(t, items)}
                disabled={!onPlay}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  border: "none",
                  padding: 0,
                  overflow: "hidden",
                  background: t.bg ?? C.surf,
                  cursor: onPlay ? "pointer" : "default",
                  flexShrink: 0,
                  position: "relative",
                }}
              >
                <ImageWithFallback src={t.imageUrl} coverColor={t.bg} alt="" highlight />
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(0,0,0,0.35)",
                  }}
                >
                  <Play size={14} color="#fff" fill="#fff" />
                </span>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    color: C.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.muted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.artist}
                </div>
              </div>
              <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{t.duration}</span>
              <span
                title="Available offline"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#34C759",
                  flexShrink: 0,
                }}
              >
                <CloudOff size={12} aria-hidden /> Offline
              </span>
              <span
                aria-hidden
                style={{ fontSize: 12, color: C.muted, width: 18, textAlign: "right" }}
              >
                {i + 1}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyStateCard
          colors={C}
          visual={EMPTY_GIF}
          title="No Offline Tracks"
          subtitle="Tracks you download will be stored locally for offline playback."
          action={
            <button
              type="button"
              onClick={handleSync}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                height: 42,
                padding: "0 20px",
                borderRadius: 21,
                border: "none",
                background: C.accent,
                color: C.bg,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <RefreshCw size={15} aria-hidden /> Sync Library
            </button>
          }
        />
      )}

      {/* Confirmation dialog */}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Clear offline cache"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={() => setConfirming(false)}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(6px)",
            }}
          />
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 380,
              borderRadius: 22,
              padding: 26,
              border: `1px solid ${C.border}`,
              background: C.pane,
              boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "rgba(229,72,77,0.14)",
                  display: "grid",
                  placeItems: "center",
                  color: "#E5484D",
                  flexShrink: 0,
                }}
              >
                <Trash2 size={18} aria-hidden />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>
                  Clear offline cache?
                </div>
                <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginTop: 6 }}>
                  This removes all {items.length} locally stored track
                  {items.length === 1 ? "" : "s"} from this device. Nothing in
                  your library is deleted.
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setConfirming(false)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  border: "none",
                  background: C.surf,
                  color: C.muted,
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 22,
                  border: `1px solid ${C.border}`,
                  background: "transparent",
                  color: C.text,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Keep them
              </button>
              <button
                type="button"
                onClick={handleClear}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 22,
                  border: "none",
                  background: "#E5484D",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Clear cache
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
