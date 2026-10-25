// The diversity rules, computed once here for the grid, the warnings drawer,
// the demo and (later) the approvals queue. Memorial slots never count: they
// are not lessons a trainee recruits for.
import type { Approach, Gender, Lesson, LessonSpeaker, Pitch, Speaker } from "../domain/types";
import { LIVE_PITCH } from "../domain/types";
import type { Day } from "../domain/time";

export interface GenderTally {
  m: number;
  f: number;
  unknown: number;
}

export interface DayBalance {
  day: Day;
  /** Closed lessons, by speaker gender; a co-taught lesson splits its 1 between its speakers. */
  closed: GenderTally;
  /** Drafts with a live pitch, by the gender of their leading candidate. */
  pending: GenderTally;
  /** Lesson cells still open: free rows + drafts nobody has been pitched for. */
  open: number;
  /** The gender the open cells should go to for 50/50; null when the day is even. */
  need: Gender | null;
  /** How many more of `need` would even the day (closed + pending). */
  deficit: number;
  /** The day cannot end even: the deficit is larger than the open cells. */
  unreachable: boolean;
}

export interface BalanceInput {
  lessons: Lesson[];
  lessonSpeakers: LessonSpeaker[];
  pitches: Pitch[];
  approaches: Approach[];
  speakers: Speaker[];
}

const PITCH_RANK: Record<string, number> = { approached: 0, candidate: 1 };

/**
 * «הצעה» — until the instructor sets edition.settings.gender_tolerance (v13): a day whose CLOSED lessons
 * differ by more than this many between women and men is «לא מאוזן» (a warning; the drafts only tint the cells).
 */
export const DEFAULT_GENDER_TOLERANCE = 1;

/** The day's closed lessons differ by more than the tolerance. */
export function unbalanced(closed: GenderTally, tolerance: number): boolean {
  return Math.abs(closed.m - closed.f) > tolerance + 1e-9;
}

/** The week's totals: what is closed, what is in process, what is open. */
export function weekBalance(days: Pick<DayBalance, "closed" | "pending" | "open">[]): { closed: GenderTally; pending: GenderTally; open: number } {
  const sum = (k: "closed" | "pending"): GenderTally => ({
    m: days.reduce((s, d) => s + d[k].m, 0),
    f: days.reduce((s, d) => s + d[k].f, 0),
    unknown: days.reduce((s, d) => s + d[k].unknown, 0),
  });
  return { closed: sum("closed"), pending: sum("pending"), open: days.reduce((s, d) => s + d.open, 0) };
}

/** The speaker a draft is "heading to": the most advanced live pitch, oldest first. */
export function leadingPitch(lessonId: number, pitches: Pitch[]): Pitch | null {
  const live = pitches.filter((p) => p.lesson_id === lessonId && LIVE_PITCH.has(p.state));
  live.sort((a, b) => PITCH_RANK[a.state] - PITCH_RANK[b.state] || a.id - b.id);
  return live[0] ?? null;
}

export function dayBalance(day: Day, input: BalanceInput, freeCellCount: number): DayBalance {
  const speakerById = new Map(input.speakers.map((s) => [s.id, s]));
  const approachById = new Map(input.approaches.map((a) => [a.id, a]));
  const closed: GenderTally = { m: 0, f: 0, unknown: 0 };
  const pending: GenderTally = { m: 0, f: 0, unknown: 0 };
  let open = freeCellCount;

  const add = (t: GenderTally, g: Gender | null, w: number) => {
    if (g === "m" || g === "f") t[g] += w;
    else t.unknown += w;
  };

  for (const l of input.lessons) {
    if (l.day !== day || l.kind !== "lesson" || l.state === "cancelled") continue;
    if (l.state === "closed") {
      const ss = input.lessonSpeakers.filter((x) => x.lesson_id === l.id);
      if (ss.length === 0) add(closed, null, 1);
      for (const x of ss) add(closed, speakerById.get(x.speaker_id)?.gender ?? null, 1 / ss.length);
    } else {
      const p = leadingPitch(l.id, input.pitches);
      if (!p) {
        open += 1;
        continue;
      }
      const speakerId = approachById.get(p.approach_id)?.speaker_id;
      add(pending, speakerId != null ? (speakerById.get(speakerId)?.gender ?? null) : null, 1);
    }
  }

  const diff = closed.m + pending.m - (closed.f + pending.f);
  // Half a lesson (co-teaching) is not worth tinting the day for.
  const need: Gender | null = diff >= 0.5 ? "f" : diff <= -0.5 ? "m" : null;
  const deficit = Math.abs(diff);
  return { day, closed, pending, open, need, deficit, unreachable: need !== null && deficit - open >= 1 };
}

/** Closed lessons per category on a day (lessons without a category are not counted). */
export function categoryLoad(day: Day, lessons: Lesson[]): Map<number, number> {
  const load = new Map<number, number>();
  for (const l of lessons) {
    if (l.day !== day || l.kind !== "lesson" || l.state !== "closed" || l.category_id == null) continue;
    load.set(l.category_id, (load.get(l.category_id) ?? 0) + 1);
  }
  return load;
}
