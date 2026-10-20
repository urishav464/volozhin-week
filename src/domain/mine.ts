// «המרצים שלי» and the approvals queue, derived from a loaded Week (pure, so
// every device groups the same way). The groups follow the next step
// (DESIGN «המרצים שלי»): לפנות → מחכה לתשובה → לסגור שעה; then, for each
// closed lesson, its own next step (src/domain/stages.ts): תשלום/הסעה →
// לעדכן את המרצה → לשלוח סיכום → חסר מלווה → חסרים מקורות → נסגר. A
// hand-over waiting for me comes first.
import { type LessonStep, nextLessonStep, readerFilesOf } from "./stages";
import type { Approach, Lesson, Pitch, Speaker, Week } from "./types";
import { LIVE_PITCH } from "./types";

export type MineGroup =
  | "offered"
  | "to_approach"
  | "awaiting"
  | "to_schedule"
  | "payment"
  | "reconfirm"
  | "send"
  | "escort"
  | "sources"
  | "closed"
  | "declined";

/** In the order a phone shows them. */
export const MINE_GROUPS: readonly { group: MineGroup; label: string }[] = [
  { group: "offered", label: "הוצעו לי" },
  { group: "to_approach", label: "לפנות" },
  { group: "awaiting", label: "מחכה לתשובה" },
  { group: "to_schedule", label: "לסגור שעה" },
  { group: "payment", label: "תשלום/הסעה" },
  { group: "reconfirm", label: "לעדכן את המרצה" },
  { group: "send", label: "לשלוח סיכום" },
  { group: "escort", label: "חסר מלווה" },
  { group: "sources", label: "חסרים מקורות" },
  { group: "closed", label: "נסגר" }, // every step of the handler's done (the reader comes later)
  { group: "declined", label: "סירבו" },
];

/** A closed lesson's next step → its group (null: everything in place → «נסגר»). */
const STEP_GROUP: Record<LessonStep, MineGroup> = { payment: "payment", reconfirm: "reconfirm", send: "send", escort: "escort", sources: "sources" };

export interface MineRow {
  speaker: Speaker;
  approach: Approach;
  group: MineGroup;
  /** The speaker's closed lessons this edition. */
  closed: Lesson[];
  /** Cells the speaker is still pitched in (candidate / approached). */
  live: Pitch[];
  /** For a speaker who teaches: the one closed lesson this row is about (a row per lesson, each in its next step's group). */
  lesson?: Lesson;
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
    if (!offered && closed.length > 0) {
      for (const lesson of [...closed].sort(byTime)) {
        const step = nextLessonStep(lesson, readerFilesOf(week, lesson.id));
        const group = step ? STEP_GROUP[step] : "closed";
        out.get(group)!.push({ speaker, approach: a, group, closed, live, lesson });
      }
      continue;
    }
    const group: MineGroup = offered
      ? "offered"
      : a.status === "claimed"
        ? "to_approach"
        : a.status === "positive"
          ? "to_schedule"
          : a.status === "declined"
            ? "declined"
            : "awaiting"; // approached, no_answer
    out.get(group)!.push({ speaker, approach: a, group, closed, live });
  }
  for (const rows of out.values()) {
    rows.sort((x, y) => x.speaker.name.localeCompare(y.speaker.name, "he") || x.speaker.id - y.speaker.id || (x.lesson && y.lesson ? byTime(x.lesson, y.lesson) : 0));
  }
  return out;
}

const byTime = (a: Lesson, b: Lesson) => a.day - b.day || a.start_min - b.start_min || a.id - b.id;

/** A payment/transport request waiting for the instructor, with who teaches it and who handles it. */
export interface PaymentRow {
  lesson: Lesson;
  /** The lead speaker. */
  speaker: Speaker | null;
  /** The handler (members.id), who asked. */
  handler: number | null;
}

/** The approvals queue's payment and transport requests: closed lessons whose request waits (`pending`), by time. */
export function pendingPayments(week: Week): PaymentRow[] {
  const speakerById = new Map(week.speakers.map((s) => [s.id, s]));
  return week.lessons
    .filter((l) => l.state === "closed" && l.approval === "pending")
    .sort(byTime)
    .map((lesson) => {
      const lead = week.lessonSpeakers.find((x) => x.lesson_id === lesson.id && x.role === "lead");
      const speaker = lead ? (speakerById.get(lead.speaker_id) ?? null) : null;
      const handler = speaker ? (week.approaches.find((a) => a.speaker_id === speaker.id)?.owner_member_id ?? null) : null;
      return { lesson, speaker, handler };
    });
}

/** The header's badge: everything waiting for a global admin — speakers to vet and requests to decide. */
export function waitingForApproval(week: Week): number {
  return pendingSpeakers(week).length + pendingPayments(week).length;
}

/** The approvals queue's speakers (a global admin's): waiting for vetting, not retired, by name. */
export function pendingSpeakers(week: Week): Speaker[] {
  return week.speakers.filter((s) => s.vetted === "pending" && !s.retired).sort((a, b) => a.name.localeCompare(b.name, "he") || a.id - b.id);
}

/** The one primary button of a «המרצים שלי» row. */
export type MineStep = "accept" | "approached" | "positive" | "schedule" | LessonStep | "lesson" | null;

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
    case "payment":
    case "reconfirm":
    case "send":
    case "escort":
    case "sources":
      return group; // to the lesson, at that stage (a global admin decides a waiting request right there)
    case "closed":
      return "lesson"; // to the lesson on the week
    case "declined":
      return null;
  }
}
