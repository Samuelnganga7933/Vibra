/**
 * Vibra content. Fictional artists and releases, written as real editorial copy
 * so every screen reads like a shipping product rather than a wireframe.
 */

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: number;
  duration: number; // seconds
  art: string;
  /** Dominant artwork colour — drives the adaptive Now Playing background. */
  tone: string;
  /** Why Vibra surfaced this. Shown as AI reasoning, never as chat. */
  because: string;
}

const IMG = (id: string, size = 900) =>
  `https://images.unsplash.com/photo-${id}?w=${size}&h=${size}&fit=crop&auto=format&q=80`;

export const TRACKS: Track[] = [
  {
    id: "t1",
    title: "Slow Water",
    artist: "Néa Osei",
    album: "Tidal Rooms",
    year: 2026,
    duration: 254,
    art: IMG("1698191373970-228c25ee6fd0"),
    tone: "#B4622C",
    because: "You keep returning to warm, unhurried percussion after 9pm.",
  },
  {
    id: "t2",
    title: "Harmattan",
    artist: "Kweku Lane",
    album: "Dust & Gold",
    year: 2025,
    duration: 221,
    art: IMG("1774386513122-d70499fb0953"),
    tone: "#2F7D4E",
    because: "Shares the loose Lagos drum programming you saved twice this month.",
  },
  {
    id: "t3",
    title: "Cassette Sunday",
    artist: "Marisol Vane",
    album: "Long Way Round",
    year: 2026,
    duration: 198,
    art: IMG("1536138746221-2c489206ff6c"),
    tone: "#4A4A52",
    because: "A quieter cousin of the soul records you finish start to finish.",
  },
  {
    id: "t4",
    title: "Blue Hour Traffic",
    artist: "Isa Fontaine",
    album: "Night Errands",
    year: 2024,
    duration: 276,
    art: IMG("1625916308278-c8b2b269ebc4"),
    tone: "#3C6E9B",
    because: "Matches your Tuesday commute listening almost exactly.",
  },
  {
    id: "t5",
    title: "Paper Lanterns",
    artist: "Yuna Ito",
    album: "Small Ceremonies",
    year: 2026,
    duration: 187,
    art: IMG("1748723594339-46dc3e25e329"),
    tone: "#8A8C86",
    because: "For the wind-down hour — no drums past the first minute.",
  },
  {
    id: "t6",
    title: "Bitter Orange",
    artist: "Delta Ferrer",
    album: "Bitter Orange",
    year: 2025,
    duration: 233,
    art: IMG("1651776493054-083b8f14a930"),
    tone: "#9A5B3C",
    because: "Only 4,000 monthly listeners. You tend to find these early.",
  },
  {
    id: "t7",
    title: "Cedar Smoke",
    artist: "Théo Marchand",
    album: "Rue Basse",
    year: 2026,
    duration: 301,
    art: IMG("1673100131941-227f0fb32d80"),
    tone: "#6B5A3E",
    because: "Late-night jazz with the upright bass mixed forward, as you prefer.",
  },
  {
    id: "t8",
    title: "Northbound",
    artist: "Halden Frost",
    album: "Northbound",
    year: 2026,
    duration: 245,
    art: IMG("1681473937206-dae584b0808a"),
    tone: "#7E8890",
    because: "Released three days ago by an artist you follow.",
  },
];

export const trackById = (id: string) => TRACKS.find((t) => t.id === id) ?? TRACKS[0];

export const formatTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export interface Moment {
  id: string;
  glyph: string;
  label: string;
  caption: string;
  seed: string[];
}

export const MOMENTS: Moment[] = [
  {
    id: "focus",
    glyph: "◎",
    label: "Help me Focus",
    caption: "Instrumental, steady tempo, no vocals",
    seed: ["t5", "t7", "t4"],
  },
  {
    id: "wind",
    glyph: "☾",
    label: "Wind Down",
    caption: "Softer than your average evening",
    seed: ["t5", "t3", "t1"],
  },
  {
    id: "surprise",
    glyph: "↗",
    label: "Surprise Me",
    caption: "One step outside your taste",
    seed: ["t6", "t8", "t2"],
  },
  {
    id: "world",
    glyph: "⌖",
    label: "Take Me Somewhere New",
    caption: "Highlife, Ethio-jazz, Nordic folk",
    seed: ["t2", "t7", "t6"],
  },
  {
    id: "mood",
    glyph: "♡",
    label: "Match My Mood",
    caption: "Reads your last few hours of listening",
    seed: ["t1", "t4", "t3"],
  },
];

export interface Section {
  id: string;
  title: string;
  kicker: string;
  layout: "feature" | "wide" | "grid" | "genres";
  trackIds: string[];
}

