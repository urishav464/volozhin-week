// Everything the grid screen derives from a loaded Week, computed once per load
// (pure, so it is unit-testable and identical on every device).
import { displayName } from "../domain/names";
import { DAYS, type Day, overlaps } from "../domain/time";
import type { Approach, Category, Gender, Lesson, Pitch, Speaker, Week } from "../domain/types";
import { LIVE_PITCH } from "../domain/types";
import { type DayBalance, categoryLoad, dayBalance } from "../rules/balance";
import { type Warning, warningsFor } from "../rules/warnings";
import { type FreeCell, type Layout, type Placed, buildLayout, freeCells, placeDay } from "./layout";

export interface DayModel {
  day: Day;
  placed: Placed[];
  free: FreeCell[];
  memorialFree: FreeCell[];
  balance: DayBalance;
  load: Map<number, number>;
  warnings: Warning[];
}

export interface GridModel {
  week: Week;
  layout: Layout;
  days: DayModel[];
  warnings: Warning[];
  speakerById: Map<number, Speaker>;
  approachBySpeaker: Map<number, Approach>;
  approachById: Map<number, Approach>;
  categoryById: Map<number, Category>;
  /** Live and declined pitches of each lesson, most advanced first. */
  pitchesByLesson: Map<number, Pitch[]>;
  /** The lead speaker of each closed lesson. */
  leadOf: Map<number, Speaker>;
  /** Warning count per lesson id. */
  warningCount: Map<number, number>;
  memberName: Map<number, string>;
}

const RANK: Record<string, number> = { approached: 0, candidate: 1, declined: 2 };

export function buildModel(week: Week): GridModel {
  const layout = buildLayout(week.rows);
  const speakerById = new Map(week.speakers.map((s) => [s.id, s]));
  const approachById = new Map(week.approaches.map((a) => [a.id, a]));
  const approachBySpeaker = new Map(week.approaches.map((a) => [a.speaker_id, a]));
  const categoryById = new Map(week.categories.map((c) => [c.id, c]));
  const warnings = warningsFor(week);

  const pitchesByLesson = new Map<number, Pitch[]>();
  for (const p of week.pitches) {
    if (!(LIVE_PITCH.has(p.state) || p.state === "declined")) continue;
    pitchesByLesson.set(p.lesson_id, [...(pitchesByLesson.get(p.lesson_id) ?? []), p]);
  }
  for (const list of pitchesByLesson.values()) list.sort((a, b) => RANK[a.state] - RANK[b.state] || a.id - b.id);

  const leadOf = new Map<number, Speaker>();
  for (const x of week.lessonSpeakers) {
    if (x.role === "lead" && speakerById.has(x.speaker_id)) leadOf.set(x.lesson_id, speakerById.get(x.speaker_id)!);
  }

  const warningCount = new Map<number, number>();
  for (const w of warnings) {
    if (w.severity === "info") continue;
    for (const id of w.lessonIds) warningCount.set(id, (warningCount.get(id) ?? 0) + 1);
  }

  const days: DayModel[] = DAYS.map((day) => {
    const dayLessons = week.lessons.filter((l) => l.day === day);
    const free = freeCells(layout, day, week.lessons, week.edition);
    return {
      day,
      placed: placeDay(layout, dayLessons),
      free,
      memorialFree: freeCells(layout, day, week.lessons, week.edition, "memorial"),
      balance: dayBalance(day, week, free.length),
      load: categoryLoad(day, week.lessons),
      warnings: warnings.filter((w) => w.day === day),
    };
  });

  return {
    week,
    layout,
    days,
    warnings,
    speakerById,
    approachBySpeaker,
    approachById,
    categoryById,
    pitchesByLesson,
    leadOf,
    warningCount,
    memberName: new Map(week.team.map((m) => [m.id, m.display_name])),
  };
}

/** Speaker of a pitch. */
export function pitchSpeaker(m: GridModel, p: Pitch): Speaker | undefined {
  const a = m.approachById.get(p.approach_id);
  return a ? m.speakerById.get(a.speaker_id) : undefined;
}

export type Fit = "cannot" | "busy" | "can" | "neutral";

/** How well a speaker fits a time: what they said they can't do, or are already closed for. */
export function fitFor(m: GridModel, speakerId: number, day: Day, start: number, end: number): Fit {
  const a = m.approachBySpeaker.get(speakerId);
  const busy = m.week.lessonSpeakers.some((x) => {
    if (x.speaker_id !== speakerId) return false;
    const l = m.week.lessons.find((y) => y.id === x.lesson_id);
    return !!l && l.state === "closed" && l.day === day && overlaps(l.start_min, l.end_min, start, end);
  });
  if (busy) return "busy";
  if (!a) return "neutral";
  const said = m.week.availability.filter((v) => v.approach_id === a.id && v.day === day && overlaps(v.from_min, v.to_min, start, end));
  if (said.some((v) => v.kind === "cannot")) return "cannot";
  if (said.some((v) => v.kind === "can")) return "can";
  return "neutral";
}

export type PoolSection = "mine" | "free" | "others" | "closed" | "declined";

export const POOL_SECTION_LABEL: Record<PoolSection, string> = {
  mine: "שלי",
  free: "פנויים",
  others: "בטיפול אחרים",
  closed: "נסגרו",
  declined: "סירבו השנה",
};

/** Where a speaker sits in the pool, from the viewer's point of view. */
export function poolSection(m: GridModel, speakerId: number, me: number): PoolSection {
  const closed = m.week.lessonSpeakers.some((x) => x.speaker_id === speakerId && m.week.lessons.some((l) => l.id === x.lesson_id && l.state === "closed"));
  if (closed) return "closed";
  const a = m.approachBySpeaker.get(speakerId);
  if (!a || a.owner_member_id == null) return "free";
  if (a.status === "declined") return "declined";
  return a.owner_member_id === me ? "mine" : "others";
}

/** Hebrew-insensitive search key: no gershayim/geresh differences, no title words. */
export function searchKey(s: string): string {
  return s
    .replace(/[״"]/g, "")
    .replace(/[׳']/g, "")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[-–־]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function speakerMatches(s: Speaker, query: string): boolean {
  const q = searchKey(query);
  if (!q) return true;
  return searchKey(`${displayName(s)} ${s.topics.join(" ")} ${s.affiliation ?? ""}`).includes(q);
}

/** The category a speaker's first topic names, if any — a guess for highlighting only, never stored. */
export function guessedCategory(m: GridModel, s: Speaker): number | null {
  const t = s.topics[0];
  if (!t) return null;
  for (const c of m.categoryById.values()) if (c.name === t) return c.id;
  return null;
}

export function lessonsOfDay(m: GridModel, day: Day): Lesson[] {
  return m.week.lessons.filter((l) => l.day === day && l.state !== "cancelled");
}

export const GENDER_NEED_LABEL: Record<Gender, string> = { f: "דרושה מרצה", m: "דרוש מרצה" };
