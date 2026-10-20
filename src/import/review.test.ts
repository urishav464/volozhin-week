// What the review of the import found (DECISIONS «ביקורת: ייבוא ואבן דרך 6»), each a rule with a test that fails
// without it: a day named once and as a whole word; «ליל» of one day refused; adjacent double lessons apart; the
// markers in mapped columns only; «כפולה» out of names; the sources' words without phones; Thursday's end; the rows
// of one table against each other (the same phone, a name 0.6 alike); the escorts' WhatsApp as a word; dates no
// phones; the label's key. Synthetic names and numbers only.
import { describe, expect, it } from "vitest";
import { labelKey } from "../data/importRules";
import { DEFAULT_TITLES } from "../data/speakerRules";
import type { Speaker } from "../domain/types";
import { candidatesPayload, contextOf, previewCandidates, readCandidates, undecided } from "./candidates";
import { channelOf } from "./escorts";
import { defaultMapping, type Mapping } from "./fields";
import { fillPlan, type Choice } from "./match";
import { normalizePhone, scrubContacts } from "./phone";
import { archivePayload, doubleGroups, planLessons, previewTrackingSpeakers, readTracking, speakerAliases, WHEN_PROBLEM } from "./tracking";
import { parseWhen } from "./when";

const sp = (id: number, name: string, extra: Partial<Speaker> = {}): Speaker => ({
  id, title: null, name, disambiguator: null, gender: null, affiliation: null, bio_short: null, topics: [], contact_pref: null,
  vetted: "approved", vetted_by: null, vetted_note: null, retired: false, name_key: name, version: 1, ...extra,
});
const EMPTY = contextOf([], { phones: [], contacts: [] });
const H = ["מרצה", "שיעור ב", "כותרת", "מקורות (נשלח?)", "הסעה/תשלום", "טלפון", "קיבל הודעת סיכום מ", "נושא"];
const opts = { headerRow: true, titles: DEFAULT_TITLES, genderFromTitle: true };
const track = (rows: string[][], headers = H, m?: Mapping) => readTracking([headers, ...rows], m ?? defaultMapping("tracking", headers, headers.length), opts);
/** A tracking row: speaker, when, title — the rest empty. */
const r = (speaker: string, when: string, title = "", extra: string[] = []) => [speaker, when, title, "", "", "", "", "", ...extra];
const plan = (read: ReturnType<typeof track>, decisions: [number, "parallel" | "merge"][] = [], alias?: Map<string, string>) =>
  planLessons(read, { decisions: new Map(decisions), categories: new Map(), sources: new Map(), alias })!;

