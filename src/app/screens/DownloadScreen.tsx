import React, { useEffect, useState } from "react";
import { ArrowLeft, Download, Smartphone, RefreshCw } from "lucide-react";
import { useApp } from "../context";

/** Fallback when the GitHub API is unreachable or rate-limited. */
const APK_URL =
  "https://github.com/Samuelnganga7933/Vibra/releases/download/nightly/vybra-latest.apk";
const RELEASE_URL = "https://api.github.com/repos/Samuelnganga7933/Vibra/releases/tags/nightly";

interface NightlyAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface NightlyRelease {
  tag_name?: string;
  published_at?: string;
  assets?: NightlyAsset[];
}

const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;
const shortDate = (iso?: string): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/**
 * /download — the GetApp page from the design boards: hero, one platform
 * card (Android .apk only — no Play Store, no ZIP). Reachable signed out
 * (the auth gate lets this screen through) and from both layout branches.
 * Version/size/date come from the nightly release tag; the static asset URL
 * is the fallback so the button always works.
 */
export function DownloadScreen() {
  const { C, navigate } = useApp();
  const [release, setRelease] = useState<NightlyRelease | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(RELEASE_URL, { headers: { Accept: "application/vnd.github+json" } })
      .then(r => (r.ok ? r.json() : null))
      .then((d: NightlyRelease | null) => { if (alive && d) setRelease(d); })
      .catch(() => { /* rate-limited or offline — the static link still works */ });
    return () => { alive = false; };
  }, []);

  const apk = release?.assets?.find(a => a.name.toLowerCase().endsWith(".apk"));
  const apkUrl = apk?.browser_download_url || APK_URL;
  const sizeLabel = apk?.size ? mb(apk.size) : "≈ 4 MB";
  const updated = shortDate(release?.published_at);

  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto", padding: "48px 24px" }}>
      <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 26 }}>
        {/* Hero */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.22em", color: C.accent }}>
            GET THE APP
          </div>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 800, color: C.text, letterSpacing: -1.1, lineHeight: 1.08 }}>
            Vibra on every screen.
          </h1>
          <p style={{ margin: 0, fontSize: 15, color: C.muted, lineHeight: 1.6, maxWidth: 460 }}>
            Your library, queues and lyrics in a native app. Install the APK
            directly from GitHub — no Play Store needed.
          </p>
        </div>

        {/* Platform card — Android only */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16, padding: 20,
          borderRadius: 16, background: C.surf, border: `1px solid ${C.border}`,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, flexShrink: 0,
            display: "grid", placeItems: "center",
            background: `color-mix(in srgb, ${C.accent} 16%, transparent)`, color: C.accent,
          }}>
            <Smartphone size={26} strokeWidth={2} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text, letterSpacing: -0.2 }}>
              Android
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              APK · {sizeLabel} · Android 6.0 and up
            </div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 3, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={12} />
              {updated ? `Nightly build · updated ${updated}` : "Nightly build"}
            </div>
          </div>

          <a
            href={apkUrl}
            rel="noopener"
            style={{
              display: "inline-flex", alignItems: "center", gap: 9, height: 46,
              padding: "0 24px", borderRadius: 999, background: C.accent, color: "#fff",
              fontWeight: 700, fontSize: 14.5, textDecoration: "none", flexShrink: 0,
              transition: "filter .15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.filter = "brightness(1.1)")}
            onMouseLeave={e => (e.currentTarget.style.filter = "none")}
          >
            <Download size={17} />
            Download
          </a>
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
          Back to Vibra
        </button>
      </div>
    </div>
  );
}
