import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search as SearchIcon, X } from "lucide-react";
import { useVibra } from "../store";
import { RECENT_SEARCHES, SEARCH_EXAMPLES, TRACKS, trackById } from "../data";
import { Inset, Pill, Skeleton } from "../primitives";
import { TrackRow } from "../track-row";
import { EASE } from "../motion";

/**
 * Natural-language search. The app shows its reading of the query as a quiet
 * line of text that crossfades — no chat bubbles, no assistant persona.
 */
export function SearchScreen() {
  const { m, accent } = useVibra();
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [focused, setFocused] = useState(false);

  const match = useMemo(() => {
    if (!committed) return null;
    const q = committed.toLowerCase();
    const example = SEARCH_EXAMPLES.find((e) => e.query.toLowerCase() === q);
    if (example) return example;

    const hits = TRACKS.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q),
    );
    return {
      query: committed,
      reading:
        hits.length > 0
          ? `Matched on title, artist and album · ${hits.length} result${hits.length > 1 ? "s" : ""}`
          : "Read as a mood · tempo and texture weighted over keywords",
      trackIds: (hits.length ? hits : TRACKS.slice(0, 3)).map((t) => t.id),
    };
  }, [committed]);

  const run = (q: string) => {
    setQuery(q);
    setCommitted(q);
    setThinking(true);
  };

  useEffect(() => {
    if (!thinking) return;
    const t = window.setTimeout(() => setThinking(false), m.reduced ? 220 : 640);
    return () => window.clearTimeout(t);
  }, [thinking, committed, m.reduced]);

  return (
    <div className="mx-auto max-w-2xl pb-10">
      <motion.div className="px-8 pt-10" {...m.riseIn(0)}>
        <h1
          className="text-[40px] font-semibold"
          style={{
            color: "var(--v-text)",
            lineHeight: 1.06,
            fontFamily: "Bricolage Grotesque, sans-serif",
            letterSpacing: "-0.03em",
          }}
        >
          Search
        </h1>

        {/* The field expands naturally on focus rather than jumping. */}
        <motion.div
          animate={{ scale: focused && !m.reduced ? 1.012 : 1 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="mt-5"
        >
          <Inset
            className="flex items-center gap-3 px-4"
            style={{
              height: 54,
              borderRadius: 999,
              boxShadow: focused ? `inset 3px 4px 10px var(--v-shade), 0 0 0 1.5px ${accent}66` : undefined,
            }}
          >
            <SearchIcon size={17} color={focused ? accent : "var(--v-text-3)"} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim()) run(query.trim());
              }}
              placeholder="Late-night jazz, songs like Tems…"
              aria-label="Search music in your own words"
              className="w-full bg-transparent text-[15px] outline-none"
              style={{ color: "var(--v-text)" }}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  setCommitted(null);
                }}
              >
                <X size={15} color="var(--v-text-3)" />
              </button>
            )}
          </Inset>
        </motion.div>
      </motion.div>

      {/* AI reading — crossfades between interpretations. */}
      <div className="px-8">
        <AnimatePresence mode="wait">
          {match && (
            <motion.div
              key={match.reading}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={m.crossfade}
              className="mt-5"
            >
              <p className="text-[11px] uppercase" style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}>
                Understood as
              </p>
              <p className="mt-2 text-[15px]" style={{ color: "var(--v-text)", lineHeight: 1.5 }}>
                {match.reading}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!committed ? (
        <div className="mt-8 space-y-9">
          <section>
            <p className="px-8 text-[11px] uppercase" style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}>
              Try asking for
            </p>
            <div className="mt-3.5 space-y-2 px-6">
              {SEARCH_EXAMPLES.map((e, i) => (
                <motion.button
                  key={e.query}
                  type="button"
                  onClick={() => run(e.query)}
                  className="block w-full text-left"
                  {...m.stagger(i, 0.06, 0.08)}
                  whileTap={m.reduced ? undefined : { scale: 0.99 }}
                >
                  <div
                    className="flex items-center justify-between gap-3 py-3.5"
                    style={{ borderBottom: "1px solid var(--v-border)" }}
                  >
                    <span className="text-[17px]" style={{ color: "var(--v-text)", letterSpacing: "-0.015em" }}>
                      {e.query}
                    </span>
                    <span style={{ color: "var(--v-text-3)", fontSize: 15 }} aria-hidden>
                      ↗
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>
          </section>

          <section>
            <p className="px-8 text-[11px] uppercase" style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}>
              Recent
            </p>
            <div className="mt-3.5 flex flex-wrap gap-2 px-6">
              {RECENT_SEARCHES.map((r, i) => (
                <motion.button key={r} type="button" onClick={() => run(r)} {...m.stagger(i, 0.04, 0.2)}>
                  <Pill>{r}</Pill>
                </motion.button>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="mt-7">
          {thinking ? (
            <div className="space-y-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3.5 px-6 py-2.5">
                  <Skeleton style={{ width: 54, height: 54 }} radius={12} />
                  <div className="flex-1 space-y-2">
                    <Skeleton style={{ height: 11, width: "58%" }} radius={999} />
                    <Skeleton style={{ height: 9, width: "38%" }} radius={999} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {match?.trackIds.map((id, i) => (
                <TrackRow key={id} track={trackById(id)} index={i} showReason />
              ))}
              <p className="mt-6 px-6 text-[12px]" style={{ color: "var(--v-text-3)", lineHeight: 1.6 }}>
                Not quite it? Add a detail — a decade, a tempo, a place — and
                search again.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
