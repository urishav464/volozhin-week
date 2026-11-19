import { describe, expect, it } from "vitest";
import { buildModel } from "../grid/model";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../testing/week";
import { placementFor, proposeMode, targetOf } from "./placement";
import type { Week } from "./types";

const ME = 2;

/** A slot marked for the speaker on one of the template's rows (by its start). */
function mark(w: Week, speakerId: number, day: 0 | 1 | 2 | 3 | 4, start: number, kind: "can" | "cannot") {
  const row = w.rows.find((r) => r.kind === "lesson" && r.start_min === start)!;
  w.slotAvailability.push({ id: w.slotAvailability.length + 1, speaker_id: speakerId, day, row_id: row.id, kind, note: null, updated_by: null });
}

describe("where a speaker can be placed (placementFor)", () => {
  it("nothing said: every open slot of the week, neutral, my days first and then by day", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "f");
    w.dayOwners = [
      { day: 0, member_id: 3, seen_at: null },
      { day: 0, member_id: 4, seen_at: null },
      { day: 2, member_id: 4, seen_at: null },
      { day: 2, member_id: ME, seen_at: null },
    ];
    const days = placementFor(buildModel(w), s.id, ME);
    expect(days.map((d) => d.day)).toEqual([2, 0, 1, 3, 4]);
    expect(days[0]).toMatchObject({ day: 2, owners: [ME, 4], mine: true });
    expect(days[1]).toMatchObject({ day: 0, owners: [3, 4], mine: false });
    expect(days[2]).toMatchObject({ day: 1, owners: [], mine: false });
    // Sunday opens at 08:30 (first_day_from 510): its first slot is 08:30–10:00, by time
    expect(days[1].options[0]).toMatchObject({ start: 510, end: 600, lessonId: null, candidates: 0, fit: "neutral" });
    expect(days[1].options.map((o) => o.start)).toEqual([...days[1].options.map((o) => o.start)].sort((a, b) => a - b));
    expect(days.every((d) => d.options.every((o) => o.fit === "neutral"))).toBe(true);
  });

  it("«יכול/ה» is marked, «לא» is dropped — over every row a slot covers", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "m");
    mark(w, s.id, 1, 960, "can");
    mark(w, s.id, 1, 1050, "cannot");
    const day1 = placementFor(buildModel(w), s.id, ME).find((d) => d.day === 1)!;
    expect(day1.options.find((o) => o.start === 960)?.fit).toBe("can");
    expect(day1.options.some((o) => o.start === 1050)).toBe(false);
    expect(day1.options.find((o) => o.start === 870)?.fit).toBe("neutral");
  });

  it("not at a time they already teach, nor in a draft they are proposed in; another's draft counts its candidates", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "f");
    const other = addSpeaker(w, "m");
    const a = addApproach(w, s, "approached");
    const b = addApproach(w, other, "claimed");
    closeWith(w, addLesson(w, 3, 510, 600), s);
    // a parallel draft at the very time they teach: «כבר משובצת»
    addLesson(w, 3, 510, 600, { room_id: 2 });
    const mine = addLesson(w, 3, 600, 690);
    pitch(w, mine, a, "candidate");
    const theirs = addLesson(w, 3, 690, 780);
    pitch(w, theirs, b, "candidate");
    const day3 = placementFor(buildModel(w), s.id, ME).find((d) => d.day === 3)!;
    expect(day3.options.some((o) => o.start === 510)).toBe(false);
    expect(day3.options.some((o) => o.lessonId === mine.id)).toBe(false);
    expect(day3.options.find((o) => o.lessonId === theirs.id)).toMatchObject({ start: 690, end: 780, candidates: 1, fit: "neutral" });
    // a withdrawn pitch is no longer a proposal: the draft is offered again
    w.pitches.find((p) => p.lesson_id === mine.id)!.state = "withdrawn";
    expect(placementFor(buildModel(w), s.id, ME).find((d) => d.day === 3)!.options.some((o) => o.lessonId === mine.id)).toBe(true);
  });

  it("a memorial slot is never offered", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "f");
    addLesson(w, 1, 780, 795, { kind: "memorial" });
    const day1 = placementFor(buildModel(w), s.id, ME).find((d) => d.day === 1)!;
    expect(day1.options.some((o) => o.start === 780)).toBe(false);
  });

  it("nothing for a retired speaker, one who declined this edition, or one not in the week", () => {
    const w = emptyWeek();
    const retired = addSpeaker(w, "f");
    retired.retired = true;
    const declined = addSpeaker(w, "m");
    addApproach(w, declined, "declined");
    const m = buildModel(w);
    expect(placementFor(m, retired.id, ME)).toEqual([]);
    expect(placementFor(m, declined.id, ME)).toEqual([]);
    expect(placementFor(m, 999_999, ME)).toEqual([]);
  });
});

describe("proposing from the speaker page", () => {
  it("the target: the draft itself, or the free cell in the default room", () => {
    expect(targetOf({ day: 2, start: 960, end: 1050, lessonId: 7 })).toEqual({ lesson_id: 7 });
    expect(targetOf({ day: 2, start: 960, end: 1050, lessonId: null })).toEqual({ day: 2, start_min: 960, end_min: 1050, room_id: null });
  });

  it("the mode: offered to the handler when someone else handles them, else mine", () => {
    const w = emptyWeek();
    const free = addSpeaker(w, "f");
    const mine = addSpeaker(w, "f");
    const theirs = addSpeaker(w, "m");
    const back = addSpeaker(w, "m");
    addApproach(w, mine).owner_member_id = ME;
    addApproach(w, theirs).owner_member_id = 3;
    addApproach(w, back).owner_member_id = null;
    const m = buildModel(w);
    expect(proposeMode(m, free.id, ME)).toBe("self");
    expect(proposeMode(m, mine.id, ME)).toBe("self");
    expect(proposeMode(m, theirs.id, ME)).toBe("offer");
    expect(proposeMode(m, back.id, ME)).toBe("self");
  });
});
