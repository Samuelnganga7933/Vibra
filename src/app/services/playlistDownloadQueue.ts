import { hasDownload, saveDownload, type DownloadableTrack, type SaveOutcome } from "./localAudio";

const STORAGE_KEY = "vibra_playlist_download_queue_v1";

export interface PlaylistIdentity {
  id: string;
  title: string;
}

/** Only the metadata needed to resume a playlist download batch is persisted. */
export type PlaylistDownloadTrack = Pick<
  DownloadableTrack,
  "id" | "videoId" | "title" | "artist" | "duration" | "bg" | "imageUrl"
>;

export type PlaylistDownloadStatus = "running" | "paused" | "cancelling" | "cancelled" | "completed";
export type PlaylistTrackProgressStatus = "pending" | "downloading" | "completed" | "failed";

export interface PlaylistDownloadJob {
  playlist: PlaylistIdentity;
  tracks: PlaylistDownloadTrack[];
  /** Index of the next track to process (or tracks.length when finished). */
  currentIndex: number;
  completedIds: string[];
  failedIds: string[];
  status: PlaylistDownloadStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  lastTrackAt: string | null;
  finishedAt: string | null;
}

export interface PlaylistTrackProgress {
  id: string;
  index: number;
  status: PlaylistTrackProgressStatus;
  /** Null until the underlying downloader reports a fraction. */
  fraction: number | null;
}

export interface PlaylistDownloadProgress {
  job: PlaylistDownloadJob;
  total: number;
  completed: number;
  failed: number;
  processed: number;
  /** Current track's index, or null while idle/between tracks. */
  activeIndex: number | null;
  activeTrackId: string | null;
  /** Current track fraction, or null if not currently reported. */
  activeFraction: number | null;
  tracks: PlaylistTrackProgress[];
}

export type PlaylistDownloadProgressCallback = (progress: PlaylistDownloadProgress) => void;

export interface StartPlaylistDownloadInput {
  playlist: PlaylistIdentity;
  tracks: readonly PlaylistDownloadTrack[];
}

let currentJob: PlaylistDownloadJob | null = null;
let activeRun: Promise<PlaylistDownloadJob> | null = null;
let cancelRequested = false;
let activeIndex: number | null = null;
let activeFraction: number | null = null;
let callback: PlaylistDownloadProgressCallback | undefined;
const progressListeners = new Set<PlaylistDownloadProgressCallback>();

function now(): string {
  return new Date().toISOString();
}

function copyJob(job: PlaylistDownloadJob): PlaylistDownloadJob {
  return {
    ...job,
    playlist: { ...job.playlist },
    tracks: job.tracks.map(track => ({ ...track })),
    completedIds: [...job.completedIds],
    failedIds: [...job.failedIds],
  };
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function compactTrack(value: unknown): PlaylistDownloadTrack | null {
  if (!value || typeof value !== "object") return null;
  const track = value as Record<string, unknown>;
  if ((typeof track.id !== "string" && typeof track.id !== "number") ||
      typeof track.title !== "string" || typeof track.artist !== "string") return null;

  return {
    id: track.id,
    ...(typeof track.videoId === "string" ? { videoId: track.videoId } : {}),
    title: track.title,
    artist: track.artist,
    ...(typeof track.duration === "string" ? { duration: track.duration } : {}),
    ...(typeof track.bg === "string" ? { bg: track.bg } : {}),
    ...(typeof track.imageUrl === "string" ? { imageUrl: track.imageUrl } : {}),
  };
}

function parseJob(value: unknown): PlaylistDownloadJob | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const playlist = raw.playlist as Record<string, unknown> | null;
  const tracks = Array.isArray(raw.tracks) ? raw.tracks.map(compactTrack) : null;
  const validStatuses: PlaylistDownloadStatus[] = ["running", "paused", "cancelling", "cancelled", "completed"];
  if (!playlist || typeof playlist.id !== "string" || typeof playlist.title !== "string" ||
      !tracks || tracks.some(track => !track) ||
      !Number.isInteger(raw.currentIndex) || typeof raw.currentIndex !== "number" ||
      !Array.isArray(raw.completedIds) || !raw.completedIds.every(id => typeof id === "string") ||
      !Array.isArray(raw.failedIds) || !raw.failedIds.every(id => typeof id === "string") ||
      !validStatuses.includes(raw.status as PlaylistDownloadStatus)) return null;

  const validDate = (date: unknown): string | null => typeof date === "string" ? date : null;
  return {
    playlist: { id: playlist.id, title: playlist.title },
    tracks: tracks as PlaylistDownloadTrack[],
    currentIndex: Math.max(0, Math.min(raw.currentIndex, tracks.length)),
    completedIds: [...new Set(raw.completedIds as string[])],
    failedIds: [...new Set(raw.failedIds as string[])],
    // A persisted worker cannot still be running after a page/app restart.
    status: raw.status === "running" || raw.status === "cancelling" ? "paused" : raw.status as PlaylistDownloadStatus,
    createdAt: validDate(raw.createdAt) ?? now(),
    updatedAt: validDate(raw.updatedAt) ?? now(),
    startedAt: validDate(raw.startedAt),
    lastTrackAt: validDate(raw.lastTrackAt),
    finishedAt: validDate(raw.finishedAt),
  };
}

