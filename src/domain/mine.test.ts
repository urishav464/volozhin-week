import { describe, expect, it } from "vitest";
import { addApproach, addLesson, addSpeaker, addTrainee, closeWith, emptyWeek, pitch } from "../testing/week";
import { agreedPending, groupOf, MINE_GROUPS, type MineRow, mySpeakers, nextStep, pendingPayments, pendingSpeakers, pendingWhoTaught, teamBoard, waitingForApproval } from "./mine";
import type { Week } from "./types";

const team = (w: Week) => {
  w.team = [
    { id: 1, display_name: "מדריך/ה", gender: null, role: "admin" },
    { id: 2, display_name: "חניך/ה א׳", gender: null, role: "content" },
    { id: 5, display_name: "לוגיסטיקה", gender: null, role: "logistics" },
    { id: 3, display_name: "חניך/ה ב׳", gender: null, role: "content" },
  ];
};
const names = (rows: MineRow[]) => rows.map((r) => r.speaker.name);

describe("«המרצים שלי»", () => {
  it("groups my speakers by where the call stands, the approval before closing, and puts an offer to me first", () => {
    const w = emptyWeek();
    const [claimed, approached, noAnswer, agreed, rejected, positive, closed, declined, others, offered] = ["י", "ט", "ח", "ז", "ו", "ה", "ד", "ג", "ב", "א"].map((n) => addSpeaker(w, "f", n));
    addApproach(w, claimed, "claimed");
    addApproach(w, approached, "approached");
    addApproach(w, noAnswer, "no_answer");
    agreed.vetted = "pending";
    rejected.vetted = "rejected";
    addApproach(w, agreed, "positive");
    addApproach(w, rejected, "positive");
    const pos = addApproach(w, positive, "positive");
    addApproach(w, closed, "positive");
    addApproach(w, declined, "declined");
    Object.assign(addApproach(w, others, "approached"), { owner_member_id: 2 });
    Object.assign(addApproach(w, offered, "approached"), { owner_member_id: 2, offered_to: 1 });
    closeWith(w, addLesson(w, 1, 510, 600), closed);
    const later = pitch(w, addLesson(w, 3, 510, 600), pos, "candidate");
    const sooner = pitch(w, addLesson(w, 2, 870, 960), pos, "candidate");
    pitch(w, addLesson(w, 0, 510, 600), pos, "declined");

    const g = mySpeakers(w, 1);
    expect([...g.keys()]).toEqual(MINE_GROUPS.map((x) => x.group));
    const at = (k: Parameters<typeof g.get>[0]) => names(g.get(k)!);
    expect(at("offered")).toEqual(["א"]);
    expect(at("to_call")).toEqual(["י"]);
    expect(at("retry")).toEqual(["ח"]);
    expect(at("awaiting")).toEqual(["ט"]);
    expect(at("agreed")).toEqual(["ו", "ז"]); // the rejected one too: its row says «לא אושר/ה»
    expect(at("to_schedule")).toEqual(["ה"]);
    expect(g.get("to_schedule")![0].live).toEqual([sooner, later]); // live only, by the lesson's time
    expect(at("send")).toEqual(["ד"]); // closed, the summary message not yet sent
    expect(g.get("send")![0].closed).toHaveLength(1);
    expect(g.get("send")![0].lesson?.day).toBe(1);
    expect(at("declined")).toEqual(["ג"]);
    expect([...g.values()].flat().some((r) => r.speaker.name === "ב")).toBe(false);
  });

  it("groupOf: an approach's status, the approval once they agreed — and a closed lesson's own step", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "m");
    const a = addApproach(w, s, "positive");
    expect(groupOf(w, a, s)).toBe("to_schedule");
    s.vetted = "pending";
    expect(groupOf(w, a, s)).toBe("agreed");
    for (const [status, group] of [["claimed", "to_call"], ["no_answer", "retry"], ["approached", "awaiting"], ["declined", "declined"]] as const) {
      expect(groupOf(w, { ...a, status }, s), status).toBe(group);
    }
    const l = closeWith(w, addLesson(w, 0, 510, 600, { pay_amount: 100, approval: "pending" }), s);
    expect(groupOf(w, a, s, l)).toBe("payment");
  });

  it("lists the speakers waiting for vetting, retired ones aside", () => {
    const w = emptyWeek();
    Object.assign(addSpeaker(w, null, "ב"), { vetted: "pending" });
    Object.assign(addSpeaker(w, null, "א"), { vetted: "pending" });
    Object.assign(addSpeaker(w, null, "ג"), { vetted: "pending", retired: true });
    addSpeaker(w, "m", "ד");
    expect(pendingSpeakers(w).map((s) => s.name)).toEqual(["א", "ב"]);
  });

  it("agreedPending: who agreed and waits for approval — not one still to call, not an approved or a retired one", () => {
    const w = emptyWeek();
    const [late, early, toCall, approved, retired, noApproach] = ["ת", "א", "ב", "ג", "ד", "ה"].map((n) => addSpeaker(w, null, n));
    [late, early, toCall, retired, noApproach].forEach((s) => (s.vetted = "pending"));
    retired.retired = true;
    [late, early, approved, retired].forEach((s) => addApproach(w, s, "positive"));
    addApproach(w, toCall, "claimed");
    expect(agreedPending(w).map((s) => s.name)).toEqual(["א", "ת"]);
  });

  it("the batch approve of an archive: the pending speakers who taught one of its closed lessons, lead or co — not a draft's, not an approved one", () => {
    const pool = emptyWeek();
    const [lead, co, draftOnly, , approved] = ["א", "ב", "ג", "ד", "ה"].map((n) => addSpeaker(pool, null, n));
    [lead, co, draftOnly].concat(pool.speakers[3]).forEach((s) => (s.vetted = "pending"));
    const archive = emptyWeek();
    closeWith(archive, addLesson(archive, 1, 510, 600), lead, co, approved);
    const draft = addLesson(archive, 2, 510, 600);
    archive.lessonSpeakers.push({ lesson_id: draft.id, speaker_id: draftOnly.id, role: "lead" });
    expect(pendingWhoTaught(pendingSpeakers(pool), archive).map((s) => s.name)).toEqual(["א", "ב"]);
    expect(pendingWhoTaught(pendingSpeakers(pool), emptyWeek())).toEqual([]);
  });

  it("gives every group one next step: the call for the three before an answer, none once they declined", () => {
    expect(MINE_GROUPS.map((g) => nextStep(g.group))).toEqual(["accept", "call", "call", "call", "vet", "close", "payment", "reconfirm", "send", "escort", "sources", "lesson", null]);
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
    closeWith(w, addLesson(w, 3, 510, 600, { pay_amount: 100, approval: "rejected" }), s[5]); // the same speaker, twice (later first)
    closeWith(w, addLesson(w, 2, 510, 600, { ...sent, escort_roster_id: t.id, sources_kind: "none" }), s[5]);
    const g = mySpeakers(w, 1);
    const at = (k: Parameters<typeof g.get>[0]) => g.get(k)!.map((r) => `${r.speaker.name}:${r.lesson?.day}`);
    expect(at("payment")).toEqual(["א:0", "ו:3"]);
    expect(at("reconfirm")).toEqual(["ב:0"]);
    expect(at("escort")).toEqual(["ג:0"]);
    expect(at("sources")).toEqual(["ד:1"]);
    expect(at("closed")).toEqual(["ה:1", "ו:2"]);
    expect(at("send")).toEqual([]);
    expect(g.get("closed")!.find((r) => r.speaker.name === "ו")!.closed.map((l) => l.day)).toEqual([2, 3]); // by time
  });

  it("the approvals queue's requests: closed lessons waiting for the instructor, by time, with the speaker and the handler", () => {
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
  });

  it("the badge counts the requests and who agreed and waits for approval — not every speaker waiting for it", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "f", "א");
    addApproach(w, s, "positive");
    closeWith(w, addLesson(w, 0, 870, 960, { pay_amount: 300, approval: "pending" }), s);
    expect(waitingForApproval(w)).toBe(1);
    const [agreed, toCall] = [addSpeaker(w, "f", "ב"), addSpeaker(w, "m", "ג")];
    Object.assign(addSpeaker(w, null, "ד"), { vetted: "pending" }); // no approach this edition
    agreed.vetted = toCall.vetted = "pending";
    const a = addApproach(w, agreed, "approached");
    addApproach(w, toCall, "claimed");
    expect(waitingForApproval(w)).toBe(1); // nobody of them agreed yet
    a.status = "positive";
    expect(waitingForApproval(w)).toBe(2);
    agreed.vetted = "approved";
    expect(waitingForApproval(w)).toBe(1);
  });
});

