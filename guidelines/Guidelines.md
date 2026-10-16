# Vibra — design guidelines

An AI-native music discovery app. Playback is familiar; discovery is the product.
The tone to hold: **premium, editorial, minimal, calm.** Closer to Apple Music,
Nothing OS, Linear and Arc than to anything that glows.

Explicitly out of bounds: purple gradients, cyan glows, cyberpunk, gaming UI,
chat interfaces, AI orbs, listening analytics, Wrapped-style recaps.

## Ground and colour

Tokens live in `src/styles/theme.css`, scoped to `[data-vibra="dark|light|oled"]`
so all three themes can be rendered at once. Never hard-code these values in
components — read the variables.

| Token | Dark | OLED | Light |
| --- | --- | --- | --- |
| `--v-bg` | `#111111` | `#000000` | `#F6F5F2` |
| `--v-elevated` | `#181818` | `#0B0B0B` | `#FBFAF8` |
| `--v-card` | `#202020` | `#131313` | `#FFFFFF` |
| `--v-surface` | `#242424` | `#191919` | `#F1EFEA` |
| `--v-border` | `rgba(255,255,255,.06)` | `rgba(255,255,255,.08)` | `rgba(0,0,0,.07)` |

Accent is emerald `#34C759` by default and user-switchable (green, blue, orange,
red, custom). Read it through `--v-accent-live`, a registered `@property` so
accent changes interpolate over ~900ms instead of snapping. Secondaries: warm
white `#F4F2EE`, soft gray `--v-text-2`, muted gold `--v-gold`. Accent is for
interactive emphasis and state only — never decoration.

## Depth

Soft neo-morphism, three classes only:

* `.v-raised` — cards and sheets, softly elevated
* `.v-raised-soft` — secondary cards, list tiles
* `.v-inset` — search fields, sliders, segmented controls

No harsh glassmorphism, no heavy blur. Corner radius is user-controlled
(`--v-radius`, 6–30px, default 22). Respect the Neumorphism toggle: when off,
surfaces fall back to flat fills with hairline borders.

## Typography

Inter Tight for headlines (`h1`–`h4`, tight tracking), Inter for everything else.
Large editorial headlines, generous spacing, minimal words, large imagery. Never
add a sentence a screen can do without.

## Motion

All timings come from `src/app/components/vibra/motion.ts` — import `DUR`, `EASE`
and `motionKit`; never invent a duration inline.

| Class | Duration |
| --- | --- |
| Tiny interactions | 100–150ms |
| Buttons | 150–200ms |
| Cards | 200–250ms |
| Navigation | 250–350ms |
| Screen transitions | 350–500ms |
| Backgrounds | 700–1200ms |

Rules: cards lift and settle, buttons depress to ~0.98, artwork settles from 98%
to 100%, lists stagger by ~55ms, AI interpretations crossfade rather than pop,
Now Playing grows out of the mini player via a shared `layoutId="player-art"`.
Loading is always skeleton + shimmer, never a spinner. Errors and empty states
fade in with a quiet glyph and one explanatory line — never a shake.

Every animated surface reads its transitions from `motionKit(reduced)`, so Reduce
Motion (setting or OS) collapses the whole system to crossfades in one place.

## Backgrounds

`AmbientBackground` handles all five styles (animated gradient, video scene,
album art, static, none). Cinematic scenes are composited layers with 45–160s
loop periods — peripheral only. They dim to 40% while the user is scrolling and
pause entirely in battery saver or Reduce Motion.

## Accessibility floor

WCAG AA body contrast, 44px minimum touch targets, one-handed reach for primary
actions, `aria-label` on every icon-only control, `role="switch"` with
`aria-checked` on toggles, and state signalled by more than colour alone.
