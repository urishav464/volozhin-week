// «המרצים שלי», the team's board and the approvals queue, derived from a loaded Week (pure, so every device groups
// the same way). The groups follow the next step (v14: the call comes first): להתקשר → לנסות שוב / מחכים לתשובה →
// הסכימו — ממתינים לאישור (the instructor's approval waits only for closing) → לסגור שעה; then, for each closed
// lesson, its own next step (src/domain/stages.ts): תשלום/הסעה → לעדכן את המרצה → לשלוח סיכום → חסר מלווה → חסרים
// מקורות → נסגר. A hand-over waiting for me comes first.
import { ownerColors } from "../grid/owners";
import { type LessonStep, nextLessonStep, readerFilesOf } from "./stages";
import type { Approach, Lesson, Pitch, Speaker, Week } from "./types";
import { LIVE_PITCH } from "./types";

export type MineGroup =
  | "offered"
  | "to_call"
  | "retry"
  | "awaiting"
  | "agreed"
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
  { group: "to_call", label: "להתקשר" }, // «לפני שיחה»
  { group: "retry", label: "לנסות שוב" }, // «לא ענה/תה»
  { group: "awaiting", label: "מחכים לתשובה" }, // «שוחחנו, מחכים לתשובה»
  { group: "agreed", label: "הסכימו — ממתינים לאישור" }, // agreed, not (yet) approved by the instructor
  { group: "to_schedule", label: "לסגור שעה" }, // agreed and approved, no lesson closed yet
  { group: "payment", label: "תשלום/הסעה" },
  { group: "reconfirm", label: "לעדכן את המרצה" },
  { group: "send", label: "לשלוח סיכום" },
  { group: "escort", label: "חסר מלווה" },
  { group: "sources", label: "חסרים מקורות" },
  { group: "closed", label: "נסגר" }, // every step of the handler's done (the reader comes later)
  { group: "declined", label: "סירבו" },
];

const GROUP_ORDER = new Map(MINE_GROUPS.map((g, i) => [g.group, i]));

/** A closed lesson's next step → its group (null: everything in place → «נסגר»). */
const STEP_GROUP: Record<LessonStep, MineGroup> = { payment: "payment", reconfirm: "reconfirm", send: "send", escort: "escort", sources: "sources" };

const byTime = (a: Lesson, b: Lesson) => a.day - b.day || a.start_min - b.start_min || a.id - b.id;

export interface MineRow {
  speaker: Speaker;
  approach: Approach;
  group: MineGroup;
  /** The speaker's closed lessons this edition, by time. */
  closed: Lesson[];
  /** Cells the speaker is still pitched in (candidate / approached), by the lesson's time. */
  live: Pitch[];
  /** For a speaker who teaches: the one closed lesson this row is about (a row per lesson, each in its next step's group). */
  lesson?: Lesson;
}

/**
 * Where a speaker stands: for one of their closed lessons, that lesson's next step; before any, the call's result —
 * and once they agreed, the instructor's approval (a rejected speaker stays under «הסכימו — ממתינים לאישור»).
 */
export function groupOf(week: Week, a: Approach, s: Speaker, lesson?: Lesson): MineGroup {
  if (lesson) {
    const step = nextLessonStep(lesson, readerFilesOf(week, lesson.id));
    return step ? STEP_GROUP[step] : "closed";
  }
  switch (a.status) {
    case "claimed":
      return "to_call";
    case "no_answer":
      return "retry";
    case "approached":
      return "awaiting";
    case "positive":
      return s.vetted === "approved" ? "to_schedule" : "agreed";
    case "declined":
      return "declined";
  }
}

/** One approach's rows: one per closed lesson, else one by where it stands; `offered`: a hand-over waiting for me. */
function rowsOf(week: Week, ix: Index, a: Approach, speaker: Speaker, offered: boolean): MineRow[] {
  const closed = ix.closedBySpeaker.get(a.speaker_id) ?? [];
  const live = ix.liveByApproach.get(a.id) ?? [];
  if (offered) return [{ speaker, approach: a, group: "offered", closed, live }];
  if (closed.length > 0) return closed.map((lesson) => ({ speaker, approach: a, group: groupOf(week, a, speaker, lesson), closed, live, lesson }));
  return [{ speaker, approach: a, group: groupOf(week, a, speaker), closed, live }];
}

interface Index {
  speakerById: Map<number, Speaker>;
  closedBySpeaker: Map<number, Lesson[]>;
  liveByApproach: Map<number, Pitch[]>;
}

/** The lookups every row needs, once per call. */
function indexOf(week: Week): Index {
  const lessonById = new Map(week.lessons.map((l) => [l.id, l]));
  const closedBySpeaker = new Map<number, Lesson[]>();
  for (const x of week.lessonSpeakers) {
    const l = lessonById.get(x.lesson_id);
    if (l?.state !== "closed") continue;
    closedBySpeaker.set(x.speaker_id, [...(closedBySpeaker.get(x.speaker_id) ?? []), l]);
  }
  for (const list of closedBySpeaker.values()) list.sort(byTime);
  const liveByApproach = new Map<number, Pitch[]>();
  for (const p of week.pitches) {
    const l = lessonById.get(p.lesson_id);
    if (!LIVE_PITCH.has(p.state) || !l) continue;
    liveByApproach.set(p.approach_id, [...(liveByApproach.get(p.approach_id) ?? []), p]);
  }
  for (const list of liveByApproach.values()) list.sort((x, y) => byTime(lessonById.get(x.lesson_id)!, lessonById.get(y.lesson_id)!) || x.id - y.id);
  return { speakerById: new Map(week.speakers.map((s) => [s.id, s])), closedBySpeaker, liveByApproach };
}

