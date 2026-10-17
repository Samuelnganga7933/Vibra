/**
 * events.ts — silent playback/feedback telemetry.
 *
 * Every event POSTs to the BFF (`POST /api/events`) and includes the shelf it
 * came from plus the active output device, so the backend can learn which
 * shelves work and where playback happens. Fire-and-forget: failures are
 * invisible to the user.
 */

import { bffSend, isSignedIn } from "./bff";
import { getActiveOutput } from "./devices";

export type EventType =
  | "play"
  | "skip"
  | "complete"
  | "replay"
  | "like"
  | "unlike"
  | "add_to_playlist"
  | "search"
  | "not_interested";

/** Listening events respect "Pause history"; feedback events do not. */
const LISTENING_EVENTS: EventType[] = ["play", "skip", "complete", "replay"];

const PAUSED_KEY = "vibra_history_paused";

export interface VibraEvent {
  type: EventType;
  track_id?: string;
  title?: string;
  image?: string;
  position_ms?: number;
  source_shelf_id?: string;
  artist?: string;
  device: { type: string; name: string };
  ts: number;
}

export function isHistoryPaused(): boolean {
  try {
    return window.localStorage.getItem(PAUSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setHistoryPaused(paused: boolean): void {
  try {
    if (paused) window.localStorage.setItem(PAUSED_KEY, "1");
    else window.localStorage.removeItem(PAUSED_KEY);
  } catch {
    /* storage blocked — pause lives only in server settings */
  }
}

/**
 * Queues one telemetry event. Never throws, never blocks: called straight from
 * playback transitions and card feedback affordances.
 */
export function sendEvent(input: {
  type: EventType;
  trackId?: string | number;
  title?: string;
  image?: string;
  positionMs?: number;
  sourceShelfId?: string;
  artist?: string;
}): void {
  // The BFF logs events per signed-in user — nothing to send when signed out.
  if (!isSignedIn()) return;
  if (LISTENING_EVENTS.includes(input.type) && isHistoryPaused()) return;

  const device = getActiveOutput();
  const payload: VibraEvent = {
    type: input.type,
    track_id: input.trackId !== undefined ? String(input.trackId) : undefined,
    title: input.title,
    image: input.image,
    position_ms: input.positionMs,
    source_shelf_id: input.sourceShelfId,
    artist: input.artist,
    device: { type: device.kind, name: device.name },
    ts: Date.now(),
  };

  void bffSend("/api/events", { method: "POST", body: JSON.stringify(payload) });
}