export const DISCOVER_SECTIONS: Section[] = [
  {
    id: "gems",
    title: "Hidden Gems",
    kicker: "Under 10,000 listeners",
    layout: "feature",
    trackIds: ["t6", "t7", "t3"],
  },
  {
    id: "world",
    title: "Around the World",
    kicker: "Accra · Lisbon · Osaka",
    layout: "wide",
    trackIds: ["t2", "t5", "t1", "t7"],
  },
  {
    id: "new",
    title: "New This Week",
    kicker: "Friday, 31 July",
    layout: "grid",
    trackIds: ["t8", "t1", "t5", "t2"],
  },
  {
    id: "editors",
    title: "Editors' Picks",
    kicker: "Chosen by the Vibra desk",
    layout: "wide",
    trackIds: ["t3", "t4", "t6", "t8"],
  },
  {
    id: "genres",
    title: "Genres",
    kicker: "23 rooms",
    layout: "genres",
    trackIds: [],
  },
  {
    id: "ai",
    title: "AI Picks",
    kicker: "Built from 214 listens this month",
    layout: "grid",
    trackIds: ["t7", "t2", "t4", "t6"],
  },
];

export const GENRES = [
  { name: "Alté", count: 148, tone: "#2F7D4E" },
  { name: "Neo-Soul", count: 92, tone: "#9A5B3C" },
  { name: "Ambient Jazz", count: 76, tone: "#3C6E9B" },
  { name: "Highlife", count: 64, tone: "#B4622C" },
  { name: "Nordic Folk", count: 51, tone: "#7E8890" },
  { name: "Downtempo", count: 118, tone: "#6B5A3E" },
];

export const EDITORIAL: Record<string, string> = {
  t6: "Delta Ferrer recorded Bitter Orange in a Valencia stairwell. You can hear the room.",
  t7: "A late-night quartet that never plays the same arrangement twice.",
  t3: "Marisol Vane's second record trades the horns for a single upright piano.",
};

export interface SearchExample {
  query: string;
  reading: string;
  trackIds: string[];
}

/** Natural-language searches, each with the app's plain-language interpretation. */
export const SEARCH_EXAMPLES: SearchExample[] = [
  {
    query: "Songs like Tems",
    reading: "Warm alté vocals · restrained drums · Lagos-adjacent production",
    trackIds: ["t2", "t1", "t6"],
  },
  {
    query: "Music for studying",
    reading: "Instrumental · 60–80 bpm · no sudden dynamics",
    trackIds: ["t5", "t7", "t4"],
  },
  {
    query: "Late-night jazz",
    reading: "Acoustic quartets · recorded after midnight · upright bass forward",
    trackIds: ["t7", "t3", "t5"],
  },
  {
    query: "Artists before they blow up",
    reading: "Under 10k listeners · rising 40%+ this month",
    trackIds: ["t6", "t8", "t2"],
  },
  {
    query: "Something for a long drive at dusk",
    reading: "Mid-tempo · wide stereo · 4+ minute runtimes",
    trackIds: ["t4", "t1", "t8"],
  },
];

export const RECENT_SEARCHES = ["Néa Osei", "rainy morning piano", "Dust & Gold", "highlife 2026"];

export interface Playlist {
  id: string;
  name: string;
  note: string;
  count: number;
  art: string;
}

export const PLAYLISTS: Playlist[] = [
  { id: "p1", name: "Kitchen Mornings", note: "Updated yesterday", count: 42, art: IMG("1748723594339-46dc3e25e329", 400) },
  { id: "p2", name: "Long Way Round", note: "For the drive north", count: 68, art: IMG("1625916308278-c8b2b269ebc4", 400) },
  { id: "p3", name: "Found on Vibra", note: "Auto-updating", count: 115, art: IMG("1774386513122-d70499fb0953", 400) },
  { id: "p4", name: "Sunday Reset", note: "Updated 3 days ago", count: 27, art: IMG("1536138746221-2c489206ff6c", 400) },
];

export const ARTISTS = [
  { id: "a1", name: "Néa Osei", art: IMG("1716569355086-6caed45f6855", 400), listeners: "1.2M" },
  { id: "a2", name: "Kweku Lane", art: IMG("1627456060888-efca82dcfe58", 400), listeners: "840K" },
  { id: "a3", name: "Marisol Vane", art: IMG("1544248298-b9b251b67f72", 400), listeners: "410K" },
  { id: "a4", name: "Théo Marchand", art: IMG("1618674782816-1c1c777bd2c1", 400), listeners: "96K" },
  { id: "a5", name: "Delta Ferrer", art: IMG("1735512464310-67b784bddc12", 400), listeners: "4K" },
  { id: "a6", name: "Yuna Ito", art: IMG("1667361354275-9cf7a063f849", 400), listeners: "220K" },
];

export const ONBOARDING_TASTES = [
  "Alté", "Neo-Soul", "Ambient Jazz", "Highlife", "Nordic Folk", "Downtempo",
  "Ethio-Jazz", "Bossa Nova", "Dream Pop", "Afrobeats", "Piano", "Field Recordings",
];
