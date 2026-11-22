// The words and the one rule of «מאושר/ת להופיע» (PublicOk.tsx) — the activity log's words in the toast, the speaker's
// gender where it is known and the slashed form where not, and who is never offered the box (a practice or demo week).
import { describe, expect, it } from "vitest";
import { approvedWord, practiceWeek, publicOkDone, publicOkHint } from "./PublicOk";

describe("«מאושר/ת להופיע באתר האורחים» (the reset, phase 5)", () => {
  it("the toast says what the activity log says, in the speaker's gender", () => {
    expect(publicOkDone({ title: "ד״ר", name: "מרצה 01", gender: "m" }, true)).toBe("ד״ר מרצה 01 אושר להופיע באתר האורחים");
    expect(publicOkDone({ title: null, name: "מרצה 16", gender: "f" }, false)).toBe("מרצה 16 הוסרה מאתר האורחים");
    expect(publicOkDone({ title: null, name: "מרצה 02", gender: null }, true)).toBe("מרצה 02 אושר/ה להופיע באתר האורחים");
    expect(publicOkDone({ title: null, name: "מרצה 02", gender: null }, false)).toBe("מרצה 02 הוסר/ה מאתר האורחים");
  });

  it("the hint and the state word", () => {
    expect(publicOkHint(null)).toBe("מסמנים רק אחרי שהמרצה הסכים/ה שהשם, התיאור והתמונה יופיעו באתר. ביטול מוריד אותם מהאתר מיד.");
    expect(publicOkHint("f")).toContain("שהמרצה הסכימה שהשם");
    expect([approvedWord("m"), approvedWord("f"), approvedWord(null)]).toEqual(["מאושר", "מאושרת", "מאושר/ת"]);
  });

  it("no box in a practice or demo week but for a global admin; a real edition — live or archived — follows the rules", () => {
    expect(practiceWeek({ global: false }, { kind: "practice" })).toBe(true);
    expect(practiceWeek({ global: false }, { kind: "demo" })).toBe(true);
    expect(practiceWeek({ global: true }, { kind: "demo" })).toBe(false);
    expect(practiceWeek({ global: false }, { kind: "real" })).toBe(false);
    expect(practiceWeek({ global: false }, { kind: "archive" })).toBe(false);
  });
});
