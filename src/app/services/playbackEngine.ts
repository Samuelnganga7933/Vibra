/**
 * playbackEngine — the audio playback layer behind the player bar.
 *
 * Strategy, in order:
 *   1. Direct stream URL through the Vibra audio engine (<audio> element).
 *   2. On any stream failure (5xx, empty body, network), fall back to a hidden
 *      YouTube IFrame player using the official IFrame API — audio still plays.
 *
 * Both engines expose the same `PlaybackHandle` shape (currentTime, duration,
 * volume, play, pause) so the rest of the player UI never cares which one is
 * live. Every failure resolves to a calm, human message — never a throw that
 * reaches the UI unhandled.
 */

// ─── Shared engine contract ───────────────────────────────────────────────────

export interface PlaybackHandle {
  currentTime: number;
  readonly duration: number;
  volume: number;
  play(): Promise<void>;
  pause(): void;
}

export type PlaybackFailure =
  | { kind: "blocked" } // gesture/autoplay policy — one more tap fixes it
  | { kind: "network" } // script/API unreachable — offline
  | { kind: "track"; message: string }; // specific track problem

// ─── YouTube IFrame API loader ────────────────────────────────────────────────

interface YTPlayerLike {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(v: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

type YTStatic = {
  Player: new (
    el: HTMLElement,
    opts: Record<string, unknown>,
  ) => YTPlayerLike;
};

declare global {
  interface Window {
    YT?: YTStatic;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_STATE_ENDED = 0;
const YT_STATE_PLAYING = 1;

let ytApiPromise: Promise<YTStatic> | null = null;

function loadYtApi(): Promise<YTStatic> {
  if (typeof window === "undefined") {
    return Promise.reject(Object.assign(new Error("no window"), { __kind: "network" as const }));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<YTStatic>((resolve, reject) => {
    const done = () => {
      if (window.YT?.Player) resolve(window.YT);
      else reject(Object.assign(new Error("YouTube player unavailable"), { __kind: "network" as const }));
    };
    const fail = () =>
      reject(Object.assign(new Error("YouTube player failed to load"), { __kind: "network" as const }));

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      done();
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.addEventListener("error", fail);
    document.head.appendChild(script);

    window.setTimeout(done, 10_000);
  });

  return ytApiPromise;
}

function ytMessageFor(code: number): string {
  if (code === 101 || code === 150) return "This track doesn't allow embedded playback.";
  if (code === 100) return "This track is unavailable — it may be private or removed.";
  if (code === 2 || code === 5) return "That track reference is invalid. Try another result.";
  return "The audio source dropped out — try the next track.";
}

export function failureFromError(err: unknown): PlaybackFailure {
  const kind = (err as { __kind?: string } | null)?.__kind;
  if (kind === "network") return { kind: "network" };
  if (kind === "blocked") return { kind: "blocked" };
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotAllowedError") return { kind: "blocked" };
  if (name === "AbortError") return { kind: "track", message: "Playback was interrupted — try again." };
  if (name === "NotSupportedError") {
    return { kind: "track", message: "That audio source can't be played — try the next track." };
  }
  const message = err instanceof Error ? err.message : "";
  return { kind: "track", message: message || "This track can't play right now." };
}

interface PendingWait {
  resolve: () => void;
  reject: (failure: PlaybackFailure) => void;
  timer: number;
}

/**
 * Hidden YouTube audio engine. The iframe lives off-screen (never `display:
 * none`, which browsers treat as paused) and is reused across tracks.
 */
export class YTAudioEngine implements PlaybackHandle {
  private player: YTPlayerLike | null = null;
  private container: HTMLDivElement | null = null;
  private pending: PendingWait | null = null;
  private volumeField = 1;
  private currentVideoId = "";
  private onEnded: () => void;
  private onFailure: (failure: PlaybackFailure) => void;

  private constructor(handlers: { onEnded: () => void; onFailure: (f: PlaybackFailure) => void }) {
    this.onEnded = handlers.onEnded;
    this.onFailure = handlers.onFailure;
  }

  static async create(handlers: {
    onEnded: () => void;
    onFailure: (f: PlaybackFailure) => void;
  }): Promise<YTAudioEngine> {
    const YT = await loadYtApi();
    const engine = new YTAudioEngine(handlers);

    const container = document.createElement("div");
    container.id = `vibra-audio-${Math.random().toString(36).slice(2, 9)}`;
    container.style.cssText =
      "position:fixed;left:-10000px;top:0;width:320px;height:180px;opacity:0;pointer-events:none;";
    document.body.appendChild(container);
    engine.container = container;

    let player: YTPlayerLike | null = null;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject({ kind: "blocked" } as PlaybackFailure);
      }, 10_000);

      player = new YT.Player(container, {
        width: "320",
        height: "180",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          },
          onError: (event: { data?: number }) => {
            const failure: PlaybackFailure = {
              kind: "track",
              message: ytMessageFor(event?.data ?? -1),
            };
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(failure);
              return;
            }
            engine.settlePending(failure);
            engine.onFailure(failure);
          },
          onStateChange: (event: { data?: number }) => engine.handleState(event?.data ?? -1),
        },
      });
    });

    engine.player = player;
    return engine;
  }

  private handleState(state: number): void {
    if (state === YT_STATE_PLAYING) {
      this.settlePending(null);
      return;
    }
    if (state === YT_STATE_ENDED) {
      this.settlePending(null);
      this.onEnded();
    }
  }

  /** Resolves the in-flight wait with a failure, or resolves it when `null`. */
  private settlePending(failure: PlaybackFailure | null): void {
    const wait = this.pending;
    if (!wait) return;
    this.pending = null;
    clearTimeout(wait.timer);
    if (failure) wait.reject(failure);
    else wait.resolve();
  }

  private waitForPlayback(timeoutMs: number, failure: PlaybackFailure): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.settlePending({ kind: "blocked" }); // supersede any prior wait
      this.pending = {
        resolve,
        reject,
        timer: window.setTimeout(() => {
          this.pending = null;
          reject(failure);
        }, timeoutMs),
      };
    });
  }

  /** Loads a video and resolves once audio is actually playing. */
  async load(videoId: string, volume: number): Promise<void> {
    if (!this.player) throw { kind: "blocked" } as PlaybackFailure;
    this.volumeField = volume;
    this.player.setVolume(Math.round(volume * 100));

    const alreadyCurrent =
      this.currentVideoId === videoId && this.player.getPlayerState?.() === YT_STATE_PLAYING;
    this.currentVideoId = videoId;
    if (alreadyCurrent) return;

    const wait = this.waitForPlayback(
      15_000,
      { kind: "track", message: "The audio source isn't responding. Try the next track." },
    );
    this.player.loadVideoById(videoId);
    await wait;
  }

  // ── PlaybackHandle ──────────────────────────────────────────────────────────

  get currentTime(): number {
    try {
      return this.player?.getCurrentTime() ?? 0;
    } catch {
      return 0;
    }
  }

  set currentTime(seconds: number) {
    try {
      this.player?.seekTo(seconds, true);
    } catch {
      /* seeking is best-effort */
    }
  }

  get duration(): number {
    try {
      return this.player?.getDuration() ?? 0;
    } catch {
      return 0;
    }
  }

  get volume(): number {
    return this.volumeField;
  }

  set volume(value: number) {
    this.volumeField = value;
    try {
      this.player?.setVolume(Math.round(Math.max(0, Math.min(1, value)) * 100));
    } catch {
      /* volume is best-effort */
    }
  }

  play(): Promise<void> {
    if (!this.player) return Promise.reject({ kind: "blocked" } as PlaybackFailure);
    if (this.player.getPlayerState?.() === YT_STATE_PLAYING) return Promise.resolve();
    const wait = this.waitForPlayback(6_000, { kind: "blocked" });
    this.player.playVideo();
    return wait;
  }

  pause(): void {
    this.settlePending({ kind: "blocked" });
    try {
      this.player?.pauseVideo();
    } catch {
      /* pause is best-effort */
    }
  }

  destroy(): void {
    this.settlePending({ kind: "blocked" });
    try {
      this.player?.destroy?.();
    } catch {
      /* ignore */
    }
    this.player = null;
    this.container?.remove();
    this.container = null;
  }
}

/** Human copy for a playback failure, shown as a toast. */
export function describePlaybackFailure(failure: PlaybackFailure): string {
  switch (failure.kind) {
    case "blocked":
      return "Press play once more to start the audio.";
    case "network":
      return "You're offline — reconnect to play music.";
    case "track":
      return failure.message;
  }
}
