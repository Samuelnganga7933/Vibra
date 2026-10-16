import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownToLine, Clock, Disc3, Heart, ListMusic, Mic2 } from "lucide-react";
import { useVibra } from "../store";
import { ARTISTS, PLAYLISTS, TRACKS, trackById } from "../data";
import { Art, Card, Inset } from "../primitives";
import { TrackRow } from "../track-row";
import { EASE } from "../motion";

const TABS = [
  { id: "playlists", label: "Playlists", icon: ListMusic },
  { id: "liked", label: "Liked", icon: Heart },
  { id: "albums", label: "Albums", icon: Disc3 },
  { id: "artists", label: "Artists", icon: Mic2 },
  { id: "downloads", label: "Downloads", icon: ArrowDownToLine },
  { id: "history", label: "History", icon: Clock },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function LibraryScreen() {
  const { m, liked, play } = useVibra();
  const [tab, setTab] = useState<TabId>("playlists");

  const likedTracks = TRACKS.filter((t) => liked[t.id]);

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <motion.div className="px-8 pt-10" {...m.riseIn(0)}>
        <h1
          className="text-[40px] font-semibold"
          style={{ color: "var(--v-text)", lineHeight: 1.06, fontFamily: "Bricolage Grotesque, sans-serif", letterSpacing: "-0.03em" }}
        >
          Library
        </h1>
      </motion.div>

      <div className="v-scroll mt-5 flex gap-2 overflow-x-auto px-8 pb-1">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTab(t.id)}
              className={`relative shrink-0 ${on ? "" : "v-raised-soft"}`}
              style={{
                padding: "9px 15px",
                borderRadius: 999,
                fontSize: 13,
                color: on ? "var(--v-bg)" : "var(--v-text-2)",
                background: on ? "var(--v-text)" : undefined,
                transition: "color 200ms, background 200ms",
              }}
            >
              <span className="flex items-center gap-1.5">
                <t.icon size={13} /> {t.label}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: m.reduced ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: m.reduced ? 0.16 : 0.28, ease: EASE }}
          className="mt-6"
        >
          {tab === "playlists" && (
            <div className="grid grid-cols-2 gap-3 px-6">
              {PLAYLISTS.map((p, i) => (
                <motion.div key={p.id} {...m.stagger(i, 0.05)}>
                  <Card soft className="p-2.5" onClick={() => play("t3")} label={p.name}>
                    <Art src={p.art} alt={`${p.name} cover`} className="aspect-square w-full" radius={14} />
                    <div className="px-1 pb-1 pt-3">
                      <p className="truncate text-[14px]" style={{ color: "var(--v-text)" }}>
                        {p.name}
                      </p>
                      <p className="mt-0.5 text-[12px]" style={{ color: "var(--v-text-3)" }}>
                        {p.count} tracks · {p.note}
                      </p>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}

          {tab === "liked" && (
            <div>
              <div className="px-6">
                <Inset className="flex items-center gap-4 px-5 py-4">
                  <span
                    className="grid place-items-center rounded-full"
                    style={{ width: 40, height: 40, background: "var(--v-card)" }}
                  >
                    <Heart size={16} color="var(--v-accent-live)" fill="var(--v-accent-live)" />
                  </span>
                  <div>
                    <p className="text-[15px]" style={{ color: "var(--v-text)" }}>
                      Liked Songs
                    </p>
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--v-text-3)" }}>
                      {likedTracks.length} tracks · synced
                    </p>
                  </div>
                </Inset>
              </div>
              <div className="mt-4">
                {likedTracks.length ? (
                  likedTracks.map((t, i) => <TrackRow key={t.id} track={t} index={i} />)
                ) : (
                  <EmptyState
                    title="Nothing liked yet"
                    note="Tap the heart on any track and it will collect here."
                  />
                )}
              </div>
            </div>
          )}

          {tab === "albums" && (
            <div className="space-y-1">
              {TRACKS.slice(0, 6).map((t, i) => (
                <motion.button
                  key={t.id}
                  type="button"
                  onClick={() => play(t.id)}
                  className="flex w-full items-center gap-4 px-6 py-2.5 text-left"
                  {...m.stagger(i)}
                >
                  <Art src={t.art} alt={`${t.album} artwork`} className="h-[56px] w-[56px]" radius={12} />
                  <div className="min-w-0">
                    <p className="truncate text-[15px]" style={{ color: "var(--v-text)" }}>
                      {t.album}
                    </p>
                    <p className="mt-0.5 truncate text-[13px]" style={{ color: "var(--v-text-2)" }}>
                      {t.artist} · {t.year}
                    </p>
                  </div>
                </motion.button>
              ))}
            </div>
          )}

          {tab === "artists" && (
            <div className="grid grid-cols-3 gap-3.5 px-6">
              {ARTISTS.map((a, i) => (
                <motion.button key={a.id} type="button" className="text-center" {...m.stagger(i, 0.04)}>
                  <Art src={a.art} alt={a.name} radius={999} className="aspect-square w-full" />
                  <p className="mt-2.5 truncate text-[12px]" style={{ color: "var(--v-text)" }}>
                    {a.name}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--v-text-3)" }}>
                    {a.listeners}
                  </p>
                </motion.button>
              ))}
            </div>
          )}

          {tab === "downloads" && (
            <div>
              <p className="px-6 text-[12px]" style={{ color: "var(--v-text-3)" }}>
                3 albums · 1.4 GB · available offline
              </p>
              <div className="mt-3">
                {["t3", "t7", "t1"].map((id, i) => (
                  <TrackRow key={id} track={trackById(id)} index={i} />
                ))}
              </div>
            </div>
          )}

          {tab === "history" && (
            <div>
              {[
                { label: "Today", ids: ["t1", "t6"] },
                { label: "Yesterday", ids: ["t4", "t2", "t7"] },
              ].map((group) => (
                <div key={group.label} className="mb-6">
                  <p
                    className="px-6 text-[11px] uppercase"
                    style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}
                  >
                    {group.label}
                  </p>
                  <div className="mt-2">
                    {group.ids.map((id, i) => (
                      <TrackRow key={id} track={trackById(id)} index={i} compactArt />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Calm empty / error state: a fading icon and one explanatory line. No shake. */
export function EmptyState({
  title,
  note,
  glyph = "◌",
}: {
  title: string;
  note: string;
  glyph?: string;
}) {
  const { m } = useVibra();
  return (
    <motion.div
      className="flex flex-col items-center px-10 py-14 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: m.reduced ? 0.16 : 0.4, ease: EASE }}
    >
      <motion.span
        className="text-[26px]"
        style={{ color: "var(--v-text-3)" }}
        animate={m.reduced ? {} : { opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      >
        {glyph}
      </motion.span>
      <p className="mt-4 text-[16px]" style={{ color: "var(--v-text)" }}>
        {title}
      </p>
      <p className="mt-2 text-[13px]" style={{ color: "var(--v-text-3)", lineHeight: 1.6 }}>
        {note}
      </p>
    </motion.div>
  );
}
