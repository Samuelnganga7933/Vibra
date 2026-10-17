/**
 * devices.ts — output-device awareness ("Playing on").
 *
 * Not a handoff picker: this reports where audio is actually coming out.
 * Source of truth is `navigator.mediaDevices.enumerateDevices()` filtered to
 * `audiooutput`; labels need a one-time microphone permission, after which we
 * release the stream immediately. Switching applies `setSinkId` to every
 * registered media element (the HTML5 audio engine; iframes cannot be routed).
 *
 * Every playback event ships `device: { type, name }` from here.
 */

export type DeviceKind = "headphones" | "computer" | "phone" | "speaker";

export interface OutputDevice {
  id: string;
  /** Human label, e.g. "AirPods Pro" — empty until labels are granted. */
  label: string;
  /** Display name: label when known, otherwise the friendly default. */
  name: string;
  kind: DeviceKind;
}

const DEFAULT_DEVICE: OutputDevice = {
  id: "default",
  label: "",
  name: "This computer",
  kind: "computer",
};

let active: OutputDevice = DEFAULT_DEVICE;
let labelsGranted = false;
let permissionPending: Promise<void> | null = null;
const listeners = new Set<(d: OutputDevice) => void>();
const sinks = new Set<HTMLMediaElement>();
let currentSinkId: string | undefined;

// ─── Classification ───────────────────────────────────────────────────────────

export function classifyOutput(label: string): DeviceKind {
  const l = label.toLowerCase();
  if (/\b(airpods?|headphones?|headset|earbuds?|earphones?|beats|sony wh|bose|galaxy buds|earpod)\b/.test(l)) return "headphones";
  if (/\b(iphone|ipad|pixel|galaxy|android|phone|mobile)\b/.test(l)) return "phone";
  if (/\b(speaker|echo|homepod|soundbar|studio monitors|jabr|marshall|lenovo smart)\b/.test(l)) return "speaker";
  return "computer";
}

const KIND_ICON_LABEL: Record<DeviceKind, string> = {
  headphones: "headphones",
  computer: "computer",
  phone: "phone",
  speaker: "speaker",
};

export const deviceKindLabel = (kind: DeviceKind): string => KIND_ICON_LABEL[kind];

// ─── State ────────────────────────────────────────────────────────────────────

function emit(): void {
  listeners.forEach(listener => {
    try {
      listener(active);
    } catch {
      /* a broken subscriber must never break the device layer */
    }
  });
}

export function subscribeOutput(listener: (d: OutputDevice) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The device every event should report: real output when known, else the OS default. */
export function getActiveOutput(): OutputDevice {
  return active;
}

// ─── Media-element routing ────────────────────────────────────────────────────

type RoutableMedia = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

/** Registers an element (the audio engine) so output switches apply to it. */
export function registerSinkElement(el: HTMLMediaElement | null): void {
  if (!el) return;
  sinks.add(el);
  if (currentSinkId && typeof (el as RoutableMedia).setSinkId === "function") {
    void (el as RoutableMedia).setSinkId(currentSinkId).catch(() => {});
  }
}

export function unregisterSinkElement(el: HTMLMediaElement | null): void {
  if (el) sinks.delete(el);
}

function routeTo(sinkId: string | undefined): void {
  currentSinkId = sinkId;
  sinks.forEach(el => {
    const routable = el as RoutableMedia;
    if (sinkId && typeof routable.setSinkId === "function") {
      void routable.setSinkId(sinkId).catch(() => {});
    }
  });
}

// ─── Enumeration & switching ──────────────────────────────────────────────────

/**
 * Requests microphone access once (only way browsers expose output labels),
 * then releases the stream. Resolves even when denied.
 */
async function ensureLabels(): Promise<void> {
  if (labelsGranted || permissionPending) return permissionPending ?? Promise.resolve();
  if (!navigator.mediaDevices?.getUserMedia) return;

  permissionPending = (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      labelsGranted = true;
    } catch {
      /* denied — labels stay hidden and we fall back to "This computer" */
    }
  })();

  await permissionPending;
  permissionPending = null;
}

/** Lists real audio outputs. Falls back to the single default entry. */
export async function listOutputDevices(requestLabels = false): Promise<OutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [active];
  if (requestLabels) await ensureLabels();

  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const outputs = all
      .filter(d => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default")
      .map((d): OutputDevice => ({
        id: d.deviceId,
        label: d.label,
        name: d.label || DEFAULT_DEVICE.name,
        kind: classifyOutput(d.label),
      }));
    return outputs.length > 0 ? outputs : [active];
  } catch {
    return [active];
  }
}

/**
 * Refreshes the active output from the OS default device. Called when
 * playback starts — by then the user has interacted, so labels may be legal.
 */
export async function refreshOutput(): Promise<OutputDevice> {
  if (!navigator.mediaDevices?.enumerateDevices) return active;
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const outputs = all.filter(d => d.kind === "audiooutput");
    const labelled = outputs.find(d => d.label);
    const chosen = labelled ?? outputs[0];
    if (chosen) {
      const isDefault = !chosen.deviceId || chosen.deviceId === "default";
      const name = chosen.label || DEFAULT_DEVICE.name;
      active = isDefault
        ? { ...DEFAULT_DEVICE, label: chosen.label, name: chosen.label || DEFAULT_DEVICE.name, kind: classifyOutput(chosen.label) }
        : { id: chosen.deviceId, label: chosen.label, name, kind: classifyOutput(chosen.label) };
      if (!isDefault) routeTo(chosen.deviceId);
      emit();
    }
  } catch {
    /* enumeration failed — keep the current default */
  }
  return active;
}

/** Switches the output (used by the device chip menu). Never throws. */
export async function switchOutput(deviceId: string): Promise<OutputDevice> {
  if (deviceId === "default") {
    active = DEFAULT_DEVICE;
    routeTo(undefined);
    emit();
    return active;
  }
  const devices = await listOutputDevices(false);
  const target = devices.find(d => d.id === deviceId);
  if (!target) return active;

  const el: HTMLElement | null = sinks.values().next().value ?? null;
  const canRoute = el && typeof (el as RoutableMedia).setSinkId === "function";
  if (canRoute) {
    try {
      await (el as RoutableMedia).setSinkId!(deviceId);
    } catch {
      return active;
    }
  }
  active = target;
  routeTo(deviceId);
  emit();
  return active;
}

/** Picks up labels once the user has interacted with the page. */
export function primeOutput(): void {
  void ensureLabels().then(() => refreshOutput());
}
