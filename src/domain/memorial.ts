// Memorial times as the screens read them (milestone 5ב-2): the slots (lessons
// of kind 'memorial' inside the grid's memorial rows), the plan on each, the
// yellow card's words, and the slot picker's choices. Pure, from a Week.
import { FAMILY_STATUS_LABEL } from "../data/memorial";
import { rowActive } from "../grid/layout";
import { type Day, dayRange } from "./time";
import type { GridRow, Lesson, MemorialPlan, Week } from "./types";

/** The edition's live memorial slots, in grid order. */
export function memorialSlots(week: Pick<Week, "lessons" | "rooms">): Lesson[] {
  const sort = new Map(week.rooms.map((r) => [r.id, r.sort]));
  return week.lessons
    .filter((l) => l.kind === "memorial" && l.state !== "cancelled")
    .sort((a, b) => a.day - b.day || a.start_min - b.start_min || (sort.get(a.room_id) ?? 0) - (sort.get(b.room_id) ?? 0) || a.id - b.id);
}

/** The plan placed on this slot, if any. */
export function planOf(week: Pick<Week, "memorialPlans">, lessonId: number): MemorialPlan | null {
  return (week.memorialPlans ?? []).find((p) => p.lesson_id === lessonId) ?? null;
}

/** The fallen's name as the Week carries it (load_week's `fallen`). */
export function fallenName(week: Pick<Week, "fallen">, fallenId: number): string {
  return (week.fallen ?? []).find((f) => f.id === fallenId)?.name ?? "חלל/ה";
}

/**
 * «ראשון 13:00–13:15 · אולם» — a slot as the picker and the lists name it; plain text (an <option> has no <bdi>),
 * so an LRM keeps the range left to right among the Hebrew (dayRange).
 */
export function slotLabel(week: Pick<Week, "rooms">, l: Pick<Lesson, "day" | "start_min" | "end_min" | "room_id">): string {
  const room = week.rooms.find((r) => r.id === l.room_id)?.name;
  return `${dayRange(l.day, l.start_min, l.end_min)}${room ? ` · ${room}` : ""}`;
}

/** The slots a plan may be placed on: those with no plan, and the plan's own. */
export function freeSlots(week: Pick<Week, "lessons" | "rooms" | "memorialPlans">, plan?: Pick<MemorialPlan, "id">): Lesson[] {
  const taken = new Set((week.memorialPlans ?? []).filter((p) => p.lesson_id != null && p.id !== plan?.id).map((p) => p.lesson_id));
  return memorialSlots(week).filter((l) => !taken.has(l.id));
}

/** The day's memorial rows (where an admin makes a slot), as the edition's window allows them. */
export function memorialRowsOf(week: Pick<Week, "rows" | "edition">, day: Day): GridRow[] {
  return week.rows.filter((r) => r.kind === "memorial" && rowActive(r, day, week.edition)).sort((a, b) => a.start_min - b.start_min);
}

/** «10 דק׳», or nothing planned yet. */
export function minutesText(n: number | null): string {
  return n == null ? "משך לא נקבע" : `${n} דק׳`;
}

/**
 * The grid's yellow card: «זמן זיכרון – <name>» and «<the family's status> · <minutes>», or «זמן זיכרון» and
 * «עוד לא שובץ/ה חלל/ה» on an empty slot. Never a contact. `name` is what the card itself shows first — the
 * fallen's name alone (the yellow says «זמן זיכרון»; the card's accessible name and tooltip keep `title`).
 */
export function memorialCard(week: Pick<Week, "memorialPlans" | "fallen">, l: Pick<Lesson, "id" | "title">): { title: string; name: string; line: string; plan: MemorialPlan | null } {
  const plan = planOf(week, l.id);
  if (!plan) {
    const title = l.title || "זמן זיכרון";
    return { title, name: title, line: "עוד לא שובץ/ה חלל/ה", plan: null };
  }
  const name = fallenName(week, plan.fallen_id);
  return {
    title: `זמן זיכרון – ${name}`,
    name,
    line: `${FAMILY_STATUS_LABEL[plan.family_status]} · ${minutesText(plan.planned_minutes)}${plan.hard_stop ? " · בלי חריגה" : ""}`,
    plan,
  };
}
