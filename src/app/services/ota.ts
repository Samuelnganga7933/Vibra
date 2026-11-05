import { Capacitor } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";

/**
 * Self-hosted live updates via @capawesome/capacitor-live-update.
 *
 * CI rebuilds the web app on every push to main and uploads `vybra-bundle.zip`
 * (a zip of `dist/`) to the rolling `nightly` GitHub release, then edits the
 * release notes to carry the bundle id (`Bundle: nightly-<sha7>`). The app
 * reads the release through api.github.com — which is CORS-open, unlike the
 * release asset host — downloads the zip when the bundleId differs from the
 * running one, stages it with setNextBundle(), and reloads into it. No
 * Capawesome Cloud account: the nightly release is the update server.
 */

const RELEASE_API = "https://api.github.com/repos/Samuelnganga7933/Vibra/releases/tags/nightly";
const BUNDLE_ASSET_NAME = "vybra-bundle.zip";
const CHECK_TIMEOUT_MS = 10_000;
const MANIFEST_RETRIES = 2;

interface NightlyRelease {
  body?: string | null;
  assets?: { name: string; browser_download_url?: string }[] | null;
}

interface OtaManifest {
  bundleId: string;
  url: string;
}

export type OtaCheckResult = "skipped" | "up-to-date" | "update-installed" | "error";

/** True inside the Capacitor Android/iOS shell — the only place OTA applies. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** Pulls the nightly release and decodes the bundle id + zip URL from it. */
async function fetchNightlyManifest(): Promise<OtaManifest | null> {
  for (let attempt = 0; attempt <= MANIFEST_RETRIES; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
    try {
      // api.github.com sends Access-Control-Allow-Origin: * — the release asset
      // host does not, so the WebView can only reach the metadata this way.
      // A cache-busting query avoids seeing the old release body while CI is
      // replacing the rolling nightly asset.
      const url = `${RELEASE_API}?v=${Date.now()}`;
      const res = await fetch(url, {
        signal: ctrl.signal,
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" },
      });
      if (res.ok) {
        const data = (await res.json()) as NightlyRelease;
        const bundleId = /^Bundle:\s*(\S+)/m.exec(data.body ?? "")?.[1];
        const assetUrl = data.assets?.find(a => a.name === BUNDLE_ASSET_NAME)?.browser_download_url;
        if (bundleId && assetUrl) return { bundleId, url: assetUrl };
      }
    } catch {
      // Retry once for a short-lived network, rate-limit, or release-update gap.
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MANIFEST_RETRIES) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return null;
}

/**
 * Confirms the running bundle is healthy — call first on every app start.
 * With `readyTimeout` configured, a bundle that never calls ready() is rolled
 * back to the default bundle (the app as installed) on the next launch.
 */
export async function markBundleReady(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await LiveUpdate.ready();
  } catch {
    /* Never block startup on the plugin — the app must open regardless. */
  }
}

/**
 * Silent background check: compares the running bundle with the nightly
 * release and, when newer, downloads + stages it for the next reload.
 * Never throws — callers branch on the returned status.
 */
export async function checkForOtaUpdates(): Promise<OtaCheckResult> {
  if (!isNativeApp()) return "skipped";
  try {
    // The plugin docs require ready() before inspecting or changing bundles.
    await LiveUpdate.ready();
    const current = await LiveUpdate.getCurrentBundle();
    const manifest = await fetchNightlyManifest();
    if (!manifest) return "error";
    // bundleId null = the app exactly as installed from the APK.
    if (current?.bundleId === manifest.bundleId) return "up-to-date";
    await LiveUpdate.downloadBundle({ url: manifest.url, bundleId: manifest.bundleId });
    await LiveUpdate.setNextBundle({ bundleId: manifest.bundleId });
    return "update-installed";
  } catch {
    return "error";
  }
}

/**
 * Reloads the WebView into the staged bundle. localStorage (session tokens,
 * profile, offline cache) survives — the user stays signed in.
 */
export async function reloadIntoLatestBundle(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await LiveUpdate.reload();
  } catch {
    window.location.reload();
  }
}
