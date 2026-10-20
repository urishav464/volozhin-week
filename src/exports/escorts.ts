// The escorts' list for print (DESIGN «תוצרים» 2): grouped by escort — the
// trainee's name, how many lessons (in their gender) — and for each lesson the
// day, the teaching time, the room, the speaker, the title, who introduces the
// speaker (the speaker themself, or the escort — each phrase in the right
// gender), and «משהו שחשוב לדעת»: the instructor's duty phrases that apply
// (src/domain/escorts.ts) and the lesson's own note. Closed lessons with no
// escort — and no self-introduction, which needs none — close the list, so the
// team sees what is still open. A memorial slot is in its liaison's group (its
// escort is the family's contact person, 5ב-2): «זמן זיכרון – <the fallen>»,
// never a family's contact detail. Pure.
import { dutyNotes, escortable } from "../domain/escorts";
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
  const escorted = week.lessons.filter(escortable).sort(gridOrder(week));
  const fallen = new Map((week.fallen ?? []).map((f) => [f.id, f.name]));
  const planOn = new Map((week.memorialPlans ?? []).filter((p) => p.lesson_id != null).map((p) => [p.lesson_id!, p]));

  const line = (l: Lesson, escort: RosterMember | null): EscortLesson => {
    if (l.kind === "memorial") {
      const name = fallen.get(planOn.get(l.id)?.fallen_id ?? -1);
      return {
        lesson: l, speakerId: null, ...teachingWhen(l, lessonMinutes), room: rooms.get(l.room_id) ?? "", speaker: "",
        title: name ? `זמן זיכרון – ${name}` : (l.title ?? "זמן זיכרון"),
        intro: "זמן זיכרון",
        introDetail: byGender(escort?.gender ?? null, "איש הקשר של המשפחה", "אשת הקשר של המשפחה", "איש/אשת הקשר של המשפחה"),
        notes: [...dutyNotes(l, phrases), ...(l.escort_note ? [l.escort_note] : [])],
      };
    }
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
      const mine = escorted.filter((l) => l.escort_roster_id === r.id);
      return {
        escort: r,
        heading: r.full_name,
        load: `${byGender(r.gender, "הוא מלווה", "היא מלווה", "מלווה")} ${lessonsWord(mine.length)}`,
        lessons: mine.map((l) => line(l, r)),
      };
    })
    .filter((g) => g.lessons.length > 0);
  // a self-introduced lesson needs no escort (its escort stage is done — src/domain/stages.ts): not «open»
  const open = closed.filter((l) => l.escort_roster_id == null && !l.self_intro);
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
