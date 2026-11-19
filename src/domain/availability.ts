// Availability per slot (v14): a speaker's word on one lesson row of one day — «יכול/ה» (can), «לא» (cannot), or
// nothing said (no row: «לא ידוע»). Every reader asks here, so the grid's colouring, the chooser, the warnings, the
// pool's strip and the speaker sheet agree. A lesson or a cell that spans several rows (a merged night, a time split
// across rows) is judged over every row it covers: «לא» if any of them is «לא», «יכול/ה» only if all of them are.
// v18: a day's slots can also be typed as time ranges — `rangesToSlots` turns them into the same slots.
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

/**
 * v18: availability typed as a time range — an INPUT method only (the slots stay the one store): «יכול/ה» or «לא»
 * from `start` to `end`, minutes of the grid's day (06:30 = 390 … 06:30 the next morning = 1830; a night hour belongs
 * to the day before it).
 */
export interface AvailabilityRange {
  day: Day;
  start: number;
  end: number;
  kind: SlotKind;
}

/**
 * What a set of ranges marks, row by row (≡ public.set_availability_ranges, and the v6→v14 conversion's rule): for
 * every lesson row in play on each of `days`, «לא» if ANY cannot-range touches the row at all; else «יכול/ה» if ONE
 * can-range covers the row whole (two adjacent ranges never unite); else `rest` — and no mark when that is null. A range
 * of a day outside `days` is not looked at. No validation (cleanAvailabilityRanges, src/data/speakerRules.ts, is the
 * command's); by day, then the row's start.
 */
export function rangesToSlots(
  rows: readonly GridRow[],
  edition: Edition,
  days: readonly Day[],
  ranges: readonly AvailabilityRange[],
  rest: SlotKind | null,
): { day: Day; row_id: number; kind: SlotKind }[] {
  const out: { day: Day; row_id: number; kind: SlotKind }[] = [];
  for (const day of [...new Set(days)].sort((a, b) => a - b)) {
    const mine = ranges.filter((r) => r.day === day);
    for (const row of activeLessonRows(rows, edition, day)) {
      const kind: SlotKind | null = mine.some((r) => r.kind === "cannot" && r.start < row.end_min && r.end > row.start_min)
        ? "cannot"
        : mine.some((r) => r.kind === "can" && r.start <= row.start_min && r.end >= row.end_min)
          ? "can"
          : rest;
      if (kind != null) out.push({ day, row_id: row.id, kind });
    }
  }
  return out;
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

/** A day at a glance: «can» / «cannot» when its marked rows all say so, «some» when it holds both — «יכול/ה רק בשעות…». */
export type DayKind = SlotKind | "some";

/**
 * A day at a glance (the pool's strip, «מתאים/ה ליום»): what its active rows say — «some» for «יכול/ה» on part of the day
 * and «לא» on the rest (the ranges editor's «רק בשעות…» always writes it so), null when nothing is said.
 */
export function dayKind(mine: SpeakerSlots | undefined, day: Day, active: readonly GridRow[]): DayKind | null {
  if (!mine) return null;
  const kinds = active.map((r) => mine.get(slotKey(day, r.id))?.kind);
  const can = kinds.includes("can");
  const cannot = kinds.includes("cannot");
  return can && cannot ? "some" : cannot ? "cannot" : can ? "can" : null;
}

/** A tap on a slot: nothing said → «יכול/ה» → «לא» → nothing said. */
export function nextKind(k: SlotKind | null): SlotKind | null {
  return k === null ? "can" : k === "can" ? "cannot" : null;
}
