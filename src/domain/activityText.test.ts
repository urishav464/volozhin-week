import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../data/speakers";
import { timeline } from "./activityText";
import { LRM } from "./time";

let seq = 0;
const row = (entity: string, kind: string, detail: Record<string, unknown>, actor: number | null = 2, entity_id = 9): ActivityEntry => ({
  id: ++seq, at: `2026-11-0${seq}T10:00:00Z`, actor, edition_id: 1, entity, entity_id, kind, detail,
});

const names = new Map([[1, "מדריך/ה"], [2, "חניך/ה א׳"], [3, "חניך/ה ב׳"]]);
const ctx = (gender: "m" | "f" | null) => ({ name: (id: number) => names.get(id) ?? null, gender, lesson: (id: number) => (id === 5 ? "ראשון 08:30" : null) });

describe("a speaker's timeline", () => {
  it("says what changed on each approach row, against the row before it", () => {
    const log = [
      row("approaches", "insert", { status: "claimed", owner: 2, speaker: 4 }),
      row("approaches", "update", { status: "approached", owner: 2, speaker: 4, note: "שלחתי הודעה" }),
      row("approaches", "update", { status: "approached", owner: 2, speaker: 4, offered_to: 3 }),
      row("approaches", "update", { status: "approached", owner: 3, speaker: 4 }, 3),
      row("approaches", "update", { status: "approached", owner: 3, speaker: 4, offered_to: 2 }, 3),
      row("approaches", "update", { status: "approached", owner: 3, speaker: 4 }, 3),
      row("approaches", "update", { status: "declined", owner: null, speaker: 4, note: "לא בשנה הזו" }, 1),
    ].reverse(); // newest first, as speaker_activity returns them
    const lines = timeline(log, ctx("f")).reverse();
    expect(lines.map((l) => l.text)).toEqual([
      "בטיפול חניך/ה א׳ · לפני שיחה",
      "שוחחנו, מחכים לתשובה",
      "הוצע להעביר את הטיפול לחניך/ה ב׳",
      "הטיפול עבר לחניך/ה ב׳",
      "הוצע להעביר את הטיפול לחניך/ה א׳",
      "ההצעה להעביר לא התקבלה או בוטלה",
      "חזרה למאגר, בלי מטפל/ת · סירבה",
    ]);
    expect(lines[1].note).toBe("שלחתי הודעה");
    expect(lines[3].who).toBe("חניך/ה ב׳");
    expect(lines[6].who).toBe("מדריך/ה");
  });

  it("speaks of the speaker in their gender, slashed while it is unknown", () => {
    const log = [
      row("speakers", "vet", { vetted: "approved", note: null }, 1),
      row("speakers", "contacts", { fields: ["phone", "notes"] }),
      row("speakers", "update", { fields: ["bio_short", "topics"] }),
      row("speakers", "insert", { vetted: "pending" }),
    ];
    expect(timeline(log, ctx("m")).map((l) => l.text)).toEqual(["אושר", "פרטי הקשר עודכנו: טלפון, הערות", "הפרטים עודכנו: תיאור קצר, נושאים", "נוסף למאגר"]);
    expect(timeline(log, ctx(null))[3].text).toBe("נוסף/ה למאגר");
    expect(timeline([row("speakers", "vet", { vetted: "rejected" })], ctx(null))[0].text).toBe("נדחה/תה");
  });

  it("availability per slot (its range, left to right) and cells, with the lesson's time when it is loaded", () => {
    const log = [
      row("approaches", "availability", { speaker: 4, day: 0, start: 510, end: 600, kind: "cannot", note: "לא בבקרים" }),
      row("approaches", "availability", { speaker: 4, day: 2, start: 1200, end: 1290, kind: null }),
      row("pitches", "insert", { state: "candidate", lesson: 5, approach: 9 }),
      row("pitches", "update", { state: "declined", lesson: 5, approach: 9 }),
      row("pitches", "update", { state: "accepted", lesson: 77, approach: 9 }),
    ];
    const lines = timeline(log, ctx("f"));
    expect(lines.map((l) => l.text)).toEqual([
      `זמינות: ראשון ${LRM}08:30–10:00 — לא יכולה`,
      `זמינות: שלישי ${LRM}20:00–21:30 — לא ידוע`,
      "הוצעה למשבצת (ראשון 08:30)",
      "סירבה למשבצת (ראשון 08:30)",
      "השיעור נסגר",
    ]);
    expect(lines[0].note).toBe("לא בבקרים");
    expect(timeline([log[0]], ctx(null))[0].text).toBe(`זמינות: ראשון ${LRM}08:30–10:00 — לא יכול/ה`);
  });

  it("a row logged before v14 (a part of a day) still reads; one it cannot place says only that it changed", () => {
    const log = [
      row("approaches", "availability", { speaker: 4, day: 1, part: "evening", kind: "can" }),
      row("approaches", "availability", { speaker: 4, day: 3, part: "night", kind: "cannot" }),
      row("approaches", "availability", { speaker: 4, day: 3, part: "dawn", kind: "can" }),
      row("approaches", "availability", { speaker: 4, day: 7, start: 510, end: 600, kind: "can" }),
    ];
    expect(timeline(log, ctx("m")).map((l) => l.text)).toEqual(["זמינות: שני ערב — יכול", "זמינות: רביעי לילה — לא יכול", "זמינות עודכנה", "זמינות עודכנה"]);
  });

  it("an approach row with nothing older in the list says where it stands", () => {
    const [line] = timeline([row("approaches", "update", { status: "claimed", owner: 3, speaker: 4, offered_to: 2, note: "לדוגמה" })], ctx("m"));
    expect(line.text).toBe("בטיפול חניך/ה ב׳ · הוצע להעביר את הטיפול לחניך/ה א׳ · לפני שיחה");
    expect(line.note).toBe("לדוגמה");
  });

  it("a member not on this edition's team is «חבר/ת צוות»; no actor is none", () => {
    const [a, b] = timeline([row("speakers", "insert", {}, 99), row("speakers", "insert", {}, null)], ctx("m"));
    expect(a.who).toBe("חבר/ת צוות");
    expect(b.who).toBeNull();
  });
});
