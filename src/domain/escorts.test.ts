import { describe, expect, it } from "vitest";
import { addLesson, addTrainee, emptyWeek } from "../testing/week";
import { DUTY_WHEN_LABEL, dutyNotes, escortLoad, SELF_INTRO_FROM, suggestSelfIntro } from "./escorts";
import type { DutyPhrase } from "./types";

describe("escorts", () => {
  it("suggests self-introduction from 22:30 to the morning («הצעה»), never before", () => {
    expect(SELF_INTRO_FROM).toBe(1350);
    expect(suggestSelfIntro({ start_min: 1200 })).toBe(false); // 20:00
    expect(suggestSelfIntro({ start_min: 1350 })).toBe(true); // 22:30
    expect(suggestSelfIntro({ start_min: 1650 })).toBe(true); // 03:30
    expect(suggestSelfIntro({ start_min: 390 })).toBe(false); // 06:30, the next day column
  });

  it("counts each trainee's lessons, cancelled ones aside", () => {
    const w = emptyWeek();
    const [a, b] = [addTrainee(w), addTrainee(w)];
    addLesson(w, 0, 510, 600, { state: "closed", escort_roster_id: a.id });
    addLesson(w, 1, 510, 600, { state: "closed", escort_roster_id: a.id });
    addLesson(w, 2, 510, 600, { state: "cancelled", escort_roster_id: b.id });
    addLesson(w, 3, 510, 600, { state: "closed" });
    expect([...escortLoad(w)]).toEqual([[a.id, 2]]);
  });

  it("composes «משהו שחשוב לדעת» from the instructor's phrases that apply — in their order, nothing of ours", () => {
    const phrases: DutyPhrase[] = [
      { when: "always", text: "ניסוח לדוגמה 1" },
      { when: "self_intro", text: "ניסוח לדוגמה 2" },
      { when: "escort_intro", text: "ניסוח לדוגמה 3" },
      { when: "transport", text: "ניסוח לדוגמה 4" },
      { when: "memorial", text: "ניסוח לדוגמה 5" },
    ];
    const base = { kind: "lesson" as const, self_intro: false, transport: "none" as const, approval: "none" as const };
    expect(dutyNotes(base, phrases)).toEqual(["ניסוח לדוגמה 1", "ניסוח לדוגמה 3"]);
    expect(dutyNotes({ ...base, self_intro: true }, phrases)).toEqual(["ניסוח לדוגמה 1", "ניסוח לדוגמה 2"]);
    expect(dutyNotes({ ...base, transport: "one_way", approval: "pending" }, phrases)).toEqual(["ניסוח לדוגמה 1", "ניסוח לדוגמה 3"]);
    expect(dutyNotes({ ...base, transport: "round_trip", approval: "approved" }, phrases)).toEqual(["ניסוח לדוגמה 1", "ניסוח לדוגמה 3", "ניסוח לדוגמה 4"]);
    expect(dutyNotes({ ...base, kind: "memorial" }, phrases)).toEqual(["ניסוח לדוגמה 1", "ניסוח לדוגמה 5"]);
    expect(dutyNotes(base, undefined)).toEqual([]); // none pasted yet: none
    expect(Object.keys(DUTY_WHEN_LABEL)).toEqual(["always", "self_intro", "escort_intro", "transport", "memorial"]);
  });
});
