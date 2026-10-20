// Last year's stage colours (DESIGN «עדשות», «תוצרים» 1): light blue = sources
// received, orange = a presentation, yellow = a memorial slot, grey = not
// closed yet — and white while sources are still awaited. «No sources» has a
// colour of its own (violet), so «nothing to receive» never reads as «still
// missing». One definition for the grid's progress lens, the tracking table's
// row tint on screen and in print, and its xlsx fill.
import type { Lesson } from "./types";

export type ProgressTone = "received" | "presentation" | "pending" | "none" | "draft" | "memorial";

/** A closed lesson's tone, by its sources. */
export function progressOf(kind: Lesson["sources_kind"]): Exclude<ProgressTone, "draft" | "memorial"> {
  if (kind === "presentation") return "presentation";
  if (kind === "pending") return "pending";
  if (kind === "none") return "none";
  return "received";
}

/** Any lesson's tone: a memorial slot, a cell not closed yet, else its sources. */
export function lessonTone(l: Pick<Lesson, "kind" | "state" | "sources_kind">): ProgressTone {
  if (l.kind === "memorial") return "memorial";
  if (l.state !== "closed") return "draft";
  return progressOf(l.sources_kind);
}

/** Tailwind background classes (the lens's, and the tracking table's rows). */
export const PROGRESS_TONE: Record<ProgressTone, string> = {
  received: "bg-cyan-100",
  presentation: "bg-orange-100",
  pending: "bg-card",
  none: "bg-violet-100",
  draft: "bg-line/70",
  memorial: "bg-amber-100",
};

/** The same colours as RGB for a spreadsheet's fill (null: no fill). */
export const PROGRESS_FILL: Record<ProgressTone, string | null> = {
  received: "CFFAFE",
  presentation: "FFEDD5",
  pending: null,
  none: "EDE9FE",
  draft: "E8E2D6",
  memorial: "FEF3C7",
};

/** The legend: the colour's name first, for whoever reads it without the colour. */
export const PROGRESS_LABEL: Record<ProgressTone, string> = {
  received: "תכלת: מקורות התקבלו",
  presentation: "כתום: מצגת",
  pending: "לבן: מקורות טרם התקבלו",
  none: "סגול: בלי מקורות (אין מה לקבל)",
  draft: "אפור: טרם נסגר",
  memorial: "צהוב: זמן זיכרון",
};
