import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Compass, Home, Library, Search, User } from "lucide-react";
import { useVibra, type Tab } from "./store";
import { AmbientBackground } from "./ambient";
import { MiniPlayer, NowPlaying } from "./player";
import { HomeScreen } from "./screens/home";
import { DiscoverScreen } from "./screens/discover";
import { SearchScreen } from "./screens/search";
import { LibraryScreen } from "./screens/library";
import { ProfileScreen } from "./screens/profile";
import { AppearanceScreen, BackgroundScreen } from "./screens/settings";
import { LoginScreen, OnboardingScreen, SplashScreen } from "./screens/entry";
import { EASE } from "./motion";

export type Platform = "ios" | "android";

const TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "search", label: "Search", icon: Search },
  { id: "library", label: "Library", icon: Library },
  { id: "profile", label: "You", icon: User },
];

/** iOS status bar / Android status bar. Same information, native ordering. */
function StatusBar({ platform }: { platform: Platform }) {
  return (
    <div
      className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-7 pt-3 text-[12px]"
      style={{ color: "var(--v-text)", height: 44 }}
    >
      {platform === "ios" ? (
        <>
          <span className="tabular-nums" style={{ fontWeight: 500 }}>
            9:41
          </span>
          <span className="flex items-center gap-1.5" aria-hidden>
            <Bars /> <Wifi /> <Battery />
          </span>
        </>
      ) : (
        <>
          <span className="flex items-center gap-2">
            <span className="tabular-nums">9:41</span>
          </span>
          <span className="flex items-center gap-1.5" aria-hidden>
            <Wifi /> <Bars /> <Battery />
          </span>
        </>
      )}
    </div>
  );
}

const Bars = () => (
  <svg width="17" height="11" viewBox="0 0 17 11" fill="none">
    {[0, 1, 2, 3].map((i) => (
      <rect
        key={i}
        x={i * 4.4}
        y={8 - i * 2.4}
        width="3"
        height={3 + i * 2.4}
        rx="1"
        fill="currentColor"
        opacity={i === 3 ? 0.4 : 1}
      />
    ))}
  </svg>
);
const Wifi = () => (
  <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
    <path d="M7.5 9.4 5.2 6.9a3.4 3.4 0 0 1 4.6 0L7.5 9.4Z" fill="currentColor" />
    <path d="M2.6 4.4a7 7 0 0 1 9.8 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
  </svg>
);
const Battery = () => (
  <svg width="24" height="12" viewBox="0 0 24 12" fill="none">
    <rect x="0.5" y="0.5" width="20" height="11" rx="3" stroke="currentColor" opacity="0.4" />
    <rect x="2" y="2" width="14" height="8" rx="1.8" fill="currentColor" />
    <path d="M22 4.2v3.6a2 2 0 0 0 0-3.6Z" fill="currentColor" opacity="0.4" />
  </svg>
);

function TabBar({ platform }: { platform: Platform }) {
  const { tab, go, m, accent, settings } = useVibra();

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30"
      style={{
        paddingBottom: platform === "ios" ? 22 : 14,
        paddingTop: 10,
        background: `color-mix(in srgb, var(--v-bg) ${Math.round(
          62 + (1 - settings.transparency) * 38,
        )}%, transparent)`,
        backdropFilter: "blur(22px)",
        borderTop: "1px solid var(--v-border)",
      }}
    >
      <div className="flex items-stretch justify-around px-2">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-label={t.label}
              aria-current={on ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center gap-1 py-1.5"
            >
              {/* Android gets Material's pill indicator; iOS stays label-forward. */}
              {platform === "android" && on && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute -top-0.5 h-8 w-16 rounded-full"
                  style={{ background: `${accent}22` }}
                  transition={m.reduced ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <motion.span
                className="relative"
                animate={{ scale: on && !m.reduced ? 1.04 : 1 }}
                transition={{ duration: 0.18, ease: EASE }}
              >
                <t.icon
                  size={platform === "android" ? 21 : 22}
                  color={on ? accent : "var(--v-text-3)"}
                  strokeWidth={on ? 2.2 : 1.7}
                />
              </motion.span>
              <span
                className="relative text-[10px]"
                style={{
                  color: on ? "var(--v-text)" : "var(--v-text-3)",
                  letterSpacing: platform === "android" ? "0.02em" : "0",
                }}
              >
                {t.label}
              </span>
              {platform === "ios" && on && (
                <motion.span
                  layoutId="tab-dot"
                  className="absolute -bottom-0.5 block rounded-full"
                  style={{ width: 4, height: 4, background: accent }}
                  transition={m.reduced ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 32 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SCREENS = {
  home: HomeScreen,
  discover: DiscoverScreen,
  search: SearchScreen,
  library: LibraryScreen,
  profile: ProfileScreen,
  appearance: AppearanceScreen,
  backgrounds: BackgroundScreen,
  splash: SplashScreen,
  login: LoginScreen,
  onboarding: OnboardingScreen,
} as const;

/** The device. 390×844 (iPhone) / 393×851 (Pixel) — one layout, two chromes. */
export function PhoneShell({ platform }: { platform: Platform }) {
  const { screen, settings, resolvedTheme, accent, m, hasStarted } = useVibra();
  const [reading, setReading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const chrome = screen === "splash" || screen === "login" || screen === "onboarding";
  const Screen = SCREENS[screen];

  return (
    <div
      data-vibra={resolvedTheme}
      className="relative overflow-hidden"
      style={
        {
          width: platform === "ios" ? 390 : 393,
          height: platform === "ios" ? 844 : 851,
          borderRadius: platform === "ios" ? 54 : 40,
          background: "var(--v-bg)",
          color: "var(--v-text)",
            boxShadow: "0 50px 100px rgba(0,0,0,0.55), 0 0 0 10px #17171A, 0 0 0 11px #2C2C30",
          ["--v-accent-live" as string]: accent,
          ["--v-radius" as string]: `${settings.radius}px`,
          ["--v-lift" as string]: settings.neumorphism ? 1 : 0.4,
        } as React.CSSProperties
      }
    >
      <AmbientBackground dim={reading} />

      <StatusBar platform={platform} />

      {/* Screen transitions: fade with a slight upward drift. */}
      <div
        ref={scroller}
        onScroll={(e) => setReading(e.currentTarget.scrollTop > 24)}
        className="v-scroll relative h-full overflow-y-auto"
        style={{
          paddingTop: chrome ? 0 : 52,
          paddingBottom: chrome ? 0 : hasStarted ? 152 : 100,
          // Large text scales the whole content layer so nothing crops or clips.
          zoom: settings.largeText ? 1.08 : 1,
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div key={screen} {...m.screen}>
            <Screen />
          </motion.div>
        </AnimatePresence>
      </div>

      {!chrome && (
        <>
          <MiniPlayer />
          <TabBar platform={platform} />
        </>
      )}
      <NowPlaying />

      {/* Home indicator / navigation pill */}
      {platform === "ios" ? (
        <span
          className="pointer-events-none absolute bottom-2 left-1/2 z-40 block -translate-x-1/2 rounded-full"
          style={{ width: 134, height: 5, background: "var(--v-text)", opacity: 0.5 }}
        />
      ) : (
        <span
          className="pointer-events-none absolute bottom-1.5 left-1/2 z-40 block -translate-x-1/2 rounded-full"
          style={{ width: 106, height: 3.5, background: "var(--v-text)", opacity: 0.35 }}
        />
      )}
    </div>
  );
}
