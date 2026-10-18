import React from "react";
import { ImageWithFallback } from "./ImageWithFallback";
import { UiThemeContext, type UiColors } from "./ui-theme";

interface MediaCardProps {
  title: string;
  /** Artist / creator / year line. */
  subtitle?: string;
  /** Trailing metadata (track count, duration). */
  meta?: string;
  /** Cover colour hex — drives the gradient fallback. */
  coverColor?: string;
  imageUrl?: string;
  /** Cover edge length in px. */
  size?: number;
  /** Corner radius for the cover. */
  radius?: number;
  /** Pane-backed card (library grids) vs. bare card (rails). */
  variant?: "pane" | "bare";
  /** Stacked card vs. horizontal row tile (compact playlists, rails). */
  layout?: "stack" | "row";
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The one cover-art card used by tracks, albums and playlists — a single
 * shared treatment instead of per-screen duplicated tile markup.
 */
function MediaCard({
  title,
  subtitle,
  meta,
  coverColor,
  imageUrl,
  size = 140,
  radius = 14,
  variant = "bare",
  layout = "stack",
  onClick,
  className,
  style,
}: MediaCardProps) {
  const C = React.useContext(UiThemeContext);

  const pane = variant === "pane";
  const row = layout === "row";

  // Interactive hover — cursor-following glow behind the card + a light tilt
  // toward the pointer. Pointer vars are written straight to the DOM (no
  // re-render per mousemove); reduced-motion users get the static card.
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const reduced = React.useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const onHoverMove = (e: React.MouseEvent) => {
    if (reduced) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / Math.max(r.width, 1);
    const py = (e.clientY - r.top) / Math.max(r.height, 1);
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
    el.style.setProperty("--tiltY", `${((px - 0.5) * 12).toFixed(2)}deg`);
    el.style.setProperty("--tiltX", `${((0.5 - py) * 9).toFixed(2)}deg`);
  };

  // The glow wears the card's own colour so every shelf lights in its key.
  const glow = coverColor && /^#[0-9a-f]{6}$/i.test(coverColor) ? `${coverColor}99` : `${C.accent}80`;

  const cover = (
    <div
      className="mcard-cover"
      style={{
        width: size,
        height: size,
        aspectRatio: pane && !row ? "1 / 1" : undefined,
        flexShrink: 0,
        borderRadius: radius,
        overflow: "hidden",
        background: coverColor ?? C.surf,
        position: "relative",
        ...(pane && !row ? { width: "100%", height: "auto" } : null),
      }}
    >
      <ImageWithFallback src={imageUrl} coverColor={coverColor} alt={title} />
    </div>
  );

  const labels = (
    <>
      <div
        style={{
          fontWeight: 700,
          fontSize: pane ? 14 : 13.5,
          color: C.text,
          width: "100%",
          minWidth: 0,
          ...(row
            ? {
                flex: 1,
                padding: "0 12px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }
            : {
                // Two lines, then ellipsis — long titles breathe instead of
                // clipping mid-word, and minHeight keeps tile rows aligned.
                marginTop: pane ? 12 : 9,
                minHeight: pane ? 38 : 36,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                whiteSpace: "normal",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }),
        }}
      >
        {title}
      </div>
      {(subtitle || meta) && (
        <div
          style={{
            fontSize: 12,
            color: C.muted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            width: "100%",
            ...(row ? { display: "none" } : { marginTop: 3 }),
          }}
        >
          {[subtitle, meta].filter(Boolean).join(" · ")}
        </div>
      )}
    </>
  );

  return (
    <div
      ref={wrapRef}
      className="mcard-wrap"
      onMouseMove={onHoverMove}
      style={{
        position: "relative",
        width: row ? "100%" : pane ? "100%" : size,
        flexShrink: row ? undefined : 0,
      }}
    >
      <div
        className="mcard-glow"
        aria-hidden
        style={{
          background: `radial-gradient(150px circle at var(--mx, 50%) var(--my, 42%), ${glow}, transparent 72%)`,
        }}
      />
      <button
        type="button"
        onClick={onClick}
        className={className ? `mcard ${className}` : "mcard"}
        style={{
          width: row ? "100%" : pane ? "100%" : size,
          height: row ? size : undefined,
          flexShrink: 0,
          background: pane || row ? (row ? C.surf : C.pane) : "none",
          border: pane && !row ? `1px solid ${C.border}` : "none",
          borderRadius: row ? 10 : pane ? 16 : undefined,
          padding: row ? 0 : pane ? 14 : 0,
          overflow: "hidden",
          cursor: onClick ? "pointer" : "default",
          textAlign: "left",
          display: "flex",
          flexDirection: row ? "row" : "column",
          alignItems: row ? "center" : undefined,
          minWidth: 0,
          position: "relative",
          ...style,
        }}
      >
        {cover}
        {labels}
      </button>
    </div>
  );
}

interface TrackCardData {
  title: string;
  artist?: string;
  album?: string;
  duration?: string;
  bg?: string;
  imageUrl?: string;
}

interface AlbumCardData {
  title: string;
  artist?: string;
  year?: string;
  trackCount?: number;
  bg?: string;
  imageUrl?: string;
}

interface PlaylistCardData {
  name: string;
  creator?: string;
  trackCount?: number;
  bg?: string;
  imageUrl?: string;
}

const withMeta = (count?: number, unit = "tracks") =>
  typeof count === "number" && count > 0 ? `${count} ${unit}` : undefined;

export function TrackCard({
  track,
  size = 140,
  radius = 14,
  variant = "bare",
  layout = "stack",
  onClick,
  onPlay,
}: {
  track: TrackCardData;
  size?: number;
  radius?: number;
  variant?: "pane" | "bare";
  layout?: "stack" | "row";
  onClick?: () => void;
  /** Fired with the card's track whenever it is clicked. */
  onPlay?: (track: TrackCardData) => void;
}) {
  return (
    <MediaCard
      title={track.title ?? "Untitled track"}
      subtitle={track.artist}
      meta={track.duration}
      coverColor={track.bg}
      imageUrl={track.imageUrl}
      size={size}
      radius={radius}
      variant={variant}
      layout={layout}
      onClick={() => {
        onPlay?.(track);
        onClick?.();
      }}
    />
  );
}

export function AlbumCard({
  album,
  size = 140,
  radius = 12,
  variant = "bare",
  layout = "stack",
  onClick,
}: {
  album: AlbumCardData;
  size?: number;
  radius?: number;
  variant?: "pane" | "bare";
  layout?: "stack" | "row";
  onClick?: () => void;
}) {
  return (
    <MediaCard
      title={album.title ?? "Untitled album"}
      subtitle={album.artist}
      meta={[album.year, withMeta(album.trackCount, "songs")].filter(Boolean).join(" · ")}
      coverColor={album.bg}
      imageUrl={album.imageUrl}
      size={size}
      radius={radius}
      variant={variant}
      layout={layout}
      onClick={onClick}
    />
  );
}

export function PlaylistItemCard({
  playlist,
  size = 140,
  radius = 14,
  variant = "bare",
  layout = "stack",
  onClick,
}: {
  playlist: PlaylistCardData;
  size?: number;
  radius?: number;
  variant?: "pane" | "bare";
  layout?: "stack" | "row";
  onClick?: () => void;
}) {
  return (
    <MediaCard
      title={playlist.name ?? "Untitled playlist"}
      subtitle={playlist.creator}
      meta={withMeta(playlist.trackCount, "songs")}
      coverColor={playlist.bg}
      imageUrl={playlist.imageUrl}
      size={size}
      radius={radius}
      variant={variant}
      layout={layout}
      onClick={onClick}
    />
  );
}
