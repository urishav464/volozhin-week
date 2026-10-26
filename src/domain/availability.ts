// Availability per slot (v14): a speaker's word on one lesson row of one day — «יכול/ה» (can), «לא» (cannot), or
// nothing said (no row: «לא ידוע»). Every reader asks here, so the grid's colouring, the chooser, the warnings, the
// pool's strip and the speaker sheet agree. A lesson or a cell that spans several rows (a merged night, a time split
// across rows) is judged over every row it covers: «לא» if any of them is «לא», «יכול/ה» only if all of them are.
import { rowActive } from "../grid/layout";
import type { Day } from "./time";
import type { Edition, GridRow, SlotAvailability } from "./types";

export type SlotKind = SlotAvailability["kind"];

/** One speaker's slots this edition, by `slotKey(day, row)`. */
export type SpeakerSlots = Map<string, SlotAvailability>;

export function slotKey(day: number, rowId: number): string {
  return `${day}:${rowId}`;
}

/** The lesson rows in play on a day — the rows a slot can be marked on (≡ app.lesson_rows), in time order. */
export function activeLessonRows(rows: readonly GridRow[], edition: Edition, day: Day): GridRow[] {
  return rows.filter((r) => r.kind === "lesson" && rowActive(r, day, edition)).sort((a, b) => a.start_min - b.start_min);
}

/** The day's active lesson rows that a range [start, end) touches. */
export function coveredRows(rows: readonly GridRow[], edition: Edition, day: Day, start: number, end: number): GridRow[] {
  return activeLessonRows(rows, edition, day).filter((r) => r.start_min < end && r.end_min > start);
}

/** Every speaker's slots, once per load. */
export function slotsBySpeaker(slots: readonly SlotAvailability[]): Map<number, SpeakerSlots> {
  const out = new Map<number, SpeakerSlots>();
  for (const v of slots) {
    let mine = out.get(v.speaker_id);
    if (!mine) out.set(v.speaker_id, (mine = new Map()));
    mine.set(slotKey(v.day, v.row_id), v);
  }
  return out;
}

/** What a speaker said about a range of rows: «לא» if any covered row is «לא»; «יכול/ה» only if every one is; else nothing. */
export function slotFit(mine: SpeakerSlots | undefined, day: Day, covered: readonly GridRow[]): SlotKind | null {
  if (!mine || covered.length === 0) return null;
  const kinds = covered.map((r) => mine.get(slotKey(day, r.id))?.kind ?? null);
  if (kinds.includes("cannot")) return "cannot";
  return kinds.every((k) => k === "can") ? "can" : null;
}

/** A day at a glance (the pool's strip): «לא» if any of its active rows is «לא», «יכול/ה» if any is «יכול/ה». */
export function dayKind(mine: SpeakerSlots | undefined, day: Day, active: readonly GridRow[]): SlotKind | null {
  if (!mine) return null;
  const kinds = active.map((r) => mine.get(slotKey(day, r.id))?.kind);
  return kinds.includes("cannot") ? "cannot" : kinds.includes("can") ? "can" : null;
}

/** A tap on a slot: nothing said → «יכול/ה» → «לא» → nothing said. */
export function nextKind(k: SlotKind | null): SlotKind | null {
  return k === null ? "can" : k === "can" ? "cannot" : null;
}
