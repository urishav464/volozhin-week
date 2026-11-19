import { describe, expect, it } from "vitest";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../testing/week";
import { afterCounts, afterRows } from "./after";

// The week starts on Sunday 2027-02-14 (emptyWeek); Monday's lessons open on Tuesday the 16th.
const ME = 2;

function fixture() {
  const w = emptyWeek();
  const mine = addSpeaker(w, "f");
  const theirs = addSpeaker(w, "m");
  const nobody = addSpeaker(w, "f");
  Object.assign(addApproach(w, mine, "positive"), { owner_member_id: ME });
  Object.assign(addApproach(w, theirs, "positive"), { owner_member_id: 3 });
  Object.assign(addApproach(w, nobody, "positive"), { owner_member_id: null });
  const monLate = closeWith(w, addLesson(w, 1, 960, 1050), mine);
  const sun = closeWith(w, addLesson(w, 0, 510, 600), mine);
  const night = closeWith(w, addLesson(w, 1, 1470, 1560), mine); // 00:30–02:00: ends on Tuesday's date
  const other = closeWith(w, addLesson(w, 0, 600, 690), theirs);
  const unowned = closeWith(w, addLesson(w, 2, 510, 600), nobody);
  const draft = addLesson(w, 0, 870, 960);
  pitch(w, draft, addApproach(w, addSpeaker(w, "m"), "positive"), "candidate");
  addLesson(w, 1, 780, 795, { kind: "memorial", state: "closed" });
  addLesson(w, 1, 690, 780, { state: "cancelled" });
  return { w, sun, monLate, night, other, unowned };
}

describe("afterRows", () => {
  it("my closed lessons in time order; every closed lesson for «כל השיעורים» — never a draft, a memorial slot or a cancelled one", () => {
    const { w, sun, monLate, night, other, unowned } = fixture();
    const now = "2027-02-20T10:00:00Z";
    expect(afterRows(w, ME, false, now).map((r) => r.lesson.id)).toEqual([sun.id, monLate.id, night.id]);
    expect(afterRows(w, ME, true, now).map((r) => [r.lesson.id, r.handler])).toEqual([
      [sun.id, ME],
      [other.id, 3],
      [monLate.id, ME],
      [night.id, ME],
      [unowned.id, null],
    ]);
    expect(afterRows(w, 9, false, now)).toEqual([]);
  });

  it("each with its window: before, open, the date TBD — a night lesson opens a day later", () => {
    const { w, sun, monLate, night } = fixture();
    const on = (nowIso: string) => Object.fromEntries(afterRows(w, ME, false, nowIso).map((r) => [r.lesson.id, r.win]));
    const tue = on("2027-02-16T10:00:00Z");
    expect(tue[sun.id]).toEqual({ state: "open", opensOn: "2027-02-15" });
    expect(tue[monLate.id]).toEqual({ state: "open", opensOn: "2027-02-16" });
    expect(tue[night.id]).toEqual({ state: "before", opensOn: "2027-02-17" });
    expect(on("2027-02-14T10:00:00Z")[sun.id]).toEqual({ state: "before", opensOn: "2027-02-15" });
    w.edition.start_date = null;
    expect(afterRows(w, ME, false, "2027-02-20T10:00:00Z").every((r) => r.win.state === "tbd")).toBe(true);
  });
});

describe("afterCounts", () => {
  it("written and not yet, over the rows shown", () => {
    const { w, sun, other } = fixture();
    const rows = afterRows(w, ME, true, "2027-02-20T10:00:00Z");
    expect(afterCounts(rows, new Set([sun.id, other.id, 424242]))).toEqual({ written: 2, missing: 3 });
    expect(afterCounts([], new Set([sun.id]))).toEqual({ written: 0, missing: 0 });
  });
});
