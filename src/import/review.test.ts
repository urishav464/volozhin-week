// What the review of the import found (DECISIONS «ביקורת: ייבוא ואבן דרך 6»), each a rule with a test that fails
// without it: a day named once and as a whole word; «ליל» of one day refused; adjacent double lessons apart; the
// markers in mapped columns only; «כפולה» out of names; the sources' words without phones; Thursday's end; the rows
// of one table against each other (the same phone, a name 0.6 alike); the escorts' WhatsApp as a word; dates no
// phones; the label's key. Synthetic names and numbers only.
import { describe, expect, it } from "vitest";
import { labelKey } from "../data/importRules";
import { DEFAULT_TITLES } from "../data/speakerRules";
import type { Speaker } from "../domain/types";
import { DemoPort } from "../data/demoPort";
import { candidatesPayload, contextOf, lookupFor, previewCandidates, readCandidates, undecided } from "./candidates";
import { channelOf, escortColumns, escortNames, escortsPayload, namedEscort, previewEscorts, readEscorts } from "./escorts";
import { defaultMapping, findHeaderRow, type Mapping } from "./fields";
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
const opts = { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true };
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

describe("«כפולה» beside a name: the marker out, the name as the pool has it — a title is never cut", () => {
  it("«הרב פלוני - כפולה», «(כפולה)», «כפולה - …»: the name, its title and gender; the row is double; the title whole", () => {
    for (const cell of ["הרב דוגמה אלף - כפולה", "הרב דוגמה אלף (כפולה)", "כפולה - הרב דוגמה אלף", "הרב דוגמה אלף כפולה"]) {
      const read = track([r(cell, "שני 10:00", "שיעור (כפולה)")]);
      expect(read.speakers.map((s) => [s.key, s.name, s.title, s.gender]), cell).toEqual([["דוגמה אלף", "דוגמה אלף", "הרב", "m"]]);
      expect([read.rows[0].double, read.rows[0].title], cell).toEqual([true, "שיעור (כפולה)"]);
    }
  });

  it("«הכפולה» inside a title is a word of the title: kept, and the row is not double; «+» on one line is two speakers", () => {
    expect(track([r("דוגמה אלף", "שני 20:00", "הנאמנות הכפולה")]).rows[0]).toMatchObject({ double: false, title: "הנאמנות הכפולה" });
    expect(track([r("דוגמה אלף - כפולה + דוגמה בית", "שני 20:00")]).speakers.map((s) => s.key)).toEqual(["דוגמה אלף", "דוגמה בית"]);
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
    const two = candidatesPayload(p, new Map<string, Choice>([["3", { action: "new" }]]), "x", null)!;
    expect(two.rows.map((x) => [x.action, x.name, x.title, x.gender])).toEqual([
      ["new", "בודק אלף", "הרב", "m"],
      ["new", "בודקת בית", "הרבנית", "f"],
    ]);
  });

  it("one person spelled two ways: «אותו/ה מרצה כמו שורה N» sends the row under row N's name (the commit completes that speaker)", () => {
    const p = cands([["יהודה לדוגמה", "", ""], ["יהודא לדוגמה", "", "רק בבוקר"]]);
    expect(p.map((x) => x.status)).toEqual(["new", "ambiguous"]);
    expect(p[1].match?.sheet?.[0]).toMatchObject({ ref: "2", via: "similar" });
    const one = candidatesPayload(p, new Map<string, Choice>([["3", { action: "same", ref: "2" }]]), "x", null)!;
    expect(one.rows.map((x) => [x.row, x.action, x.name, x.notes])).toEqual([
      [2, "new", "יהודה לדוגמה", null],
      [3, "new", "יהודה לדוגמה", "הערות: רק בבוקר"],
    ]);
    // the row it names left out: the choice cannot stand
    const left = new Map<string, Choice>([["2", { action: "skip" }], ["3", { action: "same", ref: "2" }]]);
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

describe("a match fills only what does not contradict the pool's own title — or its own gender", () => {
  it("«הרבנית» with no gender and a row «הרב»: no gender filled, and the preview says so; «ד״ר» takes the row's", () => {
    const row = { title: "הרב", gender: "m" as const, affiliation: null, topics: [], phone: null, email: null, notes: null };
    expect(fillPlan(sp(1, "x", { title: "הרבנית" }), undefined, row)).toEqual(["מגדר: לא ימולא — במאגר התואר הרבנית"]);
    expect(fillPlan(sp(1, "x", { title: "ד״ר" }), undefined, row)).toEqual(["מגדר: זכר (הצעה, מהתואר)"]);
  });

  it("the mirror: a pool speaker with a gender and no title is never given a title of the other gender — the preview names it", () => {
    const rav = { title: "הרב", gender: "m" as const, affiliation: null, topics: [], phone: null, email: null, notes: null };
    const rabbanit = { ...rav, title: "הרבנית", gender: "f" as const };
    expect(fillPlan(sp(1, "x", { gender: "f" }), undefined, rav)).toEqual(["תואר: לא ימולא — במאגר המגדר נקבה"]);
    expect(fillPlan(sp(1, "x", { gender: "m" }), undefined, rabbanit)).toEqual(["תואר: לא ימולא — במאגר המגדר זכר"]);
    // the same gender, a title that says none, or no gender in the pool: the title it fills, named
    expect(fillPlan(sp(1, "x", { gender: "m" }), undefined, rav)).toEqual(["תואר: הרב"]);
    expect(fillPlan(sp(1, "x", { gender: "f" }), undefined, { ...rav, title: "ד״ר", gender: null })).toEqual(["תואר: ד״ר"]);
    expect(fillPlan(sp(1, "x"), undefined, rabbanit)).toEqual(["תואר: הרבנית", "מגדר: נקבה (הצעה, מהתואר)"]);
  });

  it("the demo's commit holds the same rule: «הרבנית מרצה 07» matched to the pool's man keeps him without a title", async () => {
    const d = new DemoPort();
    const pool = await d.imports.pool();
    const t = pool.find((s) => s.title == null && s.gender === "m")!;
    const grid = [["מרצה", "מוסד"], [`הרבנית ${t.name}`, "מוסד לבדיקה"]];
    const read = readCandidates(grid, defaultMapping("candidates", grid[0], 2), opts);
    const ask = lookupFor(read, pool);
    const pv = previewCandidates(read, contextOf(pool, await d.imports.lookup(ask.speakerIds, ask.phoneKeys)));
    expect(pv.map((p) => [p.status, p.fills])).toEqual([["match", ["תואר: לא ימולא — במאגר המגדר זכר", ...(t.affiliation == null ? ["מוסד"] : [])]]]);
    await d.imports.commit({ kind: "candidates", payload: candidatesPayload(pv, new Map(), "p", null)! });
    const after = (await d.imports.pool()).find((s) => s.id === t.id)!;
    expect([after.title, after.gender]).toEqual([null, "m"]);
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

describe("סבב שני: «כפולה» as a word of a title, «שיעור להורים» where it marks the lesson", () => {
  it("«זהות כפולה», «נאמנות כפולה»: a title — the row is not double, no group, and the title is never cut", () => {
    const read = track([r("דוגמה אלף", "רביעי 10:00", "זהות כפולה"), r("דוגמה בית", "רביעי 11:30", "נאמנות כפולה בעם ישראל")]);
    expect(read.rows.map((x) => [x.double, x.title])).toEqual([
      [false, "זהות כפולה"],
      [false, "נאמנות כפולה בעם ישראל"],
    ]);
    expect(doubleGroups(read)).toEqual([]);
    expect(plan(read).map((p) => [p.title, p.start_min, p.end_min])).toEqual([
      ["זהות כפולה", 600, 690],
      ["נאמנות כפולה בעם ישראל", 690, 780],
    ]);
  });

  it("the marker where the sheet writes it: «שיעור ב», beside the name, or a cell that says only it", () => {
    const headers = [...H, "הערות"];
    const m = defaultMapping("tracking", headers, headers.length);
    m[8] = "note";
    const read = track(
      [r("דוגמה אלף", "שני 10:00 כפולה", "שיעור א"), r("דוגמה בית", "שני 10:00", "שיעור ב", ["כפולה"]), r("דוגמה גימל", "שני 11:30", "כפולה"), r("דוגמה דלת", "שני 13:00", "שיעור ד", ["אולי כפולה"])],
      headers,
      m,
    );
    expect(read.rows.map((x) => [x.double, x.title])).toEqual([
      [true, "שיעור א"],
      [true, "שיעור ב"],
      [true, null], // a title cell that is only the marker holds no title
      [false, "שיעור ד"], // a word in a note, not the marker
    ]);
  });

  it("«שיעור להורים»: a cell that begins with it, or «שיעור ב» after its time — never a title that only mentions it", () => {
    const read = track([
      r("דוגמה אלף", "חמישי 17:30", "שיעור להורים"),
      r("דוגמה בית", "חמישי 16:00", "שיעור להורים: הורים וילדים"),
      r("דוגמה גימל", "רביעי 17:30 - שיעור להורים", "שיעור ג"),
      r("דוגמה דלת", "רביעי 10:00", "על שיעור להורים"),
      r("דוגמה הא", "רביעי 11:30", "מה ראינו בשיעור להורים אשתקד"),
    ]);
    expect(read.rows.map((x) => [x.audience, x.title])).toEqual([
      ["שיעור להורים", "שיעור להורים"],
      ["שיעור להורים", "שיעור להורים: הורים וילדים"],
      ["שיעור להורים", "שיעור ג"],
      [null, "על שיעור להורים"],
      [null, "מה ראינו בשיעור להורים אשתקד"],
    ]);
    expect(read.rows[2].notes).toEqual([]); // the marker is no note of «שיעור ב»
  });
});

describe("סבב שני: a second line in the speaker's cell — an affiliation or a speaker; the phone after the choices", () => {
  const withPhone = (speaker: string, when: string, phone: string) => [speaker, when, "", "", "", phone, "", ""];

  it("a line in brackets with an institution is the affiliation of the name above — one speaker, the row's phone theirs, the payload's «מוסד»", () => {
    const read = track([withPhone("הרב אלפא דוגמני\n(ישיבת דוגמה)", "ראשון 8:30", "000-000-0011")]);
    expect(read.speakers.map((s) => [s.key, s.title, s.affiliation, s.phone])).toEqual([["אלפא דוגמני", "הרב", "ישיבת דוגמה", "0000000011"]]);
    expect(read.lines).toEqual([{ id: "2:2", row: 2, text: "(ישיבת דוגמה)", of: "אלפא דוגמני", ofName: "אלפא דוגמני", as: "affiliation", chosen: false, why: "שם של מוסד" }]);
    const plans = plan(read);
    expect(plans[0].warnings).toEqual([]);
    const p = archivePayload(plans, previewTrackingSpeakers(read, EMPTY), new Map(), { label: "x", start_date: null, source: "x", titles_from: null })!;
    expect(p.speakers.map((x) => [x.name, x.affiliation, x.phone])).toEqual([["אלפא דוגמני", "ישיבת דוגמה", "0000000011"]]);
  });

  it("only an institution's word proposes an affiliation; a title, a name the sheet or the pool has, a bracket — each waits (סבב רביעי)", () => {
    const read = track([
      r("דוגמה אלף\nהרבנית דוגמה בית", "ראשון 8:30"),
      r("דוגמה גימל\nדוגמה אלף", "ראשון 10:00"),
      r("דוגמה דלת\nמכון לדוגמה", "ראשון 11:30"),
      r("דוגמה הא\n(בסוגריים לדוגמה)", "ראשון 13:00"),
      r("דוגמה וו\n(ישיבת דוגמה)", "ראשון 14:30"),
    ]);
    expect(read.lines.map((l) => [l.text, l.as, l.why])).toEqual([
      ["הרבנית דוגמה בית", null, "בלי שם של מוסד"],
      ["דוגמה אלף", null, "בלי שם של מוסד"],
      ["מכון לדוגמה", "affiliation", "שם של מוסד"],
      ["(בסוגריים לדוגמה)", null, "בלי שם של מוסד"],
      ["(ישיבת דוגמה)", "affiliation", "שם של מוסד"],
    ]);
    // decided: a speaker, an affiliation (the brackets out), or left out
    const decided = readTracking([H, r("דוגמה אלף\nהרבנית דוגמה בית", "ראשון 8:30"), r("דוגמה הא\n(בסוגריים לדוגמה)", "ראשון 13:00")], defaultMapping("tracking", H, H.length), {
      ...opts,
      lineAs: new Map([["2:2", "speaker" as const], ["3:2", "affiliation" as const]]),
    });
    expect(decided.speakers.map((x) => [x.key, x.affiliation])).toEqual([["דוגמה אלף", null], ["דוגמה בית", null], ["דוגמה הא", "בסוגריים לדוגמה"]]);
    const left = readTracking([H, r("דוגמה אלף\nהרבנית דוגמה בית", "ראשון 8:30")], defaultMapping("tracking", H, H.length), { ...opts, lineAs: new Map([["2:2", "skip" as const]]) });
    expect(left.speakers.map((x) => x.key)).toEqual(["דוגמה אלף"]);
  });

  it("the admin turns a line; the phone goes to the one speaker left after the choices — never while two are", () => {
    const rows = [withPhone("דוגמה אלף\nדוגמה בית", "ראשון 8:30", "000-000-0012")];
    // the read: «דוגמה בית» undecided — neither, until chosen; turned into an affiliation: one speaker, the phone theirs
    expect(track(rows).speakers.map((x) => [x.key, x.affiliation, x.phone])).toEqual([["דוגמה אלף", null, "0000000012"]]);
    const aff = readTracking([H, ...rows], defaultMapping("tracking", H, H.length), { ...opts, lineAs: new Map([["2:2", "affiliation" as const]]) });
    expect(aff.speakers.map((x) => [x.key, x.affiliation, x.phone])).toEqual([["דוגמה אלף", "דוגמה בית", "0000000012"]]);
    // turned into a speaker: two — the phone waits, and the lesson says why
    const two = readTracking([H, ...rows], defaultMapping("tracking", H, H.length), { ...opts, lineAs: new Map([["2:2", "speaker" as const]]) });
    expect(two.lines[0]).toMatchObject({ as: "speaker", chosen: true });
    expect(two.speakers.map((x) => [x.key, x.affiliation, x.phone])).toEqual([
      ["דוגמה אלף", null, null],
      ["דוגמה בית", null, null],
    ]);
    expect(plan(two)[0].warnings).toEqual(["הטלפון לא נשמר: יש בשורה יותר ממרצה אחד/ת"]);
    // the second skipped («דילוג»): the phone goes to the one left — in the preview and in the payload
    const speakers = previewTrackingSpeakers(two, EMPTY);
    const choices = new Map<string, Choice>([["דוגמה בית", { action: "skip" }]]);
    const plans = planLessons(two, { decisions: new Map(), categories: new Map(), sources: new Map(), skipped: new Set(["דוגמה בית"]) })!;
    expect(plans[0]).toMatchObject({ warnings: [], phones: [{ speaker: "דוגמה אלף", value: "0000000012" }] });
    const p = archivePayload(plans, speakers, choices, { label: "x", start_date: null, source: "x", titles_from: null })!;
    expect(p.speakers.map((x) => [x.name, x.phone])).toEqual([["דוגמה אלף", "0000000012"]]);
  });
});

describe("סבב שני: the header row in the first rows; the escorts' column never mappable, whatever the header", () => {
  it("a title above the table (a Word paragraph, a merged Excel row): the header row found below it, the rows above left out", () => {
    const docx = [["מלווים — לדוגמה"], ["מרצה", "מלווה", "הערות"], ["מרצה 07", "חניך/ה לדוגמה 1", "דרך המזכירה"]];
    expect(findHeaderRow("escorts", docx)).toBe(1);
    const xlsx = [["רשימת מועמדים לדוגמה — סיעור", "", ""], ["מרצה", "מוסד", "טלפון"], ["הרב קפא שורתי", "", "000-000-0031"]];
    expect(findHeaderRow("candidates", xlsx)).toBe(1);
    const read = readCandidates(xlsx, defaultMapping("candidates", xlsx[1], 3), { ...opts, headerRow: 1 });
    expect(read.map((x) => [x.row, x.data?.name])).toEqual([[3, "קפא שורתי"]]); // the sheet's own row number
    // nothing like a header in the first five rows: none
    expect(findHeaderRow("candidates", [["א"], ["ב"], ["ג"], ["ד"], ["ה"], ["מרצה"]])).toBeNull();
  });

  it("the escorts' column: by the header row, or by a cell of the first rows that reads as its header — with or without a header row", () => {
    const grid = [["מלווים — לדוגמה", "", ""], ["מרצה", "מלווה/ת", "הערות"], ["מרצה 07", "חניך/ה לדוגמה 1", "המלווה חניך/ה לדוגמה 1 יתאם דרך המזכירה"]];
    expect([...escortColumns(grid, 1)]).toEqual([1]);
    expect([...escortColumns(grid, null)]).toEqual([1]); // the header row not chosen
    expect([...escortColumns(grid, 0)]).toEqual([0, 1]); // the title row chosen as the header: still blocked — and, on the safe side, the title's column too
    // a phrase that speaks of the escort is no header: the phrases' column stays mappable
    expect([...escortColumns([["מרצה", "הערות"], ["מרצה 07", "המלווה יתאם"]], null)]).toEqual([]);
    expect(escortNames(grid, null, new Set([1]))).toEqual(["חניך/ה לדוגמה"]); // the header cell is no name; digits out
  });
});

describe("סבב שני → סבב רביעי: a phrase that names an escort is said so — and no phrase is ever sent", () => {
  const grid = [
    ["מרצה", "מלווה", "הערות"],
    ["מרצה 07", "חניכה לדוגמה", "המלווה חניכה לדוגמה תתאם דרך המזכירה"],
    ["מרצה 07", "חניכה לדוגמה", "לתאם עם חניך לדוגמה בוואטסאפ"],
    ["מרצה 12", "חניך לדוגמה", "רק בוואטסאפ"],
  ];
  const m: Mapping = ["speaker", null, "phrases"];
  const rows = readEscorts(grid, m, { headerRow: 0, titles: DEFAULT_TITLES });
  const names = escortNames(grid, 0, escortColumns(grid, 0));
  const pool = [sp(7, "מרצה 07"), sp(12, "מרצה 12")];
  const ctx = contextOf(pool, { phones: [], contacts: [] });

  it("said beside the phrase: a name of the escorts' column, a roster's name; a phrase about «המלווה» marked", () => {
    expect(names).toEqual(["חניכה לדוגמה", "חניך לדוגמה"]);
    const ps = previewEscorts(rows, ctx, names).flatMap((x) => x.phrases);
    expect(ps.map((p) => [p.text, p.escort, p.mentions])).toEqual([
      ["המלווה חניכה לדוגמה תתאם דרך המזכירה", "חניכה", true],
      ["לתאם עם חניך לדוגמה בוואטסאפ", "חניך", true], // «חניך» speaks of a trainee (סבב רביעי)
      ["רק בוואטסאפ", null, false],
    ]);
    // a name only a roster has
    expect(previewEscorts(rows, ctx, ["חניכה לדוגמה"]).flatMap((x) => x.phrases).map((p) => p.escort)).toEqual(["חניכה", "לדוגמה", null]);
    expect(namedEscort("דרך המזכירה", names)).toBeNull();
    expect(namedEscort("לחניך לדוגמה בוואטסאפ", names)).toBe("חניך"); // a prefix letter
    expect(namedEscort("להתקשר לחניכות בוואטסאפ", names)).toBeNull(); // another word
  });

  it("the channel the phrases suggest is pre-selected; what is sent is the channel and the admin's note — never a phrase", () => {
    const preview = previewEscorts(rows, ctx, names);
    // «מרצה 07»: the secretary and WhatsApp both named — no suggestion; the admin chooses
    expect(preview.map((x) => [x.key, x.suggested])).toEqual([["מרצה 07", null], ["מרצה 12", "whatsapp"]]);
    const answers = new Map([["מרצה 07", { channel: "secretary" as const, note: "בבוקר" }], ["מרצה 12", { channel: "whatsapp" as const, note: "" }]]);
    const payload = escortsPayload(preview, new Map(), answers)!;
    expect(payload.rows).toEqual([{ row: 2, speaker_id: 7, channel: "secretary", note: "בבוקר" }, { row: 4, speaker_id: 12, channel: "whatsapp", note: null }]);
    expect(JSON.stringify(payload)).not.toMatch(/חניכה?|לדוגמה|המזכירה/);
  });
});
