import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motionKit, type MotionKit } from "./motion";
import { TRACKS, trackById, type Track } from "./data";

// ─── Settings ────────────────────────────────────────────────────────────────

export type ThemeMode = "light" | "dark" | "oled" | "system";
export type ResolvedTheme = "light" | "dark" | "oled";
export type AccentName = "green" | "blue" | "orange" | "red" | "custom";
export type BackgroundKind = "gradient" | "video" | "album" | "static" | "none";
export type VideoScene = "rain" | "ocean" | "forest" | "clouds" | "aurora" | "space" | "city";

export const ACCENTS: Record<AccentName, string> = {
  green: "#8B5CF6",   // violet
  blue: "#22D3EE",    // cyan
  orange: "#EC4899",  // pink
  red: "#F59E0B",     // amber
  custom: "#C9A961",
};

export const ACCENT_DISPLAY: Record<AccentName, string> = {
  green: "Violet",
  blue: "Cyan",
  orange: "Pink",
  red: "Amber",
  custom: "Custom",
};

export const VIDEO_SCENES: { id: VideoScene; label: string; note: string }[] = [
  { id: "rain", label: "Rain", note: "Window, evening" },
  { id: "ocean", label: "Ocean", note: "Slow swell" },
  { id: "forest", label: "Forest", note: "Canopy light" },
  { id: "clouds", label: "Clouds", note: "High altitude" },
  { id: "aurora", label: "Aurora", note: "Northern drift" },
  { id: "space", label: "Space", note: "Near-still" },
  { id: "city", label: "City Night", note: "Distant traffic" },
];

export interface Settings {
  theme: ThemeMode;
  accent: AccentName;
  customAccent: string;
  background: BackgroundKind;
  scene: VideoScene;
  motion: number; // background motion intensity, 0–1
  transparency: number; // 0–1
  radius: number; // px
  neumorphism: boolean;
  reducedMotion: boolean;
  compact: boolean;
  largeText: boolean;
  batterySaver: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  accent: "green",
  customAccent: "#C9A961",
  background: "gradient",
  scene: "rain",
  motion: 0.45,
  transparency: 0.7,
  radius: 22,
  neumorphism: true,
  reducedMotion: false,
  compact: false,
  largeText: false,
  batterySaver: false,
};

// ─── Player ──────────────────────────────────────────────────────────────────

export type Screen =
  | "splash"
  | "login"
  | "onboarding"
  | "home"
  | "discover"
  | "search"
  | "library"
  | "profile"
  | "appearance"
  | "backgrounds";

export type Tab = "home" | "discover" | "search" | "library" | "profile";

interface Store {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resolvedTheme: ResolvedTheme;
  accent: string;
  /** True when motion should be reduced — either the setting or the OS. */
  reduced: boolean;
  m: MotionKit;
  /** Background motion actually allowed right now (battery saver pauses it). */
  bgActive: boolean;

  screen: Screen;
  go: (screen: Screen) => void;
  tab: Tab;

  track: Track;
  playing: boolean;
  progress: number; // seconds
  liked: Record<string, boolean>;
  queue: Track[];
  hasStarted: boolean;

  play: (id?: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  toggleLike: (id?: string) => void;
  setQueue: (tracks: Track[]) => void;
  reorderQueue: (from: number, to: number) => void;

  nowPlayingOpen: boolean;
  setNowPlayingOpen: (open: boolean) => void;
  queueOpen: boolean;
  setQueueOpen: (open: boolean) => void;
}

const Ctx = createContext<Store | null>(null);

export function useVibra() {
  const store = useContext(Ctx);
  if (!store) throw new Error("useVibra must be used inside <VibraProvider>");
  return store;
}

const TAB_FOR: Partial<Record<Screen, Tab>> = {
  home: "home",
  discover: "discover",
  search: "search",
  library: "library",
  profile: "profile",
  appearance: "profile",
  backgrounds: "profile",
};

export function VibraProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [systemDark, setSystemDark] = useState(true);
  const [osReduced, setOsReduced] = useState(false);

  const [screen, setScreen] = useState<Screen>("splash");
  const [track, setTrack] = useState<Track>(TRACKS[0]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [liked, setLiked] = useState<Record<string, boolean>>({ t3: true, t7: true });
  const [queue, setQueueState] = useState<Track[]>(TRACKS.slice(1, 6));
  const [hasStarted, setHasStarted] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  // Respect the OS for the "System" theme option and for Reduce Motion.
  useEffect(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setSystemDark(dark.matches);
      setOsReduced(rm.matches);
    };
    sync();
    dark.addEventListener("change", sync);
    rm.addEventListener("change", sync);
    return () => {
      dark.removeEventListener("change", sync);
      rm.removeEventListener("change", sync);
    };
  }, []);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const resolvedTheme: ResolvedTheme =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  const accent = settings.accent === "custom" ? settings.customAccent : ACCENTS[settings.accent];
  const reduced = settings.reducedMotion || osReduced;
  const m = useMemo(() => motionKit(reduced), [reduced]);

  // Playback clock.
  const trackRef = useRef(track);
  trackRef.current = track;
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setProgress((p) => (p + 1 >= trackRef.current.duration ? 0 : p + 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing]);

  const play = useCallback((id?: string) => {
    if (id) {
      setTrack(trackById(id));
      setProgress(0);
    }
    setPlaying(true);
    setHasStarted(true);
  }, []);

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const next = useCallback(() => {
    const q = queueRef.current;
    if (!q.length) return;
    const [head, ...rest] = q;
    setQueueState([...rest, head]);
    setTrack(head);
    setProgress(0);
    setPlaying(true);
  }, []);

  /** First press restarts the track; a second press steps back. */
  const prev = useCallback(() => {
    if (progressRef.current > 3) {
      setProgress(0);
      return;
    }
    const i = TRACKS.findIndex((t) => t.id === trackRef.current.id);
    setTrack(TRACKS[(i - 1 + TRACKS.length) % TRACKS.length]);
    setProgress(0);
  }, []);

  const toggleLike = useCallback((id?: string) => {
    const key = id ?? trackRef.current.id;
    setLiked((l) => ({ ...l, [key]: !l[key] }));
  }, []);

  const reorderQueue = useCallback((from: number, to: number) => {
    setQueueState((q) => {
      const copy = [...q];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  }, []);

  const go = useCallback((next: Screen) => {
    setScreen(next);
    setNowPlayingOpen(false);
    setQueueOpen(false);
  }, []);

  const value: Store = {
    settings,
    set,
    resolvedTheme,
    accent,
    reduced,
    m,
    bgActive: !settings.batterySaver && !reduced && settings.motion > 0.02,
    screen,
    go,
    tab: TAB_FOR[screen] ?? "home",
    track,
    playing,
    progress,
    liked,
    queue,
    hasStarted,
    play,
    toggle: () => {
      setPlaying((p) => !p);
      setHasStarted(true);
    },
    next,
    prev,
    seek: setProgress,
    toggleLike,
    setQueue: setQueueState,
    reorderQueue,
    nowPlayingOpen,
    setNowPlayingOpen,
    queueOpen,
    setQueueOpen,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
