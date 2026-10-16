/**
 * store.ts — the persistent client state engine.
 *
 * Four localStorage-backed engines power personal features with no backend
 * dependency: user profile, playback history, playlists, and devices.
 * Every access is failure-tolerant (blocked storage / bad JSON → safe
 * defaults), so the app never crashes because of persistence.
 */

// ─── Generic helpers ──────────────────────────────────────────────────────────

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded or storage disabled — in-memory state keeps working */
  }
}

// ─── A. User Profile & Settings ───────────────────────────────────────────────
// Key: vibra_user_profile

export const PROFILE_KEY = "vibra_user_profile";

export interface StoredUserProfile {
  name: string;
  username: string;
  initials: string;
  email: string;
  avatarUrl?: string;
  subscription: "premium" | "free";
  accentColor: string;
  audioQuality: "low" | "normal" | "high" | "lossless" | string;
}

/** Returns the persisted profile, or null when none exists yet. */
export function getUserProfile(): StoredUserProfile | null {
  const profile = readJSON<Partial<StoredUserProfile> | null>(PROFILE_KEY, null);
  if (!profile || typeof profile !== "object") return null;
  // A profile counts as existing once any field has been persisted (accent /
  // quality can be saved before a display name is set — keep those values).
  if (Object.keys(profile).length === 0) return null;
  return {
    name: profile.name ?? "",
    username: profile.username ?? "",
    initials: profile.initials ?? (profile.name ? profile.name.slice(0, 2).toUpperCase() : ""),
    email: profile.email ?? "",
    avatarUrl: profile.avatarUrl,
    subscription: profile.subscription === "premium" ? "premium" : "free",
    accentColor: profile.accentColor ?? "#E8354D",
    audioQuality: profile.audioQuality ?? "high",
  };
}

/** Merges a patch into the persisted profile and returns the full result. */
export function updateUserProfile(patch: Partial<StoredUserProfile>): StoredUserProfile {
  const current = getUserProfile();
  const merged: StoredUserProfile = {
    name: patch.name ?? current?.name ?? "",
    username: patch.username ?? current?.username ?? "",
    initials: patch.initials ?? current?.initials ?? "",
    email: patch.email ?? current?.email ?? "",
    avatarUrl: patch.avatarUrl ?? current?.avatarUrl,
    subscription: patch.subscription ?? current?.subscription ?? "free",
    accentColor: patch.accentColor ?? current?.accentColor ?? "#E8354D",
    audioQuality: patch.audioQuality ?? current?.audioQuality ?? "high",
  };
  writeJSON(PROFILE_KEY, merged);
  return merged;
}

