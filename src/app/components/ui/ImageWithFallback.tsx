import React, { useEffect, useState } from "react";
import { Music2 } from "lucide-react";

interface ImageWithFallbackProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string | null;
  /** Cover colour hex used for the gradient placeholder (e.g. `coverColor`). */
  coverColor?: string;
  alt?: string;
  /** Decorative vinyl highlight, matching the app's cover art treatment. */
  highlight?: boolean;
}

/**
 * Artwork that never shows a broken-image icon: missing or failed sources fall
 * back to a styled gradient derived from `coverColor` (or a dark glass panel).
 */
export function ImageWithFallback({
  src,
  coverColor,
  alt = "",
  className,
  style,
  highlight = false,
  ...rest
}: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    setCurrentSrc(src);
    setFailed(false);
  }, [src]);

  const showFallback = !currentSrc || failed;

  const baseStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    display: "block",
    objectFit: "cover",
    ...style,
  };

  if (showFallback) {
    const gradient = coverColor
      ? `linear-gradient(145deg, ${coverColor} 0%, rgba(0,0,0,0.55) 130%)`
      : `linear-gradient(145deg, ${style?.background ?? "#1F1B30"} 0%, rgba(0,0,0,0.6) 130%)`;
    return (
      <div
        role="img"
        aria-label={alt || "Artwork unavailable"}
        className={className}
        style={{
          ...baseStyle,
          background: gradient,
          display: "grid",
          placeItems: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Music2 size={28} color="rgba(255,255,255,0.4)" aria-hidden />
        {highlight && (
          <span
            style={{
              position: "absolute",
              width: "52%",
              height: "52%",
              borderRadius: "50%",
              right: "-10%",
              bottom: "-10%",
              background: "rgba(255,255,255,0.16)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    );
  }

  return (
    <img
      {...rest}
      src={currentSrc}
      alt={alt}
      className={className}
      style={baseStyle}
      onError={() => setFailed(true)}
    />
  );
}