function loadStoredJob(): PlaylistDownloadJob | null {
  try {
    const raw = safeStorage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseJob(JSON.parse(raw) as unknown);
    if (!parsed) return null;
    // Normalize stale active state immediately so a restarted app can resume it.
    if (parsed.status !== "completed" && parsed.status !== "cancelled" &&
        JSON.parse(raw).status !== parsed.status) persistJob(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function persistJob(job: PlaylistDownloadJob): void {
  currentJob = job;
  try {
    safeStorage()?.setItem(STORAGE_KEY, JSON.stringify(job));
  } catch {
    // Storage may be disabled or full; the in-memory job still remains usable.
  }
}

function emitProgress(): void {
  if (!currentJob) return;
  const completed = new Set(currentJob.completedIds);
  const failed = new Set(currentJob.failedIds);
  const tracks = currentJob.tracks.map((track, index): PlaylistTrackProgress => {
    const id = String(track.id);
    let status: PlaylistTrackProgressStatus = "pending";
    let fraction: number | null = null;
    if (completed.has(id)) status = "completed";
    else if (failed.has(id)) status = "failed";
    else if (index === activeIndex) {
      status = "downloading";
      fraction = activeFraction;
    }
    return { id, index, status, fraction };
  });
  const processed = currentJob.completedIds.length + currentJob.failedIds.length;
  const progress: PlaylistDownloadProgress = {
    job: copyJob(currentJob),
    total: currentJob.tracks.length,
    completed: currentJob.completedIds.length,
    failed: currentJob.failedIds.length,
    processed,
    activeIndex,
    activeTrackId: activeIndex === null ? null : String(currentJob.tracks[activeIndex]?.id ?? ""),
    activeFraction,
    tracks,
  };
  const notify = (listener: PlaylistDownloadProgressCallback) => {
    try { listener(progress); } catch { /* A view callback must not disrupt the batch. */ }
  };
  if (callback) notify(callback);
  for (const listener of progressListeners) notify(listener);
}

/** Subscribe to the persisted batch and its live per-track progress. */
export function subscribePlaylistDownloadProgress(
  listener: PlaylistDownloadProgressCallback,
): () => void {
  progressListeners.add(listener);
  emitProgress();
  return () => { progressListeners.delete(listener); };
}

function ensureIdle(): void {
  if (activeRun) throw new Error("A playlist download batch is already active.");
}

function uniqueTracks(tracks: readonly PlaylistDownloadTrack[]): PlaylistDownloadTrack[] {
  const seen = new Set<string>();
  const result: PlaylistDownloadTrack[] = [];
  for (const value of tracks) {
    const track = compactTrack(value);
    if (!track) continue;
    const id = String(track.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(track);
  }
  return result;
}

function launch(onProgress?: PlaylistDownloadProgressCallback): Promise<PlaylistDownloadJob> {
  if (!currentJob) return Promise.reject(new Error("There is no playlist download job."));
  callback = onProgress;
  cancelRequested = false;
  currentJob.status = "running";
  currentJob.startedAt = now();
  currentJob.finishedAt = null;
  currentJob.updatedAt = now();
  activeIndex = null;
  activeFraction = null;
  persistJob(currentJob);
  emitProgress();

  const run = Promise.resolve().then(processBatch);
  activeRun = run.finally(() => {
    activeRun = null;
    activeIndex = null;
    activeFraction = null;
    callback = undefined;
  });
  return activeRun;
}

async function processBatch(): Promise<PlaylistDownloadJob> {
  if (!currentJob) throw new Error("There is no playlist download job.");
  while (currentJob.currentIndex < currentJob.tracks.length) {
    if (cancelRequested) break;
    const index = currentJob.currentIndex;
    const track = currentJob.tracks[index];
    const id = String(track.id);
    if (currentJob.completedIds.includes(id) || currentJob.failedIds.includes(id)) {
      currentJob.currentIndex += 1;
      currentJob.updatedAt = now();
      persistJob(currentJob);
      emitProgress();
      continue;
    }

    activeIndex = index;
    activeFraction = null;
    emitProgress();
    let outcome: SaveOutcome = "failed";
    try {
      if (await hasDownload(id)) outcome = "already";
      else outcome = await saveDownload(track, fraction => {
        if (activeIndex !== index) return;
        activeFraction = fraction;
        emitProgress();
      });
    } catch {
      // Per-track failures are recorded and the rest of the playlist continues.
    }

    if (outcome === "saved" || outcome === "already") {
      if (!currentJob.completedIds.includes(id)) currentJob.completedIds.push(id);
      currentJob.failedIds = currentJob.failedIds.filter(failedId => failedId !== id);
    } else if (!currentJob.failedIds.includes(id)) {
      currentJob.failedIds.push(id);
    }
    currentJob.currentIndex = index + 1;
    currentJob.lastTrackAt = now();
    currentJob.updatedAt = currentJob.lastTrackAt;
    activeIndex = null;
    activeFraction = null;
    persistJob(currentJob);
    emitProgress();

    if (cancelRequested) break;
  }

  if (cancelRequested) {
    currentJob.status = "cancelled";
    currentJob.finishedAt = now();
  } else if (currentJob.currentIndex >= currentJob.tracks.length) {
    currentJob.status = "completed";
    currentJob.finishedAt = now();
  } else {
    currentJob.status = "paused";
  }
  currentJob.updatedAt = now();
  persistJob(currentJob);
  emitProgress();
  return copyJob(currentJob);
}

/** Read the current batch, returning null when no valid job has been stored. */
export function readCurrentPlaylistDownloadJob(): PlaylistDownloadJob | null {
  if (currentJob) return copyJob(currentJob);
  currentJob = loadStoredJob();
  return currentJob ? copyJob(currentJob) : null;
}

/** Create and immediately run a fresh batch for the supplied playlist. */
export function startPlaylistDownload(
  input: StartPlaylistDownloadInput,
  onProgress?: PlaylistDownloadProgressCallback,
): Promise<PlaylistDownloadJob> {
  ensureIdle();
  const previous = currentJob ?? loadStoredJob();
  const hasPendingWork = !!previous && (
    previous.failedIds.length > 0 ||
    (previous.status !== "completed" && previous.currentIndex < previous.tracks.length)
  );
  if (hasPendingWork) {
    return Promise.reject(new Error(`Resume or discard the saved “${previous.playlist.title}” download batch first.`));
  }
  const id = String(input.playlist.id ?? "").trim();
  if (!id) return Promise.reject(new Error("A playlist id is required."));
  const timestamp = now();
  currentJob = {
    playlist: { id, title: input.playlist.title },
    tracks: uniqueTracks(input.tracks),
    currentIndex: 0,
    completedIds: [],
    failedIds: [],
    status: "paused",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    lastTrackAt: null,
    finishedAt: null,
  };
  persistJob(currentJob);
  return launch(onProgress);
}

/** Explicitly discard only the persisted batch metadata; saved audio files remain. */
export function discardPlaylistDownloadJob(): PlaylistDownloadJob | null {
  ensureIdle();
  const job = currentJob ?? loadStoredJob();
  currentJob = null;
  activeIndex = null;
  activeFraction = null;
  try { safeStorage()?.removeItem(STORAGE_KEY); } catch { /* keep the in-memory discard */ }
  return job ? copyJob(job) : null;
}

/** Restart the stored batch from its first track; this is an explicit retry. */
export function restartPlaylistDownload(
  onProgress?: PlaylistDownloadProgressCallback,
): Promise<PlaylistDownloadJob> {
  ensureIdle();
  const job = currentJob ?? loadStoredJob();
  if (!job) return Promise.reject(new Error("There is no playlist download job to restart."));
  currentJob = job;
  currentJob.currentIndex = 0;
  currentJob.completedIds = [];
  currentJob.failedIds = [];
  currentJob.lastTrackAt = null;
  currentJob.finishedAt = null;
  currentJob.createdAt = now();
  currentJob.updatedAt = currentJob.createdAt;
  persistJob(currentJob);
  return launch(onProgress);
}

/** Continue unfinished tracks, without re-running any previously failed track. */
export function resumePlaylistDownload(
  onProgress?: PlaylistDownloadProgressCallback,
): Promise<PlaylistDownloadJob> {
  ensureIdle();
  const job = currentJob ?? loadStoredJob();
  if (!job) return Promise.reject(new Error("There is no playlist download job to resume."));
  if (job.status === "completed" || job.currentIndex >= job.tracks.length) {
    return Promise.resolve(copyJob(job));
  }
  currentJob = job;
  return launch(onProgress);
}

/** Explicitly retry only tracks recorded as failed; completed tracks stay done. */
export function retryFailedPlaylistDownloads(
  onProgress?: PlaylistDownloadProgressCallback,
): Promise<PlaylistDownloadJob> {
  ensureIdle();
  const job = currentJob ?? loadStoredJob();
  if (!job) return Promise.reject(new Error("There is no playlist download job to retry."));
  if (job.failedIds.length === 0) return Promise.resolve(copyJob(job));
  const failed = new Set(job.failedIds);
  const firstFailedIndex = job.tracks.findIndex(track => failed.has(String(track.id)));
  currentJob = job;
  currentJob.failedIds = [];
  currentJob.currentIndex = firstFailedIndex < 0 ? job.tracks.length : firstFailedIndex;
  currentJob.finishedAt = null;
  currentJob.updatedAt = now();
  persistJob(currentJob);
  return launch(onProgress);
}

/** Request cancellation and wait for the current save to settle safely. */
export async function cancelPlaylistDownload(): Promise<PlaylistDownloadJob | null> {
  const job = currentJob ?? loadStoredJob();
  if (!job) return null;
  currentJob = job;
  if (activeRun) {
    cancelRequested = true;
    currentJob.status = "cancelling";
    currentJob.updatedAt = now();
    persistJob(currentJob);
    emitProgress();
    try {
      await activeRun;
    } catch {
      // processBatch is failure-tolerant; preserve safe cancellation semantics.
    }
    return currentJob ? copyJob(currentJob) : null;
  }
  if (currentJob.status !== "completed" && currentJob.status !== "cancelled") {
    currentJob.status = "cancelled";
    currentJob.finishedAt = now();
    currentJob.updatedAt = currentJob.finishedAt;
    persistJob(currentJob);
    emitProgress();
  }
  return copyJob(currentJob);
}
