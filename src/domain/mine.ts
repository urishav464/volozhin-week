// «המרצים שלי» and the approvals queue, derived from a loaded Week (pure, so
// every device groups the same way). The groups follow the next step
// (DESIGN «המרצים שלי»): לפנות → מחכה לתשובה → לסגור שעה → נסגר; a
// hand-over waiting for me comes first. Payment, transport, the summary
// message, escorts and sources join as groups in milestone 3.
import type { Approach, Lesson, Pitch, Speaker, Week } from "./types";
import { LIVE_PITCH } from "./types";

export type MineGroup = "offered" | "to_approach" | "awaiting" | "to_schedule" | "closed" | "declined";

/** In the order a phone shows them. */
export const MINE_GROUPS: readonly { group: MineGroup; label: string }[] = [
  { group: "offered", label: "הוצעו לי" },
  { group: "to_approach", label: "לפנות" },
  { group: "awaiting", label: "מחכה לתשובה" },
  { group: "to_schedule", label: "לסגור שעה" },
  { group: "closed", label: "נסגר" },
  { group: "declined", label: "סירבו" },
];

export interface MineRow {
  speaker: Speaker;
  approach: Approach;
  group: MineGroup;
  /** The speaker's closed lessons this edition. */
  closed: Lesson[];
  /** Cells the speaker is still pitched in (candidate / approached). */
  live: Pitch[];
}

/** My speakers this edition, by next step; a speaker offered to me (not yet mine, waiting for my answer) under «הוצעו לי». */
export function mySpeakers(week: Week, me: number): Map<MineGroup, MineRow[]> {
  const out = new Map<MineGroup, MineRow[]>(MINE_GROUPS.map((g) => [g.group, []]));
  const speakerById = new Map(week.speakers.map((s) => [s.id, s]));
  for (const a of week.approaches) {
    const mine = a.owner_member_id === me;
    const offered = a.offered_to === me && !mine;
    if (!mine && !offered) continue;
    const speaker = speakerById.get(a.speaker_id);
    if (!speaker) continue;
    const closed = week.lessons.filter(
      (l) => l.state === "closed" && week.lessonSpeakers.some((x) => x.lesson_id === l.id && x.speaker_id === a.speaker_id),
    );
    const live = week.pitches.filter((p) => p.approach_id === a.id && LIVE_PITCH.has(p.state));
    const group: MineGroup = offered
      ? "offered"
      : closed.length > 0
        ? "closed"
        : a.status === "claimed"
          ? "to_approach"
          : a.status === "positive"
            ? "to_schedule"
            : a.status === "declined"
              ? "declined"
              : "awaiting"; // approached, no_answer
    out.get(group)!.push({ speaker, approach: a, group, closed, live });
  }
  for (const rows of out.values()) rows.sort((x, y) => x.speaker.name.localeCompare(y.speaker.name, "he") || x.speaker.id - y.speaker.id);
  return out;
}

/** The approvals queue's speakers (a global admin's): waiting for vetting, not retired, by name. */
export function pendingSpeakers(week: Week): Speaker[] {
  return week.speakers.filter((s) => s.vetted === "pending" && !s.retired).sort((a, b) => a.name.localeCompare(b.name, "he") || a.id - b.id);
}

/** The one primary button of a «המרצים שלי» row. */
export type MineStep = "accept" | "approached" | "positive" | "schedule" | "lesson" | null;

export function nextStep(group: MineGroup): MineStep {
  switch (group) {
    case "offered":
      return "accept"; // take the hand-over
    case "to_approach":
      return "approached"; // «פניתי»
    case "awaiting":
      return "positive"; // «הסכים/ה»
    case "to_schedule":
      return "schedule"; // to the week, placing them
    case "closed":
      return "lesson"; // to the lesson on the week
    case "declined":
      return null;
  }
}
