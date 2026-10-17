import React from "react";
import { AlertCircle, Copy, Home as HomeIcon, RefreshCw, WifiOff, Music2 } from "lucide-react";
import { toast } from "sonner";
import { useApp, type AppError } from "../context";

const VARIANTS = {
  error:    { Icon: AlertCircle, title: "Something went wrong" },
  offline:  { Icon: WifiOff,     title: "You're offline" },
  notfound: { Icon: Music2,      title: "We couldn't find that page" },
} as const;

/**
 * Failure surface rendered inside the main area — the shell, sidebar and player
 * bar stay intact. One copy line, a request id for support, real actions only.
 */
export function ErrorScreen({ error }: { error: AppError }) {
  const { C, navigate, clearError } = useApp();
  const { Icon, title } = VARIANTS[error.variant] ?? VARIANTS.error;

  const retry = () => {
    if (error.retry) { error.retry(); return; }
    clearError();
    navigate({ id: "home" });
  };

  const copyDetails = async () => {
    const text = `[${error.code}] ${error.message} — request ${error.requestId} (${new Date(error.at).toISOString()})`;
    try {
      await navigator.clipboard.writeText(text);
      toast("Details copied — paste them when you report the problem.");
    } catch {
      toast.error("Couldn't copy the details.");
    }
  };

  const primary = error.variant === "notfound" ? "Back to Home" : "Try again";

  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ maxWidth: 420, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{
          width: 68, height: 68, borderRadius: "50%", background: C.surf,
          border: `1px solid ${C.border}`, display: "grid", placeItems: "center",
        }}>
          <Icon size={26} color={error.variant === "offline" ? C.muted : C.accent} strokeWidth={2} />
        </div>

        <div style={{ fontWeight: 800, fontSize: 22, color: C.text, letterSpacing: -0.3 }}>{title}</div>
        <div style={{ fontSize: 14.5, color: C.muted, lineHeight: 1.6 }}>{error.message}</div>

        <div style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11.5, color: C.dim, background: C.surf, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: "6px 10px",
        }}>
          {error.code} · {error.requestId}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={retry} style={{
            display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 20px",
            borderRadius: 999, border: "none", background: C.accent, color: "#fff",
            fontWeight: 700, fontSize: 14, cursor: "pointer",
          }}>
            {error.variant === "notfound" ? <HomeIcon size={15} /> : <RefreshCw size={15} />}
            {primary}
          </button>
          <button onClick={copyDetails} style={{
            display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 18px",
            borderRadius: 999, border: `1px solid ${C.border}`, background: "transparent",
            color: C.text, fontWeight: 600, fontSize: 13.5, cursor: "pointer",
          }}>
            <Copy size={14} />
            Copy details
          </button>
        </div>
      </div>
    </div>
  );
}
