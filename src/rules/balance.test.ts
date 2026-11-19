import { describe, expect, it } from "vitest";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../testing/week";
import { categoryLoad, dayBalance, leadingPitch, unbalanced, weekBalance } from "./balance";

describe("dayBalance", () => {
  it("an even day needs nobody in particular", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 1, 510, 600), addSpeaker(w, "m"));
    closeWith(w, addLesson(w, 1, 600, 690), addSpeaker(w, "f"));
    const b = dayBalance(1, w, 5);
    expect(b.need).toBeNull();
    expect(b.open).toBe(5);
  });

  it("a day whose closed lessons have more men needs women — a candidate is kept apart, never counted (phase 2)", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 1, 510, 600), addSpeaker(w, "m"));
    const draft = addLesson(w, 1, 600, 690);
    pitch(w, draft, addApproach(w, addSpeaker(w, "m")));
    const b = dayBalance(1, w, 3);
    expect(b.closed.m).toBe(1);
    expect(b.pending.m).toBe(1);
    expect(b.need).toBe("f");
    expect(b.deficit).toBe(1);
    expect(b.unreachable).toBe(false);
  });

  it("a lone male candidate on an empty day asks for nobody", () => {
    const w = emptyWeek();
    const draft = addLesson(w, 0, 960, 1050);
    pitch(w, draft, addApproach(w, addSpeaker(w, "m")));
    const b = dayBalance(0, w, 7);
    expect(b.pending).toEqual({ m: 1, f: 0, unknown: 0 });
    expect(b.need).toBeNull();
    expect(b.deficit).toBe(0);
    expect(b.unreachable).toBe(false);
  });

  it("candidates of the other side do not even the day either", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 1, 510, 600), addSpeaker(w, "m"));
    closeWith(w, addLesson(w, 1, 600, 690), addSpeaker(w, "m"));
    for (const start of [690, 870]) pitch(w, addLesson(w, 1, start, start + 90), addApproach(w, addSpeaker(w, "f")));
    const b = dayBalance(1, w, 0);
    expect(b.pending.f).toBe(2);
    expect(b.need).toBe("f");
    expect(b.deficit).toBe(2);
  });

  it("a slot in process still counts as one that could even the day", () => {
    const w = emptyWeek();
    for (const start of [510, 600]) closeWith(w, addLesson(w, 2, start, start + 90), addSpeaker(w, "m"));
    // two short of women, no free cell — but two drafts in process (a man pitched in one): not yet beyond reach
    pitch(w, addLesson(w, 2, 690, 780), addApproach(w, addSpeaker(w, "m")));
    pitch(w, addLesson(w, 2, 870, 960), addApproach(w, addSpeaker(w, null)));
    const b = dayBalance(2, w, 0);
    expect(b.need).toBe("f");
    expect(b.deficit).toBe(2);
    expect(b.unreachable).toBe(false);
    // one fewer: beyond reach
    w.pitches = w.pitches.slice(0, 1);
    w.lessons = w.lessons.filter((l) => l.start_min !== 870);
    expect(dayBalance(2, w, 0).unreachable).toBe(true);
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

describe("unbalanced and weekBalance (v13)", () => {
  it("a day is unbalanced only past the tolerance; half a co-taught lesson counts as half", () => {
    expect(unbalanced({ m: 2, f: 1, unknown: 0 }, 1)).toBe(false);
    expect(unbalanced({ m: 3, f: 1, unknown: 0 }, 1)).toBe(true);
    expect(unbalanced({ m: 1.5, f: 0, unknown: 0 }, 1)).toBe(true);
    expect(unbalanced({ m: 1, f: 0, unknown: 4 }, 1)).toBe(false); // unknown is not a side
    expect(unbalanced({ m: 1, f: 0, unknown: 0 }, 0)).toBe(true);
  });

  it("sums the week", () => {
    const t = (m: number, f: number, unknown = 0) => ({ m, f, unknown });
    expect(weekBalance([{ closed: t(2, 1), pending: t(0, 1), open: 3 }, { closed: t(0.5, 0.5, 1), pending: t(1, 0), open: 2 }])).toEqual({ closed: t(2.5, 1.5, 1), pending: t(1, 1), open: 5 });
  });
});
