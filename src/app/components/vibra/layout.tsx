import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Compass, Home, Library, Search, Settings } from "lucide-react";
import { useVibra, type Tab } from "./store";
import { AmbientBackground } from "./ambient";
import { NowPlaying, WebPlayerBar } from "./player";
import { HomeScreen } from "./screens/home";
import { DiscoverScreen } from "./screens/discover";
import { SearchScreen } from "./screens/search";
import { LibraryScreen } from "./screens/library";
import { ProfileScreen } from "./screens/profile";
import { AppearanceScreen, BackgroundScreen } from "./screens/settings";
import { LoginScreen, OnboardingScreen, SplashScreen, VibraMark } from "./screens/entry";
import { EASE } from "./motion";

const SCREENS = {
  home:        HomeScreen,
  discover:    DiscoverScreen,
  search:      SearchScreen,
  library:     LibraryScreen,
  profile:     ProfileScreen,
  appearance:  AppearanceScreen,
  backgrounds: BackgroundScreen,
  splash:      SplashScreen,
  login:       LoginScreen,
  onboarding:  OnboardingScreen,
} as const;

const ENTRY_SCREENS = new Set(["splash", "login", "onboarding"]);

const NAV: { id: Tab; label: string; Icon: typeof Home }[] = [
  { id: "home",     label: "Home",     Icon: Home },
  { id: "discover", label: "Discover", Icon: Compass },
  { id: "search",   label: "Search",   Icon: Search },
  { id: "library",  label: "Library",  Icon: Library },
];

export function WebLayout() {
  const { screen, resolvedTheme, accent, settings, m } = useVibra();
  const isEntry = ENTRY_SCREENS.has(screen);

  return (
    <div
      data-vibra={resolvedTheme}
      className="relative h-screen w-screen overflow-hidden"
      style={
        {
          background: "var(--v-bg)",
          color: "var(--v-text)",
          "--v-accent-live": accent,
          "--v-radius": `${settings.radius}px`,
          "--v-lift": settings.neumorphism ? 1 : 0.4,
        } as React.CSSProperties
      }
    >
      <AmbientBackground />

      {isEntry ? (
        <AnimatePresence mode="wait">
          <motion.div key={screen} {...m.screen} className="relative z-10 h-full w-full">
            {React.createElement(SCREENS[screen as keyof typeof SCREENS])}
          </motion.div>
        </AnimatePresence>
      ) : (
        <div className="relative z-10 flex h-screen overflow-hidden">
          <Sidebar />

          <main
            id="vibra-main"
            className="v-scroll relative flex-1 overflow-y-auto"
            style={{ paddingBottom: 80 }}
          >
            <AnimatePresence mode="wait">
              <motion.div key={screen} {...m.screen}>
                {React.createElement(SCREENS[screen as keyof typeof SCREENS])}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      )}

      {!isEntry && <WebPlayerBar />}
      <NowPlaying />
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar() {
  const { tab, go, accent } = useVibra();

  return (
    <aside
      className="relative z-20 flex h-screen w-[220px] shrink-0 flex-col"
      style={{
        background: "rgba(9, 9, 13, 0.86)",
        backdropFilter: "blur(40px) saturate(1.3)",
        WebkitBackdropFilter: "blur(40px) saturate(1.3)",
        borderRight: "1px solid var(--v-border)",
      }}
    >
      {/* Logo */}
      <div className="px-5 pb-6 pt-7">
        <button
          type="button"
          onClick={() => go("home")}
          className="flex items-center gap-2.5"
          aria-label="Go to Home"
        >
          <VibraMark size={26} />
          <span
            className="text-[18px] font-semibold tracking-tight"
            style={{
              color: "var(--v-text)",
              fontFamily: "Bricolage Grotesque, sans-serif",
              letterSpacing: "-0.04em",
            }}
          >
            vibra
          </span>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2.5" aria-label="Main navigation">
        {NAV.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              aria-current={active ? "page" : undefined}
              className="relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
              style={{ color: active ? "var(--v-text)" : "var(--v-text-2)" }}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-bg"
                  className="absolute inset-0 rounded-xl"
                  style={{ background: `${accent}18` }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <Icon
                size={17}
                color={active ? accent : "var(--v-text-3)"}
                strokeWidth={active ? 2.2 : 1.7}
                className="relative shrink-0"
              />
              <span
                className="relative text-[13.5px]"
                style={{ fontWeight: active ? 500 : 400, letterSpacing: "-0.01em" }}
              >
                {label}
              </span>
              {active && (
                <motion.span
                  layoutId="sidebar-dot"
                  className="relative ml-auto block rounded-full"
                  style={{ width: 5, height: 5, background: accent, flexShrink: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, background: "var(--v-border)", margin: "0 16px 12px" }} />

      {/* Profile row */}
      <div className="px-2.5 pb-5">
        <button
          type="button"
          onClick={() => go("profile")}
          className="relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5"
          style={{ color: tab === "profile" ? "var(--v-text)" : "var(--v-text-2)" }}
        >
          {tab === "profile" && (
            <motion.span
              layoutId="sidebar-bg"
              className="absolute inset-0 rounded-xl"
              style={{ background: `${accent}18` }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          )}
          <div
            className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full"
            style={{ border: `1.5px solid ${tab === "profile" ? accent : "var(--v-border-strong)"}` }}
          >
            <img
              src="https://images.unsplash.com/photo-1628345868536-de082a3babf5?w=56&h=56&fit=crop&auto=format&q=80"
              alt="Amara"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="relative min-w-0 flex-1 text-left">
            <p
              className="truncate text-[13px]"
              style={{ color: "var(--v-text)", fontWeight: 500 }}
            >
              Amara
            </p>
            <p className="truncate text-[11px]" style={{ color: "var(--v-text-3)" }}>
              @amarab
            </p>
          </div>
          <Settings size={14} color="var(--v-text-3)" className="relative shrink-0" />
        </button>
      </div>
    </aside>
  );
}
