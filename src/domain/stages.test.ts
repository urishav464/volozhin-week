// The five stages of a closed lesson and its one next step, rule by rule —
// the card's dots, the lesson panel and «המרצים שלי» all read these.
import { describe, expect, it } from "vitest";
import { NO_FILES, nextLessonStep as nextStepOf, readerFilesOf, type ReaderFiles, reopenLoses, requestText, shekels, STEP_STAGE, stagesOf as stagesWith } from "./stages";
import { LESSON_STAGE_DEFAULTS, type Lesson } from "./types";

type Fields = Parameters<typeof stagesWith>[0];
const lesson = (over: Partial<Lesson> = {}): Fields => ({ ...LESSON_STAGE_DEFAULTS, ...over });
const stagesOf = (l: Fields, files: ReaderFiles = NO_FILES) => stagesWith(l, files);
const nextLessonStep = (l: Fields, files: ReaderFiles = NO_FILES) => nextStepOf(l, files);
const states = (l: Fields, files: ReaderFiles = NO_FILES) => Object.fromEntries(stagesOf(l, files).map((s) => [s.key, s.state]));
const PDF_ONE: ReaderFiles = { printable: 1, word: 0, unread: 0 };

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
    // an imported archive lesson: an amount from last year's sheet, no request behind it — a record, not «ממתין»
    expect(pay({ pay_amount: 300, transport: "none", approval: "none" })).toMatchObject({ state: "na", note: "מגיליון המעקב של אשתקד" });
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
    expect(states(lesson({ sources_kind: "sheet", in_reader: true }), PDF_ONE)).toMatchObject({ sources: "done", reader: "done" });
    expect(states(lesson({ sources_kind: "presentation" }))).toMatchObject({ sources: "done", reader: "na" });
    expect(states(lesson({ sources_kind: "none" }))).toMatchObject({ sources: "done", reader: "na" });
    expect(stagesOf(lesson({ sources_kind: "none" }))[3].note).toBe("בלי מקורות");
  });

  it("«במקראה» only when a PDF or a picture is there — marked with nothing to merge is «חסר קובץ», «צריך PDF» or «צריך קובץ אחר», as the manifest says", () => {
    const marked = lesson({ sources_kind: "sheet", in_reader: true });
    expect(stagesOf(marked, NO_FILES)[4]).toMatchObject({ state: "open", note: "חסר קובץ" });
    expect(stagesOf(marked, { printable: 0, word: 2, unread: 0 })[4]).toMatchObject({ state: "open", note: "צריך PDF" });
    expect(stagesOf(marked, { printable: 1, word: 2, unread: 0 })[4]).toMatchObject({ state: "done", note: "במקראה" });
    // files the browser could not read on upload are not in the reader: someone uploads another
    expect(stagesOf(marked, { printable: 0, word: 0, unread: 2 })[4]).toMatchObject({ state: "open", note: "צריך קובץ אחר" });
    expect(stagesOf(marked, { printable: 0, word: 1, unread: 1 })[4]).toMatchObject({ state: "open", note: "צריך PDF" }); // the manifest's order
    expect(stagesOf(marked, { printable: 1, word: 0, unread: 1 })[4]).toMatchObject({ state: "done", note: "במקראה" });
    // a presentation alone stays out whatever its files
    expect(stagesOf(lesson({ sources_kind: "presentation", in_reader: true }), PDF_ONE)[4].state).toBe("na");
  });

  it("counts the current lead speaker's files only — a previous speaker's never — PDFs and pictures apart from Word, and from what was not read", () => {
    const f = (id: number, lesson_id: number, speaker_id: number | null, mime: string, page_count: number | null = mime.includes("word") ? null : 1) =>
      ({ id, lesson_id, speaker_id, mime, page_count }) as Parameters<typeof readerFilesOf>[0]["sourceFiles"][number];
    const week = {
      lessonSpeakers: [
        { lesson_id: 1, speaker_id: 10, role: "lead" },
        { lesson_id: 1, speaker_id: 11, role: "co" },
        { lesson_id: 2, speaker_id: 20, role: "lead" },
      ] as Parameters<typeof readerFilesOf>[0]["lessonSpeakers"],
      sourceFiles: [
        f(1, 1, 10, "application/pdf"), f(2, 1, 10, "image/jpeg"), f(3, 1, 10, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        f(4, 1, 9, "application/pdf"), // a previous speaker's
        f(5, 2, 20, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        f(6, null as unknown as number, null, "application/pdf"), // a poster
        f(7, 2, 20, "application/pdf", null), f(8, 2, 20, "image/png", null), // not read on upload (protected, damaged): no page count
      ],
    };
    expect(readerFilesOf(week, 1)).toEqual({ printable: 2, word: 1, unread: 0 });
    expect(readerFilesOf(week, 2)).toEqual({ printable: 0, word: 1, unread: 2 });
    expect(readerFilesOf(week, 3)).toEqual({ printable: 0, word: 0, unread: 0 }); // no lead: nothing is the current speaker's
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
    // but a lesson marked «במקראה» whose file has not been uploaded (or came only in Word) still needs its sources
    expect(nextLessonStep(lesson({ ...sent, escort_roster_id: 1, sources_kind: "sheet", in_reader: true }), NO_FILES)).toBe("sources");
    expect(nextLessonStep(lesson({ ...sent, escort_roster_id: 1, sources_kind: "other", in_reader: true }), { printable: 0, word: 1, unread: 0 })).toBe("sources");
    expect(nextLessonStep(lesson({ ...sent, escort_roster_id: 1, sources_kind: "sheet", in_reader: true }), { printable: 0, word: 0, unread: 1 })).toBe("sources");
    expect(nextLessonStep(lesson({ ...sent, escort_roster_id: 1, sources_kind: "sheet", in_reader: true }), PDF_ONE)).toBeNull();
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
