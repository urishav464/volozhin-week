// «אחרי השבוע» (`/after`, the reset, phase 3): the closed lessons whose «איך עבר» the viewer writes — their own (the
// lesson's handler, src/domain/handler.ts — the one rule), or, for an admin's «כל השיעורים», every one — in time order,
// each with where its window stands (src/domain/reviews.ts reviewWindow: «נפתח ב-…», open, or the date TBD). Pure; the
// page reads the reviews once (port.reviews.ofEdition) and draws these rows.
import { lessonHandler } from "./handler";
import { type ReviewWindow, reviewWindow } from "./reviews";
import type { Lesson, Week } from "./types";

export interface AfterRow {
  lesson: Lesson;
  handler: number | null;
  win: ReviewWindow;
}

/** My closed lessons (`all`: every closed lesson of the edition), by day, start and id. Never a memorial slot. */
export function afterRows(week: Pick<Week, "edition" | "lessons" | "lessonSpeakers" | "approaches">, viewer: number, all: boolean, nowIso: string): AfterRow[] {
  return week.lessons
    .filter((l) => l.kind === "lesson" && l.state === "closed")
    .sort((a, b) => a.day - b.day || a.start_min - b.start_min || a.id - b.id)
    .map((lesson) => ({ lesson, handler: lessonHandler(week, lesson.id), win: reviewWindow(week.edition, lesson, nowIso) }))
    .filter((r) => all || (r.handler != null && r.handler === viewer));
}

/** «נכתב: N · עוד לא נכתב: M» over the rows, given the lessons that have a review. */
export function afterCounts(rows: readonly AfterRow[], reviewed: ReadonlySet<number>): { written: number; missing: number } {
  const written = rows.filter((r) => reviewed.has(r.lesson.id)).length;
  return { written, missing: rows.length - written };
}
