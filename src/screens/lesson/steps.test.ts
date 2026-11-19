import { describe, expect, it } from "vitest";
import { stagesOf } from "../../domain/stages";
import type { SourceFile } from "../../domain/types";
import { buildModel } from "../../grid/model";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../../testing/week";
import { AFTER_CLOSING, firstOpenStep, pageSteps, sourcesStep } from "./steps";

const keys = ["place", "close", "pay", "msg", "sources", "escort"];
const view = (steps: ReturnType<typeof pageSteps>) => steps.map((s) => [s.key, s.state]);

describe("pageSteps: a draft", () => {
  it("six steps in order; after «סגירה» nothing yet", () => {
    const w = emptyWeek();
    const l = addLesson(w, 1, 600, 690);
    const steps = pageSteps(buildModel(w), l);
    expect(steps.map((s) => s.key)).toEqual(keys);
    expect(steps.map((s) => s.label)).toEqual(["שיבוץ", "סגירה", "תשלום והסעה", "הודעת סיכום", "מקורות ומצגת", "מלווה"]);
    expect(steps.slice(2).every((s) => s.state === "na" && s.note === AFTER_CLOSING)).toBe(true);
    expect(steps[0]).toMatchObject({ state: "open", note: "עוד אין מועמד/ת" });
    expect(steps[1]).toMatchObject({ state: "waiting", note: "אחרי שמרצה מסכים/ה" });
    expect(firstOpenStep(steps)).toBe("place");
  });

  it("where the call stands: before it and no answer are a call to make; talked is a wait", () => {
    const w = emptyWeek();
    const l = addLesson(w, 1, 600, 690);
    const a = addApproach(w, addSpeaker(w, "f", "מרצה לדוגמה"), "claimed");
    pitch(w, l, a, "candidate");
    expect(pageSteps(buildModel(w), l)[0]).toMatchObject({ state: "open", note: "מרצה לדוגמה · לפני שיחה" });
    a.status = "no_answer";
    expect(pageSteps(buildModel(w), l)[0]).toMatchObject({ state: "open", note: "מרצה לדוגמה · לא ענתה" });
    a.status = "approached";
    pitch(w, l, addApproach(w, addSpeaker(w, "m"), "claimed"), "candidate");
    expect(pageSteps(buildModel(w), l)[0]).toMatchObject({ state: "waiting", note: "מרצה לדוגמה · שוחחנו, מחכים לתשובה (ועוד 1)" });
  });

  it("a yes is «שיבוץ» done, and «סגירה» the step to take", () => {
    const w = emptyWeek();
    const l = addLesson(w, 1, 600, 690);
    pitch(w, l, addApproach(w, addSpeaker(w, "m", "מרצה לדוגמה"), "positive"), "candidate");
    const steps = pageSteps(buildModel(w), l);
    expect(view(steps).slice(0, 2)).toEqual([["place", "done"], ["close", "open"]]);
    expect(steps[1].note).toBe("אפשר לסגור עם מרצה לדוגמה");
    expect(firstOpenStep(steps)).toBe("close");
  });

  it("what closing waits for: the instructor's approval, a rejected speaker, a missing gender", () => {
    const w = emptyWeek();
    const l = addLesson(w, 1, 600, 690);
    const s = addSpeaker(w, "f", "מרצה לדוגמה");
    pitch(w, l, addApproach(w, s, "positive"), "candidate");
    s.vetted = "pending";
    expect(pageSteps(buildModel(w), l)[1]).toMatchObject({ state: "waiting", note: "סוגרים שעה אחרי אישור המדריך/ה." });
    s.vetted = "rejected";
    expect(pageSteps(buildModel(w), l)[1]).toMatchObject({ state: "problem", note: "מרצה לדוגמה לא אושרה על ידי המדריך/ה" });
    s.vetted = "approved";
    s.gender = null;
    expect(pageSteps(buildModel(w), l)[1].state).toBe("problem");
  });

  it("everyone declined: back to choosing; a declined pitch is not a candidate", () => {
    const w = emptyWeek();
    const l = addLesson(w, 1, 600, 690);
    pitch(w, l, addApproach(w, addSpeaker(w, "m"), "declined"), "candidate");
    pitch(w, l, addApproach(w, addSpeaker(w, "f"), "positive"), "declined");
    const steps = pageSteps(buildModel(w), l);
    expect(steps[0]).toMatchObject({ state: "open", note: "המועמדים סירבו: לבחור מרצה אחר/ת" });
    expect(steps[1].state).toBe("waiting");
  });
});

