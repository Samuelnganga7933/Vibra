import React, { useEffect, useState } from "react";
import {
  getConnectionStatus,
  subscribeConnection,
  type ConnectionStatus,
} from "../services/safeFetch";

/**
 * Non-intrusive top banner shown while the API is unreachable or the device is
 * offline: a quiet glass pill with a smooth pulse dot and calm copy. It never
 * blocks interaction and disappears the moment a request succeeds again.
 */
export function ConnectionBanner() {
  const [status, setStatus] = useState<ConnectionStatus>(() => getConnectionStatus());

  useEffect(() => subscribeConnection(setStatus), []);

  if (status === "online") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 400,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 16px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.09)",
        background: "rgba(20,18,31,0.78)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        color: "#F2F0FA",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: 0.1,
        pointerEvents: "none",
        animation: "vibraFadeIn .35s ease both",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: status === "offline" ? "#F97316" : "#E8354D",
          boxShadow: "0 0 0 0 currentColor",
          animation: "vibraPulse 1.6s ease-out infinite",
          flexShrink: 0,
        }}
      />
      Connecting to audio nodes…
      <style>{`
        @keyframes vibraPulse {
          0%   { box-shadow: 0 0 0 0 rgba(232,53,77,0.55); transform: scale(1); }
          70%  { box-shadow: 0 0 0 9px rgba(232,53,77,0);    transform: scale(1.15); }
          100% { box-shadow: 0 0 0 0 rgba(232,53,77,0);      transform: scale(1); }
        }
        @keyframes vibraFadeIn {
          from { opacity: 0; transform: translate(-50%, -8px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [aria-live="polite"] * { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
