import { describe, expect, it } from "vitest";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../testing/week";
import { categoryLoad, dayBalance, leadingPitch } from "./balance";

describe("dayBalance", () => {
  it("an even day needs nobody in particular", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 1, 510, 600), addSpeaker(w, "m"));
    closeWith(w, addLesson(w, 1, 600, 690), addSpeaker(w, "f"));
    const b = dayBalance(1, w, 5);
    expect(b.need).toBeNull();
    expect(b.open).toBe(5);
  });

  it("a day with more men tints its open cells for women — pending pitches count", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 1, 510, 600), addSpeaker(w, "m"));
    const draft = addLesson(w, 1, 600, 690);
    pitch(w, draft, addApproach(w, addSpeaker(w, "m")));
    const b = dayBalance(1, w, 3);
    expect(b.closed.m).toBe(1);
    expect(b.pending.m).toBe(1);
    expect(b.need).toBe("f");
    expect(b.deficit).toBe(2);
    expect(b.unreachable).toBe(false);
  });

  it("counts a draft with no live pitch as an open cell", () => {
    const w = emptyWeek();
    const draft = addLesson(w, 2, 510, 600);
    pitch(w, draft, addApproach(w, addSpeaker(w, "f")), "declined");
    expect(dayBalance(2, w, 0).open).toBe(1);
  });

  it("splits a co-taught lesson between its speakers", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 3, 510, 600), addSpeaker(w, "m"), addSpeaker(w, "f"));
    const b = dayBalance(3, w, 2);
    expect(b.closed).toEqual({ m: 0.5, f: 0.5, unknown: 0 });
    expect(b.need).toBeNull();
  });

  it("flags a day that can no longer end even", () => {
    const w = emptyWeek();
    for (const start of [510, 600, 690]) closeWith(w, addLesson(w, 0, start, start + 90), addSpeaker(w, "f"));
    const b = dayBalance(0, w, 1);
    expect(b.need).toBe("m");
    expect(b.unreachable).toBe(true);
  });

  it("ignores memorial slots, other days and cancelled lessons", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 1, 780, 795, { kind: "memorial" }), addSpeaker(w, "m"));
    closeWith(w, addLesson(w, 2, 510, 600), addSpeaker(w, "m"));
    closeWith(w, addLesson(w, 1, 510, 600), addSpeaker(w, "m")).state = "cancelled";
    expect(dayBalance(1, w, 4).closed).toEqual({ m: 0, f: 0, unknown: 0 });
  });
});

describe("leadingPitch", () => {
  it("prefers an approach over a candidate, then the oldest", () => {
    const w = emptyWeek();
    const l = addLesson(w, 1, 510, 600);
    const c = pitch(w, l, addApproach(w, addSpeaker(w, "m")), "candidate");
    const a1 = pitch(w, l, addApproach(w, addSpeaker(w, "f")), "approached");
    pitch(w, l, addApproach(w, addSpeaker(w, "m")), "approached");
    expect(leadingPitch(l.id, w.pitches)?.id).toBe(a1.id);
    expect(leadingPitch(l.id, w.pitches.filter((p) => p.state === "candidate"))?.id).toBe(c.id);
  });
});

describe("categoryLoad", () => {
  it("counts closed lessons per category", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 1, 510, 600, { category_id: 1 }), addSpeaker(w, "m"));
    closeWith(w, addLesson(w, 1, 600, 690, { category_id: 1 }), addSpeaker(w, "f"));
    addLesson(w, 1, 690, 780, { category_id: 1 }); // a draft does not count
    expect(categoryLoad(1, w.lessons).get(1)).toBe(2);
  });
});
