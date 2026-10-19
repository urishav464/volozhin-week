// Soft rules: things worth a second look, never blocks. (Hard rules — one
// handler per speaker, no room or speaker in two places at once — are database
// constraints.) Every warning has a stable key so it can be acknowledged as
// «מכוון» and stay quiet.
import { byGender, displayName } from "../domain/names";
import { DAY_NAMES, type Day, fmtRange, overlaps } from "../domain/time";
import type { Week } from "../domain/types";
import { rowActive } from "../grid/layout";
import { categoryLoad } from "./balance";

export type WarningKind =
  | "parallel"
  | "back_to_back"
  | "category_load"
  | "speaker_twice"
  | "outside_availability"
  | "declined_pitch"
  | "fixed_overlap"
  | "outside_window"
  | "missing_info";

export interface Warning {
  key: string;
  kind: WarningKind;
  severity: "info" | "warn";
  day: Day;
  lessonIds: number[];
  message: string;
}

/** «הצעה» — until the instructor sets edition.settings.max_category_per_day. */
export const DEFAULT_MAX_CATEGORY_PER_DAY = 3;
/** Two lessons count as back-to-back when at most this many minutes separate them. */
export const BACK_TO_BACK_GAP = 30;

export function warningsFor(week: Week): Warning[] {
  const out: Warning[] = [];
  const speakerById = new Map(week.speakers.map((s) => [s.id, s]));
  const categoryById = new Map(week.categories.map((c) => [c.id, c]));
  const approachById = new Map(week.approaches.map((a) => [a.id, a]));
  const live = week.lessons.filter((l) => l.state !== "cancelled");
  const closed = live.filter((l) => l.state === "closed" && l.kind === "lesson");
  const speakersOf = (lessonId: number) =>
    week.lessonSpeakers.filter((x) => x.lesson_id === lessonId).map((x) => speakerById.get(x.speaker_id)).filter((s) => s != null);
  const push = (w: Omit<Warning, "key">) => out.push({ ...w, key: `${w.kind}:${[...w.lessonIds].sort((a, b) => a - b).join(",")}` });
  const max = week.edition.settings.max_category_per_day ?? DEFAULT_MAX_CATEGORY_PER_DAY;

  for (const day of [0, 1, 2, 3, 4] as Day[]) {
    const dayLessons = live.filter((l) => l.day === day && l.kind === "lesson");

    // Parallel lessons split the group — allowed, but always visible.
    const seen = new Set<number>();
    for (const a of dayLessons) {
      if (seen.has(a.id)) continue;
      const group = dayLessons.filter((b) => overlaps(a.start_min, a.end_min, b.start_min, b.end_min));
      if (group.length > 1) {
        group.forEach((g) => seen.add(g.id));
        push({ kind: "parallel", severity: "info", day, lessonIds: group.map((g) => g.id), message: `${group.length} שיעורים במקביל ב${DAY_NAMES[day]} ${fmtRange(a.start_min, a.end_min)}` });
      }
    }

    // The same category in a row: one warning per run (three in a row is one
    // problem, not two). Lessons are "in a row" when at most BACK_TO_BACK_GAP
    // minutes separate them and no other closed lesson sits between.
    const dayClosed = closed.filter((l) => l.day === day && l.category_id != null).sort((a, b) => a.start_min - b.start_min);
    const sequential = dayClosed.filter((l) => !dayClosed.some((o) => o !== l && overlaps(o.start_min, o.end_min, l.start_min, l.end_min)));
    let run: typeof sequential = [];
    const flush = () => {
      if (run.length > 1) {
        const name = categoryById.get(run[0].category_id!)?.name ?? "?";
        const count = run.length === 2 ? "שני" : String(run.length);
        push({ kind: "back_to_back", severity: "warn", day, lessonIds: run.map((l) => l.id), message: `${count} שיעורי «${name}» ברצף ב${DAY_NAMES[day]}` });
      }
    };
    for (const l of sequential) {
      const prev = run[run.length - 1];
      if (prev && prev.category_id === l.category_id && l.start_min - prev.end_min <= BACK_TO_BACK_GAP && l.start_min >= prev.end_min) run.push(l);
      else {
        flush();
        run = [l];
      }
    }
    flush();

    // Too much of one category in a day.
    for (const [catId, n] of categoryLoad(day, week.lessons)) {
      if (n > max) {
        const ids = closed.filter((l) => l.day === day && l.category_id === catId).map((l) => l.id);
        push({ kind: "category_load", severity: "warn", day, lessonIds: ids, message: `${n} שיעורי «${categoryById.get(catId)?.name ?? "?"}» ביום ${DAY_NAMES[day]} (הצעה: עד ${max})` });
      }
    }

    // Lessons on a row that is not in play that day, or over a fixed block.
    for (const l of live.filter((x) => x.day === day)) {
      const touching = week.rows.filter((r) => overlaps(l.start_min, l.end_min, r.start_min, r.end_min));
      if (touching.some((r) => !rowActive(r, day, week.edition))) {
        push({ kind: "outside_window", severity: "warn", day, lessonIds: [l.id], message: `שיעור מחוץ לשעות השבוע: ${DAY_NAMES[day]} ${fmtRange(l.start_min, l.end_min)}` });
      }
      const fixed = touching.filter((r) => (r.kind === "fixed" || r.kind === "kk") && rowActive(r, day, week.edition));
      if (fixed.length > 0 && l.kind === "lesson") {
        push({ kind: "fixed_overlap", severity: "warn", day, lessonIds: [l.id], message: `השיעור ב${DAY_NAMES[day]} ${fmtRange(l.start_min, l.end_min)} נכנס ל«${fixed[0].label}»` });
      }
    }
  }

  // A speaker closed in two lessons (at different times — the same time is a hard constraint).
  const bySpeaker = new Map<number, number[]>();
  for (const l of closed) for (const s of speakersOf(l.id)) bySpeaker.set(s.id, [...(bySpeaker.get(s.id) ?? []), l.id]);
  for (const [sid, ids] of bySpeaker) {
    if (ids.length > 1) {
      const s = speakerById.get(sid)!;
      const day = closed.find((l) => l.id === ids[0])!.day;
      push({ kind: "speaker_twice", severity: "warn", day, lessonIds: ids, message: `${displayName(s)} ${byGender(s.gender, "משובץ", "משובצת")} ב-${ids.length} שיעורים` });
    }
  }

  // Closed or pitched outside what the speaker said they can do.
  const lessonById = new Map(week.lessons.map((l) => [l.id, l]));
  for (const p of week.pitches) {
    if (!["candidate", "approached", "accepted"].includes(p.state)) continue;
    const l = lessonById.get(p.lesson_id);
    const a = approachById.get(p.approach_id);
    if (!l || !a || l.state === "cancelled") continue;
    const s = speakerById.get(a.speaker_id);
    if (!s) continue;
    const cannot = week.availability.some((v) => v.approach_id === a.id && v.kind === "cannot" && v.day === l.day && overlaps(v.from_min, v.to_min, l.start_min, l.end_min));
    if (cannot) {
      push({ kind: "outside_availability", severity: "warn", day: l.day, lessonIds: [l.id], message: `${displayName(s)} ${byGender(s.gender, "אמר", "אמרה")} שלא ${byGender(s.gender, "יכול", "יכולה")} ב${DAY_NAMES[l.day]} ${fmtRange(l.start_min, l.end_min)}` });
    }
    if (a.status === "declined" && p.state !== "accepted") {
      push({ kind: "declined_pitch", severity: "warn", day: l.day, lessonIds: [l.id], message: `${displayName(s)} ${byGender(s.gender, "סירב", "סירבה")} השנה, ועדיין ${byGender(s.gender, "מוצע", "מוצעת")} כאן` });
    }
  }

  // A closed lesson missing what the outputs need.
  for (const l of closed) {
    const missing: string[] = [];
    if (!l.title) missing.push("כותרת");
    if (l.category_id == null) missing.push("קטגוריה");
    if (speakersOf(l.id).some((s) => s.gender == null)) missing.push("מגדר המרצה");
    if (missing.length) {
      push({ kind: "missing_info", severity: "info", day: l.day, lessonIds: [l.id], message: `חסר: ${missing.join(", ")} (${DAY_NAMES[l.day]} ${fmtRange(l.start_min, l.end_min)})` });
    }
  }

  return out;
}
