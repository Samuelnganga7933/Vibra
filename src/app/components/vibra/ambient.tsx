import { useVibra, type VideoScene } from "./store";

const BLOB_KEYFRAMES = `
  @keyframes vibra-blob-1 {
    0%,  100% { transform: translate(0%,   0%)   scale(1);    }
    25%        { transform: translate(7%,   10%)  scale(1.04); }
    50%        { transform: translate(12%,  18%)  scale(0.96); }
    75%        { transform: translate(-5%,  8%)   scale(1.02); }
  }
  @keyframes vibra-blob-2 {
    0%,  100% { transform: translate(0%,   0%)   scale(1);    }
    33%        { transform: translate(-9%, -12%)  scale(1.06); }
    66%        { transform: translate(6%,  -7%)   scale(0.94); }
  }
  @keyframes vibra-blob-3 {
    0%,  100% { transform: translate(0%,   0%)   scale(1);    }
    20%        { transform: translate(10%, -14%)  scale(1.05); }
    40%        { transform: translate(-7%,  9%)   scale(0.97); }
    60%        { transform: translate(14%,  5%)   scale(1.03); }
    80%        { transform: translate(-4%, -9%)   scale(0.98); }
  }
`;

/**
 * Full-viewport ambient gradient. Three slow radial blobs — violet, cyan,
 * pink — drift on 60–90 s loops. Peripheral only; never draws focus.
 * Pauses when battery saver or reduced motion is on.
 */
export function AmbientBackground({ dim = false }: { dim?: boolean }) {
  const { bgActive, settings } = useVibra();

  if (settings.background === "none") return null;

  const animated = bgActive && settings.background !== "static";
  const baseOpacity = dim ? 0.35 : 0.65;

  return (
    <>
      <style>{BLOB_KEYFRAMES}</style>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ zIndex: 0, opacity: baseOpacity, transition: "opacity 1.4s ease" }}
      >
        {/* Violet — top-left anchor */}
        <div
          className="absolute"
          style={{
            width: "65vw",
            height: "65vw",
            left: "-15vw",
            top: "-15vh",
            background: "radial-gradient(ellipse at center, #8B5CF688 0%, #8B5CF622 45%, transparent 70%)",
            animation: animated ? "vibra-blob-1 88s ease-in-out infinite" : "none",
          }}
        />
        {/* Cyan — bottom-right anchor */}
        <div
          className="absolute"
          style={{
            width: "55vw",
            height: "55vw",
            right: "-10vw",
            bottom: "-10vh",
            background: "radial-gradient(ellipse at center, #22D3EE70 0%, #22D3EE1A 45%, transparent 68%)",
            animation: animated ? "vibra-blob-2 72s ease-in-out infinite" : "none",
          }}
        />
        {/* Pink — center, faintest */}
        <div
          className="absolute"
          style={{
            width: "42vw",
            height: "42vw",
            left: "28vw",
            top: "22vh",
            background: "radial-gradient(ellipse at center, #EC489945 0%, #EC489912 45%, transparent 68%)",
            animation: animated ? "vibra-blob-3 60s ease-in-out infinite" : "none",
          }}
        />
      </div>
    </>
  );
}

/** Static gradient preview for the background settings screen. */
export function ScenePreview({ scene }: { scene: VideoScene }) {
  return (
    <div
      className="absolute inset-0"
      style={{ background: SCENE_PREVIEWS[scene], transition: "background 0.8s ease" }}
    />
  );
}

const SCENE_PREVIEWS: Record<VideoScene, string> = {
  rain:    "linear-gradient(135deg, #1E2A33 0%, #0A0F12 100%)",
  ocean:   "linear-gradient(135deg, #123040 0%, #080F16 100%)",
  forest:  "linear-gradient(135deg, #1B2B1E 0%, #080F09 100%)",
  clouds:  "linear-gradient(135deg, #1E2030 0%, #0A0B14 100%)",
  aurora:  "linear-gradient(135deg, #0B2A2A 0%, #1A0B2A 100%)",
  space:   "linear-gradient(135deg, #06060E 0%, #0C0A0F 100%)",
  city:    "linear-gradient(135deg, #1A140E 0%, #0A0808 100%)",
};
