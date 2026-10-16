import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Play, Search as SearchIcon, Sparkles } from "lucide-react";
import { useVibra } from "../store";
import { MOMENTS, TRACKS, trackById, type Moment } from "../data";
import { Art, Pill, Skeleton } from "../primitives";
import { TrackRow } from "../track-row";
import { DUR, EASE } from "../motion";

const GREETING = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
};

const DAY_LABEL = () => {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[new Date().getDay()];
};

// ─── Destination tile ─────────────────────────────────────────────────────────

function DestinationTile({
  moment,
  index,
  onSelect,
  selected,
}: {
  moment: Moment;
  index: number;
  onSelect: () => void;
  selected: boolean;
}) {
  const { m, accent } = useVibra();

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="group relative flex flex-col items-start overflow-hidden rounded-2xl px-5 py-5 text-left"
      style={{
        background: selected ? "rgba(139,92,246,0.18)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${selected ? `${accent}55` : "var(--v-border)"}`,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: selected ? `0 0 0 1px ${accent}33, 0 8px 32px rgba(0,0,0,0.4)` : "0 4px 20px rgba(0,0,0,0.25)",
        minHeight: 148,
        transition: "background 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease",
      }}
      {...m.stagger(index, 0.05, 0.08)}
      whileHover={m.reduced ? undefined : { y: -2, scale: 1.01 }}
      whileTap={m.reduced ? undefined : { scale: 0.98 }}
      transition={{ duration: DUR.button, ease: EASE }}
    >
      {/* Top: glyph */}
      <span
        className="mb-auto text-[36px] leading-none"
        style={{
          color: selected ? accent : "var(--v-text-3)",
          transition: "color 0.22s ease",
        }}
        aria-hidden
      >
        {moment.glyph}
      </span>

      {/* Bottom: label + caption */}
      <div className="mt-8">
        <p
          className="text-[15px] font-medium leading-tight"
          style={{
            color: "var(--v-text)",
            fontFamily: "Bricolage Grotesque, sans-serif",
            letterSpacing: "-0.02em",
          }}
        >
          {moment.label}
        </p>
        <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--v-text-3)" }}>
          {moment.caption}
        </p>
      </div>

      {/* Selection glow */}
      {selected && (
        <motion.span
          layoutId="tile-glow"
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{ background: `radial-gradient(ellipse at 20% 80%, ${accent}20 0%, transparent 60%)` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      )}
    </motion.button>
  );
}

// ─── Today's Pick ─────────────────────────────────────────────────────────────

function TodaysPick() {
  const { m, play, accent } = useVibra();
  const pick = trackById("t6");

  return (
    <motion.section {...m.riseIn(0.44)} className="mt-16">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p
            className="text-[10px] uppercase"
            style={{ color: "var(--v-text-3)", letterSpacing: "0.18em" }}
          >
            Today's Pick
          </p>
          <h2
            className="mt-1.5 text-[26px] font-semibold leading-tight"
            style={{ color: "var(--v-text)", fontFamily: "Bricolage Grotesque, sans-serif", letterSpacing: "-0.03em" }}
          >
            {pick.title}
          </h2>
        </div>
        <Pill tone="gold">
          <Sparkles size={11} />
          Hidden gem
        </Pill>
      </div>

      {/* Wide card */}
      <div
        className="flex gap-7 overflow-hidden rounded-2xl p-6"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid var(--v-border)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
        }}
      >
        {/* Artwork */}
        <motion.div {...m.settle(0.5)} className="shrink-0">
          <Art
            src={pick.art}
            alt={`${pick.album} artwork`}
            className="h-[200px] w-[200px]"
            radius={16}
            style={{ boxShadow: `0 16px 48px ${pick.tone}55` }}
          />
        </motion.div>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-[13px]" style={{ color: "var(--v-text-2)" }}>
            {pick.artist} · {pick.year}
          </p>

          <motion.p
            className="mt-3 max-w-lg text-[14px] leading-relaxed"
            style={{ color: "var(--v-text)", lineHeight: 1.65 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: m.reduced ? 0 : 0.7, ease: EASE }}
          >
            {pick.because} Sits between the two records you replayed most this month,
            short enough to finish in one sitting.
          </motion.p>

          {/* Stats */}
          <div
            className="mt-4 flex gap-5 text-[11px]"
            style={{ color: "var(--v-text-3)", borderTop: "1px solid var(--v-border)", paddingTop: 14 }}
          >
            <span>4,021 monthly listeners</span>
            <span>·</span>
            <span>Released 2025</span>
            <span>·</span>
            <span>3:53</span>
          </div>

          <div className="mt-5 flex gap-3">
            <motion.button
              type="button"
              onClick={() => play(pick.id)}
              className="flex items-center gap-2 px-5 text-[14px] font-medium"
              style={{
                height: 44,
                borderRadius: 999,
                background: accent,
                color: "#07070A",
                boxShadow: `0 8px 24px ${accent}38`,
              }}
              whileHover={m.reduced ? undefined : { scale: 1.03 }}
              whileTap={m.reduced ? undefined : { scale: 0.97 }}
              transition={{ duration: DUR.button, ease: EASE }}
            >
              <Play size={15} fill="#07070A" />
              Play now
            </motion.button>
            <button
              type="button"
              className="flex items-center gap-2 px-5 text-[13px]"
              style={{
                height: 44,
                borderRadius: 999,
                border: "1px solid var(--v-border)",
                background: "rgba(255,255,255,0.04)",
                color: "var(--v-text-2)",
              }}
            >
              + Save
            </button>
          </div>
        </div>
      </div>

      <p className="mt-3 px-1 text-[11px]" style={{ color: "var(--v-text-3)" }}>
        Chosen from {TRACKS.length * 1140} releases in the past 30 days.
      </p>
    </motion.section>
  );
}