export function clearUserProfile(): void {
  try {
    window.localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

// ─── B. Recently Played History ───────────────────────────────────────────────
// Key: vibra_history — 50 most recent, deduplicated by id.

export const HISTORY_KEY = "vibra_history";
export const HISTORY_LIMIT = 50;

export interface StoredTrack {
  id: string | number;
  title: string;
  artist: string;
  album?: string;
  duration?: string;
  durationSec?: number;
  bg: string;
  imageUrl?: string;
  previewUrl?: string;
  streamUrl?: string;
  videoId?: string;
}

/** Returns the persisted history, newest first. */
export function getHistory(): StoredTrack[] {
  const list = readJSON<unknown>(HISTORY_KEY, []);
  return Array.isArray(list) ? (list as StoredTrack[]).filter(isStoredTrack) : [];
}

/**
 * Prepends a track to the history: existing entries move to the top instead
 * of duplicating, and the list is capped at HISTORY_LIMIT. Persists and
 * returns the updated list.
 */
export function addHistoryTrack(track: StoredTrack): StoredTrack[] {
  const next = [track, ...getHistory().filter(t => String(t.id) !== String(track.id))];
  const capped = next.slice(0, HISTORY_LIMIT);
  writeJSON(HISTORY_KEY, capped);
  return capped;
}

/** Merges external (e.g. backend) tracks into the stored history. */
export function mergeHistory(tracks: StoredTrack[]): StoredTrack[] {
  const merged = [...tracks, ...getHistory()]
    .filter((t, i, arr) => arr.findIndex(x => String(x.id) === String(t.id)) === i)
    .slice(0, HISTORY_LIMIT);
  writeJSON(HISTORY_KEY, merged);
  return merged;
}

function isStoredTrack(value: unknown): value is StoredTrack {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return typeof t.id !== "undefined" && typeof t.title === "string";
}

// ─── C. Playlists & Library ───────────────────────────────────────────────────
// Key: vibra_playlists — custom playlists created in the client.

export const PLAYLISTS_KEY = "vibra_playlists";
const CUSTOM_ID_PREFIX = "local_";
const PLAYLIST_BG_PALETTE = ["#2D1B4E", "#0F4C5C", "#5C2A2A", "#1B4332", "#3D2C5C", "#1F3A5F"];

export interface StoredPlaylist {
  id: string;
  name: string;
  description?: string;
  bg: string;
  imageUrl?: string;
  trackCount: number;
  creator?: string;
  tracks: StoredTrack[];
  createdAt: number;
}

/** Returns every locally persisted custom playlist. */
export function getPlaylists(): StoredPlaylist[] {
  const list = readJSON<unknown>(PLAYLISTS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is StoredPlaylist => {
    if (!p || typeof p !== "object") return false;
    const pl = p as Record<string, unknown>;
    return typeof pl.id === "string" && typeof pl.name === "string";
  });
}

export function savePlaylist(playlist: StoredPlaylist): void {
  const others = getPlaylists().filter(p => p.id !== playlist.id);
  writeJSON(PLAYLISTS_KEY, [playlist, ...others]);
}

/** Creates a custom playlist (id `local_<ts>`) and persists it. */
export function createCustomPlaylist(name: string, description = ""): StoredPlaylist {
  const playlist: StoredPlaylist = {
    id: `${CUSTOM_ID_PREFIX}${Date.now().toString(36)}`,
    name: name.trim() || "My playlist",
    description: description.trim() || undefined,
    bg: PLAYLIST_BG_PALETTE[Math.floor(Math.random() * PLAYLIST_BG_PALETTE.length)],
    trackCount: 0,
    creator: "You",
    tracks: [],
    createdAt: Date.now(),
  };
  savePlaylist(playlist);
  return playlist;
}

/** Adds a track (deduped by id) to a playlist and persists the change. */
export function addTrackToPlaylist(playlistId: string, track: StoredTrack): StoredPlaylist | null {
  const playlists = getPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  if (!playlist) return null;
  if (playlist.tracks.some(t => String(t.id) === String(track.id))) return playlist;
  const updated: StoredPlaylist = {
    ...playlist,
    tracks: [track, ...playlist.tracks],
    trackCount: playlist.trackCount + 1,
  };
  savePlaylist(updated);
  return updated;
}

/** Removes a track from a playlist and persists the change. */
export function removeTrackFromPlaylist(playlistId: string, trackId: string | number): StoredPlaylist | null {
  const playlists = getPlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  if (!playlist) return null;
  const tracks = playlist.tracks.filter(t => String(t.id) !== String(trackId));
  const updated: StoredPlaylist = {
    ...playlist,
    tracks,
    trackCount: tracks.length,
  };
  savePlaylist(updated);
  return updated;
}

export function deletePlaylist(playlistId: string): void {
  writeJSON(PLAYLISTS_KEY, getPlaylists().filter(p => p.id !== playlistId));
}

// ─── D. Connected Devices & Active Session ────────────────────────────────────
// Key: vibra_devices — simulated output devices for playback routing.

export const DEVICES_KEY = "vibra_devices";

export interface StoredDevice {
  id: string;
  name: string;
  type: "browser" | "phone" | "desktop" | "speaker";
  active: boolean;
  lastActive: number;
}

const DEFAULT_DEVICES: StoredDevice[] = [
  { id: "device_web", name: "Web Player (This Browser)", type: "browser", active: true, lastActive: Date.now() },
  { id: "device_iphone", name: "iPhone 15 Pro", type: "phone", active: false, lastActive: Date.now() - 86_400_000 },
  { id: "device_macbook", name: "MacBook Pro", type: "desktop", active: false, lastActive: Date.now() - 3_600_000 },
];

/** Returns the device list, seeding the defaults on first use. */
export function getDevices(): StoredDevice[] {
  const list = readJSON<unknown>(DEVICES_KEY, []);
  if (Array.isArray(list) && list.length > 0) {
    return list.filter((d): d is StoredDevice => {
      if (!d || typeof d !== "object") return false;
      const dev = d as Record<string, unknown>;
      return typeof dev.id === "string" && typeof dev.name === "string";
    });
  }
  const seeded = DEFAULT_DEVICES.map(d => ({ ...d }));
  writeJSON(DEVICES_KEY, seeded);
  return seeded;
}

/** Returns the active output device (the web player when unknown). */
export function getActiveDevice(): StoredDevice {
  const devices = getDevices();
  return devices.find(d => d.active) ?? devices[0] ?? DEFAULT_DEVICES[0];
}

/** Switches the active output device; exactly one device is ever active. */
export function setActiveDevice(deviceId: string): StoredDevice {
  const devices = getDevices().map(d => ({
    ...d,
    active: d.id === deviceId,
    lastActive: d.id === deviceId ? Date.now() : d.lastActive,
  }));
  writeJSON(DEVICES_KEY, devices);
  return devices.find(d => d.active) ?? devices[0] ?? DEFAULT_DEVICES[0];
}
