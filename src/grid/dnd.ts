// Drag and drop — mouse (and pen) only, all of it in this one module.
//
// Touch never drags: on a phone or tablet a tap selects and a second tap
// places (the «שבץ» flow), which is also what the keyboard uses. That keeps a
// scroll gesture from ever moving a lesson by accident, and keeps this module
// small enough to own without a library.
//
// Sources and targets are plain DOM attributes, so any element can be one:
//   data-drag="speaker:12" | "pitch:7" | "lesson:31"
//   data-drop="cell:<day>:<start>:<end>" | "lesson:31" | "pool"
import { useEffect, useRef, useState } from "react";

export type DragItem = { kind: "speaker" | "pitch" | "lesson"; id: number };

export type DropTarget =
  | { kind: "cell"; day: number; start: number; end: number }
  | { kind: "lesson"; id: number }
  | { kind: "pool" };

export function parseDrop(value: string | null | undefined): DropTarget | null {
  if (!value) return null;
  const [kind, ...rest] = value.split(":");
  if (kind === "pool") return { kind: "pool" };
  if (kind === "lesson" && rest.length === 1) return { kind: "lesson", id: Number(rest[0]) };
  if (kind === "cell" && rest.length === 3) {
    const [day, start, end] = rest.map(Number);
    return { kind: "cell", day, start, end };
  }
  return null;
}

export function parseDrag(value: string | null | undefined): DragItem | null {
  if (!value) return null;
  const [kind, id] = value.split(":");
  if ((kind === "speaker" || kind === "pitch" || kind === "lesson") && id) return { kind, id: Number(id) };
  return null;
}

export interface DragState {
  item: DragItem;
  label: string;
  x: number;
  y: number;
  over: DropTarget | null;
  overKey: string | null;
}

const THRESHOLD = 5; // px of movement before a press becomes a drag (a click stays a click)
const EDGE = 56; // px from a scroll container's edge where dragging scrolls it
const SPEED = 14; // px per frame at the very edge

/**
 * Wire drag-and-drop for a subtree. `onDrop` gets the dragged item and the
 * target under the pointer. Returns the live drag state, for the ghost and for
 * highlighting the target.
 */
export function useMouseDrag(onDrop: (item: DragItem, target: DropTarget) => void): DragState | null {
  const [state, setState] = useState<DragState | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    let pending: { item: DragItem; label: string; x0: number; y0: number } | null = null;
    let active: DragState | null = null;
    let frame = 0;

    const targetAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
      const key = el?.dataset.drop ?? null;
      return { over: parseDrop(key), overKey: key };
    };

    // Near the top or bottom edge of a [data-autoscroll] container, scroll it,
    // so a lesson can be dragged from 17:30 to 08:30 on a laptop screen.
    const autoscroll = () => {
      frame = 0;
      if (!active) return;
      for (const el of document.querySelectorAll<HTMLElement>("[data-autoscroll]")) {
        const r = el.getBoundingClientRect();
        if (active.x < r.left || active.x > r.right) continue;
        const up = active.y - r.top;
        const down = r.bottom - active.y;
        if (up >= 0 && up < EDGE) el.scrollTop -= Math.ceil(SPEED * (1 - up / EDGE));
        else if (down >= 0 && down < EDGE) el.scrollTop += Math.ceil(SPEED * (1 - down / EDGE));
        else continue;
        active = { ...active, ...targetAt(active.x, active.y) };
        setState(active);
        frame = requestAnimationFrame(autoscroll);
        return;
      }
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      const src = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-drag]");
      const item = parseDrag(src?.dataset.drag);
      if (!src || !item) return;
      pending = { item, label: src.dataset.dragLabel ?? "", x0: e.clientX, y0: e.clientY };
    };

    const move = (e: PointerEvent) => {
      if (!pending && !active) return;
      if (pending && !active) {
        if (Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0) < THRESHOLD) return;
        document.body.style.userSelect = "none";
        active = { item: pending.item, label: pending.label, x: e.clientX, y: e.clientY, over: null, overKey: null };
      }
      if (active) {
        active = { ...active, x: e.clientX, y: e.clientY, ...targetAt(e.clientX, e.clientY) };
        setState(active);
        if (!frame) frame = requestAnimationFrame(autoscroll);
      }
    };

    const up = (e: PointerEvent) => {
      const finished = active;
      pending = null;
      active = null;
      document.body.style.userSelect = "";
      setState(null);
      if (!finished) return;
      const { over } = targetAt(e.clientX, e.clientY);
      if (over) onDropRef.current(finished.item, over);
      // Swallow the click that follows a drag, so dropping on a card does not also open it.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };

    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !active) return;
      pending = null;
      active = null;
      document.body.style.userSelect = "";
      setState(null);
    };

    window.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", cancel);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", cancel);
    };
  }, []);

  return state;
}
