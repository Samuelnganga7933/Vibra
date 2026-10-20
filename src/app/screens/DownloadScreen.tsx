import React from "react";
import { ArrowLeft, Download, Package, ShieldCheck, Smartphone } from "lucide-react";
import { useApp } from "../context";

/** CI's latest artifact — nightly.link streams the newest build of this repo's APK. */
const APK_URL =
  "https://nightly.link/Samuelnganga7933/Vibra/workflows/build-apk/main/vybra-debug-apk.zip";

const STEPS = [
  { Icon: Package,   text: "Open the downloaded .zip and tap the APK inside." },
  { Icon: Smartphone, text: "Pick Vybra as your installer if Android asks." },
  { Icon: ShieldCheck, text: "Allow installs from this source once — that's it." },
] as const;

/**
 * /download — public APK page for Android. Deliberately plain: one badge, one
 * headline, one download pill, the three install steps. Reachable signed out
 * (the auth gate lets this screen through) and from both layout branches, since
 * ScreenView renders it inside the shell.
 */
export function DownloadScreen() {
  const { C, navigate } = useApp();

  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto", padding: "40px 24px" }}>
      <div style={{ width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 20, display: "grid", placeItems: "center",
          background: C.accent, color: "#fff",
        }}>
          <Download size={26} strokeWidth={2.2} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: C.text, letterSpacing: -0.6, lineHeight: 1.15 }}>
            Vybra for Android
          </h1>
          <p style={{ margin: 0, fontSize: 14.5, color: C.muted, lineHeight: 1.6 }}>
            Your library, queues and lyrics in a native app. Install the APK
            directly — no Play Store needed.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <a
            href={APK_URL}
            rel="noopener"
            style={{
              display: "inline-flex", alignItems: "center", gap: 10, height: 52,
              padding: "0 30px", borderRadius: 999, background: C.accent, color: "#fff",
              fontWeight: 700, fontSize: 15.5, textDecoration: "none", transition: "filter .15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.filter = "brightness(1.1)")}
            onMouseLeave={e => (e.currentTarget.style.filter = "none")}
          >
            <Download size={18} />
            Download APK
          </a>
          <span style={{ fontSize: 12.5, color: C.dim }}>
            Nightly build · about 4 MB · Android 6.0 and up
          </span>
        </div>

        <div style={{
          background: C.surf, border: `1px solid ${C.border}`, borderRadius: 16,
          padding: "6px 16px", display: "flex", flexDirection: "column",
        }}>
          {STEPS.map(({ Icon, text }, i) => (
            <div key={text} style={{
              display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0",
              borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
            }}>
              <span style={{ color: C.accent, marginTop: 1 }}><Icon size={16} /></span>
              <span style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate({ id: "home" })}
          style={{
            alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 7,
            background: "none", border: "none", padding: 0, cursor: "pointer",
            color: C.muted, fontSize: 13.5, fontWeight: 600,
          }}
        >
          <ArrowLeft size={15} />
          Back to Vybra
        </button>
      </div>
    </div>
  );
}
