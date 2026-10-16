import React from "react";
import { RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";

export interface BoundaryColors {
  bg: string;
  pane: string;
  surf: string;
  accent: string;
  text: string;
  muted: string;
  border: string;
}

const DEFAULT_COLORS: BoundaryColors = {
  bg: "#0B0A12",
  pane: "#14121F",
  surf: "#1F1B30",
  accent: "#E8354D",
  text: "#F2F0FA",
  muted: "#A9A6BD",
  border: "#26223A",
};

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Theme colours so the fallback matches the surrounding chrome. */
  colors?: BoundaryColors;
  /** Short copy shown above the recovery actions. */
  title?: string;
  /** Compact treatment for embedded panels (sidebar, right panel, main view). */
  compact?: boolean;
  /** Called after the boundary resets, e.g. to clear broken state. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Keeps a render error contained to one frame of the layout so the app never
 * white-screens: the navigation sidebar, player bar and remaining panels stay
 * usable while the failed view offers a recovery action.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.warn(
      `[vibra:view] recovered from render error: ${error.message}`,
      info.componentStack ?? "",
    );
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  private reload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const C = this.props.colors ?? DEFAULT_COLORS;
    const { compact = false, title = "This view lost its signal" } = this.props;

    return (
      <div
        role="alert"
        style={{
          height: "100%",
          minHeight: compact ? 0 : 240,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: compact ? 24 : "48px 28px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            padding: compact ? "24px 22px" : "36px 32px",
            borderRadius: 22,
            border: `1px solid ${C.border}`,
            background: `linear-gradient(160deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%), ${C.pane}`,
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: compact ? 44 : 56,
              height: compact ? 44 : 56,
              borderRadius: "50%",
              background: C.surf,
              border: `1px solid ${C.border}`,
              display: "grid",
              placeItems: "center",
              color: C.accent,
            }}
          >
            <TriangleAlert size={compact ? 20 : 24} />
          </div>

          <div style={{ fontWeight: 700, fontSize: compact ? 16 : 19, color: C.text }}>{title}</div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, maxWidth: 300 }}>
            The rest of Vibra is still running. Restore this panel, or reload
            the app if the signal doesn't come back.
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              type="button"
              onClick={this.reset}
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
              <RotateCcw size={15} />
              Restore Frequency
            </button>
            <button
              type="button"
              onClick={this.reload}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                height: 42,
                padding: "0 20px",
                borderRadius: 21,
                border: `1px solid ${C.border}`,
                background: "transparent",
                color: C.text,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <RefreshCw size={15} />
              Reload Component
            </button>
          </div>

          {error.message && (
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                color: C.muted,
                opacity: 0.75,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={error.message}
            >
              {error.message}
            </div>
          )}
        </div>
      </div>
    );
  }
}

/**
 * Last-resort guards: uncaught exceptions and unhandled promise rejections are
 * logged as clean warnings instead of surfacing as unhandled runtime noise.
 * Rendering is already protected by <ErrorBoundary>.
 */
export function installRuntimeGuards(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __vibraGuards?: boolean };
  if (w.__vibraGuards) return;
  w.__vibraGuards = true;

  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason as { message?: string } | string | undefined;
    const message =
      typeof reason === "string" ? reason : reason?.message ?? "unknown promise rejection";
    console.warn(`[vibra:async] unhandled rejection neutralised — ${message}`);
    event.preventDefault();
  });

  window.addEventListener("error", event => {
    if (event.error) console.warn(`[vibra:runtime] ${event.message}`);
  });
}
