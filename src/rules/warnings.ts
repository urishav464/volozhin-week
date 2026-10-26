// Soft rules: things worth a second look, never blocks. (Hard rules — one
// handler per speaker, no room or speaker in two places at once — are database
// constraints.) Every warning has a stable key so it can be acknowledged as
// «מכוון» and stay quiet.
import { coveredRows, slotFit, slotsBySpeaker } from "../domain/availability";
import { byGender, displayName } from "../domain/names";
import { DAY_NAMES, type Day, dayRange, overlaps } from "../domain/time";
import type { GridRow, Lesson, Week } from "../domain/types";
import { rowActive } from "../grid/layout";
import { statusLabel } from "../lib/labels";
import { DEFAULT_GENDER_TOLERANCE, categoryLoad, dayBalance, unbalanced } from "./balance";

export type WarningKind =
  | "parallel"
  | "back_to_back"
  | "category_load"
  | "speaker_twice"
  | "outside_availability"
  | "declined_pitch"
  | "fixed_overlap"
  | "outside_window"
  | "missing_info"
  | "escort_gap"
  | "memorial_over_slot"
  | "memorial_too_long"
  | "memorial_near_meal"
  | "gender_day";

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
/** «הצעה» — an escort needs at least this many minutes between two lessons (DESIGN, כללים רכים). */
export const ESCORT_MIN_GAP = 30;

type Timed = Pick<Lesson, "day" | "start_min" | "end_min">;

/** Minutes between two lessons on the week's clock (day × 1440 + minute): 0 back to back, negative when they overlap. */
export function weekGap(a: Timed, b: Timed): number {
  const [x, y] = a.day * 1440 + a.start_min <= b.day * 1440 + b.start_min ? [a, b] : [b, a];
  return y.day * 1440 + y.start_min - (x.day * 1440 + x.end_min);
}

/**
 * The escort's other lessons less than ESCORT_MIN_GAP («הצעה») from this one, or at the same time —
 * what the escort picker says before anything is saved (the same rule as the `escort_gap` warning).
 */
export function escortClashes(week: Pick<Week, "lessons">, lesson: Timed & { id: number }, rosterId: number): { lesson: Lesson; gap: number }[] {
  return week.lessons
    .filter((l) => l.id !== lesson.id && l.state !== "cancelled" && l.escort_roster_id === rosterId)
    .map((l) => ({ lesson: l, gap: weekGap(lesson, l) }))
    .filter((x) => x.gap < ESCORT_MIN_GAP)
    .sort((a, b) => a.lesson.day - b.lesson.day || a.lesson.start_min - b.lesson.start_min || a.lesson.id - b.lesson.id);
}

