/**
 * Vibra motion system.
 *
 * One place for every duration and curve in the app so the whole product moves
 * at the same tempo. Speeds follow the spec: tiny interactions 100–150ms,
 * buttons 150–200ms, cards 200–250ms, navigation 250–350ms, screens 350–500ms,
 * backgrounds 700–1200ms.
 *
 * Nothing here bounces or overshoots hard — calm over energetic.
 */

/** Standard ease. A gentle out-curve; the app's default voice. */
export const EASE = [0.22, 0.61, 0.36, 1] as const;
/** Entering elements — decelerates into place. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** Leaving elements — accelerates away without drawing attention. */
export const EASE_IN = [0.5, 0, 0.75, 0] as const;

export const DUR = {
  tiny: 0.12,
  button: 0.18,
  card: 0.24,
  nav: 0.3,
  screen: 0.44,
  background: 0.9,
  splash: 0.65,
} as const;

/** Shared-element spring for mini player → Now Playing. Critically damped. */
export const SHARED_SPRING = {
  type: "spring" as const,
  stiffness: 260,
  damping: 30,
  mass: 0.9,
};

/**
 * Every animated surface reads its transitions through this helper so
 * Reduced Motion can strip movement down to a plain crossfade in one place.
 */
export function motionKit(reduced: boolean) {
  const fade = (delay = 0, duration = DUR.card) =>
    reduced
      ? { opacity: { duration: 0.16, delay: 0, ease: EASE } }
      : { duration, delay, ease: EASE_OUT };

  return {
    reduced,
    /** Cards and list rows: fade with a short upward drift. */
    riseIn: (delay = 0, distance = 14) => ({
      initial: { opacity: 0, y: reduced ? 0 : distance },
      animate: { opacity: 1, y: 0 },
      transition: fade(reduced ? 0 : delay),
    }),
    /** Staggered children — Moments, search suggestions, queue rows. */
    stagger: (index: number, step = 0.055, base = 0.04) => ({
      initial: { opacity: 0, y: reduced ? 0 : 12 },
      animate: { opacity: 1, y: 0 },
      transition: fade(reduced ? 0 : base + index * step),
    }),
    /** Screen-level transition: fade + slight upward motion. */
    screen: {
      initial: { opacity: 0, y: reduced ? 0 : 10 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: reduced ? 0 : -6 },
      transition: { duration: reduced ? 0.2 : DUR.screen, ease: EASE },
    },
    /** Artwork settling: 98% → 100%, never a pop. */
    settle: (delay = 0) => ({
      initial: { opacity: 0, scale: reduced ? 1 : 0.98 },
      animate: { opacity: 1, scale: 1 },
      transition: { duration: reduced ? 0.2 : 0.55, delay: reduced ? 0 : delay, ease: EASE_OUT },
    }),
    /** Buttons depress naturally; cards lift then settle. */
    press: reduced ? {} : { whileTap: { scale: 0.98 }, transition: { duration: DUR.button, ease: EASE } },
    pressFirm: reduced ? {} : { whileTap: { scale: 0.94 }, transition: { duration: DUR.tiny, ease: EASE } },
    lift: reduced ? {} : { whileHover: { y: -3 }, whileTap: { scale: 0.985 } },
    crossfade: { duration: reduced ? 0.16 : 0.34, ease: EASE },
    bg: { duration: reduced ? 0.2 : DUR.background, ease: EASE },
  };
}

export type MotionKit = ReturnType<typeof motionKit>;
