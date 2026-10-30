import React, { useMemo, useRef } from "react";

export interface WaveformSeekBarProps {
  /** Stable track identifier used to generate a repeatable waveform shape. */
  trackKey: string | number;
  /** Playback position from 0 to 1. */
  progress: number;
  /** Called with a clamped playback fraction from 0 to 1. */
  onSeek: (fraction: number) => void;
  /** Played-bar color, normally the active theme's accent token. */
  color?: string;
  /** Overall bar-strip height in CSS pixels. */
  height?: number;
  /** Optional class for layout and styling by the caller. */
  className?: string;
  /** Accessible slider name. */
  ariaLabel?: string;
}

const BAR_COUNT = 72;

/**
 * Deterministic waveform-style seek control. Its bar geometry is derived only
 * from `trackKey`, so playback updates never make the waveform jitter.
 */
export function WaveformSeekBar({
  trackKey,
  progress,
  onSeek,
  color = "var(--v-accent, #ff3b5c)",
  height = 44,
  className,
  ariaLabel = "Seek playback position",
}: WaveformSeekBarProps) {
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const bars = useMemo(() => {
    const key = String(trackKey ?? "0");
    let seed = 2166136261;
    for (let i = 0; i < key.length; i++) {
      seed = Math.imul(seed ^ key.charCodeAt(i), 16777619) >>> 0;
    }
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const random = (seed >>> 8) / 0xffffff;
      const envelope = 0.55 + 0.45 * Math.sin((i / BAR_COUNT) * Math.PI);
      return 0.3 + 0.7 * random * envelope;
    });
  }, [trackKey]);

  const value = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const seekAt = (clientX: number) => {
    const bounds = sliderRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    onSeek(Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)));
  };

  return (
    <div
      ref={sliderRef}
      className={className}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`${Math.round(value * 100)}% played`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekAt(event.clientX);
      }}
      onPointerMove={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event.clientX);
      }}
      onPointerUp={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={event => {
        let next: number | null = null;
        switch (event.key) {
          case "ArrowRight":
          case "ArrowUp": next = value + 0.02; break;
          case "ArrowLeft":
          case "ArrowDown": next = value - 0.02; break;
          case "PageUp": next = value + 0.1; break;
          case "PageDown": next = value - 0.1; break;
          case "Home": next = 0; break;
          case "End": next = 1; break;
        }
        if (next !== null) {
          event.preventDefault();
          onSeek(Math.max(0, Math.min(1, next)));
        }
      }}
      style={{
        position: "relative",
        flex: 1,
        width: "100%",
        height,
        display: "flex",
        alignItems: "center",
        gap: 2,
        cursor: "pointer",
        touchAction: "none",
        overflow: "hidden",
        outlineOffset: 4,
      }}
    >
      {bars.map((barHeight, index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{
            flex: 1,
            minWidth: 0,
            height: `${Math.round(barHeight * 100)}%`,
            borderRadius: 2,
            background: index / bars.length < value
              ? color
              : `color-mix(in srgb, ${color} 26%, transparent)`,
            transition: "background .2s linear",
          }}
        />
      ))}
    </div>
  );
}