describe("«שיעור ב»: the day it names — once, as a whole word; never guessed", () => {
  it("a cell naming two days is refused («חלק שני», «שיעור ראשון», «מפגש שני», «שיעור ב'»), wherever the other day is", () => {
    for (const c of ["חמישי 10:00 (חלק שני)", "(חלק שני) חמישי 10:00", "יום ה' 14:30 (מפגש שני)", "חמישי 10:00 עם שני מרצים", "שלישי 8:30 שיעור ראשון", "יום ד 10:00 שיעור ב'"]) {
      expect(parseWhen(c), c).toBe("two_days");
    }
    expect(WHEN_PROBLEM.two_days).toContain("שני ימים");
  });

  it("a day inside a longer word, or after ה, names none: «שלישית», «שנייה», «שניהם», «השני», «חמישים», «שישים»", () => {
    const day = (c: string) => (parseWhen(c) as { day: number }).day;
    expect(day("רביעי 22:00 (שעה שלישית)")).toBe(3);
    expect(day("שלישי 20:00 כפולה - שעה שנייה")).toBe(2);
    expect(day("רביעי 10:00 שניהם יחד")).toBe(3);
    expect(day("רביעי 10:00 הסבב השני")).toBe(3);
    expect(day("יום ג' 10:00 חמישים משתתפים")).toBe(2);
    expect(day("רביעי 10:00 שישים משתתפים")).toBe(3);
    expect(day("ביום שני 10:00")).toBe(1);
    expect(day("שני 10:00 (יום ב')")).toBe(1); // the same day twice is one day
  });

  it("«ליל» of one day is refused — the night before it or after? «ליל X–Y» (the app's own form) is read", () => {
    for (const c of ["ליל שלישי 01:00", "בליל רביעי 02:00", "ליל ה' 00:30"]) expect(parseWhen(c), c).toBe("ambiguous_night");
    expect(parseWhen("ליל שני–שלישי 00:30")).toEqual({ day: 1, start: 1470, end: null, rest: "" });
    expect(parseWhen("ליל ראשון-שני 00:30–01:45")).toMatchObject({ day: 0, start: 1470, end: 1545 });
    expect(parseWhen("ליל שני–רביעי 00:30")).toBe("two_days");
    expect(parseWhen("ליל חמישי–שישי 00:30")).toMatchObject({ day: 4, start: 1470 });
    expect(parseWhen("רביעי 00:30")).toMatchObject({ day: 3, start: 1470 }); // no «ליל»: the grid's rule («הצעה», shown)
  });

  it("the sheet: such a row is «מדולג» with the reason; a «כפולה» pair of «שעה ראשונה» / «שעה שנייה» stays one group", () => {
    const read = track([r("דוגמה אלף", "חמישי 10:00 (חלק שני)", "א"), r("דוגמה בית", "ליל שלישי 01:00", "ב"), r("דוגמה גימל", "שלישי 20:00 כפולה - שעה ראשונה", "ג"), r("דוגמה גימל", "שלישי 21:30 כפולה - שעה שנייה", "ג")]);
    expect(read.rows.map((x) => x.skip)).toEqual([WHEN_PROBLEM.two_days, WHEN_PROBLEM.ambiguous_night, null, null]);
    expect(doubleGroups(read)).toEqual([{ id: 4, rows: [4, 5] }]);
  });

  it("nothing on a Thursday night the week did not have: last year's ended on Thursday at 19:00", () => {
    const plans = plan(track([r("דוגמה אלף", "חמישי 20:00", "א"), r("דוגמה בית", "ליל חמישי–שישי 00:30", "ב"), r("דוגמה גימל", "חמישי 17:30", "ג")]));
    expect(plans.map((p) => p.skip)).toEqual([expect.stringContaining("חמישי ב-19:00"), expect.stringContaining("חמישי ב-19:00"), null]);
  });
});

describe("«כפולה» groups: two double lessons one after the other are two groups", () => {
  const groups = (rows: string[][]) => doubleGroups(track(rows)).map((g) => g.rows);
  it("different speakers at different times split; one speaker all night, or two in one slot, stay together", () => {
    expect(groups([r("דוגמה אלף", "שני 20:00 כפולה"), r("דוגמה אלף", "שני 20:00 כפולה"), r("דוגמה בית", "שני 22:30 כפולה"), r("דוגמה בית", "שני 22:30 כפולה")])).toEqual([
      [2, 3],
      [4, 5],
    ]);
    expect(groups([r("דוגמה אלף", "שני 20:00 כפולה"), r("דוגמה בית", "שני 00:30 כפולה")])).toEqual([[2], [3]]);
    expect(groups([r("דוגמה אלף", "רביעי 22:30 כפולה"), r("דוגמה אלף", "רביעי 00:30 כפולה"), r("דוגמה אלף", "רביעי 02:00 כפולה")])).toEqual([[2, 3, 4]]);
    expect(groups([r("דוגמה אלף", "שני 10:00 כפולה"), r("דוגמה בית", "שני 10:00 כפולה")])).toEqual([[2, 3]]);
  });

  it("merged, every row the same slot: one more slot per row past the first («כל הלילה» was three rows) — «הצעה»", () => {
    const read = track([r("דוגמה אלף", "רביעי 22:30 כפולה"), r("דוגמה אלף", "רביעי 22:30 כפולה"), r("דוגמה אלף", "רביעי 22:30 כפולה")]);
    expect(plan(read, [[2, "merge"]])[0]).toMatchObject({ start_min: 1350, end_min: 1650, rangeSuggested: true, rangeSlots: 3 });
    const two = track([r("דוגמה אלף", "שני 10:00 כפולה"), r("דוגמה בית", "שני 10:00 כפולה")]);
    expect(plan(two, [[2, "merge"]])[0]).toMatchObject({ start_min: 600, end_min: 780, rangeSlots: 2 });
  });
});