/** A meal on the grid: a fixed row whose label begins «ארוחת» (the 2026 poster's four: בוקר, צהריים, ערב, חצות). */
export function isMealRow(r: Pick<GridRow, "kind" | "label">): boolean {
  return r.kind === "fixed" && r.label.trim().startsWith("ארוחת");
}

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
  const tolerance = week.edition.settings.gender_tolerance ?? DEFAULT_GENDER_TOLERANCE;

  for (const day of [0, 1, 2, 3, 4] as Day[]) {
    const dayLessons = live.filter((l) => l.day === day && l.kind === "lesson");

    // v13: the day's closed lessons, women and men, further apart than the tolerance («הצעה» until set) — a day's
    // warning, on no card (the day header and its panel show it; its key is the day's)
    const { closed: g } = dayBalance(day, week, 0);
    if (unbalanced(g, tolerance)) {
      const k = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
      const rule = week.edition.settings.gender_tolerance == null ? `הצעה: הפרש של עד ${tolerance}` : `הפרש של עד ${tolerance}`;
      out.push({ key: `gender_day:${day}`, kind: "gender_day", severity: "warn", day, lessonIds: [], message: `${DAY_NAMES[day]} לא מאוזן: נסגרו ${k(g.f)} מרצות ו-${k(g.m)} מרצים (${rule})` });
    }

    // Parallel lessons split the group — allowed, but always visible.
    const seen = new Set<number>();
    for (const a of dayLessons) {
      if (seen.has(a.id)) continue;
      const group = dayLessons.filter((b) => overlaps(a.start_min, a.end_min, b.start_min, b.end_min));
      if (group.length > 1) {
        group.forEach((g) => seen.add(g.id));
        push({ kind: "parallel", severity: "info", day, lessonIds: group.map((g) => g.id), message: `${group.length} שיעורים במקביל ב${dayRange(day, a.start_min, a.end_min)}` });
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
        const rule = week.edition.settings.max_category_per_day == null ? `הצעה: עד ${max}` : `עד ${max}`;
        push({ kind: "category_load", severity: "warn", day, lessonIds: ids, message: `${n} שיעורי «${categoryById.get(catId)?.name ?? "?"}» ביום ${DAY_NAMES[day]} (${rule})` });
      }
    }

    // Lessons on a row that is not in play that day, or over a fixed block.
    for (const l of live.filter((x) => x.day === day)) {
      const touching = week.rows.filter((r) => overlaps(l.start_min, l.end_min, r.start_min, r.end_min));
      if (touching.some((r) => !rowActive(r, day, week.edition))) {
        push({ kind: "outside_window", severity: "warn", day, lessonIds: [l.id], message: `שיעור מחוץ לשעות השבוע: ${dayRange(day, l.start_min, l.end_min)}` });
      }
      const fixed = touching.filter((r) => (r.kind === "fixed" || r.kind === "kk") && rowActive(r, day, week.edition));
      if (fixed.length > 0 && l.kind === "lesson") {
        push({ kind: "fixed_overlap", severity: "warn", day, lessonIds: [l.id], message: `השיעור ב${dayRange(day, l.start_min, l.end_min)} נכנס ל«${fixed[0].label}»` });
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

  // Closed or pitched where the speaker said «לא» — on any lesson row the lesson covers (v14: availability per slot).
  const lessonById = new Map(week.lessons.map((l) => [l.id, l]));
  const slots = slotsBySpeaker(week.slotAvailability);
  for (const p of week.pitches) {
    if (!["candidate", "approached", "accepted"].includes(p.state)) continue;
    const l = lessonById.get(p.lesson_id);
    const a = approachById.get(p.approach_id);
    if (!l || !a || l.state === "cancelled") continue;
    const s = speakerById.get(a.speaker_id);
    if (!s) continue;
    if (slotFit(slots.get(s.id), l.day, coveredRows(week.rows, week.edition, l.day, l.start_min, l.end_min)) === "cannot") {
      push({ kind: "outside_availability", severity: "warn", day: l.day, lessonIds: [l.id], message: `${displayName(s)} ${byGender(s.gender, "אמר", "אמרה")} שלא ${byGender(s.gender, "יכול", "יכולה")} ב${dayRange(l.day, l.start_min, l.end_min)}` });
    }
    if (a.status === "declined" && p.state !== "accepted") {
      push({ kind: "declined_pitch", severity: "warn", day: l.day, lessonIds: [l.id], message: `${displayName(s)} ${statusLabel("declined", s.gender)} השנה, ועדיין ${byGender(s.gender, "מוצע", "מוצעת")} כאן` });
    }
  }

  // An escort with two lessons too close together — or at the same time. On
  // the week's clock (day × 1440 + minute), so 05:00 → 06:30 the next morning counts too.
  // Every pair, through escortClashes — the picker's rule — so a long lesson
  // overlapping a later one that is not its neighbour is caught too.
  const rosterName = new Map(week.roster.map((r) => [r.id, r.full_name]));
  const clock = (l: Lesson) => l.day * 1440 + l.start_min;
  const byEscort = new Map<number, typeof live>();
  for (const l of live) if (l.escort_roster_id != null) byEscort.set(l.escort_roster_id, [...(byEscort.get(l.escort_roster_id) ?? []), l]);
  for (const [rid, ls] of byEscort) {
    const sorted = [...ls].sort((a, b) => clock(a) - clock(b) || a.id - b.id);
    const pairs = sorted.flatMap((x) =>
      escortClashes({ lessons: live }, x, rid)
        .filter(({ lesson: y }) => clock(x) < clock(y) || (clock(x) === clock(y) && x.id < y.id)) // each pair once, earlier first
        .map(({ lesson: y, gap }) => ({ a: x, b: y, gap })),
    );
    for (const { a, b, gap } of pairs) {
      const who = `«${rosterName.get(rid) ?? "מלווה"}»`;
      const when = dayRange(b.day, b.start_min, b.end_min);
      const message =
        gap < 0
          ? `${who} מלווה שני שיעורים חופפים (${when})`
          : gap === 0
            ? `${who} מלווה שני שיעורים צמודים, בלי הפסקה ביניהם (${when}; הצעה: לפחות ${ESCORT_MIN_GAP} דקות)`
            : `${who} מלווה שני שיעורים עם ${gap} דקות ביניהם (${when}; הצעה: לפחות ${ESCORT_MIN_GAP})`;
      push({ kind: "escort_gap", severity: "warn", day: b.day, lessonIds: [a.id, b.id], message });
    }
  }

  // Memorial times. A plan longer than the slot it is placed on — a fact, always. And only once the staff meeting
  // has set them (settings.memorial — never seeded): a plan longer than the most minutes, and a slot next to a meal.
  const policy = week.edition.settings?.memorial;
  const fallenName = new Map((week.fallen ?? []).map((f) => [f.id, f.name]));
  const byId = new Map(live.map((l) => [l.id, l]));
  for (const p of week.memorialPlans ?? []) {
    const l = p.lesson_id == null ? undefined : byId.get(p.lesson_id);
    if (!l || p.planned_minutes == null) continue;
    const who = `«${fallenName.get(p.fallen_id) ?? "זמן זיכרון"}»`;
    const when = dayRange(l.day, l.start_min, l.end_min);
    const len = l.end_min - l.start_min;
    if (p.planned_minutes > len) {
      push({ kind: "memorial_over_slot", severity: "warn", day: l.day, lessonIds: [l.id], message: `${who}: ${p.planned_minutes} דקות מתוכננות, והמשבצת ${len} דקות (${when})` });
    }
    if (policy?.max_minutes != null && p.planned_minutes > policy.max_minutes) {
      push({ kind: "memorial_too_long", severity: "warn", day: l.day, lessonIds: [l.id], message: `${who}: ${p.planned_minutes} דקות מתוכננות, יותר מ-${policy.max_minutes} שנקבעו במדיניות (${when})` });
    }
  }
  if (policy?.warn_adjacent_meal === true) {
    // only a slot a plan is placed on: the grid's memorial rows sit next to lunch by design (DESIGN), so every empty
    // default slot would be warned about, every day, burying the warnings that matter
    const placed = new Set((week.memorialPlans ?? []).map((p) => p.lesson_id));
    for (const l of live.filter((x) => x.kind === "memorial" && placed.has(x.id))) {
      const meal = week.rows.find((r) => isMealRow(r) && rowActive(r, l.day, week.edition) && (r.end_min === l.start_min || r.start_min === l.end_min));
      if (meal) {
        push({ kind: "memorial_near_meal", severity: "warn", day: l.day, lessonIds: [l.id], message: `זמן זיכרון צמוד ל«${meal.label}» (${dayRange(l.day, l.start_min, l.end_min)})` });
      }
    }
  }

  // A closed lesson missing what the outputs need.
  for (const l of closed) {
    const missing: string[] = [];
    if (!l.title) missing.push("כותרת");
    if (l.category_id == null) missing.push("קטגוריה");
    if (speakersOf(l.id).some((s) => s.gender == null)) missing.push("מגדר המרצה");
    if (missing.length) {
      push({ kind: "missing_info", severity: "info", day: l.day, lessonIds: [l.id], message: `חסר: ${missing.join(", ")} (${dayRange(l.day, l.start_min, l.end_min)})` });
    }
  }

  return out;
}
