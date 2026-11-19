import { describe, expect, it } from "vitest";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import { lessonHandler } from "./handler";

describe("lessonHandler", () => {
  it("the lead speaker's approach's owner — never the co-speaker's", () => {
    const w = emptyWeek();
    const lead = addSpeaker(w, "f");
    const co = addSpeaker(w, "m");
    Object.assign(addApproach(w, lead, "positive"), { owner_member_id: 7 });
    Object.assign(addApproach(w, co, "positive"), { owner_member_id: 8 });
    const l = closeWith(w, addLesson(w, 1, 510, 600), lead, co);
    expect(lessonHandler(w, l.id)).toBe(7);
  });

  it("null: no lead, no approach, or nobody handles them", () => {
    const w = emptyWeek();
    const bare = addLesson(w, 1, 510, 600);
    expect(lessonHandler(w, bare.id)).toBeNull();
    const s = addSpeaker(w, "f");
    const l = closeWith(w, addLesson(w, 1, 600, 690), s);
    expect(lessonHandler(w, l.id)).toBeNull();
    Object.assign(addApproach(w, s, "positive"), { owner_member_id: null });
    expect(lessonHandler(w, l.id)).toBeNull();
    expect(lessonHandler(w, 99999)).toBeNull();
  });
});
