import { describe, expect, it } from "vitest";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../testing/week";
import type { Approach, Week } from "../domain/types";
import { buildModel } from "./model";
import { myDay } from "../domain/myDay";
import { dayPair, lessonOwner, NO_PAIR_LABEL, outsidePair, ownerColors, ownerException, pairText } from "./owners";

// 1 the instructor, 2 and 3 Monday's pair, 4 another trainee, 9 logistics.
function week(): Week {
  const w = emptyWeek();
  w.team = [
    { id: 1, display_name: "מדריך/ה", gender: null, role: "admin" },
    { id: 2, display_name: "חניך/ה א׳", gender: null, role: "content" },
    { id: 3, display_name: "חניך/ה ב׳", gender: null, role: "content" },
    { id: 4, display_name: "חניך/ה ג׳", gender: null, role: "content" },
    { id: 9, display_name: "לוגיסטיקה", gender: null, role: "logistics" },
  ];
  w.dayOwners = [
    { day: 1, member_id: 3, seen_at: null },
    { day: 1, member_id: 2, seen_at: null },
    { day: 1, member_id: 2, seen_at: null }, // a duplicate row is one owner
    { day: 3, member_id: 4, seen_at: null },
  ];
  return w;
}
const own = (a: Approach, owner: number | null) => Object.assign(a, { owner_member_id: owner });

describe("ownerColors", () => {
  it("every member who can handle, in the team's order — never logistics", () => {
    expect(ownerColors(week().team).map((o) => o.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("dayPair and pairText", () => {
  it("the day's owners, ascending and distinct; none for a day nobody owns", () => {
    const m = buildModel(week());
    expect(dayPair(m, 1)).toEqual([2, 3]);
    expect(dayPair(m, 3)).toEqual([4]);
    expect(dayPair(m, 0)).toEqual([]);
  });

  it("names them: a pair, one owner, nobody", () => {
    const m = buildModel(week());
    expect(pairText(m, 1)).toBe("הזוג: חניך/ה א׳ ו-חניך/ה ב׳");
    expect(pairText(m, 3)).toBe("אחראי/ת: חניך/ה ג׳");
    expect(pairText(m, 0)).toBe(NO_PAIR_LABEL);
  });
});

describe("ownerException: «חריג»", () => {
  it("a lesson handled outside its day's pair — closed or a draft; the pair's own are not", () => {
    const w = week();
    const outsider = own(addApproach(w, addSpeaker(w, "f"), "positive"), 4);
    const closedOut = closeWith(w, addLesson(w, 1, 510, 600), w.speakers.find((s) => s.id === outsider.speaker_id)!);
    const draftOut = addLesson(w, 1, 600, 690);
    pitch(w, draftOut, own(addApproach(w, addSpeaker(w, "m"), "claimed"), 1), "candidate");
    const ours = addLesson(w, 1, 690, 780);
    pitch(w, ours, own(addApproach(w, addSpeaker(w, "m"), "claimed"), 3), "candidate");
    const m = buildModel(w);
    expect(lessonOwner(m, closedOut)).toBe(4);
    expect(ownerException(m, closedOut)).toBe(true);
    expect(ownerException(m, draftOut)).toBe(true);
    expect(ownerException(m, ours)).toBe(false);
  });

  it("a day with no owners marks nothing (never every lesson)", () => {
    const w = week();
    const s = addSpeaker(w, "f");
    own(addApproach(w, s, "positive"), 4);
    const l = closeWith(w, addLesson(w, 0, 510, 600), s);
    expect(ownerException(buildModel(w), l)).toBe(false);
    w.dayOwners = [];
    const m = buildModel(w);
    expect(w.lessons.some((x) => ownerException(m, x))).toBe(false);
  });

  it("nobody handling it, a handler who left the team, a bare draft, a memorial slot: not an exception", () => {
    const w = week();
    const s = addSpeaker(w, "f");
    own(addApproach(w, s, "positive"), null);
    const nobody = closeWith(w, addLesson(w, 1, 510, 600), s);
    const left = addSpeaker(w, "m");
    own(addApproach(w, left, "positive"), 77);
    const gone = closeWith(w, addLesson(w, 1, 600, 690), left);
    const bare = addLesson(w, 1, 690, 780);
    const memorial = addLesson(w, 1, 780, 795, { kind: "memorial" });
    const declined = addLesson(w, 1, 870, 960);
    pitch(w, declined, own(addApproach(w, addSpeaker(w, "f"), "declined"), 4), "declined");
    const m = buildModel(w);
    for (const l of [nobody, gone, bare, memorial, declined]) expect(ownerException(m, l)).toBe(false);
  });

  it("one rule for the card and the day's list: a draft with a candidate of the pair AND one from outside is «חריג» in both", () => {
    const w = week();
    const mixed = addLesson(w, 1, 510, 600);
    pitch(w, mixed, own(addApproach(w, addSpeaker(w, "f"), "approached"), 2), "candidate"); // the pair's, pitched first
    pitch(w, mixed, own(addApproach(w, addSpeaker(w, "m"), "claimed"), 4), "candidate"); // someone else's
    const m = buildModel(w);
    expect(lessonOwner(m, mixed)).toBe(2); // its stripe: the first live candidate's handler
    expect(outsidePair(m, mixed)).toEqual([4]);
    expect(ownerException(m, mixed)).toBe(true);
    for (const viewer of [2, 1]) {
      const d = myDay(m, 1, viewer, { staff: viewer === 1 });
      expect(d.others.map((o) => [o.lessonId, o.handlers])).toEqual([[mixed.id, [4]]]);
    }
  });

  it("a handler who left the team (deactivated: not in public.team) is nobody's — not «חריג» on the card, not in the day's «חריגים», for the pair or the staff", () => {
    const w = week();
    const left = addSpeaker(w, "m");
    own(addApproach(w, left, "positive"), 77);
    const gone = closeWith(w, addLesson(w, 1, 600, 690), left);
    const draft = addLesson(w, 1, 690, 780);
    pitch(w, draft, own(addApproach(w, addSpeaker(w, "f"), "claimed"), 77), "candidate");
    const m = buildModel(w);
    expect(lessonOwner(m, gone)).toBe(77); // the handler as stored
    for (const l of [gone, draft]) {
      expect(outsidePair(m, l)).toEqual([]);
      expect(ownerException(m, l)).toBe(false);
    }
    for (const viewer of [2, 3, 1]) expect(myDay(m, 1, viewer, { staff: viewer === 1 }).others).toEqual([]);
  });
});