describe("the markers: read in the mapped columns only; «זמן זיכרון» where a cell begins with it", () => {
  const headers = [...H, "הערות פנימיות"];
  const m = defaultMapping("tracking", headers, headers.length);
  it("an unmapped column says nothing — no memorial, no «כפולה», no parents' lesson", () => {
    expect(m[8]).toBeNull();
    const read = track(
      [r("דוגמה אלף", "ראשון 8:30", "שיעור א", ["לא לשבץ ליד זמן זיכרון"]), r("דוגמה בית", "ראשון 10:00", "שיעור ב", ["אולי כפולה? לא סגור"]), r("דוגמה גימל", "שני 8:30", "שיעור ג", ["ביקש לא להיות שיעור להורים"])],
      headers,
      m,
    );
    expect(read.rows.map((x) => [x.skip, x.double, x.audience])).toEqual([
      [null, false, null],
      [null, false, null],
      [null, false, null],
    ]);
  });

  it("a title that mentions «זמן זיכרון» is a lesson; a speaker or title cell that begins with it is a memorial time", () => {
    const read = track([r("דוגמה אלף", "ראשון 8:30", "בין יום הזיכרון לזמן זיכרון אישי"), r("זמן זיכרון א", "ראשון 13:00"), r("", "ראשון 14:15", "זמן זיכרון – בדיקה")]);
    expect(read.rows.map((x) => x.skip?.slice(0, 10) ?? null)).toEqual([null, "זמן זיכרון", "זמן זיכרון"]);
    expect(read.rows[2].title).toBe("זמן זיכרון – בדיקה"); // the preview names the row it skipped
  });
});

describe("«כפולה» beside a name or a title: the marker out, the name as the pool has it", () => {
  it("«הרב פלוני - כפולה», «(כפולה)», «כפולה - …»: the name, its title and gender; the row is double", () => {
    for (const cell of ["הרב דוגמה אלף - כפולה", "הרב דוגמה אלף (כפולה)", "כפולה - הרב דוגמה אלף"]) {
      const read = track([r(cell, "שני 10:00", "שיעור (כפולה)")]);
      expect(read.speakers.map((s) => [s.key, s.name, s.title, s.gender]), cell).toEqual([["דוגמה אלף", "דוגמה אלף", "הרב", "m"]]);
      expect([read.rows[0].double, read.rows[0].title], cell).toEqual([true, "שיעור"]);
    }
  });

  it("«הכפולה» inside a title is a word of the title: kept, and the row is not double; two speakers on two lines stay two", () => {
    expect(track([r("דוגמה אלף", "שני 20:00", "הנאמנות הכפולה")]).rows[0]).toMatchObject({ double: false, title: "הנאמנות הכפולה" });
    expect(track([r("דוגמה אלף - כפולה\nדוגמה בית", "שני 20:00")]).speakers.map((s) => s.key)).toEqual(["דוגמה אלף", "דוגמה בית"]);
  });

  it("the marked name matches the pool as its plain name — never a second speaker «… כפולה»", () => {
    const read = track([r("הרב דוגמה אלף - כפולה", "שני 10:00"), r("הרב דוגמה אלף - כפולה", "שני 11:30")]);
    const ctx = contextOf([sp(61, "דוגמה אלף", { title: "הרב", gender: "m" })], { phones: [], contacts: [] });
    expect(previewTrackingSpeakers(read, ctx).map((s) => [s.speaker.key, s.status])).toEqual([["דוגמה אלף", "match"]]);
  });
});

