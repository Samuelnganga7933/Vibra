/**
 * mediaSession.ts — system media controls (notification + lock screen).
 *
 * Two backends behind one API:
 *   • native — our local VybraMedia plugin owns a MediaSessionCompat and a
 *     MediaStyle foreground-service notification. Extra powers vs the web
 *     API: a custom "Lyrics" action on the lock screen, and a foreground
 *     service that keeps the process alive while music plays in the
 *     background.
 *   • web — the Media Session API (works in desktop browsers AND in the
 *     Chromium WebView of APKs built before the plugin existed), which
 *     surfaces play/pause/next/prev + artwork through the same system UI.
 *
 * Every exported call is fire-and-forget and fully guarded: a missing
 * plugin, an old APK or an exotic WebView degrades to silence — never a
 * crash, never a blocked playback path.
 */

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNativeApp } from "./ota";

export interface MediaNowPlaying {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationSec: number;
  /** Mirrors the heart state onto the notification's Like action. */
  liked?: boolean;
}

export interface MediaState {
  playing: boolean;
  positionSec: number;
}

export interface MediaHandlers {
  onPlay(): void;
  onPause(): void;
  onNext(): void;
  onPrev(): void;
  /** Lock-screen seek — absolute seconds into the current track. */
  onSeek(positionSec: number): void;
  /** Custom lock-screen action: open the lyrics view. */
  onOpenLyrics(): void;
  /** Custom notification/lock-screen action: like the current track. */
  onLike(): void;
}

interface VybraMediaPluginType {
  updateNowPlaying(opts: MediaNowPlaying): Promise<void>;
  setPlaybackState(opts: MediaState & { durationSec: number }): Promise<void>;
  release(): Promise<void>;
  requestNotificationPermission(): Promise<void>;
  /** Capacitor's built-in runtime-permission check for the "notifications" alias. */
  checkPermissions(): Promise<{ notifications: string }>;
  addListener(name: string, fn: (ev?: { positionSec?: number }) => void): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<VybraMediaPluginType>("VybraMedia");

let nativeReady = false;
let nativeProbed = false;
let nativeHandles: PluginListenerHandle[] = [];
let released = false;

const swallow = () => { /* plugin absent or call raced a release — fine */ };

/** Web Media Session API handlers (desktop browsers + old APKs). */
function installWebHandlers(handlers: MediaHandlers): void {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const safe = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try { ms.setActionHandler(action, fn); } catch { /* action unsupported */ }
  };
  safe("play", () => handlers.onPlay());
  safe("pause", () => handlers.onPause());
  safe("stop", () => handlers.onPause());
  safe("previoustrack", () => handlers.onPrev());
  safe("nexttrack", () => handlers.onNext());
  safe("seekto", details => {
    if (typeof details.seekTime === "number") handlers.onSeek(details.seekTime);
  });
  try { ms.setActionHandler("seekbackward", () => handlers.onSeek(Math.max(0, lastPositionSec - 15))); } catch { /* optional */ }
  try { ms.setActionHandler("seekforward", () => handlers.onSeek(lastPositionSec + 15)); } catch { /* optional */ }
  // "like" is in the spec but missing from older TS MediaSessionAction types.
  try { ms.setActionHandler("like" as MediaSessionAction, () => handlers.onLike()); } catch { /* action unsupported here */ }
}

let lastPositionSec = 0;
let webHandlers: MediaHandlers | null = null;

