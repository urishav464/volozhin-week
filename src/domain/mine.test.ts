import { describe, expect, it } from "vitest";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../testing/week";
import { MINE_GROUPS, mySpeakers, nextStep, pendingSpeakers } from "./mine";

describe("«המרצים שלי»", () => {
  it("groups my speakers by the next step, and puts an offer to me first", () => {
    const w = emptyWeek();
    const [claimed, approached, noAnswer, positive, closed, declined, others, offered] = ["ט", "ח", "ז", "ו", "ה", "ד", "ג", "ב"].map((n) => addSpeaker(w, "f", n));
    addApproach(w, claimed, "claimed");
    addApproach(w, approached, "approached");
    addApproach(w, noAnswer, "no_answer");
    const pos = addApproach(w, positive, "positive");
    addApproach(w, closed, "positive");
    addApproach(w, declined, "declined");
    Object.assign(addApproach(w, others, "approached"), { owner_member_id: 2 });
    Object.assign(addApproach(w, offered, "approached"), { owner_member_id: 2, offered_to: 1 });
    closeWith(w, addLesson(w, 1, 510, 600), closed);
    pitch(w, addLesson(w, 2, 510, 600), pos, "approached");

    const g = mySpeakers(w, 1);
    expect([...g.keys()]).toEqual(MINE_GROUPS.map((x) => x.group));
    const names = (k: Parameters<typeof g.get>[0]) => g.get(k)!.map((r) => r.speaker.name);
    expect(names("offered")).toEqual(["ב"]);
    expect(names("to_approach")).toEqual(["ט"]);
    expect(names("awaiting")).toEqual(["ז", "ח"]);
    expect(names("to_schedule")).toEqual(["ו"]);
    expect(g.get("to_schedule")![0].live).toHaveLength(1);
    expect(names("closed")).toEqual(["ה"]);
    expect(g.get("closed")![0].closed).toHaveLength(1);
    expect(names("declined")).toEqual(["ד"]);
    expect([...g.values()].flat().some((r) => r.speaker.name === "ג")).toBe(false);
  });

  it("lists the speakers waiting for vetting, retired ones aside", () => {
    const w = emptyWeek();
    Object.assign(addSpeaker(w, null, "ב"), { vetted: "pending" });
    Object.assign(addSpeaker(w, null, "א"), { vetted: "pending" });
    Object.assign(addSpeaker(w, null, "ג"), { vetted: "pending", retired: true });
    addSpeaker(w, "m", "ד");
    expect(pendingSpeakers(w).map((s) => s.name)).toEqual(["א", "ב"]);
  });

  it("gives every group one next step, and none once they declined", () => {
    expect(MINE_GROUPS.map((g) => nextStep(g.group))).toEqual(["accept", "approached", "positive", "schedule", "lesson", null]);
  });
});
