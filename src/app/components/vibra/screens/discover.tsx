import { motion } from "motion/react";
import { Play } from "lucide-react";
import { useVibra } from "../store";
import { GENRES, trackById } from "../data";
import { Art, Pill } from "../primitives";
import { DUR, EASE } from "../motion";

const ISSUE_DATE = "September 2026";
const ISSUE_NUM = 34;

// ─── Editorial cards ──────────────────────────────────────────────────────────

function HeroCard() {
  const { play, m, accent } = useVibra();
  const track = trackById("t7");

  return (
    <motion.article
      className="group relative col-span-7 row-span-2 overflow-hidden rounded-2xl"
      style={{ minHeight: 380 }}
      {...m.riseIn(0.06)}
    >
      {/* Background art */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${track.art})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          transition: "transform 0.8s ease",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.8) 70%, rgba(0,0,0,0.92) 100%)",
        }}
      />

      <div className="absolute inset-0 flex flex-col justify-end p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="mb-3"><Pill tone="accent">Hidden Gems</Pill></div>
            <h2
              className="text-[32px] font-semibold leading-tight text-white"
              style={{ fontFamily: "Bricolage Grotesque, sans-serif", letterSpacing: "-0.03em" }}
            >
              {track.title}
            </h2>
            <p className="mt-2 text-[14px]" style={{ color: "rgba(255,255,255,0.7)" }}>
              {track.artist} · {track.album}
            </p>
            <p className="mt-3 max-w-sm text-[13px] leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
              {track.because}
            </p>
          </div>
          <motion.button
            type="button"
            onClick={() => play(track.id)}
            className="shrink-0 grid place-items-center rounded-full"
            style={{
              width: 56, height: 56,
              background: accent,
              boxShadow: `0 8px 24px ${accent}55`,
            }}
            whileHover={m.reduced ? undefined : { scale: 1.08 }}
            whileTap={m.reduced ? undefined : { scale: 0.94 }}
            transition={{ duration: DUR.button, ease: EASE }}
            aria-label={`Play ${track.title}`}
          >
            <Play size={22} fill="#07070A" color="#07070A" style={{ marginLeft: 2 }} />
          </motion.button>
        </div>
      </div>
    </motion.article>
  );
}

function PortraitCard({ trackId, kicker, delay }: { trackId: string; kicker: string; delay: number }) {
  const { play, m } = useVibra();
  const track = trackById(trackId);

  return (
    <motion.article
      className="group relative col-span-5 overflow-hidden rounded-2xl"
      style={{ minHeight: 185 }}
      {...m.riseIn(delay)}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${track.art})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(160deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.82) 100%)" }}
      />
      <div className="absolute inset-0 flex flex-col justify-end p-5">
        <p
          className="text-[10px] uppercase"
          style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "0.14em", marginBottom: 6 }}
        >
          {kicker}
        </p>
        <h3
          className="text-[16px] font-semibold text-white leading-tight"
          style={{ fontFamily: "Bricolage Grotesque, sans-serif", letterSpacing: "-0.02em" }}
        >
          {track.title}
        </h3>
        <p className="mt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.65)" }}>
          {track.artist}
        </p>
        <motion.button
          type="button"
          onClick={() => play(track.id)}
          className="mt-3 flex w-fit items-center gap-2 rounded-full px-4 text-[12px] font-medium"
          style={{ height: 32, background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)" }}
          whileHover={m.reduced ? undefined : { background: "rgba(255,255,255,0.22)" }}
          whileTap={m.reduced ? undefined : { scale: 0.97 }}
          transition={{ duration: 0.16, ease: EASE }}
          aria-label={`Play ${track.title}`}
        >
          <Play size={12} fill="#fff" color="#fff" />
          Play
        </motion.button>
      </div>
    </motion.article>
  );
}

function ListCard({
  title,
  kicker,
  tracks,
  delay,
}: {
  title: string;
  kicker: string;
  tracks: string[];
  delay: number;
}) {
  const { play, m } = useVibra();

  return (
    <motion.article
      className="col-span-4 overflow-hidden rounded-2xl p-5"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--v-border)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
      {...m.riseIn(delay)}
    >
      <p className="text-[10px] uppercase" style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}>
        {kicker}
      </p>
      <h3
        className="mt-2 text-[18px] font-semibold"
        style={{
          color: "var(--v-text)",
          fontFamily: "Bricolage Grotesque, sans-serif",
          letterSpacing: "-0.025em",
        }}
      >
        {title}
      </h3>

      <div className="mt-4 space-y-3">
        {tracks.slice(0, 3).map((id, i) => {
          const t = trackById(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => play(id)}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left"
              style={{ background: "transparent", transition: "background 0.16s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              aria-label={`Play ${t.title}`}
            >
              <Art src={t.art} alt={t.title} className="h-10 w-10 shrink-0" radius={9} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium" style={{ color: "var(--v-text)" }}>
                  {t.title}
                </p>
                <p className="truncate text-[11px]" style={{ color: "var(--v-text-3)" }}>
                  {t.artist}
                </p>
              </div>
              <span className="shrink-0 text-[11px]" style={{ color: "var(--v-text-3)" }}>
                {Math.floor(t.duration / 60)}:{String(t.duration % 60).padStart(2, "0")}
              </span>
            </button>
          );
        })}
      </div>
    </motion.article>
  );
}

