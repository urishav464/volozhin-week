// The three kinds end to end on a table (synthetic, with last year's odd values): read → match → preview → payload.
import { describe, expect, it } from "vitest";
import { DEFAULT_TITLES } from "../data/speakerRules";
import type { Category, Speaker } from "../domain/types";
import { candidatesPayload, contextOf, lookupFor, previewCandidates, readCandidates, splitTopics, undecided } from "./candidates";
import { channelOf, escortsPayload, isContactPhrase, isMoneyOrTransport, phrasesOf, previewEscorts, readEscorts, splitPhrases } from "./escorts";
import { defaultMapping } from "./fields";
import type { Choice } from "./match";
import { archivePayload, doubleGroups, planLessons, plainAmount, previewTrackingSpeakers, proposedCategory, readTracking, topicKey, topicsOf } from "./tracking";

const sp = (id: number, name: string, extra: Partial<Speaker> = {}): Speaker => ({
  id, title: null, name, disambiguator: null, gender: null, affiliation: null, bio_short: null, topics: [], contact_pref: null,
  vetted: "approved", vetted_by: null, vetted_note: null, retired: false, name_key: name, version: 1, ...extra,
});
const POOL = [sp(1, "מרצה 07", { affiliation: "מוסד קיים" }), sp(2, "מרצה 20")];
const NO_LOOKUP = contextOf(POOL, { phones: [], contacts: [] });

describe("(a) the candidates", () => {
  const grid = [
    ["מרצה", "מוסד", "נושאים", "טלפון", "טווח ימים", "העדפה", "חניך/ה", "הערות"],
    ["הרב דוגמה אלף", "מוסד לדוגמה", "תנ\"ך, פילוסופיה", "000-000-0001", "א-ב", "", "", ""],
    ["הרבנית דוגמה בית", "", "", "", "נסגר", "", "חניך/ה לדוגמה", "הערה לדוגמה"],
    ["ד\"ר מרצה-07", "מוסד לדוגמה", "", "", "", "", "", ""],
    ["מרצה 07ב", "", "", "", "", "", "", ""],
    ["", "שורה בלי שם", "", "", "", "", "", ""],
    ["הרב דוגמה אלף", "", "", "", "", "", "", ""],
    ["דוגמה גימל", "", "", "טלפון לדוגמה", "", "", "", ""],
  ];
  const m = defaultMapping("candidates", grid[0], grid[0].length);
  m[1] = "affiliation";
  m[2] = "topics";
  m[7] = "note";

  it("reads each row: title split, gender «הצעה» from it, tags, the phone apart, statuses and notes as lines", () => {
    const read = readCandidates(grid, m, { headerRow: true, titles: DEFAULT_TITLES, genderFromTitle: true });
    expect(read[0]).toEqual({
      row: 2, skip: null, warnings: [],
      data: { title: "הרב", name: "דוגמה אלף", key: "דוגמה אלף", gender: "m", affiliation: "מוסד לדוגמה", topics: ["תנ\"ך", "פילוסופיה"], phone: "0000000001", phoneKey: "0000000001", email: null, notes: "טווח ימים: א-ב" },
    });
    expect(read[1].data).toMatchObject({ title: "הרבנית", gender: "f", notes: "טווח ימים: נסגר\nהערות: הערה לדוגמה" });
    expect(read[1].data!.notes).not.toContain("חניך/ה לדוגמה"); // an unmapped column (the trainee) is never read
    expect(read[2].data).toMatchObject({ title: "ד״ר", name: "מרצה-07", key: "מרצה 07", gender: null });
    expect(read[4]).toMatchObject({ skip: "אין שם", data: null });
    expect(read[5]).toMatchObject({ skip: "כפול בטבלה (כמו שורה 2)" });
    expect(read[6]).toMatchObject({ warnings: ["הטלפון לא נשמר: לא נראה כמו מספר"], data: { phone: null } });
    // the «הצעה» off: no gender at all
    expect(readCandidates(grid, m, { headerRow: true, titles: DEFAULT_TITLES, genderFromTitle: false })[0].data!.gender).toBeNull();
  });

  it("previews «חדש · תואם · עמום · מדולג», says what a match fills, and waits for every «עמום» before a payload", () => {
    const read = readCandidates(grid, m, { headerRow: true, titles: DEFAULT_TITLES, genderFromTitle: true });
    expect(lookupFor(read, POOL)).toEqual({ speakerIds: [1], phoneKeys: ["0000000001"] });
    const preview = previewCandidates(read, contextOf(POOL, { phones: [], contacts: [{ speaker_id: 1, phone: false, email: false, secretary_note: false, notes: true }] }));
    expect(preview.map((r) => r.status)).toEqual(["new", "new", "match", "ambiguous", "skip", "skip", "new"]);
    expect(preview[2].fills).toEqual(["תואר"]); // its affiliation is there already: never overwritten
    expect(candidatesPayload(preview, new Map(), "brainstorm-5786", null)).toBeNull();
    expect(undecided(preview, new Map()).map((r) => r.row)).toEqual([5]);
    const choices = new Map<number, Choice>([[5, { action: "merge", target: 1 }], [8, { action: "skip" }]]);
    const p = candidatesPayload(preview, choices, "brainstorm-5786", null)!;
    expect(p.rows.map((r) => [r.row, r.action, r.speaker_id])).toEqual([
      [2, "new", null],
      [3, "new", null],
      [4, "merge", 1],
      [5, "merge", 1],
    ]);
    expect(p.rows[0]).toMatchObject({ phone: "0000000001", notes: "טווח ימים: א-ב", gender: "m" });
  });

  it("a phone the pool has makes a row «תואם», whatever the name", () => {
    const read = readCandidates([["מרצה", "טלפון"], ["שם אחר לגמרי", "0000000002"]], ["name", "phone"], { headerRow: true, titles: DEFAULT_TITLES, genderFromTitle: true });
    expect(previewCandidates(read, contextOf(POOL, { phones: [{ key: "0000000002", speaker_id: 2 }], contacts: [] }))[0]).toMatchObject({ status: "match", match: { target: 2, via: "phone" } });
  });

  it("topics: tags of ≤ 40 characters, at most 10 — the rest goes to the note whole, never cut", () => {
    expect(splitTopics(`א, ב; ג\n${"ד".repeat(41)}`)).toEqual({ tags: ["א", "ב", "ג"], rest: ["ד".repeat(41)] });
    expect(splitTopics(Array.from({ length: 12 }, (_, i) => `נושא ${i}`).join(",")).rest).toEqual(["נושא 10", "נושא 11"]);
  });
});