describe("the sources' own words: no phone, no e-mail — and a title is never scrubbed", () => {
  it("a contact in «מקורות» is taken out of the sources note, and said; a range of years in a title stays", () => {
    const plans = plan(track([["דוגמה אלף", "ראשון 8:30", "מלחמות ישראל 1948-1967", "שלח למייל fake.speaker@example.com", "", "", "", ""], ["דוגמה בית", "שני 8:30", "", "רק בוואטסאפ +972-00-000-1111", "", "", "", ""]]));
    expect(plans.map((p) => [p.title, p.sources_kind, p.sources_note, p.warnings])).toEqual([
      ["מלחמות ישראל 1948-1967", "other", "שלח למייל [מייל הוסר]", ["הוסר טלפון או מייל מהערת המקורות"]],
      [null, "other", "רק בוואטסאפ [טלפון הוסר]", ["הוסר טלפון או מייל מהערת המקורות"]],
    ]);
  });

  it("a date or a range of years in a note is no phone; a cell of two numbers is compared by its first", () => {
    expect(scrubContacts('שולם 1500 ש"ח ב-12.3.2026, שוב ב-05/03/26')).toEqual({ text: 'שולם 1500 ש"ח ב-12.3.2026, שוב ב-05/03/26', scrubbed: false });
    expect(scrubContacts("בשנים 1948-1967").scrubbed).toBe(false);
    expect(scrubContacts("נהג 000-000-0009").text).toBe("נהג [טלפון הוסר]");
    expect(normalizePhone("000 0000001 / 000 0000002")).toEqual({ value: "000 0000001 / 000 0000002", key: "0000000001", problem: false });
    expect(normalizePhone("000-000-0001")).toEqual({ value: "0000000001", key: "0000000001", problem: false });
  });
});

describe("one table's rows against each other: the same phone, a name 0.6 alike — «עמום», never silent", () => {
  const cands = (rows: string[][]) => {
    const grid = [["מרצה", "טלפון", "הערות"], ...rows];
    return previewCandidates(readCandidates(grid, ["name", "phone", "note"], opts), EMPTY);
  };

  it("two names on one line: the second «עמום» (the same phone); «חדש» makes two speakers — a couple are two people", () => {
    const p = cands([["הרב בודק אלף", "000-000-0077", ""], ["הרבנית בודקת בית", "+972 (0)00 000 0077", ""]]);
    expect(p.map((x) => [x.row, x.status])).toEqual([
      [2, "new"],
      [3, "ambiguous"],
    ]);
    expect(p[1].match).toMatchObject({ allowNew: true, sheet: [{ ref: "2", via: "phone" }] });
    expect(candidatesPayload(p, new Map(), "x", null)).toBeNull();
    expect(undecided(p, new Map()).map((x) => x.row)).toEqual([3]);
    const two = candidatesPayload(p, new Map<number, Choice>([[3, { action: "new" }]]), "x", null)!;
    expect(two.rows.map((x) => [x.action, x.name, x.title, x.gender])).toEqual([
      ["new", "בודק אלף", "הרב", "m"],
      ["new", "בודקת בית", "הרבנית", "f"],
    ]);
  });

  it("one person spelled two ways: «אותו/ה מרצה כמו שורה N» sends the row under row N's name (the commit completes that speaker)", () => {
    const p = cands([["יהודה לדוגמה", "", ""], ["יהודא לדוגמה", "", "רק בבוקר"]]);
    expect(p.map((x) => x.status)).toEqual(["new", "ambiguous"]);
    expect(p[1].match?.sheet?.[0]).toMatchObject({ ref: "2", via: "similar" });
    const one = candidatesPayload(p, new Map<number, Choice>([[3, { action: "same", ref: "2" }]]), "x", null)!;
    expect(one.rows.map((x) => [x.row, x.action, x.name, x.notes])).toEqual([
      [2, "new", "יהודה לדוגמה", null],
      [3, "new", "יהודה לדוגמה", "הערות: רק בבוקר"],
    ]);
    // the row it names left out: the choice cannot stand
    const left = new Map<number, Choice>([[2, { action: "skip" }], [3, { action: "same", ref: "2" }]]);
    expect(candidatesPayload(p, left, "x", null)).toBeNull();
    expect(undecided(p, left).map((x) => x.row)).toEqual([3]);
  });

  it("the tracking sheet: the same, its lessons on one speaker («כמו …»), the second row under the first's name", () => {
    const read = track([r("הרב יהודה לדוגמה", "ראשון 8:30", "שיעור א"), ["הרב יהודא לדוגמה", "שני 8:30", "שיעור ב", "", "", "000-000-0055", "", ""]]);
    const speakers = previewTrackingSpeakers(read, EMPTY);
    expect(speakers.map((s) => [s.speaker.key, s.status])).toEqual([
      ["יהודה לדוגמה", "new"],
      ["יהודא לדוגמה", "ambiguous"],
    ]);
    const choices = new Map<string, Choice>([["יהודא לדוגמה", { action: "same", ref: "יהודה לדוגמה" }]]);
    const alias = speakerAliases(speakers, choices);
    expect([...alias]).toEqual([["יהודא לדוגמה", "יהודה לדוגמה"]]);
    const p = archivePayload(plan(read, [], alias), speakers, choices, { label: "x", start_date: null, source: "x", titles_from: null })!;
    expect(p.speakers.map((s) => [s.row, s.action, s.name, s.phone])).toEqual([
      [2, "new", "יהודה לדוגמה", null],
      [3, "new", "יהודה לדוגמה", "0000000055"],
    ]);
    expect(p.lessons.map((l) => [l.row, l.speakers])).toEqual([
      [2, [0]],
      [3, [0]],
    ]);
    // two speakers with one phone, each «חדש»: two speakers, each with their own lesson
    const shared = track([r("בודק גימל", "ראשון 8:30"), ["בודקת דלת", "שני 8:30", "", "", "", "", "", ""]].map((x, i) => (i === 0 ? [...x.slice(0, 5), "000-000-0066", ...x.slice(6)] : [...x.slice(0, 5), "0000000066", ...x.slice(6)])));
    const sps = previewTrackingSpeakers(shared, EMPTY);
    expect(sps.map((s) => s.status)).toEqual(["new", "ambiguous"]);
    const both = new Map<string, Choice>([["בודקת דלת", { action: "new" }]]);
    const q = archivePayload(plan(shared, [], speakerAliases(sps, both)), sps, both, { label: "x", start_date: null, source: "x", titles_from: null })!;
    expect(q.lessons.map((l) => [l.row, l.speakers])).toEqual([
      [2, [0]],
      [3, [1]],
    ]);
  });
});

