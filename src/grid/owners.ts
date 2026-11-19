// The «אחריות» lens (v13): who handles each lesson, and a colour per member who
// handles speakers — in the team's order, from the categories' palette (each
// dark enough for a stripe, none the gender lens's pink or blue). The reset, phase 3: each day has its pair (v18
// day owners), and a lesson handled by someone outside it is «חריג» — never on a day with no owners.
import { lessonHandler } from "../domain/handler";
import type { Day } from "../domain/time";
import { LIVE_PITCH, type Lesson, type Week } from "../domain/types";
import { PALETTE } from "../settings/palette";
import type { GridModel } from "./model";

/** The team members who can handle a speaker (content and admins), in the team's order, each with a colour. */
export function ownerColors(team: Week["team"]): { id: number; name: string; color: string }[] {
  return team.filter((m) => m.role !== "logistics").map((m, i) => ({ id: m.id, name: m.display_name ?? "חבר/ת צוות", color: PALETTE[i % PALETTE.length].color }));
}

/** Who handles a lesson: a closed lesson's handler (src/domain/handler.ts); a draft's — its first live pitch's. Null: nobody yet. */
export function lessonOwner(model: GridModel, lesson: Lesson): number | null {
  if (lesson.kind !== "lesson") return null;
  if (lesson.state === "closed") return lessonHandler(model.week, lesson.id);
  const first = (model.pitchesByLesson.get(lesson.id) ?? []).find((p) => p.state !== "declined");
  return (first && model.approachById.get(first.approach_id)?.owner_member_id) ?? null;
}

/** The day's owners (members.id, ascending, distinct) — empty when an admin has not set them yet. */
export function dayPair(model: Pick<GridModel, "week">, day: Day): number[] {
  const ids = (model.week.dayOwners ?? []).filter((o) => o.day === day).map((o) => o.member_id);
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** Everyone working on a lesson: a closed lesson's handler; a draft's — each live candidate's (distinct, by pitch). */
export function lessonHandlers(model: GridModel, lesson: Lesson): number[] {
  if (lesson.kind !== "lesson") return [];
  if (lesson.state === "closed") {
    const h = lessonHandler(model.week, lesson.id);
    return h == null ? [] : [h];
  }
  const ids = (model.pitchesByLesson.get(lesson.id) ?? []).filter((p) => LIVE_PITCH.has(p.state)).map((p) => model.approachById.get(p.approach_id)?.owner_member_id);
  return [...new Set(ids.filter((m): m is number => m != null))];
}

/**
 * The ONE «חריג» rule — the grid's «אחריות» card and the day's «חריגים» list («ימים», «היום שלי»): who works on the
 * lesson from outside its day's pair. A day with no owners has no outside (never every lesson); a bare draft has nobody;
 * a handler who left the team (not in public.team, so not in `memberName`) is nobody's either — the lens reads their
 * lessons «בלי אחראי/ת», and so do the day's lists: never «בטיפול חבר/ת צוות» outside the pair.
 */
export function outsidePair(model: GridModel, lesson: Lesson): number[] {
  if (lesson.state === "cancelled") return [];
  const pair = dayPair(model, lesson.day);
  if (pair.length === 0) return [];
  return lessonHandlers(model, lesson).filter((h) => !pair.includes(h) && model.memberName.has(h));
}

/** «חריג» on the grid's card: someone on the team, outside the day's pair, works on it (outsidePair). */
export function ownerException(model: GridModel, lesson: Lesson): boolean {
  return outsidePair(model, lesson).length > 0;
}

/** The legend's line and a marked card's text twin. */
export const OWNER_EXCEPTION_NOTE = "חריג: שיעור שמטופל על ידי מי שאינו מהזוג של היום.";

/** A day header's line when the day has no pair. */
export const NO_PAIR_LABEL = "אין זוג ליום";

/** «הזוג: X ו-Y», «אחראי/ת: X», «אין זוג ליום» — a day's owners by name (a header's line under «אחריות»). */
export function pairText(model: Pick<GridModel, "week" | "memberName">, day: Day): string {
  const names = dayPair(model, day).map((id) => model.memberName.get(id) ?? "חבר/ת צוות");
  if (names.length === 0) return NO_PAIR_LABEL;
  return names.length === 1 ? `אחראי/ת: ${names[0]}` : `הזוג: ${names.slice(0, -1).join(", ")} ו-${names[names.length - 1]}`;
}
