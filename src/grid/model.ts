// Everything the grid screen derives from a loaded Week, computed once per load
// (pure, so it is unit-testable and identical on every device).
import { type SpeakerSlots, coveredRows, slotFit, slotsBySpeaker } from "../domain/availability";
import { byGender, displayName } from "../domain/names";
import { DAYS, type Day, overlaps } from "../domain/time";
import type { Approach, ApproachStatus, Category, Gender, Lesson, Pitch, Speaker, Week, GridRow } from "../domain/types";
import { LIVE_PITCH } from "../domain/types";
import { type DayBalance, categoryLoad, dayBalance } from "../rules/balance";
import { type Warning, warningsFor } from "../rules/warnings";
import { type AxisBlock, topicAxis } from "./axis";
import { type FreeCell, type Layout, type Placed, buildLayout, freeCells, placeDay } from "./layout";

export interface DayModel {
  day: Day;
  placed: Placed[];
  free: FreeCell[];
  memorialFree: FreeCell[];
  balance: DayBalance;
  load: Map<number, number>;
  /** The day's topics in time order (axis.ts): the colour strip of its header and panel. */
  axis: AxisBlock[];
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
  /** Live and declined pitches of each lesson, most advanced first: by where the call stands (CALL_RANK), a declined pitch last. */
  pitchesByLesson: Map<number, Pitch[]>;
  /** v14: each speaker's availability per slot (src/domain/availability.ts), once per load. */
  slots: Map<number, SpeakerSlots>;
  /** The closed lessons each speaker teaches, lead or co — «כבר משובץ/ת» in fitFor. */
  closedOf: Map<number, Lesson[]>;
  /** The lead speaker of each closed lesson. */
  leadOf: Map<number, Speaker>;
  /** Warning count per lesson id. */
  warningCount: Map<number, number>;
  memberName: Map<number, string>;
}

/**
 * Where the call stands, most advanced first (v14: a pitch is a candidate until its lesson closes — the approach's
 * status says where the speaker is).
 */
const CALL_RANK: Record<ApproachStatus, number> = { positive: 0, approached: 1, no_answer: 2, claimed: 3, declined: 4 };

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
  const rank = (p: Pitch) => {
    const a = approachById.get(p.approach_id);
    return p.state === "declined" ? 5 : a ? CALL_RANK[a.status] : 4;
  };
  for (const list of pitchesByLesson.values()) list.sort((a, b) => rank(a) - rank(b) || a.id - b.id);

  const leadOf = new Map<number, Speaker>();
  const closedOf = new Map<number, Lesson[]>();
  const lessonById = new Map(week.lessons.map((l) => [l.id, l]));
  for (const x of week.lessonSpeakers) {
    if (x.role === "lead" && speakerById.has(x.speaker_id)) leadOf.set(x.lesson_id, speakerById.get(x.speaker_id)!);
    const l = lessonById.get(x.lesson_id);
    if (l?.state === "closed") closedOf.set(x.speaker_id, [...(closedOf.get(x.speaker_id) ?? []), l]);
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
      axis: topicAxis(week, day),
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
    slots: slotsBySpeaker(week.slotAvailability),
    closedOf,
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

/**
 * How well a speaker fits a time: already closed for it («busy»), else what they said of the lesson rows it covers
 * (slotFit: «לא» if any row is «לא», «יכול/ה» only if every row is) — nothing said is «neutral».
 */
export function fitFor(m: GridModel, speakerId: number, day: Day, start: number, end: number): Fit {
  if ((m.closedOf.get(speakerId) ?? []).some((l) => l.day === day && overlaps(l.start_min, l.end_min, start, end))) return "busy";
  return slotFit(m.slots.get(speakerId), day, coveredRows(m.week.rows, m.week.edition, day, start, end)) ?? "neutral";
}

/** A fit in words, by the speaker's gender: what a coloured cell or draft says beside its colour (never the colour alone). */
export function fitText(fit: Fit, g: Gender | null): string | null {
  switch (fit) {
    case "can":
      return `✓ ${byGender(g, "יכול", "יכולה")}`;
    case "cannot":
      return `⊘ ${byGender(g, "לא יכול", "לא יכולה")}`;
    case "busy":
      return `כבר ${byGender(g, "משובץ", "משובצת")} בשעה הזו`;
    case "neutral":
      return null;
  }
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

/** The topics a legend lists — active, or closed this week — each with the week's closed lessons in it (the days' loads summed). */
export function weekTopics(m: GridModel): { category: Category; count: number }[] {
  return m.week.categories
    .map((category) => ({ category, count: m.days.reduce((s, d) => s + (d.load.get(category.id) ?? 0), 0) }))
    .filter((x) => x.category.active || x.count > 0);
}

export const GENDER_NEED_LABEL: Record<Gender, string> = { f: "דרושה מרצה", m: "דרוש מרצה" };

/**
 * A memorial row an edition admin can take a slot in from the grid (v13): nothing of that day in the default room
 * over the row — the room add_memorial_slot puts it in (else `room_taken`: a merged lesson over the row, a slot there).
 */
export function memorialRowFree(m: GridModel, day: Day, row: Pick<GridRow, "start_min" | "end_min">): boolean {
  const rooms = [...m.week.rooms].sort((a, b) => a.sort - b.sort);
  const room = (rooms.find((r) => r.is_default) ?? rooms[0])?.id;
  return room != null && !m.week.lessons.some((l) => l.day === day && l.state !== "cancelled" && l.room_id === room && overlaps(l.start_min, l.end_min, row.start_min, row.end_min));
}