describe("(b) the tracking sheet", () => {
  const H = ["מרצה", "שיעור ב", "כותרת", "מקורות (נשלח?)", "הסעה/תשלום", "טלפון", "קיבל הודעת סיכום מ", "נושא"];
  const grid = [
    H,
    ["הרב דוגמה אלף", "ראשון 8:30", "שיעור לדוגמה א", "כן", "300", "000-000-0001", "חניך/ה לדוגמה", "תנ\"ך"],
    ["מרצה 07", "ראשון 8:30", "שיעור לדוגמה ב", "כן+סרטון", "הסעה הלוך וחזור, נהג 000-000-0009", "", "", "פילוסופיה"],
    ["דוגמה גימל", "שני 10:00 כפולה", "שיעור לדוגמה ג", "להדפיס לפני", "", "", "", "משהו אחר"],
    ["דוגמה דלת", "שני 10:00 כפולה", "שיעור לדוגמה ד", "", "", "", "", ""],
    ["דוגמה הא", "שישי 8:30", "שיעור בשישי", "", "", "", "", ""],
    ["זמן זיכרון", "שלישי 13:00", "", "", "", "", "", ""],
    ["דוגמה וו", "חמישי 17:30", "שיעור להורים", "נשלח במייל", "", "", "", ""],
    ["הרב דוגמה אלף", "ראשון 8:30", "פעם שנייה באותה שעה", "", "", "", "", ""],
    ["דוגמה זין", "רביעי 00:30", "שיעור לילה", "", "", "", "", ""],
    ["דוגמה חית", "רביעי 9:15", "", "", "", "", "", ""],
  ];
  const m = defaultMapping("tracking", H, H.length);
  const opts = { headerRow: true, titles: DEFAULT_TITLES, genderFromTitle: true };
  const cats: Category[] = [
    { id: 1, name: "תנ\"ך", color: "#000000", sort: 1, active: true },
    { id: 5, name: "פילוסופיה", color: "#000000", sort: 5, active: true },
  ];

  it("reads rows: the speakers once each (the phone to its speaker), memorial and out-of-week rows skipped with reasons", () => {
    const read = readTracking(grid, m, opts);
    expect(read.speakers.map((s) => [s.key, s.title, s.gender, s.phone, s.rows])).toEqual([
      ["דוגמה אלף", "הרב", "m", "0000000001", [2, 9]],
      ["מרצה 07", null, null, null, [3]],
      ["דוגמה גימל", null, null, null, [4]],
      ["דוגמה דלת", null, null, null, [5]],
      ["דוגמה הא", null, null, null, [6]],
      ["דוגמה וו", null, null, null, [8]],
      ["דוגמה זין", null, null, null, [10]],
      ["דוגמה חית", null, null, null, [11]],
    ]);
    expect(read.rows.find((r) => r.row === 6)!.skip).toBe("יום מחוץ לשבוע (ראשון עד חמישי)");
    expect(read.rows.find((r) => r.row === 7)!.skip).toMatch(/^זמן זיכרון/);
    expect(read.rows.find((r) => r.row === 8)!.audience).toBe("שיעור להורים");
    expect(doubleGroups(read)).toEqual([{ id: 4, rows: [4, 5] }]);
    expect(topicsOf(read).map((t) => t.text)).toEqual(["תנ\"ך", "פילוסופיה", "משהו אחר"]);
    expect(proposedCategory("תנ״ך", cats)).toBe(1);
    expect(proposedCategory("משהו אחר", cats)).toBeNull();
    expect(plainAmount("₪ 300")).toBe(300);
    expect(plainAmount('300 ש"ח')).toBe(300);
    expect(plainAmount("300 + הסעה")).toBeNull();
    expect(plainAmount("0")).toBeNull();
  });

  const input = (decision: "parallel" | "merge") => ({
    decisions: new Map([[4, decision]]),
    categories: new Map([[topicKey("תנ\"ך"), 1], [topicKey("פילוסופיה"), 5], [topicKey("משהו אחר"), null]]),
    sources: new Map(),
  });

  it("plans the lessons: a plain amount, the transport words (no phone) and who sent the summary as the note; rooms for overlaps", () => {
    const read = readTracking(grid, m, opts);
    expect(planLessons(read, { ...input("parallel"), decisions: new Map() })).toBeNull(); // a «כפולה» group waits
    const plans = planLessons(read, input("parallel"))!;
    const by = (row: number) => plans.find((p) => p.rows.includes(row))!;
    expect(by(2)).toMatchObject({ day: 0, start_min: 510, end_min: 600, room: 0, pay_amount: 300, category_id: 1, sources_kind: "sheet", import_note: "קיבל הודעת סיכום מ: חניך/ה לדוגמה" });
    expect(by(3)).toMatchObject({ room: 1, sources_kind: "sheet_video", pay_amount: null, import_note: "הסעה/תשלום: הסעה הלוך וחזור, נהג [טלפון הוסר]", warnings: ["הוסר טלפון או מייל מההערה"] });
    expect(by(4)).toMatchObject({ day: 1, start_min: 600, end_min: 690, room: 0, print_when: "before", category_id: null });
    expect(by(5)).toMatchObject({ day: 1, start_min: 600, room: 1 });
    expect(by(8)).toMatchObject({ day: 4, start_min: 1050, end_min: 1140, audience: "שיעור להורים", sources_kind: "other", sources_note: "נשלח במייל" });
    expect(by(9).skip).toBe("המרצה כבר משובץ/ת בשעה הזו (שורה 2)");
    expect(by(10)).toMatchObject({ day: 3, start_min: 1470, end_min: 1560 });
    expect(by(11).skip).toBe("רק שעת התחלה, והיא אינה תחילת שורה ברשת");
  });

  it("a «כפולה» group merged: one lesson, the speakers together, one slot → it and the next («הצעה»)", () => {
    const plans = planLessons(readTracking(grid, m, opts), input("merge"))!;
    const merged = plans.find((p) => p.rows.includes(4))!;
    expect(merged).toMatchObject({ rows: [4, 5], start_min: 600, end_min: 780, rangeSuggested: true, speakerKeys: ["דוגמה גימל", "דוגמה דלת"], title: "שיעור לדוגמה ג", import_note: "כותרת נוספת: שיעור לדוגמה ד" });
  });

  it("the payload: speakers once, as matched or chosen; a lesson whose speakers were all skipped is left out", () => {
    const read = readTracking(grid, m, opts);
    const plans = planLessons(read, input("parallel"))!;
    const speakers = previewTrackingSpeakers(read, NO_LOOKUP);
    expect(speakers.find((s) => s.speaker.key === "מרצה 07")).toMatchObject({ status: "match", match: { target: 1 } });
    const meta = { label: "תשפ\"ו", start_date: null, source: "tracking-5786", titles_from: null };
    const p = archivePayload(plans, speakers, new Map([["דוגמה דלת", { action: "skip" }]]), meta)!;
    expect(p.speakers.map((s) => [s.name, s.action, s.speaker_id])).toEqual([
      ["דוגמה אלף", "new", null],
      ["מרצה 07", "merge", 1],
      ["דוגמה גימל", "new", null],
      ["דוגמה וו", "new", null],
      ["דוגמה זין", "new", null],
    ]);
    expect(p.lessons.map((l) => [l.row, l.speakers])).toEqual([
      [2, [0]],
      [3, [1]],
      [4, [2]],
      [8, [3]],
      [10, [4]],
    ]);
    expect(p.speakers[0].phone).toBe("0000000001");
    expect(JSON.stringify(p)).not.toContain("0000000009"); // the driver's phone never reaches the payload
  });
});

