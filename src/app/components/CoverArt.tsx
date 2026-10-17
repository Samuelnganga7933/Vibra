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
