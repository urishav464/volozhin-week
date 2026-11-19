// «התקדמות» as a table (the reset, phase 3): one row per lesson — the closed ones, and drafts someone is pitched in —
// with the lesson page's six steps (src/screens/lesson/steps.ts pageSteps: the same states and notes the page shows),
// in time order, and the table's three filters. Pure: no stage logic of its own.
import type { Day } from "../../domain/time";
import type { Lesson } from "../../domain/types";
import { LIVE_PITCH } from "../../domain/types";
import type { GridModel } from "../../grid/model";
import { lessonOwner } from "../../grid/owners";
import { type PageStepView, pageSteps } from "../lesson/steps";

export interface ProgressRow {
  lesson: Lesson;
  /** A draft with a live candidate (its first two steps are the call and the closing). */
  draft: boolean;
  /** Who handles it: the «אחריות» lens's rule (a draft's first live pitch). */
  handler: number | null;
  steps: PageStepView[];
}

export interface ProgressFilter {
  day: Day | null;
  /** «רק מה שחסר»: a step left to do or waited on, or a lesson that changed after the message. */
  missing: boolean;
  /** A handler's lessons, «none» the lessons nobody handles, null everyone's. */
  handler: number | "none" | null;
}

export const NO_FILTER: ProgressFilter = { day: null, missing: false, handler: null };

/** The rows, by day, start and id: closed lessons, and drafts with a live pitch (a bare draft is the grid's, not a lesson yet). */
export function progressRows(model: GridModel): ProgressRow[] {
  return model.week.lessons
    .filter((l) => l.kind === "lesson" && (l.state === "closed" || (l.state === "draft" && (model.pitchesByLesson.get(l.id) ?? []).some((p) => LIVE_PITCH.has(p.state)))))
    .sort((a, b) => a.day - b.day || a.start_min - b.start_min || a.id - b.id)
    .map((lesson) => ({ lesson, draft: lesson.state === "draft", handler: lessonOwner(model, lesson), steps: pageSteps(model, lesson) }));
}

/** Something is left on the row: a step open, waiting or a problem — or the lesson changed after its message. */
export function rowMissing(row: Pick<ProgressRow, "lesson" | "steps">): boolean {
  return row.lesson.needs_reconfirm || row.steps.some((s) => s.state === "open" || s.state === "waiting" || s.state === "problem");
}

export function filterProgress(rows: readonly ProgressRow[], f: ProgressFilter): ProgressRow[] {
  return rows.filter(
    (r) =>
      (f.day == null || r.lesson.day === f.day) &&
      (!f.missing || rowMissing(r)) &&
      (f.handler == null || (f.handler === "none" ? r.handler == null : r.handler === f.handler)),
  );
}

/** The rows grouped by day, in the week's order (the wide table's day heading rows). */
export function byDay(rows: readonly ProgressRow[]): { day: Day; rows: ProgressRow[] }[] {
  const out: { day: Day; rows: ProgressRow[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.day === r.lesson.day) last.rows.push(r);
    else out.push({ day: r.lesson.day, rows: [r] });
  }
  return out;
}