describe("pageSteps: a closed lesson", () => {
  it("«שיבוץ» and «סגירה» done; then the card's stages, the sources and the reader as one", () => {
    const w = emptyWeek();
    const lead = addSpeaker(w, "f", "מרצה לדוגמה");
    const l = closeWith(w, addLesson(w, 2, 600, 690), lead, addSpeaker(w, "m"));
    const steps = pageSteps(buildModel(w), l);
    expect(steps.map((s) => s.key)).toEqual(keys);
    expect(steps.map((s) => s.label)).toEqual(["שיבוץ", "סגירה", "תשלום והסעה", "הודעת סיכום", "מקורות ומצגת", "מלווה"]);
    expect(steps[0]).toMatchObject({ state: "done", note: "מרצה לדוגמה ועוד מרצה אחד/ת" });
    expect(steps[1]).toMatchObject({ state: "done", note: "נסגר" });
    const [pay, msg, escort, sources] = stagesOf(l, { printable: 0, word: 0, unread: 0 });
    expect(steps[2]).toMatchObject({ state: pay.state, note: pay.note });
    expect(steps[3]).toMatchObject({ state: msg.state, note: msg.note });
    expect(steps[4]).toMatchObject({ state: sources.state, note: sources.note });
    expect(steps[5]).toMatchObject({ state: escort.state, note: escort.note });
    // nothing asked (na): the first with something to do is the message
    expect(firstOpenStep(steps)).toBe("msg");
  });

  it("a request waiting for approval comes first", () => {
    const w = emptyWeek();
    const l = closeWith(w, addLesson(w, 2, 600, 690, { pay_amount: 500, transport: "round_trip", approval: "pending" }), addSpeaker(w, "m"));
    const steps = pageSteps(buildModel(w), l);
    expect(steps[2]).toMatchObject({ key: "pay", state: "waiting" });
    expect(firstOpenStep(steps)).toBe("pay");
  });

  it("the sources received but marked for the reader with no file: the step is open, the reader's word added", () => {
    const w = emptyWeek();
    const lead = addSpeaker(w, "m");
    const l = closeWith(w, addLesson(w, 2, 600, 690, { sources_kind: "sheet", in_reader: true, confirm_sent_at: "2026-11-01T10:00:00Z", self_intro: true }), lead);
    let steps = pageSteps(buildModel(w), l);
    expect(steps[4]).toMatchObject({ state: "open", note: "דף מקורות · חסר קובץ" });
    expect(firstOpenStep(steps)).toBe("sources");
    const f: SourceFile = {
      id: 1, lesson_id: l.id, cover: false, speaker_id: lead.id, fallen_id: null, storage_path: "1/x/y-sheet.pdf", display_name: "דף.pdf",
      mime: "application/pdf", size_bytes: 10, page_count: 2, uploaded_by: 1, uploaded_at: "2026-11-01T10:00:00Z",
    };
    w.sourceFiles = [f];
    steps = pageSteps(buildModel(w), l);
    expect(steps[4]).toMatchObject({ state: "done", note: "דף מקורות" });
    // every step done: the page opens at the first
    expect(firstOpenStep(steps)).toBe("place");
  });

  it("a memorial slot and a cancelled lesson have no steps", () => {
    const w = emptyWeek();
    expect(pageSteps(buildModel(w), addLesson(w, 0, 780, 840, { kind: "memorial" }))).toEqual([]);
    expect(pageSteps(buildModel(w), addLesson(w, 0, 600, 690, { state: "cancelled" }))).toEqual([]);
    expect(firstOpenStep([])).toBeNull();
  });
});

describe("sourcesStep", () => {
  const st = (state: "done" | "open" | "na" | "problem" | "waiting", note: string) => ({ key: "sources" as const, label: "", state, note });
  it("the worse of the two; the sources' word unless the reader is worse", () => {
    expect(sourcesStep(st("open", "טרם התקבלו"), st("open", "מחכה למקורות"))).toEqual({ state: "open", note: "טרם התקבלו" });
    expect(sourcesStep(st("done", "מצגת"), st("na", "אין מה להדפיס"))).toEqual({ state: "done", note: "מצגת" });
    expect(sourcesStep(st("done", "דף מקורות"), st("open", "צריך PDF"))).toEqual({ state: "open", note: "דף מקורות · צריך PDF" });
  });
});