// ─── Home screen ─────────────────────────────────────────────────────────────

export function HomeScreen() {
  const { m, go } = useVibra();
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const moment = MOMENTS.find((x) => x.id === selected);

  const tap = (id: string) => {
    if (selected === id) { setSelected(null); return; }
    setSelected(id);
    setLoading(true);
  };

  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => setLoading(false), m.reduced ? 240 : 680);
    return () => window.clearTimeout(t);
  }, [loading, selected, m.reduced]);

  return (
    <div className="mx-auto max-w-4xl px-10 py-12">
      {/* ─── Greeting ─── */}
      <motion.div {...m.riseIn(0)}>
        <p
          className="text-[10.5px] uppercase"
          style={{ color: "var(--v-text-3)", letterSpacing: "0.18em" }}
        >
          {GREETING()} · {DAY_LABEL()}
        </p>
        <h1
          className="mt-3 text-[48px] font-semibold leading-[1.06]"
          style={{
            color: "var(--v-text)",
            fontFamily: "Bricolage Grotesque, sans-serif",
            letterSpacing: "-0.035em",
          }}
        >
          What fits
          <br />
          today?
        </h1>
        <p className="mt-3 text-[15px]" style={{ color: "var(--v-text-2)" }}>
          Pick a direction, or just tell me.
        </p>
      </motion.div>

      {/* ─── Search shortcut ─── */}
      <motion.div className="mt-7" {...m.riseIn(0.06)}>
        <button
          type="button"
          onClick={() => go("search")}
          className="flex items-center gap-3 px-4 v-inset"
          style={{ height: 50, borderRadius: 999, maxWidth: 440, width: "100%" }}
        >
          <SearchIcon size={16} color="var(--v-text-3)" />
          <span className="text-[14px]" style={{ color: "var(--v-text-3)" }}>
            Describe a sound, a mood, a place…
          </span>
        </button>
      </motion.div>

      {/* ─── Destination tiles ─── */}
      <motion.div className="mt-12" {...m.riseIn(0.12)}>
        <p
          className="mb-4 text-[10px] uppercase"
          style={{ color: "var(--v-text-3)", letterSpacing: "0.18em" }}
        >
          Five ways in
        </p>
        <div className="grid grid-cols-5 gap-3">
          {MOMENTS.map((mo, i) => (
            <DestinationTile
              key={mo.id}
              moment={mo}
              index={i}
              onSelect={() => tap(mo.id)}
              selected={selected === mo.id}
            />
          ))}
        </div>
      </motion.div>

      {/* ─── Recommendations for selected tile ─── */}
      <AnimatePresence mode="wait">
        {moment && (
          <motion.div
            key={moment.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: m.reduced ? 0.18 : 0.36, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-8">
              <div className="mb-3 flex items-center gap-2">
                <Pill tone="accent">
                  <Sparkles size={10} /> {moment.caption}
                </Pill>
              </div>
              <div
                className="overflow-hidden rounded-2xl"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--v-border)",
                }}
              >
                {loading
                  ? [0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3.5 px-5 py-3">
                        <Skeleton style={{ width: 50, height: 50 }} radius={11} />
                        <div className="flex-1 space-y-2">
                          <Skeleton style={{ height: 10, width: "54%" }} radius={999} />
                          <Skeleton style={{ height: 8, width: "36%" }} radius={999} />
                        </div>
                      </div>
                    ))
                  : moment.seed.map((id, i) => (
                      <TrackRow key={id} track={trackById(id)} index={i} showReason />
                    ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Today's Pick ─── */}
      <TodaysPick />
    </div>
  );
}
