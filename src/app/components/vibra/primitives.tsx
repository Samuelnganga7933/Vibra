import { motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { useVibra } from "./store";
import { EASE } from "./motion";
import { ImageWithFallback } from "../figma/ImageWithFallback";

/** Editorial section heading. Generous space above, minimal weight. */
export function SectionTitle({
  title,
  kicker,
  action,
}: {
  title: string;
  kicker?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 px-6">
      <div>
        {kicker && (
          <p
            className="text-[11px] uppercase"
            style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}
          >
            {kicker}
          </p>
        )}
        <h2
          className="mt-1.5 text-[26px]"
          style={{ color: "var(--v-text)", lineHeight: 1.14, fontWeight: 600 }}
        >
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

/** Softly elevated card. Lifts on hover, depresses on press. */
export function Card({
  children,
  className = "",
  onClick,
  style,
  soft = false,
  label,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  style?: CSSProperties;
  soft?: boolean;
  label?: string;
}) {
  const { m, settings } = useVibra();
  const interactive = Boolean(onClick);
  return (
    <motion.div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`${settings.neumorphism ? (soft ? "v-raised-soft" : "v-raised") : "border"} ${
        interactive ? "cursor-pointer" : ""
      } ${className}`}
      style={{
        borderRadius: settings.radius,
        background: settings.neumorphism ? undefined : "var(--v-card)",
        borderColor: "var(--v-border)",
        ...style,
      }}
      {...(interactive ? { ...m.lift, ...m.press } : {})}
      transition={{ duration: 0.24, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Inset control surface — search fields, sliders, segmented pickers. */
export function Inset({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { settings } = useVibra();
  return (
    <div
      className={`${settings.neumorphism ? "v-inset" : "border"} ${className}`}
      style={{
        borderRadius: settings.radius,
        background: settings.neumorphism ? undefined : "var(--v-surface)",
        borderColor: "var(--v-border)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Circular icon button with a natural depress. */
export function IconButton({
  children,
  onClick,
  label,
  size = 44,
  tone = "surface",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  size?: number;
  tone?: "surface" | "accent" | "bare";
  className?: string;
}) {
  const { m, accent, settings } = useVibra();
  const styles: CSSProperties =
    tone === "accent"
      ? { background: accent, color: "#0B1B0F", boxShadow: `0 8px 22px ${accent}44` }
      : tone === "bare"
        ? { background: "transparent", color: "var(--v-text-2)" }
        : { background: "var(--v-surface)", color: "var(--v-text)", border: "1px solid var(--v-border)" };

  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid place-items-center rounded-full ${
        tone === "surface" && settings.neumorphism ? "v-raised-soft" : ""
      } ${className}`}
      style={{ width: size, height: size, borderRadius: 999, ...styles }}
      whileHover={m.reduced ? undefined : { scale: tone === "accent" ? 1.04 : 1.02 }}
      whileTap={m.reduced ? undefined : { scale: 0.94 }}
      transition={{ duration: 0.15, ease: EASE }}
    >
      {children}
    </motion.button>
  );
}

/** Artwork with a progressive fade-in — never a hard swap. */
export function Art({
  src,
  alt,
  className = "",
  radius,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  radius?: number;
  style?: CSSProperties;
}) {
  const { settings } = useVibra();
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ borderRadius: radius ?? settings.radius, background: "var(--v-surface)", ...style }}
    >
      <motion.div
        className="h-full w-full"
        initial={{ opacity: 0, scale: 1.02 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <ImageWithFallback src={src} alt={alt} className="h-full w-full object-cover" />
      </motion.div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "inset 0 0 0 1px var(--v-border)", borderRadius: "inherit" }}
      />
    </div>
  );
}

/** Skeleton block — shimmer, never a spinner. */
export function Skeleton({
  className = "",
  radius = 12,
  style,
}: {
  className?: string;
  radius?: number;
  style?: CSSProperties;
}) {
  return <div className={`v-shimmer ${className}`} style={{ borderRadius: radius, ...style }} />;
}

/** Small pill used for AI readings and metadata. */
export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "gold";
}) {
  const { accent } = useVibra();
  const colors =
    tone === "accent"
      ? { color: accent, background: `${accent}18`, border: `1px solid ${accent}33` }
      : tone === "gold"
        ? { color: "var(--v-gold)", background: "rgba(201,169,97,0.12)", border: "1px solid rgba(201,169,97,0.25)" }
        : { color: "var(--v-text-2)", background: "var(--v-surface)", border: "1px solid var(--v-border)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
      style={{ letterSpacing: "0.01em", ...colors }}
    >
      {children}
    </span>
  );
}

/** Screen header: back affordance plus a large editorial title. */
export function ScreenHeader({
  title,
  kicker,
  onBack,
  right,
}: {
  title: string;
  kicker?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="px-6 pb-2 pt-2">
      <div className="flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="-ml-1 text-[13px]"
            style={{ color: "var(--v-text-2)" }}
          >
            ‹ Back
          </button>
        ) : (
          <span />
        )}
        {right}
      </div>
      {kicker && (
        <p
          className="mt-4 text-[11px] uppercase"
          style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}
        >
          {kicker}
        </p>
      )}
      <h1
        className="mt-1 text-[34px]"
        style={{ color: "var(--v-text)", lineHeight: 1.08, fontWeight: 600 }}
      >
        {title}
      </h1>
    </div>
  );
}

/** Toggle switch that animates rather than snaps. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  const { accent, m } = useVibra();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative shrink-0"
      style={{
        width: 48,
        height: 29,
        borderRadius: 999,
        background: checked ? accent : "var(--v-surface)",
        border: "1px solid var(--v-border)",
        boxShadow: checked ? `0 4px 14px ${accent}33` : "inset 2px 3px 8px var(--v-shade)",
        transition: "background 280ms cubic-bezier(0.22,0.61,0.36,1), box-shadow 280ms",
      }}
    >
      <motion.span
        className="absolute top-[3px] block rounded-full"
        style={{
          width: 21,
          height: 21,
          background: checked ? "#0B1B0F" : "var(--v-text-2)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        }}
        animate={{ x: checked ? 23 : 3 }}
        transition={m.reduced ? { duration: 0.1 } : { type: "spring", stiffness: 420, damping: 30 }}
      />
    </button>
  );
}

/** Inset slider with an accent-filled track. */
export function Slider({
  value,
  onChange,
  label,
  suffix,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const { accent } = useVibra();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[14px]" style={{ color: "var(--v-text)" }}>
          {label}
        </span>
        <span className="text-[12px]" style={{ color: "var(--v-text-3)" }}>
          {suffix ?? `${Math.round(pct)}%`}
        </span>
      </div>
      <div className="relative h-6">
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 v-inset"
          style={{ height: 8, borderRadius: 999 }}
        />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2"
          style={{
            height: 8,
            width: `${pct}%`,
            borderRadius: 999,
            background: accent,
            transition: "width 120ms linear, background 700ms cubic-bezier(0.22,0.61,0.36,1)",
          }}
        />
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
        />
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2"
          style={{
            left: `calc(${pct}% - 9px)`,
            width: 18,
            height: 18,
            borderRadius: 999,
            background: "var(--v-card)",
            border: "1px solid var(--v-border-strong)",
            boxShadow: "0 3px 10px var(--v-shade)",
            transition: "left 120ms linear",
          }}
        />
      </div>
    </div>
  );
}

/** Settings row. Optional inline control on the right. */
export function Row({
  title,
  note,
  right,
  onClick,
  last = false,
}: {
  title: string;
  note?: string;
  right?: ReactNode;
  onClick?: () => void;
  last?: boolean;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter") onClick();
            }
          : undefined
      }
      className={`flex items-center justify-between gap-4 px-5 py-4 ${onClick ? "cursor-pointer" : ""}`}
      style={{ borderBottom: last ? "none" : "1px solid var(--v-border)" }}
    >
      <div className="min-w-0">
        <p className="text-[15px]" style={{ color: "var(--v-text)" }}>
          {title}
        </p>
        {note && (
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--v-text-3)" }}>
            {note}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}
