import React from "react";
import { UiThemeContext, type UiColors } from "./ui-theme";

interface EmptyStateCardProps {
  /** Dark-mode animated micro-GIF or SVG loop shown inside the frame. */
  visual: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  colors?: UiColors;
  /** Renders at full width when true (page-level states). */
  block?: boolean;
}

/**
 * Glassmorphic empty/error frame with an embedded animated visual — the single
 * treatment for "nothing here yet" moments across search, downloads and 404.
 */
export function EmptyStateCard({
  visual,
  title,
  subtitle,
  action,
  colors,
  block = true,
}: EmptyStateCardProps) {
  const theme = React.useContext(UiThemeContext);
  const C = colors ?? theme;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 14,
        padding: "44px 28px",
        width: block ? "100%" : undefined,
        borderRadius: 24,
        border: `1px solid ${C.border}`,
        background:
          "linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.015) 100%)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        boxShadow: "0 16px 48px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: 148,
          height: 148,
          borderRadius: 20,
          overflow: "hidden",
          background: C.bg,
          border: `1px solid ${C.border}`,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <img
          src={visual}
          alt=""
          width={148}
          height={148}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>

      <div style={{ fontWeight: 700, fontSize: 19, color: C.text, letterSpacing: -0.2 }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6, maxWidth: 320 }}>
          {subtitle}
        </div>
      )}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
