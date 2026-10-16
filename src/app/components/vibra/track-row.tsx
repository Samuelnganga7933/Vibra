import { motion } from "motion/react";
import { Heart, Play } from "lucide-react";
import { useVibra } from "./store";
import { formatTime, type Track } from "./data";
import { Art } from "./primitives";
import { EASE } from "./motion";

export function TrackRow({
  track,
  index,
  showReason = false,
  compactArt = false,
}: {
  track: Track;
  index?: number;
  showReason?: boolean;
  compactArt?: boolean;
}) {
  const { play, m, liked, toggleLike, track: current, playing, settings } = useVibra();
  const isCurrent = current.id === track.id;
  const size = compactArt || settings.compact ? 44 : 54;

  return (
    <motion.div
      className="flex items-center gap-3.5 px-6 py-2.5"
      {...(index === undefined ? {} : m.stagger(index))}
    >
      <button
        type="button"
        onClick={() => play(track.id)}
        aria-label={`Play ${track.title} by ${track.artist}`}
        className="group relative shrink-0"
        style={{ width: size, height: size }}
      >
        <Art src={track.art} alt={`${track.album} artwork`} radius={12} className="h-full w-full" />
        <motion.span
          className="absolute inset-0 grid place-items-center"
          style={{ borderRadius: 12, background: "rgba(0,0,0,0.42)" }}
          initial={{ opacity: 0 }}
          whileHover={{ opacity: 1 }}
          transition={{ duration: 0.15, ease: EASE }}
        >
          <Play size={16} fill="#fff" color="#fff" />
        </motion.span>
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isCurrent && playing && <EqualiserBars />}
          <p
            className="truncate text-[15px]"
            style={{ color: isCurrent ? "var(--v-accent-live)" : "var(--v-text)" }}
          >
            {track.title}
          </p>
        </div>
        <p className="mt-0.5 truncate text-[13px]" style={{ color: "var(--v-text-2)" }}>
          {track.artist} · {track.album}
        </p>
        {showReason && (
          <p className="mt-1 truncate text-[12px]" style={{ color: "var(--v-text-3)" }}>
            {track.because}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => toggleLike(track.id)}
        aria-label={liked[track.id] ? `Unlike ${track.title}` : `Like ${track.title}`}
        aria-pressed={Boolean(liked[track.id])}
        className="shrink-0 p-1"
      >
        <motion.span
          className="block"
          animate={{ scale: liked[track.id] ? 1 : 1 }}
          whileTap={m.reduced ? undefined : { scale: 0.82 }}
          transition={{ duration: 0.14, ease: EASE }}
        >
          <Heart
            size={17}
            color={liked[track.id] ? "var(--v-accent-live)" : "var(--v-text-3)"}
            fill={liked[track.id] ? "var(--v-accent-live)" : "transparent"}
          />
        </motion.span>
      </button>
      <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "var(--v-text-3)" }}>
        {formatTime(track.duration)}
      </span>
    </motion.div>
  );
}

/** Three quiet bars. The only continuously moving element in a list. */
export function EqualiserBars() {
  const { m } = useVibra();
  return (
    <span className="flex items-end gap-[2px]" style={{ height: 11 }} aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          style={{ width: 2, borderRadius: 1, background: "var(--v-accent-live)" }}
          animate={m.reduced ? { height: 6 } : { height: [4, 11, 6, 9, 4] }}
          transition={
            m.reduced
              ? { duration: 0 }
              : { duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 }
          }
        />
      ))}
    </span>
  );
}
