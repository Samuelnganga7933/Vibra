/**
 * locale.ts — the browser's initial market locale.
 *
 * Captured once on first launch (navigator.language, e.g. "ko-KR") and kept
 * stable for the session's life: discovery and the Home feed send it as a
 * `locale` query parameter so a brand-new account sees its local charts
 * before any play telemetry exists. Nothing here fixes one language — the
 * territory/language subtags drive the market.
 */

const LOCALE_KEY = "vibra_locale";

// Territory code → market name (mirrors backend/market.py for the offline
// fallback path only — the server is the source of truth when reachable).
const TERRITORIES: Record<string, string> = {
  AR: "Argentina", AT: "Austria", AU: "Australia", BE: "Belgium", BG: "Bulgaria",
  BR: "Brazil", CA: "Canada", CH: "Switzerland", CL: "Chile", CO: "Colombia",
  CZ: "Czech Republic", DE: "Germany", DK: "Denmark", EG: "Egypt", ES: "Spain",
  FI: "Finland", FR: "France", GB: "the UK", GH: "Ghana", GR: "Greece",
  HK: "Hong Kong", HU: "Hungary", ID: "Indonesia", IE: "Ireland", IL: "Israel",
  IN: "India", IS: "Iceland", IT: "Italy", JP: "Japan", KE: "Kenya",
  KR: "South Korea", MA: "Morocco", MX: "Mexico", MY: "Malaysia", NG: "Nigeria",
  NL: "the Netherlands", NO: "Norway", NZ: "New Zealand", PE: "Peru",
  PH: "the Philippines", PK: "Pakistan", PL: "Poland", PT: "Portugal",
  RO: "Romania", RS: "Serbia", RU: "Russia", SA: "Saudi Arabia", SE: "Sweden",
  SG: "Singapore", SI: "Slovenia", SK: "Slovakia", TH: "Thailand", TR: "Turkey",
  TW: "Taiwan", TZ: "Tanzania", UA: "Ukraine", UG: "Uganda", US: "the US",
  VN: "Vietnam", ZA: "South Africa",
};

const LANGUAGE_MARKETS: Record<string, string> = {
  ar: "Egypt", de: "Germany", en: "Kenya", es: "Spain", fi: "Finland",
  fr: "France", hi: "India", id: "Indonesia", it: "Italy", ja: "Japan",
  ko: "South Korea", ms: "Malaysia", nl: "Netherlands", pl: "Poland",
  pt: "Brazil", sv: "Sweden", sw: "Kenya", th: "Thailand", tr: "Turkey",
  vi: "Vietnam", zh: "China",
};

/** Vibra's home market — used when a locale carries no usable signal. */
export const DEFAULT_MARKET = "Kenya";

/** The locale captured on first launch; stable afterwards. */
export function getInitialLocale(): string {
  const detected = (typeof navigator !== "undefined"
    ? navigator.language || navigator.languages?.[0] || ""
    : "") || "en";
  try {
    const saved = window.localStorage.getItem(LOCALE_KEY);
    if (saved) return saved;
    window.localStorage.setItem(LOCALE_KEY, detected);
    return detected;
  } catch {
    return detected;
  }
}

/** `locale=…` query fragment for backend discovery endpoints. */
export function localeParam(): string {
  return `locale=${encodeURIComponent(getInitialLocale())}`;
}

/** Market name for a locale ("Popular in {market}" shelves and seeds). */
export function marketLabel(locale: string = getInitialLocale()): string {
  const parts = locale.replace("_", "-").split("-");
  const language = (parts[0] || "").toLowerCase();
  const territory = parts.slice(1).find(p => p.length === 2 && /^[a-z]+$/i.test(p))?.toUpperCase();
  if (territory && TERRITORIES[territory]) return TERRITORIES[territory];
  if (language && LANGUAGE_MARKETS[language]) return LANGUAGE_MARKETS[language];
  return DEFAULT_MARKET;
}

/**
 * Market-biased engine query for the offline fallback path — same
 * music-scoped phrasing as the backend ("Kenya top songs", not the loose
 * "popular in …" wording that drags news and travel videos in).
 */
export function marketChartQuery(locale: string = getInitialLocale()): string {
  return `${marketLabel(locale)} top songs`;
}
