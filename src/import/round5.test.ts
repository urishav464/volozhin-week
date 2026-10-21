// The import review's fifth round (DECISIONS «ביקורת: ייבוא ואבן דרך 6», סבב חמישי), each a rule with a test that fails
// without it: a bracket on the name's own line and a co-name that names an escort are lines to decide (the name matches
// the pool without them); a phone by Israel's numbering plan, never «any seven digits» — and verses, dates, times, pages,
// prices and years are text; an «עמום» escorts' speaker shows what it will fill; «כפולה» set off in the middle of a
// title. Synthetic names; every realistic number is BUILT here from its parts (no phone is written in this file).
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DEFAULT_TITLES } from "../data/speakerRules";
import type { Speaker } from "../domain/types";
import { candidatesPayload, contextOf, previewCandidates, readCandidateSheet } from "./candidates";
import { escortFill, escortFills } from "./escorts";
import { defaultMapping, type Mapping } from "./fields";
import { affiliationText, trailingBrackets } from "./lines";
import { hasContact, scrubContacts, stripContacts } from "./phone";
import { archivePayload, planLessons, previewTrackingSpeakers, readTracking } from "./tracking";
import { readXlsx } from "./xlsxRead";

const sp = (id: number, name: string, extra: Partial<Speaker> = {}): Speaker => ({
  id, title: null, name, disambiguator: null, gender: null, affiliation: null, bio_short: null, topics: [], contact_pref: null,
  vetted: "approved", vetted_by: null, vetted_note: null, retired: false, name_key: name, version: 1, ...extra,
});
const POOL = contextOf([sp(1, "מרצה 07"), sp(2, "מרצה 12"), sp(3, "מרצה 03")], { phones: [], contacts: [] });
const opts = { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true };
/** A number from its parts — so that no phone is ever written in this file. */
const num = (...parts: string[]) => parts.join("");

