// v19's guests' schedule (publicSchedule ≡ public.schedule_view; tests/parity holds the two equal): the rows keep the
// designer's ten keys and add the note and the people's indexes; the people are only those approved for THIS edition,
// each once, by first appearance; the fixed rows are what the grid shows on each day. Synthetic only.
import { describe, expect, it } from "vitest";
import { scheduleEntries } from "./designer";
import { fixedRows, publicSchedule } from "./publicSchedule";
import { photoBase64 } from "../testing/photos";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";

const noPhoto = () => null;

function week() {
  const w = emptyWeek();
  const a = addSpeaker(w, "f", "מרצה לדוגמה א");
  const b = addSpeaker(w, "m", "מרצה לדוגמה ב");
  const c = addSpeaker(w, null, "מרצה לדוגמה ג");
  a.title = "ד״ר";
  a.public_bio = "תיאור לדוגמה";
  const l1 = closeWith(w, addLesson(w, 1, 600, 690), a); // Monday 10:00
  const l2 = closeWith(w, addLesson(w, 1, 510, 600), b, c); // Monday 08:30 — earlier in the grid
  const l3 = closeWith(w, addLesson(w, 2, 510, 600), a); // a's second lesson
  const draft = addLesson(w, 3, 510, 600); // not public
  w.lessonSpeakers.push({ lesson_id: draft.id, speaker_id: c.id, role: "lead" });
  return { w, a, b, c, l1, l2, l3 };
}

