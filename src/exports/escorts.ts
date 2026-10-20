// The escorts' list for print (DESIGN «תוצרים» 2): grouped by escort — the
// trainee's name, how many lessons (in their gender) — and for each lesson the
// day, the teaching time, the room, the speaker, the title, who introduces the
// speaker (the speaker themself, or the escort — each phrase in the right
// gender), and «משהו שחשוב לדעת»: the instructor's duty phrases that apply
// (src/domain/escorts.ts) and the lesson's own note. Closed lessons with no
// escort close the list, so the team sees what is still open. Pure.
import { dutyNotes } from "../domain/escorts";
import { byGender, displayName } from "../domain/names";
import type { Gender, Lesson, RosterMember, Week } from "../domain/types";
import { gridOrder, teachingWhen } from "./tracking";

export interface EscortLesson {
  lesson: Lesson;
  speakerId: number | null;
  dayLabel: string;
  time: string;
  room: string;
  speaker: string;
  title: string;
  /** «הצגה עצמית» or «הצגה על ידי המלווה». */
  intro: string;
  /** Who does it, in their gender: «המרצה מציגה את עצמה», «מציג את המרצה». */
  introDetail: string;
  /** The duty phrases that apply, in the instructor's order, then the lesson's note. */
  notes: string[];
}

export interface EscortGroup {
  /** null: the closed lessons nobody escorts yet. */
  escort: RosterMember | null;
  heading: string;
  /** «היא מלווה 2 שיעורים». */
  load: string;
  lessons: EscortLesson[];
}

function lessonsWord(n: number): string {
  return n === 1 ? "שיעור אחד" : `${n} שיעורים`;
}

export function introOf(selfIntro: boolean, speakerGender: Gender | null, escortGender: Gender | null): { intro: string; detail: string } {
  return selfIntro
    ? { intro: "הצגה עצמית", detail: byGender(speakerGender, "המרצה מציג את עצמו", "המרצה מציגה את עצמה", "המרצה מציג/ה את עצמו/ה") }
    : { intro: "הצגה על ידי המלווה", detail: `${byGender(escortGender, "מציג", "מציגה")} את ${byGender(speakerGender, "המרצה", "המרצה")}` };
}

export function escortGroups(week: Week): EscortGroup[] {
  const speakers = new Map(week.speakers.map((s) => [s.id, s]));
  const rooms = new Map(week.rooms.map((r) => [r.id, r.name]));
  const phrases = week.edition.settings?.duty_phrases;
  const lessonMinutes = week.edition.settings?.lesson_minutes;
  const closed = week.lessons.filter((l) => l.state === "closed" && l.kind === "lesson").sort(gridOrder(week));

  const line = (l: Lesson, escort: RosterMember | null): EscortLesson => {
    const lead = week.lessonSpeakers.filter((x) => x.lesson_id === l.id).sort((a, b) => Number(a.role !== "lead") - Number(b.role !== "lead"))[0];
    const s = lead ? speakers.get(lead.speaker_id) : undefined;
    const { intro, detail } = introOf(l.self_intro, s?.gender ?? null, escort?.gender ?? null);
    return {
      lesson: l,
      speakerId: s?.id ?? null,
      ...teachingWhen(l, lessonMinutes),
      room: rooms.get(l.room_id) ?? "",
      speaker: s ? displayName(s) : "",
      title: l.title ?? "TBD",
      intro,
      introDetail: detail,
      notes: [...dutyNotes(l, phrases), ...(l.escort_note ? [l.escort_note] : [])],
    };
  };

  const groups: EscortGroup[] = [...week.roster]
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "he") || a.id - b.id)
    .map((r) => {
      const mine = closed.filter((l) => l.escort_roster_id === r.id);
      return {
        escort: r,
        heading: r.full_name,
        load: `${byGender(r.gender, "הוא מלווה", "היא מלווה", "מלווה")} ${lessonsWord(mine.length)}`,
        lessons: mine.map((l) => line(l, r)),
      };
    })
    .filter((g) => g.lessons.length > 0);
  const open = closed.filter((l) => l.escort_roster_id == null);
  if (open.length) {
    groups.push({
      escort: null,
      heading: "עוד בלי מלווה",
      load: open.length === 1 ? "שיעור אחד סגור בלי מלווה" : `${open.length} שיעורים סגורים בלי מלווה`,
      lessons: open.map((l) => line(l, null)),
    });
  }
  return groups;
}
