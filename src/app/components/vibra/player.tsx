import { useState } from "react";
import { AnimatePresence, motion, Reorder } from "motion/react";
import {
  ChevronDown,
  GripVertical,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import { useVibra } from "./store";
import { formatTime } from "./data";
import { Art, IconButton } from "./primitives";
import { DUR, EASE, SHARED_SPRING } from "./motion";
import { EqualiserBars } from "./track-row";

// ─── Web player bar ───────────────────────────────────────────────────────────

export function WebPlayerBar() {
  const {
    track, playing, toggle, next, prev, progress, seek,
    liked, toggleLike, accent, hasStarted, setNowPlayingOpen, m,
  } = useVibra();
  const [volume, setVolume] = useState(0.75);
  const pct = (progress / track.duration) * 100;
  const isLiked = Boolean(liked[track.id]);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30"
      style={{
        background: "rgba(7, 7, 10, 0.92)",
        backdropFilter: "blur(44px) saturate(1.4)",
        WebkitBackdropFilter: "blur(44px) saturate(1.4)",
        borderTop: "1px solid var(--v-border)",
      }}
    >
      {/* Scrubable progress line */}
      <div className="group relative h-[3px] cursor-pointer" style={{ background: "var(--v-border)" }}>
        <div
          className="h-full transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%`, background: accent }}
        />
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={track.duration}
          value={progress}
          onChange={(e) => seek(Number(e.target.value))}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
        />
        {/* Dot appears on hover */}
        <div
          className="pointer-events-none absolute -top-[4.5px] hidden h-3 w-3 rounded-full group-hover:block"
          style={{ left: `calc(${pct}% - 6px)`, background: accent }}
        />
      </div>

      {/* Main row */}
      <div className="flex h-[72px] items-center gap-6 px-6">
        {/* Left — track info */}
        <div className="flex w-[280px] shrink-0 items-center gap-3">
          {hasStarted ? (
            <>
              <button
                type="button"
                onClick={() => setNowPlayingOpen(true)}
                aria-label={`Open now playing: ${track.title}`}
                className="shrink-0"
              >
                <motion.div layoutId="player-art" transition={SHARED_SPRING} style={{ borderRadius: 10 }}>
                  <Art src={track.art} alt={track.title} className="h-12 w-12" radius={10} />
                </motion.div>
              </button>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[13px] font-medium"
                  style={{ color: "var(--v-text)", letterSpacing: "-0.01em" }}
                >
                  {track.title}
                </p>
                <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--v-text-3)" }}>
                  {track.artist}
                </p>
              </div>
              <IconButton
                label={isLiked ? "Remove from Liked Songs" : "Add to Liked Songs"}
                tone="bare"
                size={32}
                onClick={() => toggleLike()}
              >
                <Heart
                  size={15}
                  color={isLiked ? accent : "var(--v-text-3)"}
                  fill={isLiked ? accent : "transparent"}
                />
              </IconButton>
            </>
          ) : (
            <p className="text-[13px]" style={{ color: "var(--v-text-3)" }}>
              Select something to play
            </p>
          )}
        </div>

        {/* Center — transport */}
        <div className="flex flex-1 flex-col items-center gap-1">
          <div className="flex items-center gap-1.5">
            <IconButton label="Shuffle" tone="bare" size={34}>
              <Shuffle size={14} color="var(--v-text-3)" />
            </IconButton>
            <IconButton label="Previous" tone="bare" size={36} onClick={prev}>
              <SkipBack
                size={18}
                fill={hasStarted ? "var(--v-text)" : "var(--v-text-3)"}
                color={hasStarted ? "var(--v-text)" : "var(--v-text-3)"}
              />
            </IconButton>
            <IconButton label={playing ? "Pause" : "Play"} tone="accent" size={44} onClick={toggle}>
              {playing ? (
                <Pause size={18} fill="#07070A" color="#07070A" />
              ) : (
                <Play size={18} fill="#07070A" color="#07070A" style={{ marginLeft: 2 }} />
              )}
            </IconButton>
            <IconButton label="Next" tone="bare" size={36} onClick={next}>
              <SkipForward
                size={18}
                fill={hasStarted ? "var(--v-text)" : "var(--v-text-3)"}
                color={hasStarted ? "var(--v-text)" : "var(--v-text-3)"}
              />
            </IconButton>
            <IconButton label="Repeat" tone="bare" size={34}>
              <Repeat size={14} color="var(--v-text-3)" />
            </IconButton>
          </div>
          {hasStarted && (
            <div
              className="flex items-center gap-1.5 text-[10px] tabular-nums"
              style={{ color: "var(--v-text-3)" }}
            >
              <span>{formatTime(progress)}</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{formatTime(track.duration)}</span>
            </div>
          )}
        </div>

        {/* Right — volume + queue */}
        <div className="flex w-[280px] shrink-0 items-center justify-end gap-2">
          <IconButton
            label="Open queue"
            tone="bare"
            size={34}
            onClick={() => hasStarted && setNowPlayingOpen(true)}
          >
            <ListMusic size={15} color="var(--v-text-3)" />
          </IconButton>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <Volume2 size={15} color="var(--v-text-3)" />
            <div className="group relative h-1 w-20 cursor-pointer rounded-full" style={{ background: "var(--v-border-strong)" }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${volume * 100}%`, background: "var(--v-text-2)", transition: "width 0.1s" }}
              />
              <input
                type="range"
                aria-label="Volume"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="absolute inset-0 w-full cursor-pointer opacity-0"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Now Playing (web modal) ──────────────────────────────────────────────────

export function NowPlaying() {
  const {
    track, playing, toggle, next, prev, progress, seek,
    liked, toggleLike, m, accent, nowPlayingOpen, setNowPlayingOpen,
    setQueueOpen, resolvedTheme,
  } = useVibra();

  const pct = (progress / track.duration) * 100;
  const isLiked = Boolean(liked[track.id]);

  return (
    <AnimatePresence>
      {nowPlayingOpen && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: m.reduced ? 0.18 : DUR.screen, ease: EASE }}
        >
          {/* Backdrop */}
          <motion.button
            type="button"
            aria-label="Close now playing"
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setNowPlayingOpen(false)}
          />

          {/* Dialog */}
          <motion.div
            className="relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl"
            initial={{ opacity: 0, scale: m.reduced ? 1 : 0.93, y: m.reduced ? 0 : 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: m.reduced ? 1 : 0.96, y: m.reduced ? 0 : 10 }}
            transition={{ duration: m.reduced ? 0.2 : DUR.nav, ease: EASE }}
          >
            {/* Tonal wash */}
            <div className="absolute inset-0" style={{ background: "var(--v-bg)" }} />
            <motion.div
              className="absolute inset-0"
              animate={{ backgroundColor: track.tone, opacity: resolvedTheme === "light" ? 0.18 : 0.3 }}
              transition={m.bg}
              style={{
                maskImage: "linear-gradient(180deg, #000 0%, transparent 70%)",
                WebkitMaskImage: "linear-gradient(180deg, #000 0%, transparent 70%)",
              }}
            />
            <motion.div
              key={track.id}
              className="absolute inset-x-0 top-0 h-1/2"
              animate={{ opacity: resolvedTheme === "light" ? 0.2 : 0.38 }}
              transition={m.bg}
              style={{
                backgroundImage: `url(${track.art})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(60px) saturate(1.4)",
              }}
            />

            {/* Content */}
            <div className="relative flex gap-8 p-8">
              {/* Left: artwork */}
              <div className="shrink-0">
                <motion.div
                  layoutId="player-art"
                  transition={SHARED_SPRING}
                  style={{ borderRadius: 22, width: 260, height: 260 }}
                >
                  <Art
                    src={track.art}
                    alt={`${track.album} artwork`}
                    className="h-[260px] w-[260px]"
                    radius={22}
                    style={{ boxShadow: `0 28px 64px ${track.tone}44, 0 8px 24px rgba(0,0,0,0.5)` }}
                  />
                </motion.div>
                {/* Playing-from label below art */}
                <p className="mt-4 text-center text-[11px] uppercase" style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}>
                  {track.album}
                </p>
              </div>

              {/* Right: controls */}
              <div className="flex flex-1 flex-col">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h2
                      className="text-[28px] font-semibold leading-tight"
                      style={{ color: "var(--v-text)", fontFamily: "Bricolage Grotesque, sans-serif", letterSpacing: "-0.03em" }}
                    >
                      {track.title}
                    </h2>
                    <p className="mt-1 text-[15px]" style={{ color: "var(--v-text-2)" }}>
                      {track.artist}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton label={isLiked ? "Unlike" : "Like"} tone="bare" size={36} onClick={() => toggleLike()}>
                      <Heart
                        size={18}
                        color={isLiked ? accent : "var(--v-text-2)"}
                        fill={isLiked ? accent : "transparent"}
                      />
                    </IconButton>
                    <IconButton label="Share" tone="bare" size={36} onClick={() => {}}>
                      <Share2 size={16} color="var(--v-text-2)" />
                    </IconButton>
                    <IconButton label="Close now playing" tone="bare" size={36} onClick={() => setNowPlayingOpen(false)}>
                      <X size={17} color="var(--v-text-2)" />
                    </IconButton>
                  </div>
                </div>

                {/* Because */}
                <p className="mt-4 text-[13px] leading-relaxed" style={{ color: "var(--v-text-3)" }}>
                  {track.because}
                </p>

                {/* Scrubber */}
                <div className="mt-auto pt-6">
                  <div className="relative h-5">
                    <div
                      className="absolute left-0 right-0 top-1/2 -translate-y-1/2 rounded-full"
                      style={{ height: 4, background: "var(--v-border-strong)" }}
                    />
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full"
                      style={{ height: 4, width: `${pct}%`, background: accent, transition: "width 1s linear" }}
                    />
                    <input
                      type="range"
                      aria-label="Seek"
                      min={0}
                      max={track.duration}
                      value={progress}
                      onChange={(e) => seek(Number(e.target.value))}
                      className="absolute inset-0 w-full cursor-pointer opacity-0"
                    />
                    <div
                      className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        left: `calc(${pct}% - 6px)`,
                        width: 12,
                        height: 12,
                        background: "var(--v-text)",
                        transition: "left 1s linear",
                      }}
                    />
                  </div>
                  <div
                    className="mt-1.5 flex justify-between text-[11px] tabular-nums"
                    style={{ color: "var(--v-text-3)" }}
                  >
                    <span>{formatTime(progress)}</span>
                    <span>-{formatTime(track.duration - progress)}</span>
                  </div>
                </div>

                {/* Transport */}
                <div className="mt-5 flex items-center justify-between">
                  <IconButton label="Shuffle" tone="bare" size={40}>
                    <Shuffle size={17} color="var(--v-text-2)" />
                  </IconButton>
                  <IconButton label="Previous" tone="bare" size={48} onClick={prev}>
                    <SkipBack size={24} fill="var(--v-text)" color="var(--v-text)" />
                  </IconButton>
                  <IconButton label={playing ? "Pause" : "Play"} tone="accent" size={64} onClick={toggle}>
                    {playing ? (
                      <Pause size={24} fill="#07070A" color="#07070A" />
                    ) : (
                      <Play size={24} fill="#07070A" color="#07070A" style={{ marginLeft: 3 }} />
                    )}
                  </IconButton>
                  <IconButton label="Next" tone="bare" size={48} onClick={next}>
                    <SkipForward size={24} fill="var(--v-text)" color="var(--v-text)" />
                  </IconButton>
                  <IconButton label="Repeat" tone="bare" size={40}>
                    <Repeat size={17} color="var(--v-text-2)" />
                  </IconButton>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <p className="text-[11px]" style={{ color: "var(--v-text-3)" }}>
                    Playing from <span style={{ color: "var(--v-text-2)" }}>Liked Songs</span>
                  </p>
                  <IconButton
                    label="Open queue"
                    tone="bare"
                    size={36}
                    onClick={() => setQueueOpen(true)}
                  >
                    <ListMusic size={16} color="var(--v-text-2)" />
                  </IconButton>
                </div>
              </div>
            </div>
          </motion.div>

          <QueueSheet />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Queue sheet ─────────────────────────────────────────────────────────────