describe("a match fills only what does not contradict the pool's own title", () => {
  it("«הרבנית» with no gender and a row «הרב»: no gender filled, and the preview says so; «ד״ר» takes the row's", () => {
    const row = { title: "הרב", gender: "m" as const, affiliation: null, topics: [], phone: null, email: null, notes: null };
    expect(fillPlan(sp(1, "x", { title: "הרבנית" }), undefined, row)).toEqual(["מגדר: לא ימולא — במאגר התואר הרבנית"]);
    expect(fillPlan(sp(1, "x", { title: "ד״ר" }), undefined, row)).toEqual(["מגדר: זכר (הצעה, מהתואר)"]);
  });
});

describe("the escorts' file and the label", () => {
  it("WhatsApp as a word — never «וספ» inside נוספות, תוספת, הוספה", () => {
    for (const p of ["שעות נוספות", "זמין גם בימים נוספים", "בתוספת הסעה", "הוספה לקבוצה"]) expect(channelOf(p), p).toBeNull();
    expect(channelOf("דרך המזכירה, בתוספת הודעה")).toBe("secretary");
    for (const p of ["רק בוואטסאפ", "ווטסאפ", "וואצאפ בלבד", "לוואטסאפ", "WhatsApp"]) expect(channelOf(p), p).toBe("whatsapp");
  });

  it("an archive's label by its key: the quote marks as ASCII, spaces single", () => {
    expect(["תשפ\"ו", "תשפ״ו", "תשפ”ו", " תשפ“ו ", "תשפ″ו"].map(labelKey)).toEqual(Array(5).fill("תשפ\"ו"));
    expect(labelKey("  שנה   ‘א’ ")).toBe("שנה 'א'");
  });
});