describe("«כל הצוות»", () => {
  it("a block per handler in the team's order (logistics aside), rows by group then name, each lesson its own row", () => {
    const w = emptyWeek();
    team(w);
    const [a, b, c, d, e] = ["ה", "ד", "ג", "ב", "א"].map((n) => addSpeaker(w, "f", n));
    Object.assign(addApproach(w, a, "claimed"), { owner_member_id: 2 });
    Object.assign(addApproach(w, b, "positive"), { owner_member_id: 2 });
    Object.assign(addApproach(w, c, "claimed"), { owner_member_id: 2, offered_to: 3 }); // a hand-over offered: still the owner's
    Object.assign(addApproach(w, d, "no_answer"), { owner_member_id: 1 });
    addApproach(w, e, "positive");
    closeWith(w, addLesson(w, 0, 510, 600), e);
    closeWith(w, addLesson(w, 1, 510, 600, { confirm_sent_at: "2026-11-01T10:00:00Z", self_intro: true, sources_kind: "none" }), e);

    const { owners, unowned } = teamBoard(w);
    expect(owners.map((o) => [o.id, o.name])).toEqual([[1, "מדריך/ה"], [2, "חניך/ה א׳"], [3, "חניך/ה ב׳"]]);
    expect(new Set(owners.map((o) => o.color)).size).toBe(3);
    const rows = (id: number) => owners.find((o) => o.id === id)!.rows.map((r) => `${r.speaker.name}:${r.group}`);
    expect(rows(1)).toEqual(["ב:retry", "א:send", "א:closed"]);
    expect(rows(2)).toEqual(["ג:to_call", "ה:to_call", "ד:to_schedule"]);
    expect(rows(3)).toEqual([]); // nothing handed over until they accept
    expect(unowned).toEqual([]);
  });

  it("«בלי אחראי/ת»: only speakers in process — an approach with nobody handling it, or a handler gone from the team — never the rest of the pool", () => {
    const w = emptyWeek();
    team(w);
    const [returned, declined, gone, , handled] = ["א", "ב", "ג", "ד", "ה"].map((n) => addSpeaker(w, "m", n)); // «ד»: in the pool, never approached
    Object.assign(addApproach(w, returned, "approached"), { owner_member_id: null });
    Object.assign(addApproach(w, declined, "declined"), { owner_member_id: null });
    Object.assign(addApproach(w, gone, "claimed"), { owner_member_id: 9 });
    Object.assign(addApproach(w, handled, "claimed"), { owner_member_id: 3 });
    const { owners, unowned } = teamBoard(w);
    expect(unowned.map((r) => `${r.speaker.name}:${r.group}`)).toEqual(["ג:to_call", "א:awaiting", "ב:declined"]);
    expect(owners.flatMap((o) => names(o.rows))).toEqual(["ה"]);
  });
});
