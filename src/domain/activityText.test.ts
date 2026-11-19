import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../data/speakers";
import { curate, timeline } from "./activityText";
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

  it("availability by ranges (v18): one line for the whole update — how many slots it marked; the per-slot rows beside it read as before", () => {
    const log = [
      row("approaches", "availability", { speaker: 4, days: [1, 3], ranges: 2, marked: 7, rest: "cannot" }),
      row("approaches", "availability", { speaker: 4, days: [2], ranges: 1, marked: 1, rest: null }),
      row("approaches", "availability", { speaker: 4, days: [2], ranges: 0, marked: 0, rest: null }),
      row("approaches", "availability", { speaker: 4, day: 0, start: 510, end: 600, kind: "can" }),
      row("approaches", "availability", { speaker: 4, day: 1, part: "evening", kind: "cannot" }),
    ];
    for (const g of ["m", "f", null] as const) {
      expect(timeline(log, ctx(g)).slice(0, 3).map((l) => l.text)).toEqual(["עודכנה הזמינות — 7 משבצות", "עודכנה הזמינות — משבצת אחת", "עודכנה הזמינות — 0 משבצות"]);
    }
    expect(timeline(log, ctx("f")).slice(3).map((l) => l.text)).toEqual([`זמינות: ראשון ${LRM}08:30–10:00 — יכולה`, "זמינות: שני ערב — לא יכולה"]);
    expect(timeline(log, ctx("f"))[0]).toMatchObject({ who: "חניך/ה א׳", note: null }); // never a note in this event
    // a count that came as text (bigint columns do) reads the same; one that is no number falls back to the old line
    expect(timeline([row("approaches", "availability", { speaker: 4, days: [1], ranges: 1, marked: "12", rest: null })], ctx("m"))[0].text).toBe("עודכנה הזמינות — 12 משבצות");
    expect(timeline([row("approaches", "availability", { speaker: 4, days: [1], marked: null })], ctx("m"))[0].text).toBe("זמינות עודכנה");
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

describe("«מה קרה» curated (curate)", () => {
  const at = (iso: string, e: ActivityEntry): ActivityEntry => ({ ...e, at: iso });

  it("keeps the approach, the call, the pitches and the vetting; leaves out edits of the record and of the contacts", () => {
    const log = [
      row("speakers", "vet", { vetted: "approved" }, 1),
      row("speakers", "contacts", { fields: ["phone"] }),
      row("speakers", "update", { fields: ["bio_short"] }),
      row("pitches", "update", { state: "accepted", lesson: 5 }),
      row("approaches", "update", { status: "positive", owner: 2, speaker: 4 }),
      row("approaches", "insert", { status: "claimed", owner: 2, speaker: 4 }),
      row("speakers", "insert", { vetted: "pending" }),
      row("other", "whatever", {}),
    ];
    expect(curate(log).map((e) => `${e.entity}:${e.kind}`)).toEqual(["speakers:vet", "pitches:update", "approaches:update", "approaches:insert", "speakers:insert"]);
  });

  it("one member's availability taps on one Israel day are one line: how many slots, which days — where the newest stood", () => {
    const tap = (iso: string, actor: number, day: number, start: number, kind: string | null) => at(iso, row("approaches", "availability", { speaker: 4, day, start, end: start + 90, kind }, actor));
    const log = [
      tap("2026-11-18T21:30:00Z", 2, 1, 510, "can"), // 23:30 in Israel: still the 18th
      tap("2026-11-18T20:00:00Z", 2, 1, 510, "cannot"), // the same slot again
      at("2026-11-18T19:00:00Z", row("pitches", "insert", { state: "candidate", lesson: 5 })),
      tap("2026-11-18T18:00:00Z", 2, 3, 960, "can"),
      tap("2026-11-18T17:00:00Z", 3, 2, 600, "can"), // another member: a line of their own
      tap("2026-11-17T23:00:00Z", 2, 0, 600, "can"), // 01:00 on the 18th in Israel
      tap("2026-11-17T08:00:00Z", 2, 4, 600, "cannot"), // the 17th: a line of its own
      at("2026-11-16T08:00:00Z", row("approaches", "availability", { speaker: 4, days: [1, 3], ranges: 2, marked: 7, rest: null })),
    ];
    const out = curate(log);
    expect(out.map((e) => e.id)).toEqual([log[0].id, log[2].id, log[4].id, log[6].id, log[7].id]);
    expect(out[0].detail).toEqual({ speaker: 4, marked: 3, days: [0, 1, 3] });
    expect(out[0].at).toBe(log[0].at);
    expect(out[2]).toBe(log[4]); // a single tap keeps its own line: it says which slot
    expect(out[4]).toBe(log[7]); // a set of ranges is one line already
    const lines = timeline(out, ctx("f"));
    expect(lines[0].text).toBe("עודכנה הזמינות — 3 משבצות");
    expect(lines[2].text).toBe(`זמינות: שלישי ${LRM}10:00–11:30 — יכולה`);
  });

  it("the approach's lines still compare with the approach's row before them", () => {
    const log = [
      row("approaches", "update", { status: "approached", owner: 3, speaker: 4 }, 3),
      row("approaches", "availability", { speaker: 4, day: 0, start: 510, end: 600, kind: "can" }),
      row("approaches", "availability", { speaker: 4, day: 0, start: 600, end: 690, kind: "can" }),
      row("speakers", "update", { fields: ["topics"] }),
      row("approaches", "update", { status: "approached", owner: 2, speaker: 4 }),
    ];
    expect(timeline(curate(log), ctx("m"))[0].text).toBe("הטיפול עבר לחניך/ה ב׳");
  });
});
