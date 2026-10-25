/**
 * localMusic.ts — the phone's own audio files (MediaStore), YT-Music style.
 *
 * The WebView can't list device files, so VybraMediaPlugin queries MediaStore
 * and hands back rows; playback uses Capacitor.convertFileSrc to turn each
 * absolute path into a URL the <audio> element can read — fully offline.
 * Absent permission answers `null` (the UI then shows the grant row).
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Track } from "../context";

export interface LocalSong {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number;
  sizeBytes: number;
  dateAdded: number;
  path: string;
}

interface VybraMediaLocalType {
  listLocalMusic(): Promise<{ songs: LocalSong[] }>;
  requestAudioPermission(): Promise<void>;
  openAudioSettings(): Promise<void>;
  checkPermissions(): Promise<Record<string, string>>;
}

const Native = registerPlugin<VybraMediaLocalType>("VybraMedia");

const AUDIO_KEYS = ["audioFiles", "audioFilesLegacy"];
const audioGranted = (state: Record<string, string> | undefined) =>
  AUDIO_KEYS.some(k => state?.[k] === "granted");

/** Gradient palette for artwork-less local rows — same family as BG_PALETTE. */
const LOCAL_BGS = [
  "linear-gradient(135deg,#4a1e2a,#1a1220)",
  "linear-gradient(135deg,#1d3a5a,#12202e)",
  "linear-gradient(135deg,#3a2a8a,#1a1230)",
  "linear-gradient(135deg,#1d4a3a,#10261f)",
  "linear-gradient(135deg,#5a3a1a,#241505)",
];

export function isNativeMediaAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * List every music file on the phone.
 * `null`  → not native, or permission not granted (show the grant row).
 * `[]`    → granted, but no music on the device (show the empty state).
 */
export async function listLocalMusic(): Promise<LocalSong[] | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const res = await Native.listLocalMusic();
    return res?.songs ?? [];
  } catch (err) {
    const code = (err as { code?: string } | null)?.code ?? "";
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "E_AUDIO_PERMISSION" || msg.includes("audio-permission")) return null;
    return null; // query failure on exotic OEMs — degrade to no section
  }
}

/** Ask for media-read permission (system dialog). Returns the new state. */
export async function requestLocalMusicPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await Native.requestAudioPermission();
    if (audioGranted(await Native.checkPermissions())) return true;
    // Some OEMs publish the grant a beat AFTER the dialog callback resolves;
    // poll briefly instead of reporting a false denial.
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (audioGranted(await Native.checkPermissions())) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * True when the system will still show the permission dialog. A hard
 * "denied" means the user chose "Don't ask again" — the only way forward is
 * the app settings screen (see openAudioPermissionSettings).
 */
export async function audioPermissionAskable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const state = await Native.checkPermissions();
    const mine = AUDIO_KEYS.map(k => state?.[k]);
    return mine.some(s => s === "prompt" || s === "prompt-with-rationale" || s === "granted");
  } catch {
    return false;
  }
}

/** Jump straight to this app's system settings page (permission toggles). */
export function openAudioPermissionSettings(): void {
  if (!Capacitor.isNativePlatform()) return;
  void Native.openAudioSettings().catch(() => { /* not native after all */ });
}

/** Absolute path → a URL the WebView's <audio> can play. */
export function localSongUrl(path: string): string {
  return Capacitor.convertFileSrc(path);
}

/** MediaStore row → the app's Track shape (plays straight from disk). */
export function localSongToTrack(song: LocalSong, index: number): Track {
  return {
    id: `local:${song.id}`,
    title: song.title || "Unknown title",
    artist: song.artist || "Unknown artist",
    album: song.album ?? undefined,
    durationSec: Math.round((song.durationMs || 0) / 1000),
    bg: LOCAL_BGS[index % LOCAL_BGS.length],
    localPath: song.path,
    streamUrl: localSongUrl(song.path),
  };
}