export function QueueSheet() {
  const { queue, setQueue, queueOpen, setQueueOpen, m, track, playing, play } = useVibra();

  return (
    <AnimatePresence>
      {queueOpen && (
        <>
          <motion.button
            type="button"
            aria-label="Close queue"
            className="absolute inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.5)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
            onClick={() => setQueueOpen(false)}
          />
          <motion.div
            className="absolute inset-y-0 right-0 z-50 flex w-[340px] flex-col"
            style={{
              background: "rgba(12, 10, 20, 0.94)",
              backdropFilter: "blur(40px)",
              WebkitBackdropFilter: "blur(40px)",
              borderLeft: "1px solid var(--v-border)",
            }}
            initial={{ x: m.reduced ? 0 : "100%", opacity: m.reduced ? 0 : 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: m.reduced ? 0 : "100%", opacity: m.reduced ? 0 : 1 }}
            transition={m.reduced ? { duration: 0.2 } : { type: "spring", stiffness: 300, damping: 30 }}
          >
            <div className="flex items-center justify-between px-6 pb-4 pt-6">
              <div>
                <h2 className="text-[20px] font-semibold" style={{ color: "var(--v-text)" }}>
                  Queue
                </h2>
                <p className="mt-0.5 text-[12px]" style={{ color: "var(--v-text-3)" }}>
                  {queue.length} up next · drag to reorder
                </p>
              </div>
              <IconButton label="Close queue" tone="bare" size={34} onClick={() => setQueueOpen(false)}>
                <X size={16} color="var(--v-text-2)" />
              </IconButton>
            </div>

            <div className="px-6 pb-4" style={{ borderBottom: "1px solid var(--v-border)" }}>
              <p className="text-[10px] uppercase" style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}>
                Now playing
              </p>
              <div className="mt-3 flex items-center gap-3">
                <Art src={track.art} alt={track.title} className="h-11 w-11" radius={10} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]" style={{ color: "var(--v-text)" }}>
                    {track.title}
                  </p>
                  <p className="truncate text-[11px]" style={{ color: "var(--v-text-3)" }}>
                    {track.artist}
                  </p>
                </div>
                {playing && <EqualiserBars />}
              </div>
            </div>

            <div className="v-scroll flex-1 overflow-y-auto px-6 pb-8 pt-4">
              <p className="text-[10px] uppercase" style={{ color: "var(--v-text-3)", letterSpacing: "0.14em" }}>
                Next up
              </p>
              <Reorder.Group axis="y" values={queue} onReorder={setQueue} className="mt-3 space-y-1">
                {queue.map((t) => (
                  <Reorder.Item
                    key={t.id}
                    value={t}
                    className="flex cursor-default items-center gap-3 rounded-xl px-2 py-1.5"
                    whileDrag={{ scale: 1.02, cursor: "grabbing", background: "var(--v-elevated)" }}
                    transition={{ duration: 0.22, ease: EASE }}
                  >
                    <button
                      type="button"
                      onClick={() => play(t.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      aria-label={`Play ${t.title}`}
                    >
                      <Art src={t.art} alt={t.title} className="h-10 w-10" radius={9} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px]" style={{ color: "var(--v-text)" }}>
                          {t.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px]" style={{ color: "var(--v-text-3)" }}>
                          {t.artist}
                        </span>
                      </span>
                    </button>
                    <span className="cursor-grab px-1" aria-hidden>
                      <GripVertical size={15} color="var(--v-text-3)" />
                    </span>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Keep MiniPlayer exported so shell.tsx import still compiles (it's unused on web)
export function MiniPlayer() {
  return null;
}