describe("סבב חמישי, 1: a bracket on the name's own line, and a name beside it that names an escort — lines to decide", () => {
  it("trailingBrackets: each bracket at the end of a name apart, in order; a bracket in the middle, or only a bracket, left whole", () => {
    expect(trailingBrackets("הרב פלוני (ישיבת בדיקה)")).toEqual({ name: "הרב פלוני", brackets: ["(ישיבת בדיקה)"] });
    expect(trailingBrackets("מרצה 12 (מלווה: שירה בדקני)")).toEqual({ name: "מרצה 12", brackets: ["(מלווה: שירה בדקני)"] });
    expect(trailingBrackets("פלוני (א) [ב]")).toEqual({ name: "פלוני", brackets: ["(א)", "[ב]"] });
    expect(trailingBrackets("פלוני (ישיבת בדיקה")).toEqual({ name: "פלוני", brackets: ["(ישיבת בדיקה"] });
    expect(trailingBrackets("פלוני (בן) אלמוני")).toEqual({ name: "פלוני (בן) אלמוני", brackets: [] });
    expect(trailingBrackets("(ישיבת בדיקה)")).toEqual({ name: "(ישיבת בדיקה)", brackets: [] });
    expect(affiliationText("[מכון לדוגמה]")).toBe("מכון לדוגמה");
    expect(affiliationText("(מכון לדוגמה")).toBe("מכון לדוגמה");
  });

  const H = ["מרצה", "שיעור ב", "כותרת", "מלווה"];
  const grid = [
    H,
    ["מרצה 07 (מכון לדוגמה)", "ראשון 8:30", "א", ""],
    ["הרב אלף בדיקתי (ישיבת בדיקה)", "ראשון 10:00", "ב", ""],
    ["מרצה 12 (מלווה: שירה בדקני)", "ראשון 11:30", "ג", "שירה בדקני"],
    ["מרצה 03 + נועם ניסיוני", "שני 8:30", "ד", "נועם ניסיוני"],
    ["מרצה 03 / תמר בדקנית", "שני 10:00", "ה", "תמר בדקנית"],
    ["הרב בית בדיקתי (ירושלים)", "שני 11:30", "ו", ""],
    ["מרצה 07 + גימל בדיקתי", "שלישי 8:30", "ז", ""],
  ];
  const m: Mapping = ["speaker", "when", "title", null];
  const escorts = ["שירה בדקני", "נועם ניסיוני", "תמר בדקנית"];

  it("tracking: the bracket a line of that name (an institution an affiliation, an escort «לא לייבא», else it waits); the name matches the pool", () => {
    const read = readTracking(grid, m, { ...opts, escorts });
    expect(read.lines.map((l) => [l.id, l.text, l.ofName, l.as])).toEqual([
      ["2:1.1", "(מכון לדוגמה)", "מרצה 07", "affiliation"],
      ["3:1.1", "(ישיבת בדיקה)", "אלף בדיקתי", "affiliation"],
      ["4:1.1", "(מלווה: שירה בדקני)", "מרצה 12", "skip"],
      ["5:2", "נועם ניסיוני", "מרצה 03", "skip"], // beside the first, naming an escort: a line, proposed «לא לייבא»
      ["6:2", "תמר בדקנית", "מרצה 03", "skip"],
      ["7:1.1", "(ירושלים)", "בית בדיקתי", null], // no institution's word: waits for the admin
      ["8:2", "גימל בדיקתי", "מרצה 07", "speaker"], // a name beside the first, naming no one: proposed a co-speaker (סבב שישי)
    ]);
    // a co-speaker who names no escort stays a speaker, as before
    expect(read.speakers.map((s) => [s.title, s.name, s.affiliation])).toEqual([
      [null, "מרצה 07", "מכון לדוגמה"],
      ["הרב", "אלף בדיקתי", "ישיבת בדיקה"],
      [null, "מרצה 12", null],
      [null, "מרצה 03", null],
      ["הרב", "בית בדיקתי", null],
      [null, "גימל בדיקתי", null],
    ]);
    const speakers = previewTrackingSpeakers(read, POOL);
    expect(speakers.filter((s) => s.status === "match").map((s) => s.speaker.name)).toEqual(["מרצה 07", "מרצה 12", "מרצה 03"]);
    // decided: «(ירושלים)» left out — the payload holds no bracket and no escort's word
    const decided = readTracking(grid, m, { ...opts, escorts, lineAs: new Map([["7:1.1", "skip" as const]]) });
    const p = archivePayload(planLessons(decided, { decisions: new Map(), categories: new Map(), sources: new Map() })!, previewTrackingSpeakers(decided, POOL), new Map(), { label: "בדיקה", start_date: null, source: "tracking-5786", titles_from: null })!;
    expect(JSON.stringify(p)).not.toMatch(/[()]|שירה|נועם|תמר|מלווה/);
    expect(p.speakers.filter((s) => s.action === "merge").map((s) => [s.speaker_id, s.name, s.affiliation])).toEqual([[1, "מרצה 07", "מכון לדוגמה"], [2, "מרצה 12", null], [3, "מרצה 03", null]]);
  });

  it("tracking: a bracket chosen «מרצה נוסף/ת» is a speaker by its inner name; a line under the name chosen so has its own bracket apart", () => {
    const g = [H, ["מרצה 07 (הרב דלת בדיקתי)", "ראשון 8:30", "א", ""], ["מרצה 12\nהרב זין בדיקתי (מכון לדוגמה)", "ראשון 10:00", "ב", ""]];
    const first = readTracking(g, m, opts);
    expect(first.lines.map((l) => [l.id, l.as])).toEqual([["2:1.1", null], ["3:2", "affiliation"]]);
    const read = readTracking(g, m, { ...opts, lineAs: new Map([["2:1.1", "speaker" as const], ["3:2", "speaker" as const]]) });
    expect(read.lines.map((l) => [l.id, l.text, l.ofName, l.as])).toEqual([
      ["2:1.1", "(הרב דלת בדיקתי)", "מרצה 07", "speaker"],
      ["3:2", "הרב זין בדיקתי (מכון לדוגמה)", "מרצה 12", "speaker"],
      ["3:2.1", "(מכון לדוגמה)", "זין בדיקתי", "affiliation"],
    ]);
    expect(read.speakers.map((s) => [s.title, s.name, s.affiliation])).toEqual([[null, "מרצה 07", null], ["הרב", "דלת בדיקתי", null], [null, "מרצה 12", null], ["הרב", "זין בדיקתי", "מכון לדוגמה"]]);
  });

  it("the candidates: the same — the bracket a line of the candidate (or of a name beside it), the name matched as «פלוני»", () => {
    const cg = [
      ["מרצה", "חניך/ה"],
      ["מרצה 07 (מכון לדוגמה)", ""],
      ["הרב בית בדיקתי (מלווה: נועם ניסיוני)", "נועם ניסיוני"],
      ["הרבנית גימל בדיקתית (מדרשת בדיקה)", ""],
      ["הרב דלת בדיקתי (ירושלים)", ""],
      ["הא בדיקתי + הרב וו בדיקתי (ישיבת בדיקה)", ""],
    ];
    const o = { ...opts, escorts: ["נועם ניסיוני"] };
    const first = readCandidateSheet(cg, ["name", null], o);
    expect(first.lines.map((l) => [l.id, l.text, l.ofName, l.as])).toEqual([
      ["2:1.1", "(מכון לדוגמה)", "מרצה 07", "affiliation"],
      ["3:1.1", "(מלווה: נועם ניסיוני)", "בית בדיקתי", "skip"],
      ["4:1.1", "(מדרשת בדיקה)", "גימל בדיקתית", "affiliation"],
      ["5:1.1", "(ירושלים)", "דלת בדיקתי", null],
      ["6:2", "הרב וו בדיקתי (ישיבת בדיקה)", "הא בדיקתי", "affiliation"],
    ]);
    // the name beside it made a candidate: its own bracket its affiliation
    const read = readCandidateSheet(cg, ["name", null], { ...o, lineAs: new Map([["5:1.1", "skip" as const], ["6:2", "speaker" as const]]) });
    expect(read.lines.at(-1)).toMatchObject({ id: "6:2.1", text: "(ישיבת בדיקה)", ofName: "וו בדיקתי", as: "affiliation" });
    const preview = previewCandidates(read.rows, POOL);
    expect(preview.map((r) => [r.ref, r.data?.title, r.data?.name, r.data?.affiliation, r.status])).toEqual([
      ["2", null, "מרצה 07", "מכון לדוגמה", "match"],
      ["3", "הרב", "בית בדיקתי", null, "new"],
      ["4", "הרבנית", "גימל בדיקתית", "מדרשת בדיקה", "new"],
      ["5", "הרב", "דלת בדיקתי", null, "new"],
      ["6", null, "הא בדיקתי", null, "new"],
      ["6:2", "הרב", "וו בדיקתי", "ישיבת בדיקה", "new"],
    ]);
    const p = candidatesPayload(preview, new Map(), "x", null)!;
    expect(JSON.stringify(p)).not.toMatch(/[()]|נועם|מלווה/);
    expect(p.rows[0]).toMatchObject({ action: "merge", speaker_id: 1, name: "מרצה 07" });
  });
});

