import React from "react";
import { ImageWithFallback } from "./ui/ImageWithFallback";

/**
 * Square artwork tile — `aspect-ratio: 1/1`, cover-fit, solid cover-colour
 * fallback while (or if) the image never loads.
 */
export function CoverArt({ bg, imageUrl, size = 48, radius = 12 }: { bg: string; imageUrl?: string; size?: number; radius?: number }) {
  return (
    <div style={{ width: size, height: size, aspectRatio: "1 / 1", borderRadius: radius, flexShrink: 0, overflow: "hidden", position: "relative" }}>
      <ImageWithFallback src={imageUrl} coverColor={bg} alt="" />
    </div>
  );
}

/** The four-track artwork slice a playlist cover is built from. */
export interface CoverTile {
  bg?: string;
  imageUrl?: string;
}

/**
 * The 2×2 grid half of a playlist cover: the first four track artworks,
 * laid out Spotify-style. Fills its parent — cells without artwork take the
 * playlist colour, so the grid never shows holes.
 */
export function CoverGrid({ bg, tracks }: { bg?: string; tracks: CoverTile[] }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", background: bg ?? "transparent" }}>
      {tracks.slice(0, 4).map((t, i) => (
        <div key={i} style={{ overflow: "hidden", background: t.bg ?? bg, position: "relative" }}>
          {t.imageUrl && (
            <img src={t.imageUrl} alt="" loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Playlist artwork: the playlist's own image when it has one, otherwise the
 * first four songs as a 2×2 grid, otherwise the plain gradient tile (per the
 * design spec — never a hole).
 */
export function PlaylistCover({ bg, imageUrl, tracks = [], size = 48, radius = 12 }: {
  bg: string; imageUrl?: string; tracks?: CoverTile[]; size?: number; radius?: number;
}) {
  if (imageUrl || tracks.length === 0) {
    return <CoverArt bg={bg} imageUrl={imageUrl} size={size} radius={radius} />;
  }
  return (
    <div style={{ width: size, height: size, aspectRatio: "1 / 1", borderRadius: radius, flexShrink: 0, overflow: "hidden", position: "relative" }}>
      <CoverGrid bg={bg} tracks={tracks} />
    </div>
  );
}
