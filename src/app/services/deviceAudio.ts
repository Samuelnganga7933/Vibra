/**
 * deviceAudio — resolve real audio URLs on the device itself.
 *
 * The BFF's serverless IP sits behind YouTube's bot wall ("Sign in to confirm
 * you're not a bot"), but the phone's own IP passes the ANDROID innertube
 * client — the exact request shape this module sends is the one proven to
 * return plain, unciphered streamingData URLs. CapacitorHttp runs natively
 * (OkHttp): no CORS rules, no Origin filtering, and it can carry the
 * youtube.com Origin the endpoint expects.
 *
 * Native-only by design: a browser can't spoof Origin, so web builds keep the
 * BFF → engine → IFrame chain.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";

const INNERTUBE_URL =
  "https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM37w";
const YT_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip";
const CLIENT_VERSION = "20.10.38";
/** googlevideo URLs expire around 6h — cache generously within that. */
const TTL_MS = 5 * 60 * 60 * 1000;

export interface ResolvedAudio {
  url: string;
  mime: string;
}

const cache = new Map<string, { at: number; value: ResolvedAudio }>();

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

interface InnertubeFormat {
  mimeType?: string;
  bitrate?: number;
  url?: string;
}
interface InnertubeResponse {
  playabilityStatus?: { status?: string };
  streamingData?: { adaptiveFormats?: InnertubeFormat[] };
}

function parseResponse(data: unknown): InnertubeResponse | null {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as InnertubeResponse;
    } catch {
      return null;
    }
  }
  if (data && typeof data === "object") return data as InnertubeResponse;
  return null;
}

/**
 * Direct audio URL for a video id, or null when the phone can't get one
 * (region lock, dead video, offline). Failures are silent by contract —
 * callers always have another engine to fall back to.
 */
export async function resolveOnDevice(videoId: string): Promise<ResolvedAudio | null> {
  const id = String(videoId ?? "").trim();
  if (!isNativePlatform() || !id || id.length > 20) return null;

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  try {
    const response = await CapacitorHttp.request({
      method: "POST",
      url: INNERTUBE_URL,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": YT_UA,
        "X-Youtube-Client-Name": "3",
        "X-Youtube-Client-Version": CLIENT_VERSION,
        Origin: "https://www.youtube.com",
        Referer: "https://www.youtube.com/",
      },
      data: {
        videoId: id,
        contentCheckOk: true,
        racyCheckOk: true,
        playbackContext: {
          contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" },
        },
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: CLIENT_VERSION,
            androidSdkVersion: 30,
            hl: "en",
            gl: "US",
          },
        },
      },
      // Keep a slow or blocked resolver from delaying the first audible
      // frame; the normal BFF/iframe fallbacks remain available below.
      connectTimeout: 4_000,
      readTimeout: 6_000,
    });
    if (response.status !== 200) return null;

    const data = parseResponse(response.data);
    if (data?.playabilityStatus?.status !== "OK") return null;

    const formats = (data.streamingData?.adaptiveFormats ?? []).filter(f =>
      String(f.mimeType ?? "").startsWith("audio/"),
    );
    if (formats.length === 0) return null;

    // m4a first — mp4a decodes on every Android build; opus-in-webm is shakier
    // on older WebViews. Highest bitrate within the chosen family wins.
    const mp4 = formats.filter(f => String(f.mimeType ?? "").includes("mp4"));
    const best = (mp4.length > 0 ? mp4 : formats).reduce((a, b) =>
      (b.bitrate ?? 0) > (a.bitrate ?? 0) ? b : a,
    );
    if (!best.url) return null;

    const value: ResolvedAudio = {
      url: best.url,
      mime: (String(best.mimeType ?? "audio/mp4").split(";")[0] || "audio/mp4").trim(),
    };
    if (cache.size > 64) cache.clear();
    cache.set(id, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}
