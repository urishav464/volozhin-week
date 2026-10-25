// The «אחריות» lens (v13): who handles each lesson, and a colour per member who
// handles speakers — in the team's order, from the categories' palette (each
// dark enough for a stripe, none the gender lens's pink or blue).
import type { Lesson, Week } from "../domain/types";
import { PALETTE } from "../settings/palette";
import type { GridModel } from "./model";

/** The team members who can handle a speaker (content and admins), in the team's order, each with a colour. */
export function ownerColors(team: Week["team"]): { id: number; name: string; color: string }[] {
  return team.filter((m) => m.role !== "logistics").map((m, i) => ({ id: m.id, name: m.display_name ?? "חבר/ת צוות", color: PALETTE[i % PALETTE.length].color }));
}

/** Who handles a lesson: a closed lesson's lead speaker's handler; a draft's — its first live pitch's. Null: nobody yet. */
export function lessonOwner(model: GridModel, lesson: Lesson): number | null {
  if (lesson.kind !== "lesson") return null;
  if (lesson.state === "closed") {
    const lead = model.leadOf.get(lesson.id);
    return (lead && model.approachBySpeaker.get(lead.id)?.owner_member_id) ?? null;
  }
  const first = (model.pitchesByLesson.get(lesson.id) ?? []).find((p) => p.state !== "declined");
  return (first && model.approachById.get(first.approach_id)?.owner_member_id) ?? null;
}