describe("(c) the escorts' file", () => {
  const grid = [
    ["מרצה", "מלווה", "הערות"],
    ["מרצה 07", "חניך/ה לדוגמה", "דרך המזכירה. תשלום בהעברה בנקאית"],
    ["מרצה 20", "חניך/ה לדוגמה", "רק בוואטסאפ\nלאסוף מהתחנה"],
    ["מרצה 07", "חניך/ה לדוגמה", "דרך המזכירה"],
    ["מרצה לא במאגר", "חניך/ה לדוגמה", "רק בוואטסאפ"],
    ["מרצה 20", "", "אוהב/ת קפה"],
  ];
  const m = ["speaker", null, "phrases"];

  it("phrases: split, grouped, pre-ticked when about the channel («הצעה»), payment and transport dropped", () => {
    expect(splitPhrases("דרך המזכירה. תשלום בהעברה בנקאית")).toEqual(["דרך המזכירה", "תשלום בהעברה בנקאית"]);
    const phrases = phrasesOf(readEscorts(grid, m, { headerRow: true, titles: DEFAULT_TITLES }));
    expect(phrases.map((p) => [p.text, p.count, p.channel, p.contact, p.money])).toEqual([
      ["דרך המזכירה", 2, "secretary", true, false],
      ["תשלום בהעברה בנקאית", 1, null, false, true],
      ["רק בוואטסאפ", 2, "whatsapp", true, false],
      ["לאסוף מהתחנה", 1, null, false, true],
      ["אוהב/ת קפה", 1, null, false, false],
    ]);
    for (const w of ["רק בווטסאפ", "וואטסאפ בלבד", "ווצאפ", "WhatsApp"]) expect(channelOf(w)).toBe("whatsapp");
    expect(channelOf("במייל או בטלפון")).toBeNull(); // two channels: none chosen
    expect(isContactPhrase("לתאם הסעה דרך המזכירה")).toBe(false);
    expect(isMoneyOrTransport("לתאם הסעה דרך המזכירה")).toBe(true);
  });

  it("previews per speaker: ticked phrases as the note, one channel as contact_pref, not in the pool → «מדולג»", () => {
    const rows = readEscorts(grid, m, { headerRow: true, titles: DEFAULT_TITLES });
    const ticked = new Set(["דרך המזכירה", "רק בוואטסאפ", "אוהב/ת קפה", "תשלום בהעברה בנקאית"]);
    const preview = previewEscorts(rows, ticked, NO_LOOKUP);
    const of = (k: string) => preview.find((p) => p.key === k)!;
    expect(of("מרצה 07")).toMatchObject({ status: "match", rows: [2, 4], contact_pref: "secretary", secretary_note: "דרך המזכירה", fills: ["ערוץ קשר", "איך פונים"] });
    // a money phrase never reaches the note, even ticked
    expect(of("מרצה 07").secretary_note).not.toContain("תשלום");
    expect(of("מרצה 20")).toMatchObject({ status: "match", contact_pref: "whatsapp", secretary_note: "רק בוואטסאפ · אוהב/ת קפה" });
    expect(of("מרצה לא במאגר")).toMatchObject({ status: "skip", reason: "לא במאגר — קודם מייבאים את המועמדים או את גיליון המעקב" });
    expect(escortsPayload(preview, new Map())).toEqual({
      rows: [
        { row: 2, speaker_id: 1, contact_pref: "secretary", secretary_note: "דרך המזכירה" },
        { row: 3, speaker_id: 2, contact_pref: "whatsapp", secretary_note: "רק בוואטסאפ · אוהב/ת קפה" },
      ],
    });
    expect(JSON.stringify(escortsPayload(preview, new Map()))).not.toContain("חניך/ה"); // never an escort's name
  });
});
