import { describe, expect, it } from "vitest";
import type { Approach } from "../../domain/types";
import { buildModel } from "../../grid/model";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../../testing/week";
import { byDay, filterProgress, NO_FILTER, progressRows, rowMissing } from "./rows";

const own = (a: Approach, owner: number | null) => Object.assign(a, { owner_member_id: owner });
const DONE = { confirm_sent_at: "2026-11-01T10:00:00Z", self_intro: true, sources_kind: "none" } as const;

function fixture() {
  const w = emptyWeek();
  w.team = [
    { id: 1, display_name: "מדריך/ה", gender: null, role: "admin" },
    { id: 2, display_name: "חניך/ה א׳", gender: null, role: "content" },
  ];
  const s1 = addSpeaker(w, "f");
  const s2 = addSpeaker(w, "m");
  own(addApproach(w, s1, "positive"), 2);
  own(addApproach(w, s2, "positive"), null);
  const tue = closeWith(w, addLesson(w, 2, 510, 600, DONE), s1);
  const sunLate = closeWith(w, addLesson(w, 0, 870, 960), s2);
  const sunDraft = addLesson(w, 0, 510, 600);
  pitch(w, sunDraft, own(addApproach(w, addSpeaker(w, "f"), "claimed"), 1), "candidate");
  addLesson(w, 0, 600, 690); // a bare draft: not a row
  const declinedOnly = addLesson(w, 1, 510, 600);
  pitch(w, declinedOnly, own(addApproach(w, addSpeaker(w, "m"), "declined"), 2), "declined"); // nobody live: not a row
  addLesson(w, 0, 780, 795, { kind: "memorial" }); // a memorial slot: not a row
  addLesson(w, 1, 690, 780, { state: "cancelled" });
  return { w, tue, sunLate, sunDraft };
}

describe("progressRows", () => {
  it("closed lessons and drafts with a live pitch, by day, start and id — each with the page's six steps", () => {
    const { w, tue, sunLate, sunDraft } = fixture();
    const rows = progressRows(buildModel(w));
    expect(rows.map((r) => [r.lesson.id, r.draft, r.handler])).toEqual([
      [sunDraft.id, true, 1],
      [sunLate.id, false, null],
      [tue.id, false, 2],
    ]);
    expect(rows.every((r) => r.steps.map((s) => s.key).join() === "place,close,pay,msg,sources,escort")).toBe(true);
    expect(rows[0].steps.slice(2).every((s) => s.state === "na")).toBe(true);
  });

  it("grouped by day in the week's order", () => {
    const { w, tue } = fixture();
    expect(byDay(progressRows(buildModel(w))).map((g) => [g.day, g.rows.length])).toEqual([
      [0, 2],
      [2, 1],
    ]);
    expect(byDay([])).toEqual([]);
    expect(byDay(progressRows(buildModel(w)))[1].rows[0].lesson.id).toBe(tue.id);
  });
});

describe("filterProgress", () => {
  it("by day, by handler («none» = nobody), and «רק מה שחסר»", () => {
    const { w, tue, sunLate, sunDraft } = fixture();
    const rows = progressRows(buildModel(w));
    const ids = (f: Partial<typeof NO_FILTER>) => filterProgress(rows, { ...NO_FILTER, ...f }).map((r) => r.lesson.id);
    expect(ids({})).toEqual([sunDraft.id, sunLate.id, tue.id]);
    expect(ids({ day: 0 })).toEqual([sunDraft.id, sunLate.id]);
    expect(ids({ day: 4 })).toEqual([]);
    expect(ids({ handler: 2 })).toEqual([tue.id]);
    expect(ids({ handler: "none" })).toEqual([sunLate.id]);
    // tue has every step in place: not missing; sunLate's message is still to send, the draft's call to make
    expect(ids({ missing: true })).toEqual([sunDraft.id, sunLate.id]);
    expect(ids({ day: 0, missing: true, handler: 1 })).toEqual([sunDraft.id]);
    tue.needs_reconfirm = true;
    expect(filterProgress(progressRows(buildModel(w)), { ...NO_FILTER, missing: true }).map((r) => r.lesson.id)).toEqual([sunDraft.id, sunLate.id, tue.id]);
  });

  it("a lesson that changed after its message is missing even with every dot done", () => {
    const { w, tue } = fixture();
    const row = progressRows(buildModel(w)).find((r) => r.lesson.id === tue.id)!;
    const allDone = { ...row, steps: row.steps.map((s) => ({ ...s, state: "done" as const })) };
    expect(rowMissing(allDone)).toBe(false);
    expect(rowMissing({ ...allDone, lesson: { ...tue, needs_reconfirm: true } })).toBe(true);
    expect(rowMissing({ ...allDone, steps: allDone.steps.map((s, i) => (i === 2 ? { ...s, state: "na" as const } : s)) })).toBe(false);
  });
});