const byName = (x: MineRow, y: MineRow) =>
  x.speaker.name.localeCompare(y.speaker.name, "he") || x.speaker.id - y.speaker.id || (x.lesson && y.lesson ? byTime(x.lesson, y.lesson) : 0);

/** My speakers this edition, by next step; a speaker offered to me (not yet mine, waiting for my answer) under «הוצעו לי». */
export function mySpeakers(week: Week, me: number): Map<MineGroup, MineRow[]> {
  const out = new Map<MineGroup, MineRow[]>(MINE_GROUPS.map((g) => [g.group, []]));
  const ix = indexOf(week);
  for (const a of week.approaches) {
    const mine = a.owner_member_id === me;
    const offered = a.offered_to === me && !mine;
    if (!mine && !offered) continue;
    const speaker = ix.speakerById.get(a.speaker_id);
    if (!speaker) continue;
    for (const row of rowsOf(week, ix, a, speaker, offered)) out.get(row.group)!.push(row);
  }
  for (const rows of out.values()) rows.sort(byName);
  return out;
}

/** One handler's block on the team's board: their colour of the «אחריות» lens (src/grid/owners.ts), their rows. */
export interface TeamBlock {
  id: number;
  name: string;
  color: string;
  rows: MineRow[];
}

/**
 * «כל הצוות»: every handler's speakers, in the team's order (ownerColors), each block's rows by group, then by name.
 * `unowned` («בלי אחראי/ת») holds only speakers in process — an approach this edition with nobody handling it (sent
 * back to the pool, or its handler no longer on the team) — never the pool's speakers nobody approached.
 */
export function teamBoard(week: Week): { owners: TeamBlock[]; unowned: MineRow[] } {
  const owners: TeamBlock[] = ownerColors(week.team).map((o) => ({ ...o, rows: [] }));
  const blockById = new Map(owners.map((o) => [o.id, o]));
  const unowned: MineRow[] = [];
  const ix = indexOf(week);
  for (const a of week.approaches) {
    const speaker = ix.speakerById.get(a.speaker_id);
    if (!speaker) continue;
    const rows = rowsOf(week, ix, a, speaker, false);
    (blockById.get(a.owner_member_id ?? -1)?.rows ?? unowned).push(...rows);
  }
  const byGroup = (x: MineRow, y: MineRow) => GROUP_ORDER.get(x.group)! - GROUP_ORDER.get(y.group)! || byName(x, y);
  for (const o of owners) o.rows.sort(byGroup);
  unowned.sort(byGroup);
  return { owners, unowned };
}

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

/**
 * The header's badge: what holds the team up until a global admin acts — speakers who agreed and wait for approval
 * before their time can be closed, and payment/transport requests. Other speakers waiting for approval are not counted.
 */
export function waitingForApproval(week: Week): number {
  return agreedPending(week).length + pendingPayments(week).length;
}

const speakerByName = (a: Speaker, b: Speaker) => a.name.localeCompare(b.name, "he") || a.id - b.id;

/** The approvals queue's speakers (a global admin's): waiting for vetting, not retired, by name. */
export function pendingSpeakers(week: Week): Speaker[] {
  return week.speakers.filter((s) => s.vetted === "pending" && !s.retired).sort(speakerByName);
}

/** Of those, the ones who agreed to teach this edition («הסכים/ה»): closing their time waits for the approval alone. */
export function agreedPending(week: Week): Speaker[] {
  const agreed = new Set(week.approaches.filter((a) => a.status === "positive").map((a) => a.speaker_id));
  return pendingSpeakers(week).filter((s) => agreed.has(s.id));
}

/**
 * «אישור באצווה: מי שלימד/ה ב-<מחזור>» («הצעה», DESIGN «ייבוא תשפ"ו»): the speakers still waiting for approval who
 * taught a closed lesson of that edition — an archive the import made — lead or co.
 */
export function pendingWhoTaught(pending: Speaker[], edition: Pick<Week, "lessons" | "lessonSpeakers">): Speaker[] {
  const closed = new Set(edition.lessons.filter((l) => l.state === "closed").map((l) => l.id));
  const taught = new Set(edition.lessonSpeakers.filter((x) => closed.has(x.lesson_id)).map((x) => x.speaker_id));
  return pending.filter((s) => taught.has(s.id));
}

/** The one primary action of a «המרצים שלי» row. */
export type MineStep = "accept" | "call" | "vet" | "close" | LessonStep | "lesson" | null;

export function nextStep(group: MineGroup): MineStep {
  switch (group) {
    case "offered":
      return "accept"; // take the hand-over
    case "to_call":
    case "retry":
    case "awaiting":
      return "call"; // the sheet, open at the call: its points and its result
    case "agreed":
      return "vet"; // a chip — and «אישור» for the global admin
    case "to_schedule":
      return "close"; // to the first cell they are pitched in, else placing them on the week
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
