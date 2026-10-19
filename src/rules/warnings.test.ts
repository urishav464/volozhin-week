import { describe, expect, it } from "vitest";
import { addApproach, addLesson, addSpeaker, addTrainee, closeWith, emptyWeek, pitch } from "../testing/week";
import { ESCORT_MIN_GAP, warningsFor } from "./warnings";

const kinds = (w: ReturnType<typeof emptyWeek>) => warningsFor(w).map((x) => x.kind).sort();

describe("warningsFor", () => {
  it("is quiet on a clean day", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 1, 510, 600, { title: "א", category_id: 1 }), addSpeaker(w, "m"));
    closeWith(w, addLesson(w, 1, 600, 690, { title: "ב", category_id: 2 }), addSpeaker(w, "f"));
    expect(warningsFor(w)).toEqual([]);
  });

  it("reports parallel lessons as information", () => {
    const w = emptyWeek();
    addLesson(w, 2, 960, 1050, { room_id: 1 });
    addLesson(w, 2, 960, 1050, { room_id: 2 });
    const [p] = warningsFor(w);
    expect(p.kind).toBe("parallel");
    expect(p.severity).toBe("info");
    expect(p.lessonIds).toHaveLength(2);
  });

  it("warns on the same category back to back, not across a meal", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 1, 510, 600, { title: "א", category_id: 1 }), addSpeaker(w, "m"));
    closeWith(w, addLesson(w, 1, 600, 690, { title: "ב", category_id: 1 }), addSpeaker(w, "f"));
    closeWith(w, addLesson(w, 1, 1140 - 90, 1140, { title: "ג", category_id: 2 }), addSpeaker(w, "m"));
    closeWith(w, addLesson(w, 1, 1200, 1290, { title: "ד", category_id: 2 }), addSpeaker(w, "f")); // after dinner (60 min)
    expect(kinds(w)).toEqual(["back_to_back"]);
  });

  it("reports three in a row as one run", () => {
    const w = emptyWeek();
    for (const [s, g] of [[510, "m"], [600, "f"], [690, "m"]] as const) {
      closeWith(w, addLesson(w, 2, s, s + 90, { title: "x", category_id: 2 }), addSpeaker(w, g));
    }
    const runs = warningsFor(w).filter((x) => x.kind === "back_to_back");
    expect(runs).toHaveLength(1);
    expect(runs[0].lessonIds).toHaveLength(3);
    expect(runs[0].message).toBe("3 שיעורי «פילוסופיה» ברצף בשלישי");
  });

  it("warns when one category fills a day past the suggestion", () => {
    const w = emptyWeek();
    w.edition.settings.max_category_per_day = 2;
    for (const [s, g] of [[510, "m"], [690, "f"], [960, "m"]] as const) {
      closeWith(w, addLesson(w, 3, s, s + 90, { title: "x", category_id: 1 }), addSpeaker(w, g));
    }
    expect(kinds(w)).toEqual(["category_load"]);
  });

  it("warns on a speaker closed twice, by name and gender", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "f", "פלונית");
    closeWith(w, addLesson(w, 1, 510, 600, { title: "א", category_id: 1 }), s);
    closeWith(w, addLesson(w, 3, 510, 600, { title: "ב", category_id: 2 }), s);
    const [x] = warningsFor(w);
    expect(x.kind).toBe("speaker_twice");
    expect(x.message).toContain("פלונית משובצת");
  });

  it("warns on a pitch outside the speaker's stated availability and on a declined speaker", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "m", "פלוני");
    const a = addApproach(w, s, "declined");
    w.availability.push({ id: 1, approach_id: a.id, day: 2, from_min: 390, to_min: 780, kind: "cannot", note: null });
    pitch(w, addLesson(w, 2, 510, 600), a);
    expect(kinds(w)).toEqual(["declined_pitch", "outside_availability"]);
    expect(warningsFor(w).find((x) => x.kind === "outside_availability")!.message).toContain("פלוני אמר שלא יכול");
  });

  it("warns on a lesson outside the week's hours or over a fixed block", () => {
    const w = emptyWeek();
    addLesson(w, 4, 1200, 1290); // Thursday 20:00 — the week ended at 19:00
    addLesson(w, 1, 1140, 1200); // over dinner
    expect(kinds(w)).toEqual(["fixed_overlap", "outside_window"]);
  });

  it("lists what a closed lesson is missing", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 1, 510, 600), addSpeaker(w, null));
    const [x] = warningsFor(w);
    expect(x.kind).toBe("missing_info");
    expect(x.message).toContain("כותרת");
    expect(x.message).toContain("קטגוריה");
    expect(x.message).toContain("מגדר המרצה");
  });

  it("gives every warning a stable key for «מכוון»", () => {
    const w = emptyWeek();
    addLesson(w, 2, 960, 1050, { room_id: 1 });
    addLesson(w, 2, 960, 1050, { room_id: 2 });
    expect(warningsFor(w)[0].key).toBe(warningsFor(w)[0].key);
    expect(warningsFor(w)[0].key).toMatch(/^parallel:\d+,\d+$/);
  });

  it("warns when one escort has two lessons less than 30 minutes apart («הצעה») — across midnight too, and at the same time", () => {
    expect(ESCORT_MIN_GAP).toBe(30);
    const w = emptyWeek();
    const t = addTrainee(w, "חניכה לדוגמה", "f");
    const lesson = (day: 0 | 1 | 2 | 3 | 4, start: number, end: number) => {
      const l = addLesson(w, day, start, end, { title: "x", category_id: (start % 2) + 1, escort_roster_id: t.id });
      return closeWith(w, l, addSpeaker(w, start % 2 ? "f" : "m"));
    };
    const a = lesson(1, 510, 600);
    const b = lesson(1, 600, 690); // right after: 0 minutes
    lesson(1, 870, 960); // 3 hours later: fine
    const night = lesson(1, 1650, 1740); // 03:30–05:00 …
    const morning = lesson(2, 390, 435); // … then 06:30 the next day column: 90 minutes, fine
    const gaps = warningsFor(w).filter((x) => x.kind === "escort_gap");
    expect(gaps.map((g) => [g.lessonIds, g.severity])).toEqual([[[a.id, b.id], "warn"]]);
    expect(gaps[0].message).toBe("«חניכה לדוגמה» מלווה שני שיעורים צמודים, בלי הפסקה ביניהם (שני 10:00–11:30; הצעה: לפחות 30 דקות)");
    expect([night.id, morning.id].some((id) => gaps.some((g) => g.lessonIds.includes(id)))).toBe(false);

    lesson(2, 410, 500); // overlaps the 06:30 opening
    lesson(3, 600, 690);
    lesson(3, 710, 780); // 20 minutes
    const more = warningsFor(w).filter((x) => x.kind === "escort_gap").map((g) => g.message);
    expect(more).toContain("«חניכה לדוגמה» מלווה שני שיעורים חופפים (שלישי 06:50–08:20)");
    expect(more).toContain("«חניכה לדוגמה» מלווה שני שיעורים עם 20 דקות ביניהם (רביעי 11:50–13:00; הצעה: לפחות 30)");
  });
});
