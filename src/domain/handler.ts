// Who handles a lesson — the ONE rule (the reset, phase 3): the current lead speaker's approach's owner. «היום שלי»,
// the lesson page's stages, «אחרי השבוע» and the transport board all ask it here; the grid's «אחריות» lens
// (src/grid/owners.ts lessonOwner) adds a draft's first live pitch on top of it.
import type { Week } from "./types";

/** The handler of a lesson: its lead speaker's approach's owner. Null: no lead, no approach, or nobody handles them. */
export function lessonHandler(week: Pick<Week, "lessonSpeakers" | "approaches">, lessonId: number): number | null {
  const lead = week.lessonSpeakers.find((x) => x.lesson_id === lessonId && x.role === "lead");
  if (!lead) return null;
  return week.approaches.find((a) => a.speaker_id === lead.speaker_id)?.owner_member_id ?? null;
}
