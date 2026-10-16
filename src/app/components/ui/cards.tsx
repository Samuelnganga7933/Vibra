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

  const cover = (
    <div
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
      <ImageWithFallback src={imageUrl} coverColor={coverColor} alt={title} highlight />
    </div>
  );

  const labels = (
    <>
      <div
        style={{
          fontWeight: 700,
          fontSize: pane ? 14 : 13.5,
          color: C.text,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: "100%",
          minWidth: 0,
          ...(row ? { flex: 1, padding: "0 12px" } : { marginTop: pane ? 12 : 9 }),
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
    <button
      type="button"
      onClick={onClick}
      className={className}
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
        ...style,
      }}
    >
      {cover}
      {labels}
    </button>
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
}: {
  track: TrackCardData;
  size?: number;
  radius?: number;
  variant?: "pane" | "bare";
  layout?: "stack" | "row";
  onClick?: () => void;
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
      onClick={onClick}
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
