import type { CSSProperties, ReactNode } from "react";
import { Reorder, useDragControls } from "motion/react";
import { GripVertical } from "lucide-react";

/**
 * Drag-to-reorder for playlists and queues (mouse and touch alike — HTML5
 * drag-and-drop never fires on touchscreens, which is why these lists felt
 * frozen on phones).
 *
 * Rows only start a drag from their grip handle (`dragListener={false}`), so
 * list scrolling, taps-to-play and the player's pull-down gesture keep working
 * on the row itself.
 */

/** Derives the single move that turned `prev` into `next` — by reference, so
    duplicate ids inside one playlist can't confuse it. */
export function moveFromReorder<T>(prev: T[], next: T[]): { from: number; to: number } | null {
  if (prev.length !== next.length) return null;
  let first = -1, last = -1;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== next[i]) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  // The moved item is the one that left `first` for `last` (dragged down) —
  // otherwise the one that arrived at `first` from `last` (dragged up).
  if (next[last] === prev[first]) return { from: first, to: last };
  if (next[first] === prev[last]) return { from: last, to: first };
  return null;
}

export function ReorderList<T>({ values, onReorder, style, children }: {
  values: T[];
  onReorder: (next: T[]) => void;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <Reorder.Group as="div" axis="y" values={values} onReorder={onReorder} style={style}>
      {children}
    </Reorder.Group>
  );
}

/** One reorderable row: content via render-prop, grip handle injected where
    the surface wants it (right-hand control cluster, per the old design). */
export function ReorderRow<T>({ value, label, style, itemProps, children }: {
  value: T;
  label: string;
  style?: CSSProperties;
  itemProps?: Record<string, any>;
  children: (grip: ReactNode) => ReactNode;
}) {
  const controls = useDragControls();
  const grip = (
    <button
      type="button"
      aria-label={`Reorder ${label}`}
      onPointerDown={e => { e.stopPropagation(); controls.start(e); }}
      onClick={e => e.stopPropagation()}
      style={{
        touchAction: "none",
        cursor: "grab",
        background: "none",
        border: "none",
        padding: "2px 3px",
        display: "grid",
        placeItems: "center",
        color: "var(--dim)",
        flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
      }}>
      <GripVertical size={14} />
    </button>
  );
  return (
    <Reorder.Item
      as="div"
      value={value}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.01, zIndex: 30 }}
      style={style}
      {...itemProps}>
      {children(grip)}
    </Reorder.Item>
  );
}
