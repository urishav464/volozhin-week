// The topics axis of a day (the «ציר צבעים»): its lesson time in order, cut into
// pieces — a lesson (or lessons side by side) or a stretch nobody holds yet — and
// into blocks wherever a meal or «מכריכה לכריכה» breaks the day. Memorial rows and
// slots are not on it: they are not topics. Computed once per load (model.ts).
import type { Day } from "../domain/time";
import type { Week } from "../domain/types";
import { rowActive } from "./layout";

export interface AxisLesson {
  id: number;
  state: "closed" | "draft";
  /** A closed lesson's topic; a draft has none yet. */
  categoryId: number | null;
}

/** A stretch of the day: [] = free; 2+ lessons = they overlap (parallel). */
export interface AxisPiece {
  start: number;
  end: number;
  lessons: AxisLesson[];
}

/** Pieces with no gap between them; a gap (a meal, מכריכה לכריכה) starts the next block. */
export interface AxisBlock {
  start: number;
  end: number;
  pieces: AxisPiece[];
}

export function topicAxis(week: Pick<Week, "rows" | "lessons" | "edition">, day: Day): AxisBlock[] {
  const rows = week.rows.filter((r) => r.kind === "lesson" && rowActive(r, day, week.edition)).sort((a, b) => a.start_min - b.start_min);
  const lessons = week.lessons
    .filter((l) => l.day === day && l.kind === "lesson" && l.state !== "cancelled")
    .sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);

  // 1. lessons that overlap are one piece
  const groups: AxisPiece[] = [];
  for (const l of lessons) {
    const x: AxisLesson = { id: l.id, state: l.state === "closed" ? "closed" : "draft", categoryId: l.state === "closed" ? l.category_id : null };
    const g = groups[groups.length - 1];
    if (g && l.start_min < g.end) {
      g.lessons.push(x);
      g.end = Math.max(g.end, l.end_min);
    } else groups.push({ start: l.start_min, end: l.end_min, lessons: [x] });
  }

  // 2. what no lesson covers of each lesson row is free
  const free: AxisPiece[] = [];
  for (const r of rows) {
    let at = r.start_min;
    for (const g of groups) {
      if (g.end <= at || g.start >= r.end_min) continue;
      if (g.start > at) free.push({ start: at, end: g.start, lessons: [] });
      at = Math.max(at, g.end);
    }
    if (at < r.end_min) free.push({ start: at, end: r.end_min, lessons: [] });
  }

  // 3. in time order; a gap starts a block
  const blocks: AxisBlock[] = [];
  for (const p of [...groups, ...free].sort((a, b) => a.start - b.start)) {
    const b = blocks[blocks.length - 1];
    if (b && p.start <= b.end) {
      b.pieces.push(p);
      b.end = Math.max(b.end, p.end);
    } else blocks.push({ start: p.start, end: p.end, pieces: [p] });
  }
  return blocks;
}