// ─── Genre grid ───────────────────────────────────────────────────────────────

const GENRE_ICONS: Record<string, string> = {
  "Alté": "◈",
  "Neo-Soul": "◑",
  "Ambient Jazz": "◐",
  "Highlife": "◎",
  "Nordic Folk": "⌖",
  "Downtempo": "☾",
};

function GenreGrid() {
  const { m } = useVibra();

  return (
    <motion.section className="col-span-12 mt-2" {...m.riseIn(0.32)}>
      <p
        className="mb-4 text-[10px] uppercase"
        style={{ color: "var(--v-text-3)", letterSpacing: "0.18em" }}
      >
        Browse by genre
      </p>
      <div className="grid grid-cols-6 gap-3">
        {GENRES.map((g, i) => (
          <motion.button
            key={g.name}
            type="button"
            className="relative overflow-hidden rounded-xl px-4 py-5 text-left"
            style={{
              background: g.tone + "28",
              border: `1px solid ${g.tone}38`,
              backdropFilter: "blur(12px)",
            }}
            {...m.stagger(i, 0.04, 0.32)}
            whileHover={m.reduced ? undefined : { scale: 1.03 }}
            whileTap={m.reduced ? undefined : { scale: 0.97 }}
            transition={{ duration: DUR.button, ease: EASE }}
          >
            <span className="text-[22px]" aria-hidden>{GENRE_ICONS[g.name] ?? "◎"}</span>
            <p
              className="mt-2 text-[13px] font-medium leading-tight"
              style={{ color: "var(--v-text)", fontFamily: "Bricolage Grotesque, sans-serif" }}
            >
              {g.name}
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--v-text-3)" }}>
              {g.count} tracks
            </p>
          </motion.button>
        ))}
      </div>
    </motion.section>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export function DiscoverScreen() {
  const { m } = useVibra();

  return (
    <div className="mx-auto max-w-5xl px-10 py-12">
      {/* Header */}
      <motion.div
        {...m.riseIn(0)}
        className="mb-10 flex items-end justify-between"
      >
        <div>
          <p
            className="text-[10px] uppercase"
            style={{ color: "var(--v-text-3)", letterSpacing: "0.18em" }}
          >
            Issue {ISSUE_NUM} · {ISSUE_DATE}
          </p>
          <h1
            className="mt-3 text-[44px] font-semibold leading-tight"
            style={{
              color: "var(--v-text)",
              fontFamily: "Bricolage Grotesque, sans-serif",
              letterSpacing: "-0.035em",
            }}
          >
            Browse, explore,
            <br />
            fall in love.
          </h1>
        </div>
        <p className="max-w-xs text-right text-[14px] leading-relaxed" style={{ color: "var(--v-text-2)" }}>
          Six rooms, edited weekly.
          <br />
          Read a little, then listen.
        </p>
      </motion.div>

      {/* Magazine grid — 12-column */}
      <div className="grid grid-cols-12 gap-5">
        {/* Hero */}
        <HeroCard />

        {/* Side stack */}
        <PortraitCard trackId="t2" kicker="Around the World" delay={0.1} />
        <PortraitCard trackId="t5" kicker="Wind Down" delay={0.14} />

        {/* Row 2: three equal list cards */}
        <ListCard
          title="New This Week"
          kicker="Friday 26 Sep"
          tracks={["t8", "t1", "t5"]}
          delay={0.18}
        />
        <ListCard
          title="Editors' Picks"
          kicker="Chosen by the Vibra desk"
          tracks={["t3", "t7", "t4"]}
          delay={0.22}
        />
        <ListCard
          title="AI Surfaced"
          kicker="Low listeners, high signal"
          tracks={["t6", "t2", "t8"]}
          delay={0.26}
        />

        {/* Genre grid */}
        <GenreGrid />
      </div>
    </div>
  );
}