describe("publicSchedule", () => {
  it("no approval: the rows as the designer's, no note, nobody", () => {
    const { w } = week();
    const v = publicSchedule(w, noPhoto);
    expect(Object.keys(v).sort()).toEqual(["edition", "fixed", "people", "rows"]);
    expect(v.people).toEqual([]);
    expect(v.rows.map(({ note, people, ...rest }) => [rest, note, people])).toEqual(
      scheduleEntries(w).map(({ lesson_id: _id, ...e }) => [e, null, []]),
    );
    expect(v.edition).toEqual({ label: w.edition.label, start_date: w.edition.start_date });
  });

  it("only speakers this edition approved, each once, in the order they first appear; a co-speaker without one stays a name", () => {
    const { w, a, b } = week();
    addApproach(w, a).public_ok = true;
    addApproach(w, b).public_ok = true;
    // c has no approach: in the row's names, never among the people
    const v = publicSchedule(w, (id) => (id === a.id ? photoBase64("clean") : null));
    expect(v.people).toEqual([
      { label: "מרצה לדוגמה ב", bio: null, photo: null },
      { label: "ד״ר מרצה לדוגמה א", bio: "תיאור לדוגמה", photo: `data:image/jpeg;base64,${photoBase64("clean")}` },
    ]);
    expect(v.rows.map((r) => [r.day, r.start_min, r.speaker, r.people])).toEqual([
      [1, 510, "מרצה לדוגמה ב · מרצה לדוגמה ג", [0]],
      [1, 600, "ד״ר מרצה לדוגמה א", [1]],
      [2, 510, "ד״ר מרצה לדוגמה א", [1]],
    ]);
  });

  it("an approval not given (or taken back) is no approval; the photo is asked for only for those shown", () => {
    const { w, a, b } = week();
    addApproach(w, a); // public_ok absent: false
    const ok = addApproach(w, b);
    ok.public_ok = false;
    const asked: number[] = [];
    const v = publicSchedule(w, (id) => {
      asked.push(id);
      return photoBase64("clean");
    });
    expect(v.people).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("a lesson's public_note; a memorial time has none and no people, whatever its row", () => {
    const { w, a, l1 } = week();
    addApproach(w, a).public_ok = true;
    l1.public_note = "שורה לאורחים";
    addLesson(w, 0, 780, 795, { kind: "memorial", public_note: "לא לאורחים" });
    const v = publicSchedule(w, noPhoto);
    expect(v.rows.map((r) => [r.kind, r.day, r.start_min, r.note, r.people])).toEqual([
      ["memorial", 0, 780, null, []],
      ["lesson", 1, 510, null, []],
      ["lesson", 1, 600, "שורה לאורחים", [0]],
      ["lesson", 2, 510, null, [0]],
    ]);
  });

  it("the lead first, then by speaker id — in a lesson's order of names and in who appears first", () => {
    const w = emptyWeek();
    const x = addSpeaker(w, "f", "מרצה לדוגמה ד");
    const y = addSpeaker(w, "m", "מרצה לדוגמה ה");
    const z = addSpeaker(w, "m", "מרצה לדוגמה ו");
    const l = addLesson(w, 1, 510, 600, { state: "closed" });
    // z leads, x and y are co-speakers (x's id smaller)
    w.lessonSpeakers.push({ lesson_id: l.id, speaker_id: y.id, role: "co" }, { lesson_id: l.id, speaker_id: z.id, role: "lead" }, { lesson_id: l.id, speaker_id: x.id, role: "co" });
    for (const s of [x, y, z]) addApproach(w, s).public_ok = true;
    const v = publicSchedule(w, noPhoto);
    expect(v.people.map((p) => p.label)).toEqual(["מרצה לדוגמה ו", "מרצה לדוגמה ד", "מרצה לדוגמה ה"]);
    expect(v.rows[0].people).toEqual([0, 1, 2]);
    expect(v.rows[0].speaker).toBe("מרצה לדוגמה ו · מרצה לדוגמה ד · מרצה לדוגמה ה");
  });

  it("the fixed rows on each day the grid shows them: Sunday from its opening, Thursday until its close — by day, start, end, label", () => {
    const w = emptyWeek();
    const f = fixedRows(w);
    expect(f).toHaveLength(29);
    expect(f.filter((r) => r.day === 0).map((r) => r.start_min)).toEqual([795, 1140, 1290, 1440, 1740]);
    expect(f.filter((r) => r.day === 4).map((r) => r.start_min)).toEqual([420, 480, 795]);
    for (const d of [1, 2, 3]) expect(f.filter((r) => r.day === d)).toHaveLength(7);
    expect(f[0]).toEqual({ day: 0, start_min: 795, end_min: 855, label: "ארוחת צהריים / חבורות" });
    // a row's own days; an opening set to none shows Sunday whole; labels break a tie
    w.rows = [
      { id: 1, start_min: 420, end_min: 480, kind: "fixed", label: "ב", days: [2] },
      { id: 2, start_min: 420, end_min: 480, kind: "fixed", label: "א", days: [2, 0] },
      { id: 3, start_min: 510, end_min: 600, kind: "lesson", label: "", days: [0, 1, 2, 3, 4] },
      { id: 4, start_min: 780, end_min: 795, kind: "memorial", label: "זמן זיכרון", days: [0] },
      { id: 5, start_min: 1290, end_min: 1350, kind: "kk", label: "מכריכה לכריכה", days: [4] },
    ];
    w.edition.first_day_from = null;
    expect(fixedRows(w)).toEqual([
      { day: 0, start_min: 420, end_min: 480, label: "א" },
      { day: 2, start_min: 420, end_min: 480, label: "א" },
      { day: 2, start_min: 420, end_min: 480, label: "ב" },
    ]);
    expect(publicSchedule(w, noPhoto).fixed).toEqual(fixedRows(w));
  });

  it("never a key the guests should not read: no contact, no vetting note, no internal speaker field", () => {
    const { w, a } = week();
    addApproach(w, a).public_ok = true;
    a.vetted_note = "הערה פנימית";
    a.bio_short = "תיאור פנימי";
    const text = JSON.stringify(publicSchedule(w, noPhoto));
    for (const key of ["vetted_note", "bio_short", "disambiguator", "public_ok", "has_photo", "image", "phone", "email"]) expect(text).not.toContain(`"${key}"`);
    expect(text).not.toContain("הערה פנימית");
    expect(text).not.toContain("תיאור פנימי");
  });
});
