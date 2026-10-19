// The five stages of a closed lesson and its one next step, rule by rule —
// the card's dots, the lesson panel and «המרצים שלי» all read these.
import { describe, expect, it } from "vitest";
import { nextLessonStep, reopenLoses, requestText, shekels, STEP_STAGE, stagesOf } from "./stages";
import { LESSON_STAGE_DEFAULTS, type Lesson } from "./types";

type Fields = Parameters<typeof stagesOf>[0];
const lesson = (over: Partial<Lesson> = {}): Fields => ({ ...LESSON_STAGE_DEFAULTS, ...over });
const states = (l: Fields) => Object.fromEntries(stagesOf(l).map((s) => [s.key, s.state]));

describe("a closed lesson's five stages", () => {
  it("in the card's order, and all open (or not needed) when nothing was done", () => {
    expect(stagesOf(lesson()).map((s) => s.label)).toEqual(["תשלום/הסעה", "הודעת סיכום", "מלווה", "מקורות", "מקראה"]);
    expect(states(lesson())).toEqual({ pay: "na", msg: "open", escort: "open", sources: "open", reader: "open" });
  });

  it("payment and transport: not asked, waiting, approved (paid or not), rejected", () => {
    const pay = (over: Partial<Lesson>) => stagesOf(lesson(over))[0];
    expect(pay({})).toMatchObject({ state: "na", note: "לא התבקשו" });
    expect(pay({ pay_amount: 200, approval: "pending" })).toMatchObject({ state: "waiting", note: "ממתין לאישור המדריך/ה" });
    expect(pay({ transport: "one_way", approval: "approved" })).toMatchObject({ state: "done", note: "אושר" });
    expect(pay({ pay_amount: 200, approval: "approved" })).toMatchObject({ state: "done", note: "אושר, טרם שולם" });
    expect(pay({ pay_amount: 200, approval: "approved", paid_at: "2026-11-01T10:00:00Z" })).toMatchObject({ state: "done", note: "אושר ושולם" });
    expect(pay({ pay_amount: 200, approval: "rejected" })).toMatchObject({ state: "problem" });
  });

  it("the message: waits for the request, sent, and «לעדכן את המרצה» above all", () => {
    const msg = (over: Partial<Lesson>) => stagesOf(lesson(over))[1];
    expect(msg({ approval: "pending", pay_amount: 1 }).state).toBe("waiting");
    expect(msg({ approval: "rejected", pay_amount: 1 }).state).toBe("waiting");
    expect(msg({ confirm_sent_at: "2026-11-01T10:00:00Z" })).toMatchObject({ state: "done", note: "נשלחה" });
    expect(msg({ confirm_sent_at: "2026-11-01T10:00:00Z", needs_reconfirm: true })).toMatchObject({ state: "problem", note: "השיעור השתנה: לעדכן את המרצה" });
  });

  it("the escort: a trainee, or self-introduction alone, is in place", () => {
    expect(states(lesson({ escort_roster_id: 3 })).escort).toBe("done");
    expect(states(lesson({ self_intro: true })).escort).toBe("done");
    expect(stagesOf(lesson({ escort_roster_id: 3, self_intro: true }))[2].note).toBe("שובץ/ה · הצגה עצמית");
  });

  it("sources and the reader: nothing to print is not a missing step", () => {
    expect(states(lesson({ sources_kind: "sheet" }))).toMatchObject({ sources: "done", reader: "open" });
    expect(states(lesson({ sources_kind: "sheet", in_reader: true }))).toMatchObject({ sources: "done", reader: "done" });
    expect(states(lesson({ sources_kind: "presentation" }))).toMatchObject({ sources: "done", reader: "na" });
    expect(states(lesson({ sources_kind: "none" }))).toMatchObject({ sources: "done", reader: "na" });
    expect(stagesOf(lesson({ sources_kind: "none" }))[3].note).toBe("בלי מקורות");
  });
});

describe("the next step of a closed lesson («המרצים שלי»)", () => {
  const sent = { confirm_sent_at: "2026-11-01T10:00:00Z" };
  it("a request to settle first, then the speaker to tell again, the message, an escort, the sources", () => {
    expect(nextLessonStep(lesson({ approval: "pending", pay_amount: 1, needs_reconfirm: true, ...sent }))).toBe("payment");
    expect(nextLessonStep(lesson({ approval: "rejected", transport: "one_way" }))).toBe("payment");
    expect(nextLessonStep(lesson({ needs_reconfirm: true, ...sent }))).toBe("reconfirm");
    expect(nextLessonStep(lesson({ approval: "approved", pay_amount: 1 }))).toBe("send");
    expect(nextLessonStep(lesson({ ...sent }))).toBe("escort");
    expect(nextLessonStep(lesson({ ...sent, self_intro: true }))).toBe("sources");
    expect(nextLessonStep(lesson({ ...sent, escort_roster_id: 1, sources_kind: "none" }))).toBeNull();
    // the reader is not the handler's step
    expect(nextLessonStep(lesson({ ...sent, escort_roster_id: 1, sources_kind: "sheet", in_reader: false }))).toBeNull();
    expect(STEP_STAGE).toEqual({ payment: "pay", reconfirm: "msg", send: "msg", escort: "escort", sources: "sources" });
  });
});

describe("what was asked, in words", () => {
  it("an amount in digits with the sign, the transport — nothing when nothing was asked", () => {
    expect(shekels(1500)).toBe("1,500 ₪");
    expect(requestText({ pay_amount: 1500, transport: "round_trip" })).toBe("1,500 ₪ · הלוך ושוב");
    expect(requestText({ pay_amount: null, transport: "one_way" })).toBe("בלי תשלום · הלוך");
    expect(requestText({ pay_amount: 200, transport: "none" })).toBe("200 ₪ · בלי הסעה");
    expect(requestText({ pay_amount: null, transport: "none" })).toBeNull();
  });
});

describe("what a reopen erases (CONTRACT reopen_lesson: the stages were the speaker's)", () => {
  const all = (over: Partial<Lesson>) => reopenLoses({ ...LESSON_STAGE_DEFAULTS, ...over });
  it("nothing when no stage holds anything — the reopen needs no confirmation", () => {
    expect(all({})).toEqual([]);
  });
  it("names each stage that holds something, transport details with a transport asked", () => {
    expect(all({ pay_amount: 300 })).toEqual(["בקשת התשלום"]);
    expect(all({ transport: "one_way" })).toEqual(["בקשת ההסעה ופרטיה"]);
    expect(all({ pay_amount: 300, transport: "round_trip", confirm_sent_at: "2026-11-01T10:00:00Z", self_intro: true, presentation_url: "https://example.org/x" })).toEqual([
      "בקשת התשלום וההסעה, ופרטי ההסעה", "הסימון שהודעת הסיכום נשלחה", "המלווה", "המקורות",
    ]);
    expect(all({ escort_note: "הערה לדוגמה" })).toEqual(["המלווה"]);
    expect(all({ print_when: "before" })).toEqual(["המקורות"]);
  });
});