/** Wire up whichever backend the current runtime offers. Idempotent. */
export function mediaInit(handlers: MediaHandlers): void {
  released = false;
  webHandlers = handlers;
  if (!isNativeApp()) {
    installWebHandlers(handlers);
    return;
  }
  if (nativeProbed) return;
  nativeProbed = true;
  Promise.all([
    Native.addListener("onPlay", () => handlers.onPlay()),
    Native.addListener("onPause", () => handlers.onPause()),
    Native.addListener("onNext", () => handlers.onNext()),
    Native.addListener("onPrev", () => handlers.onPrev()),
    Native.addListener("onOpenLyrics", () => handlers.onOpenLyrics()),
    Native.addListener("onLike", () => handlers.onLike()),
    Native.addListener("onSeek", ev => {
      const pos = ev?.positionSec;
      if (typeof pos === "number") handlers.onSeek(pos);
    }),
  ])
    .then(handles => {
      nativeHandles = handles;
      nativeReady = true;
    })
    .catch(() => {
      // Old APK without the plugin — the WebView Media Session still works.
      nativeReady = false;
      installWebHandlers(handlers);
    });
}

/** Publish (or clear, with null) the now-playing metadata + artwork. */
export function mediaSetNowPlaying(np: MediaNowPlaying | null): void {
  try {
    // Push to the native service even before the listeners finish attaching —
    // the foreground service must be alive on the FIRST play, or Android
    // freezes the WebView renderer once the app is backgrounded and audio
    // dies. The call is fire-and-forget: an old APK without the plugin
    // rejects and we swallow it.
    if (isNativeApp()) {
      if (np) void Native.updateNowPlaying(np).catch(swallow);
      else void Native.release().catch(swallow);
    }
    const ms = navigator.mediaSession;
    if (!ms) return;
    if (!np) {
      ms.metadata = null;
      ms.playbackState = "none";
      return;
    }
    const artwork: MediaImage[] = np.artworkUrl
      ? [{ src: np.artworkUrl, sizes: "512x512", type: "image/jpeg" }]
      : [];
    ms.metadata = new MediaMetadata({
      title: np.title,
      artist: np.artist,
      album: np.album ?? "",
      artwork,
    });
  } catch { /* media session unavailable — cosmetic loss only */ }
}

/** Push play/pause + position. durationSec feeds the lock-screen seek bar. */
export function mediaSetState(st: MediaState, durationSec: number): void {
  lastPositionSec = st.positionSec;
  try {
    // Same as mediaSetNowPlaying: reach the service unconditionally on native
    // so the foreground-service promotion happens on the first play tick.
    if (isNativeApp()) {
      void Native.setPlaybackState({ ...st, durationSec }).catch(swallow);
    }
    const ms = navigator.mediaSession;
    if (!ms) return;
    ms.playbackState = st.playing ? "playing" : "paused";
    if (durationSec > 0 && Number.isFinite(durationSec)) {
      const position = Math.max(0, Math.min(st.positionSec, durationSec));
      try {
        ms.setPositionState({
          duration: durationSec,
          position,
          playbackRate: st.playing ? 1 : 1,
        });
      } catch { /* position state rejected — seek bar only */ }
    }
  } catch { /* cosmetic */ }
}

/** Android 13+: ask for notification permission once, before first play. */
export function mediaRequestNotificationPermission(): void {
  if (!isNativeApp()) return;
  void Native.requestNotificationPermission().catch(swallow);
}

/** Current notification-permission state for the Settings row.
 *  Web and old APKs (no permission API) answer "unknown" — the row hides. */
export async function mediaNotificationPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  if (!isNativeApp()) return "unknown";
  try {
    const res = await Native.checkPermissions();
    const s = res?.notifications;
    if (s === "granted" || s === "denied" || s === "prompt") return s;
    return "unknown";
  } catch {
    return "unknown"; // plugin predates the permissions API
  }
}

/** Tear down: drop metadata, deactivate the session, remove listeners. */
export function mediaRelease(): void {
  if (released) return;
  released = true;
  try {
    if (nativeReady) void Native.release().catch(swallow);
    nativeHandles.forEach(h => { void h.remove().catch(swallow); });
    nativeHandles = [];
    nativeReady = false;
    nativeProbed = false;
    const ms = navigator.mediaSession;
    if (ms) { ms.metadata = null; ms.playbackState = "none"; }
  } catch { /* cosmetic */ }
}
