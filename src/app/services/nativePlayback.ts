import {
  mediaControlAudio,
  mediaGetAudioState,
  mediaOnAudioError,
  mediaOnAudioEnded,
  mediaOnAudioState,
  mediaStartAudio,
  type NativeAudioState,
  type NativeAudioStartOptions,
} from "./mediaSession";
import type { PlaybackFailure, PlaybackHandle } from "./playbackEngine";

interface NativePlaybackHandlers {
  onEnded: () => void;
  onFailure: (failure: PlaybackFailure) => void;
  onState?: (state: NativeAudioState) => void;
}

/** A PlaybackHandle proxy for the Android service-owned ExoPlayer instance. */
export class NativeAudioEngine implements PlaybackHandle {
  private positionSec = 0;
  private durationSec = 0;
  private fallbackDurationSec = 0;
  private volumeField = 1;
  private playing = false;
  private ended = false;
  private pendingStart: { resolve: () => void; reject: (error: unknown) => void; timer?: number } | null = null;
  private detachState: (() => void) | null = null;
  private detachError: (() => void) | null = null;
  private detachEnded: (() => void) | null = null;
  private onEnded: () => void;
  private onFailure: NativePlaybackHandlers["onFailure"];
  private onState?: NativePlaybackHandlers["onState"];
  private detached = false;

  private constructor(handlers: NativePlaybackHandlers) {
    this.onEnded = handlers.onEnded;
    this.onFailure = handlers.onFailure;
    this.onState = handlers.onState;
  }

  static async create(handlers: NativePlaybackHandlers): Promise<NativeAudioEngine> {
    const engine = new NativeAudioEngine(handlers);
    engine.detachState = mediaOnAudioState(state => engine.acceptState(state));
    engine.detachError = mediaOnAudioError(message => engine.acceptError(message));
    engine.detachEnded = mediaOnAudioEnded(() => engine.acceptEnded());
    try {
      const state = await mediaGetAudioState();
      engine.acceptState(state);
    } catch {
      // The service may not exist until startAudio starts it.
    }
    return engine;
  }

  get currentTime(): number { return this.positionSec; }
  set currentTime(seconds: number) {
    const next = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    this.positionSec = next;
    void mediaControlAudio("seek", { positionSec: next }).catch(() => {});
  }

  get duration(): number { return this.durationSec || this.fallbackDurationSec; }

  get volume(): number { return this.volumeField; }
  set volume(value: number) {
    this.volumeField = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
    void mediaControlAudio("volume", { volume: this.volumeField }).catch(() => {});
  }

  async load(options: Omit<NativeAudioStartOptions, "volume"> & { volume?: number }, timeoutMs = 10_000): Promise<void> {
    this.ended = false;
    this.playing = false;
    this.positionSec = Math.max(0, options.positionSec || 0);
    this.fallbackDurationSec = Math.max(0, options.durationSec || 0);
    this.volumeField = Math.max(0, Math.min(1, options.volume ?? this.volumeField));
    this.durationSec = 0;
    this.clearPendingStart(Object.assign(new Error("Playback start superseded"), { __kind: "blocked" as const }));

    const started = new Promise<void>((resolve, reject) => {
      // Startup is intentionally unbounded here. ExoPlayer can be waiting on
      // a slow resolver or a cold foreground service; that is not a dead track
      // and must never be converted into a queue skip/error. Real failures
      // still reject through onPlayerError/onAudioError, and a new user action
      // supersedes this pending start through clearPendingStart().
      void timeoutMs;
      this.pendingStart = { resolve, reject };
    });
    void started.catch(() => {});

    try {
      await mediaStartAudio({ ...options, volume: this.volumeField });
      // A short delay lets the Android service process a new media item before
      // consulting the service snapshot; do not mistake the previous track's
      // state for the new source becoming ready.
      window.setTimeout(() => {
        if (!this.pendingStart || this.detached) return;
        void mediaGetAudioState().then(state => this.acceptState(state)).catch(() => {});
      }, 150);
      await started;
    } catch (error) {
      this.clearPendingStart(error);
      throw error;
    }
  }

  async play(): Promise<void> {
    await mediaControlAudio("play");
  }

  async refreshState(): Promise<void> {
    try { this.acceptState(await mediaGetAudioState()); } catch { /* service may be stopping */ }
  }

  pause(): void {
    this.playing = false;
    void mediaControlAudio("pause").catch(() => {});
  }

  /** Remove JS listeners without stopping the foreground service. */
  detach(): void {
    this.detached = true;
    this.clearPendingStart(Object.assign(new Error("Playback handle detached"), { __kind: "blocked" as const }));
    this.detachState?.();
    this.detachError?.();
    this.detachEnded?.();
    this.detachState = null;
    this.detachError = null;
    this.detachEnded = null;
  }

  /** Stop native audio and release this handle. */
  dispose(): void {
    this.detach();
    void mediaControlAudio("stop").catch(() => {});
  }

  private acceptState(state: NativeAudioState): void {
    if (this.detached) return;
    const wasPlaying = this.playing;
    this.playing = state.playing;
    this.positionSec = Math.max(0, state.positionSec || 0);
    this.durationSec = Math.max(0, state.durationSec || 0);
    this.onState?.(state);
    if (state.playing) {
      const pending = this.pendingStart;
      if (pending) {
        if (pending.timer !== undefined) window.clearTimeout(pending.timer);
        this.pendingStart = null;
        pending.resolve();
      }
    } else if (wasPlaying && !this.ended && this.durationSec > 0 && this.positionSec >= this.durationSec - 0.35) {
      this.acceptEnded();
    }
  }

  private acceptEnded(): void {
    if (this.detached || this.ended) return;
    this.ended = true;
    this.playing = false;
    this.onEnded();
  }

  private acceptError(message: string): void {
    if (this.detached) return;
    const failure: PlaybackFailure = { kind: "track", message: message || "This track can't play right now." };
    const pending = this.pendingStart;
    if (pending) {
      if (pending.timer !== undefined) window.clearTimeout(pending.timer);
      this.pendingStart = null;
      pending.reject(Object.assign(new Error(failure.message), { __kind: "track" as const }));
      return;
    }
    this.onFailure(failure);
  }

  private clearPendingStart(error?: unknown): void {
    if (!this.pendingStart) return;
    const pending = this.pendingStart;
    this.pendingStart = null;
    if (pending.timer !== undefined) window.clearTimeout(pending.timer);
    if (error !== undefined) pending.reject(error);
  }
}
