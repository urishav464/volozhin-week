import { describe, expect, it } from "vitest";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../testing/week";
import { addTrainee } from "../testing/week";
import { MINE_GROUPS, mySpeakers, nextStep, pendingPayments, pendingSpeakers, waitingForApproval } from "./mine";

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
    expect(names("send")).toEqual(["ה"]); // closed, the summary message not yet sent
    expect(g.get("send")![0].closed).toHaveLength(1);
    expect(g.get("send")![0].lesson?.day).toBe(1);
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
    expect(MINE_GROUPS.map((g) => nextStep(g.group))).toEqual(["accept", "approached", "positive", "schedule", "payment", "reconfirm", "send", "escort", "sources", "lesson", null]);
  });

  it("puts each closed lesson in its own next stage's group — a speaker with two lessons may sit in two", () => {
    const w = emptyWeek();
    const sent = { confirm_sent_at: "2026-11-01T10:00:00Z" };
    const t = addTrainee(w);
    const s = ["א", "ב", "ג", "ד", "ה", "ו"].map((n) => addSpeaker(w, "f", n));
    s.forEach((x) => addApproach(w, x, "positive"));
    closeWith(w, addLesson(w, 0, 510, 600, { pay_amount: 200, approval: "pending" }), s[0]);
    closeWith(w, addLesson(w, 0, 600, 690, { ...sent, needs_reconfirm: true }), s[1]);
    closeWith(w, addLesson(w, 0, 690, 780, { ...sent }), s[2]); // no escort
    closeWith(w, addLesson(w, 1, 510, 600, { ...sent, escort_roster_id: t.id }), s[3]); // sources pending
    closeWith(w, addLesson(w, 1, 600, 690, { ...sent, self_intro: true, sources_kind: "sheet" }), s[4]); // all in place
    closeWith(w, addLesson(w, 2, 510, 600, { ...sent, escort_roster_id: t.id, sources_kind: "none" }), s[5]);
    closeWith(w, addLesson(w, 3, 510, 600, { pay_amount: 100, approval: "rejected" }), s[5]); // the same speaker, again
    const g = mySpeakers(w, 1);
    const at = (k: Parameters<typeof g.get>[0]) => g.get(k)!.map((r) => `${r.speaker.name}:${r.lesson?.day}`);
    expect(at("payment")).toEqual(["א:0", "ו:3"]);
    expect(at("reconfirm")).toEqual(["ב:0"]);
    expect(at("escort")).toEqual(["ג:0"]);
    expect(at("sources")).toEqual(["ד:1"]);
    expect(at("closed")).toEqual(["ה:1", "ו:2"]);
    expect(at("send")).toEqual([]);
    expect(g.get("closed")!.find((r) => r.speaker.name === "ו")!.closed).toHaveLength(2);
  });

  it("the approvals queue's requests: closed lessons waiting for the instructor, by time, with the speaker and the handler — and the badge counts them", () => {
    const w = emptyWeek();
    const [a, b] = [addSpeaker(w, "m", "א"), addSpeaker(w, "f", "ב")];
    Object.assign(addApproach(w, a, "positive"), { owner_member_id: 4 });
    addApproach(w, b, "positive");
    const later = closeWith(w, addLesson(w, 2, 510, 600, { transport: "one_way", approval: "pending" }), a);
    const sooner = closeWith(w, addLesson(w, 0, 870, 960, { pay_amount: 300, approval: "pending" }), b);
    closeWith(w, addLesson(w, 1, 510, 600, { pay_amount: 300, approval: "approved" }), a);
    addLesson(w, 3, 510, 600, { pay_amount: 300, approval: "pending" }); // a draft (reopened): not in the queue
    expect(pendingPayments(w).map((r) => [r.lesson.id, r.speaker?.name, r.handler])).toEqual([
      [sooner.id, "ב", 1],
      [later.id, "א", 4],
    ]);
    Object.assign(addSpeaker(w, null, "ג"), { vetted: "pending" });
    expect(waitingForApproval(w)).toBe(3);
  });
});
