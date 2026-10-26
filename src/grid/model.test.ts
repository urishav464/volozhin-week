import { describe, expect, it } from "vitest";
import type { Day } from "../domain/time";
import type { SlotAvailability, Week } from "../domain/types";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../testing/week";
import { buildModel, fitFor, fitText } from "./model";
import { lessonOwner } from "./owners";

// TEMPLATE_2026's lesson rows by id: 1 06:30, 4 08:30, 5 10:00, 6 11:30, 18 00:30, 19 02:00, 20 03:30.
function slot(w: Week, speakerId: number, day: Day, row_id: number, kind: SlotAvailability["kind"]) {
  w.slotAvailability.push({ id: w.slotAvailability.length + 1, speaker_id: speakerId, day, row_id, kind, note: null, updated_by: null });
}

describe("fitFor (v14: availability per slot)", () => {
  it("is neutral while nothing is said, and reads only this speaker's own day", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "f");
    const other = addSpeaker(w, "m");
    slot(w, other.id, 1, 4, "cannot");
    slot(w, s.id, 2, 4, "cannot");
    expect(fitFor(buildModel(w), s.id, 1, 510, 600)).toBe("neutral");
  });

  it("says «יכול/ה» only when every lesson row a range covers is «יכול/ה», and «לא» when any is", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "f");
    slot(w, s.id, 1, 18, "can");
    slot(w, s.id, 1, 19, "can");
    const m = () => buildModel(w);
    expect(fitFor(m(), s.id, 1, 1470, 1560)).toBe("can"); // 00:30 alone
    expect(fitFor(m(), s.id, 1, 1470, 1650)).toBe("can"); // 00:30–03:30, both rows
    expect(fitFor(m(), s.id, 1, 1470, 1740)).toBe("neutral"); // the night to 05:00: 03:30 said nothing
    expect(fitFor(m(), s.id, 1, 1500, 1530)).toBe("can"); // a time split inside a row is judged by that row
    slot(w, s.id, 1, 20, "cannot");
    expect(fitFor(m(), s.id, 1, 1470, 1740)).toBe("cannot"); // «לא» wins over two «יכול/ה»
    expect(fitFor(m(), s.id, 1, 1470, 1650)).toBe("can");
  });

  it("is «busy» where the speaker is closed at that time — before anything they said", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "m");
    slot(w, s.id, 3, 5, "can");
    closeWith(w, addLesson(w, 3, 600, 690, { title: "א", category_id: 1 }), addSpeaker(w, "f"), s); // a co-speaker counts
    addLesson(w, 3, 690, 780); // a draft elsewhere is no clash
    const m = buildModel(w);
    expect(fitFor(m, s.id, 3, 600, 690)).toBe("busy");
    expect(fitFor(m, s.id, 3, 630, 720)).toBe("busy");
    expect(fitFor(m, s.id, 3, 690, 780)).toBe("neutral");
    expect(fitFor(m, s.id, 2, 600, 690)).toBe("neutral");
  });

  it("ignores rows outside the week's hours: Sunday before the opening, Thursday after the close", () => {
    const w = emptyWeek(); // opens Sunday 08:30, closes Thursday 19:00
    const s = addSpeaker(w, "f");
    slot(w, s.id, 0, 1, "cannot"); // Sunday 06:30 — a mark left from before the window moved
    expect(fitFor(buildModel(w), s.id, 0, 390, 435)).toBe("neutral");
    slot(w, s.id, 0, 4, "can");
    expect(fitFor(buildModel(w), s.id, 0, 390, 600)).toBe("can"); // only 08:30 is in play
  });

  it("says each fit in the speaker's gender, beside its colour", () => {
    expect(fitText("can", "f")).toBe("✓ יכולה");
    expect(fitText("cannot", "m")).toBe("⊘ לא יכול");
    expect(fitText("cannot", null)).toBe("⊘ לא יכול/ה");
    expect(fitText("busy", "f")).toBe("כבר משובצת בשעה הזו");
    expect(fitText("neutral", "f")).toBeNull();
  });
});

describe("a lesson's pitches, most advanced first (v14: by the approach's status)", () => {
  it("orders agreed, talked, no answer, before the call, a declined speaker still pitched, then declined pitches", () => {
    const w = emptyWeek();
    const l = addLesson(w, 2, 1200, 1290);
    const byStatus = (status: Parameters<typeof addApproach>[2], state: Parameters<typeof pitch>[3] = "candidate") => pitch(w, l, addApproach(w, addSpeaker(w, "f"), status), state);
    const declinedPitch = byStatus("approached", "declined");
    const claimed = byStatus("claimed");
    const declinedApproach = byStatus("declined");
    const noAnswer = byStatus("no_answer");
    const positive = byStatus("positive");
    const approached = byStatus("approached");
    const claimedToo = byStatus("claimed");
    byStatus("positive", "withdrawn"); // a dead pitch is not the lesson's
    const m = buildModel(w);
    expect(m.pitchesByLesson.get(l.id)!.map((p) => p.id)).toEqual([positive.id, approached.id, noAnswer.id, claimed.id, claimedToo.id, declinedApproach.id, declinedPitch.id]);
  });

  it("makes the most advanced live pitch the draft's handler («אחריות»)", () => {
    const w = emptyWeek();
    const l = addLesson(w, 2, 1200, 1290);
    const first = addApproach(w, addSpeaker(w, "m"), "claimed");
    first.owner_member_id = 2;
    pitch(w, l, first, "candidate");
    const agreed = addApproach(w, addSpeaker(w, "f"), "positive");
    agreed.owner_member_id = 3;
    pitch(w, l, agreed, "candidate");
    expect(lessonOwner(buildModel(w), l)).toBe(3);
  });
});