describe("סבב חמישי, 2: a phone by Israel's numbering plan — never «any seven digits»", () => {
  const mobile = num("052", "1234567");
  const landline = num("03", "1234567");
  it("Israeli numbers in every form: a mobile, a 07X, a landline; 972, +972, 00972; 1-700, 1-800, 1-599 — and in pairs", () => {
    const forms = [
      mobile, num("052", "-", "1234567"), num("052", " ", "123", " ", "4567"), num("052", ".", "123", ".", "4567"), num("(052)", " ", "123-4567"), num("052", "/", "1234567"),
      num("052", " / ", "123", " / ", "4567"), num("052", "|", "123", "|", "4567"), num("052", ";", "123", ";", "4567"), num("052", ":", "123", ":", "4567"), num("052", ",", "1234567"),
      num("05", "-21-23-45-67"), num("077", "1234567"), landline, num("03", "-", "1234567"), num("02", ".", "123", ".", "4567"), num("+972", "-52-", "123-4567"), num("+972", " (0)52 ", "1234567"),
      num("00972", "521234567"), num("wa.me/972", "521234567"), num("1-800-", "123-456"), num("1700", "123456"), num("1-599-", "123456"),
      num("٠٥٢", "-", "١٢٣٤٥٦٧"), num("０５２", "１２３４５６７"), num("052", "‏-‏", "1234567"),
    ];
    for (const f of forms) {
      expect(hasContact(`מרצה ${f}`), JSON.stringify(f)).toBe(true);
      expect(stripContacts(`מרצה ${f}`).text, JSON.stringify(f)).toMatch(/^מרצה( wa\.me)?$/);
    }
  });

  it("abroad: «+» or «00» and 8–15 digits", () => {
    for (const f of [num("+44", " 20 ", "7946 0958"), num("+1", " (212) ", "555-0100"), num("0033", "123456789"), num("+33", "-1-23-45-67-89")]) expect(hasContact(f), f).toBe(true);
    expect(hasContact(num("+", "1234567"))).toBe(false); // seven digits
  });

  it("not by the plan: no phone — unless a word that says a phone is beside it", () => {
    for (const f of [num("052", "12345678"), num("06", "1234567"), num("01", "12345678"), num("52", "1234567"), "1234567", "12345678", num("03", "123456")]) expect(hasContact(`מרצה ${f}`), f).toBe(false);
    for (const f of ["טל' 1234567", "טל: 1234567", "טלפון 1234567", "בטלפון: 123-4567", "והנייד 1234567", "פלאפון 1234567", "סלולרי - 1234567", "פקס 12345678", "tel 1234567", "Phone: 1234567", "mobile 1234567", "☎ 1234567", "📞1234567", "1234567 (נייד)", "1234567 ☎", num("טל' ", "52", "1234567")]) {
      expect(hasContact(f), f).toBe(true);
      expect(stripContacts(`פלוני ${f}`).text, f).toBe("פלוני");
    }
    // «טל» with nothing after it is a name; a word inside another is none; seven digits too far from the word
    for (const f of ["טל 1234567", "Tel Aviv 1234567", "telephones 1234567", "טלפונים 1234567", "טל' דרך המזכירה 1234567"]) expect(hasContact(f), f).toBe(false);
  });

  it("a star number only beside a word that says a phone", () => {
    for (const f of ["טל' *2345", "☎ *2345", "2345* טלפון", "נייד: 2345*"]) expect(hasContact(f), f).toBe(true);
    for (const f of ["*2345", "2345*", "הערה *1234 בשוליים"]) expect(hasContact(f), f).toBe(false);
  });

  it("text, never a phone: verses, dates and times in every form, pages, prices, years — never cut, never «[טלפון הוסר]»", () => {
    for (const t of [
      "תהלים 119:1-176", "ישעיהו 40:1-41:10", "בראשית 28:10-32:3", "12.3 20:00", "12/3 20:00", "14.2 08:30", "12.3.2026 10:00-11:30", "12.3 10:00-11:30", "14-18/2/2027",
      "14-18.2.2027", "2026-02-10", "2026-02-10 08:30", "05.10.2026 08:30", "05-10-2026 20:00", "05-10-2026 20", "05/10/2026 08:30", "05.10-07.10.26", "03.10.2026 2",
      "עמ' 112,134,156", "עמ' 1203-1305", "1 • 2 • 3 • 4 • 5 • 6 • 7", "1,500,000 ₪", "1,000,000,000", "1948 1967 1973", "1948-67-73", "5786-5787", "ISBN 978-965-000-000-0",
      "20:00-21:00-22:00", "18:00-19:00 20:00-21:00", "1-2-3-4-5-6-7", "10-11-12-13", "יום 05 10:30-11:45", "חדר 05 בשעה 10:30-11:45",
    ]) {
      expect(hasContact(t), t).toBe(false);
      expect(scrubContacts(`הערות: נקבע ${t}`).text, t).toBe(`הערות: נקבע ${t}`);
      expect(stripContacts(`שיעור ${t}`).text, t).toBe(`שיעור ${t}`);
    }
    // beside a phone they stay whole, and the phone goes
    expect(scrubContacts(`12.3.2026 20:00 (${mobile})`).text).toBe("12.3.2026 20:00 [טלפון הוסר]");
    expect(stripContacts(`טל' 1234567 05-10-2026 08:30`).text).toBe("05-10-2026 08:30");
    expect(stripContacts(`טל' 1234567 2026-02-10 08:30`).text).toBe("2026-02-10 08:30");
    // …and a number of no fixed length never ends inside a date: «12» of «12.3» is the date's
    expect(stripContacts(`טל' 1234567 12.3 20:00`).text).toBe("12.3 20:00");
    expect(stripContacts(`טל' 1234567 12.3.26 בערב`).text).toBe("12.3.26 בערב");
  });

  it("a number of no fixed length never runs into the next one: two numbers, a space or « / » between, are two phones", () => {
    expect(stripContacts(`טל' 123-4567 ${num("076", "-", "6650431")}`)).toEqual({ text: "", phones: ["123-4567", num("076", "-", "6650431")], emails: [] });
    expect(stripContacts("פלוני 000-000-0001 / 000-000-0002")).toEqual({ text: "פלוני", phones: ["000-000-0001", "000-000-0002"], emails: [] });
    expect(stripContacts(`${num("+44", " 20 ", "7946 0958")} ${mobile}`).phones).toEqual([num("+44", " 20 ", "7946 0958"), mobile]);
  });

  it("the residuals, said in DECISIONS: six digits, «(at)», no 0 and no word, an e-mail with no TLD or a comma for its dot", () => {
    for (const t of ["טל' 123456", "someone(at)example.org", num("52", "1234567"), "someone@example", "someone@example,org"]) expect(hasContact(t), t).toBe(false);
  });

  it("the xlsx reader's own date in a note column (numFmt 14 and 22) is kept whole — never «[טלפון הוסר]»", () => {
    const cell = (r: number, c: string, v: string) => `<c r="${c}${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
    const sheet = `<worksheet><sheetData>
      <row r="1">${cell(1, "A", "מרצה")}${cell(1, "B", "שיעור ב")}${cell(1, "C", "כותרת")}${cell(1, "D", "אושר בתאריך")}</row>
      <row r="2">${cell(2, "A", "אלון ברקת")}${cell(2, "B", "ראשון 8:30")}${cell(2, "C", "שיעור פתיחה")}<c r="D2" s="1"><v>46063</v></c></row>
      <row r="3">${cell(3, "A", "גפן דולב")}${cell(3, "B", "ראשון 10:00")}${cell(3, "C", "שיעור שני")}<c r="D3" s="2"><v>46063.354166666664</v></c></row>
    </sheetData></worksheet>`;
    const bytes = zipSync({
      "xl/workbook.xml": strToU8('<workbook xmlns:r="r"><sheets><sheet name="מעקב" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Type="x/styles" Target="styles.xml"/></Relationships>'),
      "xl/styles.xml": strToU8('<styleSheet><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="22"/></cellXfs></styleSheet>'),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    });
    const grid = readXlsx(bytes).read(0);
    expect(grid.slice(1).map((r) => r[3])).toEqual(["2026-02-10", "2026-02-10 08:30"]);
    const read = readTracking(grid, defaultMapping("tracking", grid[0], 4).map((f, i) => (i === 3 ? "note" : f)), opts);
    const plans = planLessons(read, { decisions: new Map(), categories: new Map(), sources: new Map() })!;
    expect(plans.map((p) => [p.import_note, p.warnings.filter((w) => w.includes("טלפון"))])).toEqual([
      ["אושר בתאריך: 2026-02-10", []],
      ["אושר בתאריך: 2026-02-10 08:30", []],
    ]);
  });
});

describe("סבב חמישי, 3–4: an «עמום» escorts' speaker shows its fill; «כפולה» set off in the middle of a title", () => {
  it("escortFill: the channel and the note as a speaker's fill — what the card shows for the speaker chosen", () => {
    expect(escortFill({ channel: null, note: "" })).toBeNull();
    expect(escortFill({ channel: "secretary", note: "" })).toMatchObject({ contact_pref: "secretary", secretary_note: null });
    expect(escortFills(sp(7, "מרצה 07"), undefined, { channel: "secretary", note: "" })).toEqual(["ערוץ קשר"]);
    expect(escortFills(sp(7, "מרצה 07", { contact_pref: "phone" }), undefined, { channel: "secretary", note: "" })).toEqual([]);
  });

  it("«- כפולה -» and «שיעור כפול» set off by a dash or brackets: said, never a marker, the title whole", () => {
    const titles = ["נאמנות - כפולה - חלק א", "נאמנות – שיעור כפול", "נאמנות (שיעור כפול)", "שיעור כפול", "נאמנות, כפולה, חלק ב", "זהות כפולה", "נאמנות כפולה!", "שיעור כפולות", "זהות כפולה - חלק א"];
    const read = readTracking([["מרצה", "שיעור ב", "כותרת"], ...titles.map((t, i) => [`מרצה ${i}`, "ראשון 8:30", t])], ["speaker", "when", "title"], opts);
    expect(read.rows.map((r) => [r.title, r.double, r.warnings.some((w) => w.startsWith("בכותרת כתוב «כפולה»"))])).toEqual([
      ["נאמנות - כפולה - חלק א", false, true],
      ["נאמנות – שיעור כפול", false, true],
      ["נאמנות (שיעור כפול)", false, true],
      ["שיעור כפול", false, true],
      ["נאמנות, כפולה, חלק ב", false, true],
      ["זהות כפולה", false, false],
      ["נאמנות כפולה!", false, false],
      ["שיעור כפולות", false, false],
      ["זהות כפולה - חלק א", false, false],
    ]);
  });
});
