// The import review's fourth round (DECISIONS «ביקורת: ייבוא ואבן דרך 6», סבב רביעי), each a rule with a test that fails
// without it. Synthetic names, numbers no one has («000-000-…»).
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CommandError } from "../data/commands";
import { cleanPrefsRow, prefsKeys } from "../data/importRules";
import { DEFAULT_TITLES } from "../data/speakerRules";
import type { Speaker } from "../domain/types";
import { candidatesPayload, contextOf, previewCandidates, readCandidates, readCandidateSheet } from "./candidates";
import { escortColumns, escortLike, escortNames, escortsPayload, looksLikeEscortHeader, previewEscorts, readEscorts } from "./escorts";
import { defaultMapping, findHeaderRow, type Mapping } from "./fields";
import { IMPORT_LIMITS } from "./limits";
import type { Choice } from "./match";
import { foldContact, hasContact, scrubContacts, stripContacts } from "./phone";
import { openLines, planLessons, readTracking } from "./tracking";
import { readXlsx } from "./xlsxRead";

const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${(e as Error).message}`;
  }
};
const sp = (id: number, name: string): Speaker => ({
  id, title: null, name, disambiguator: null, gender: null, affiliation: null, bio_short: null, topics: [], contact_pref: null,
  vetted: "approved", vetted_by: null, vetted_note: null, retired: false, name_key: name, version: 1,
});

const opts = { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true };
const H = ["מרצה", "שיעור ב", "כותרת", "מקורות (נשלח?)", "הסעה/תשלום", "טלפון", "קיבל הודעת סיכום מ", "נושא"];
const track = (rows: string[][], o: Partial<Parameters<typeof readTracking>[2]> = {}) => readTracking([H, ...rows], defaultMapping("tracking", H, H.length), { ...opts, ...o });
/** A tracking row: speaker, when, title, phone — the rest empty. */
const r = (speaker: string, when: string, title = "", phone = "") => [speaker, when, title, "", "", phone, "", ""];

describe("סבב רביעי, 4: a phone or an e-mail in every form the reviewers wrote — and years, dates and chapters never one", () => {
  it("other separators, other digits, what shows nothing: each is a phone (hasContact ≡ app.has_contact)", () => {
    for (const t of [
      "000/000/0091", "000 / 000 / 0092", "000·000·0093", "000•000•0094", "000,000,0095", "000_000_0096", "000‧000‧0097", "000:000:0098",
      "０００－０００－００９９", "٠٠٠-٠٠٠-٠١٠٠", "۰۰۰-۰۰۰-۰۱۰۱", "000᠎000᠎0103", "000\u0085000\u00850104", "000⁣000\u{e0020}0105",
    ]) {
      expect(hasContact(`מרצה ${t}`), JSON.stringify(t)).toBe(true);
      expect(stripContacts(`מרצה ${t}`).text, JSON.stringify(t)).toBe("מרצה");
    }
  });

  it("an e-mail with spaces around «@» or a dot, «@@», a fullwidth «＠»: an e-mail — taken out as its address", () => {
    for (const t of ["someone @example.org", "someone@ example.org", "someone@example .org", "someone@@example.org", "someone＠example.org", "someone @ example . org"]) {
      expect(hasContact(t), t).toBe(true);
      expect(stripContacts(`מרצה ${t}`), t).toEqual({ text: "מרצה", phones: [], emails: ["someone@example.org"] });
    }
    // an address in other letters, with «@@» or «＠»: an e-mail too
    for (const t of ["פלוני@@מוסד.ישראל", "פלוני＠מוסד.ישראל"]) expect(hasContact(t), t).toBe(true);
    // «@» among words and numbers, no address: no e-mail
    for (const t of ["8 @ 10.30", "a @ b. c", "שיעור @ בית המדרש"]) expect(hasContact(t), t).toBe(false);
  });

  it("the fold: format characters out, every script's digits as ASCII — a text with no contact is returned as it was", () => {
    expect(foldContact("א‏ב­ג٣۴５")).toBe("אבג345");
    const plain = "שיעור‏ ١ על­ האמונה";
    expect(stripContacts(plain)).toEqual({ text: plain, phones: [], emails: [] });
    expect(scrubContacts(plain)).toEqual({ text: plain, scrubbed: false });
  });

  it("the run takes the area code and its bracket with it — «00/0000208», «(00) 0000210» beside a name come out whole", () => {
    expect(stripContacts("אלון ברקת 00/0000208")).toEqual({ text: "אלון ברקת", phones: ["00/0000208"], emails: [] });
    expect(stripContacts("אלון ברקת (00) 0000210")).toEqual({ text: "אלון ברקת", phones: ["(00) 0000210"], emails: [] });
    const t = track([r("אלון ברקת 00/0000208", "שני 20:00")]);
    expect(t.speakers.map((s) => [s.name, s.phone])).toEqual([["אלון ברקת", "000000208"]]);
    const c = readCandidates([["מרצה"], ["אלון ברקת (00) 0000210"]], ["name"], opts);
    expect([c[0].data?.name, c[0].data?.phone]).toEqual(["אלון ברקת", "000000210"]);
  });

  it("a time before a bracketed phone stays whole, and the brackets go with the phone", () => {
    expect(scrubContacts("להתקשר אחרי 20:00 (000-000-0104)").text).toBe("להתקשר אחרי 20:00 [טלפון הוסר]");
    expect(scrubContacts("שעה 8.30 [000-000-0105]").text).toBe("שעה 8.30 [טלפון הוסר]");
    expect(stripContacts("להתקשר אחרי 20:00 (000-000-0104)")).toEqual({ text: "להתקשר אחרי 20:00", phones: ["000-000-0104"], emails: [] });
    // times are never one: a list, a range, a date and its hour
    for (const t of ["8:30, 9:45, 10:15", "8:30,9:45,10:15", "שעה 20:00 ו-21:30", "12.3.2026 20:00", "נקבע 12.3.2026 20:00, 8.30-10.00"]) expect(hasContact(t), t).toBe(false);
  });

  it("chains of years, a range of dates, chapters: no phone — never cut from a title or an affiliation (the third round's regression)", () => {
    for (const t of ["1948-1967-1973", "1948, 1967, 1973", "1948/1967", "14.2-18.2.2027", "14.2.2027-18.2.2027", "12.3-15.3.2026", "1-2-3-4-5-6-7", "1, 2, 3, 4, 5, 6, 7", "1,2,3,4,5,6,7", "12-13-14-15", "12/3"]) {
      expect(hasContact(t), t).toBe(false);
    }
    // a phone written in pairs still is one (the chapters' rule never starts at a 0)
    expect(hasContact("05-21-23-45-67")).toBe(true);
    const t = track([r("אלון ברקת", "שני 20:00", "ממלחמה למלחמה: 1948-1967-1973"), r("גפן דולב", "שלישי 20:00", "סיכום השבוע 14.2-18.2.2027"), r("הדס ורד", "רביעי 20:00", "עיון בפרקים 1-2-3-4-5-6-7")]);
    expect(t.rows.map((x) => [x.title, x.warnings])).toEqual([
      ["ממלחמה למלחמה: 1948-1967-1973", []],
      ["סיכום השבוע 14.2-18.2.2027", []],
      ["עיון בפרקים 1-2-3-4-5-6-7", []],
    ]);
    const c = readCandidates([["מרצה", "מוסד"], ["זית חרוב", "המכון לחקר 1948-1967-1973"]], ["name", "affiliation"], opts);
    expect([c[0].data?.affiliation, c[0].warnings]).toEqual(["המכון לחקר 1948-1967-1973", []]);
  });
});

describe("סבב רביעי, design 1: the escorts' file sends a channel from the list and the admin's note — nothing of the file", () => {
  const grid = [
    ["מרצה", "ליווי", "הערות"],
    ["מרצה 07", "שירה לבדיקה (ונועם בדיקה)", "שירה תתקשר יום לפני דרך המזכירה"],
    ["מרצה 12", "אורי ניסיון (אוריק)", "וכשאוריק מתאם — רק בוואטסאפ"],
    ["מרצה 20", "דנה טסט", "שִׁירָה: רק במייל"],
  ];
  const m: Mapping = ["speaker", null, "phrases"];
  const ctx = contextOf([sp(7, "מרצה 07"), sp(12, "מרצה 12"), sp(20, "מרצה 20")], { phones: [], contacts: [] });

  it("the reviewers' files (a «ליווי» header, a name in brackets, three prefix letters, niqqud): whatever the answers, no word of the file is sent", () => {
    const names = escortNames(grid, 0, escortColumns(grid, 0));
    const preview = previewEscorts(readEscorts(grid, m, { headerRow: 0, titles: DEFAULT_TITLES }), ctx, names);
    expect(preview.map((x) => [x.key, x.suggested])).toEqual([["מרצה 07", "secretary"], ["מרצה 12", "whatsapp"], ["מרצה 20", "email"]]);
    // said beside each phrase (a warning — nothing depends on it)
    expect(preview.flatMap((x) => x.phrases.map((p) => p.escort))).toEqual(["שירה", "אוריק", "שירה"]);
    for (const channel of [null, "phone", "whatsapp", "email", "secretary", "other"] as const) {
      const answers = new Map(preview.map((x) => [x.key, { channel, note: channel === "other" ? "לפנות בבוקר" : "" }]));
      const p = escortsPayload(preview, new Map(), answers)!;
      expect(JSON.stringify(p).replaceAll("לפנות בבוקר", "")).not.toMatch(/[א-ת]/);
      for (const row of p.rows) expect(Object.keys(row).sort()).toEqual(["channel", "note", "row", "speaker_id"]);
    }
  });

  it("the commit accepts only {row, speaker_id, channel, note}: a phrase field, an old page's secretary_note, a channel off the list — bad_value", () => {
    expect(code(() => prefsKeys({ row: 2, speaker_id: 7, channel: "phone", note: null }))).toBe("ok");
    for (const extra of [{ secretary_note: "דרך המזכירה" }, { phrases: ["x"] }, { contact_pref: "phone" }]) expect(code(() => prefsKeys({ row: 2, speaker_id: 7, channel: "phone", ...extra }))).toBe("bad_value");
    expect(code(() => cleanPrefsRow({ row: 2, speaker_id: 7, channel: "sms" }))).toBe("bad_value");
    expect(code(() => cleanPrefsRow({ row: 2, speaker_id: 7 }))).toBe("bad_value");
    expect(code(() => cleanPrefsRow({ row: 2, speaker_id: 7, channel: "phone", note: 5 }))).toBe("bad_value");
    expect(code(() => cleanPrefsRow({ row: 2, speaker_id: 7, channel: "phone", note: "בערב ٠٠٠-٠٠٠-٠٠٨٢" }))).toBe("contact_in_text");
    expect(cleanPrefsRow({ row: 2, speaker_id: 7, channel: "other", note: " בבוקר " })).toEqual({ row: 2, speaker_id: 7, contact_pref: null, note: "בבוקר" });
  });
});

describe("סבב רביעי, design 2: the escorts' column is asked for, never guessed — its spellings widened", () => {
  it("«מלוה», «מלווה/ת», «ליווי», «חניך/ה», «שם החניך/ה» are its header; a data name is not", () => {
    for (const h of ["מלווה", "מלוה", "מלווה/ת", "המלווה", "שם המלווה", "מלווים", "ליווי", "חניך/ה", "שם החניך/ה", "חניכים"]) expect(looksLikeEscortHeader(h), h).toBe(true);
    for (const h of ["מרצה", "הערות", "חניך/ה לדוגמה 1", "שיעור ב"]) expect(looksLikeEscortHeader(h), h).toBe(false);
    for (const h of ["ליווי", "מלוה", "חניך/ה", "שם החניך/ה"]) expect([...escortColumns([["מרצה", h, "הערות"], ["מרצה 07", "שירה", "x"]], 0)], h).toEqual([1]);
  });

  it("the tracking sheet asks when a header or a first row looks like one — not for a trainee's name in a data cell", () => {
    expect(escortLike([["מרצה", "שיעור ב", "מלוה"]], 0)).toBe(true);
    expect(escortLike([["מרצה", "שיעור ב", "ליווי השיעור"]], 0)).toBe(true);
    expect(escortLike([["רשימה"], ["מרצה", "חניך/ה"]], 0)).toBe(true); // the header row chosen too high
    expect(escortLike([["מרצה", "שיעור ב", "קיבל הודעת סיכום מ"], ["מרצה 07", "ראשון 8:30", "חניך/ה לדוגמה 1"]], 0)).toBe(false);
    expect(findHeaderRow("tracking", [["מרצה", "שיעור ב", "מלוה"]])).toBe(0);
  });
});

describe("סבב רביעי, design 3: another name in a speaker's cell — only an institution proposes an affiliation; three choices; the candidates too", () => {
  it("tracking: «(מלווה: …)» and a name of the escorts' column proposed «לא לייבא»; a bracket with no institution waits; an institution an affiliation", () => {
    const rows = [r("מרצה 07\n(מלווה: שירה בדקני)", "ראשון 8:30"), r("הרב חדש בדיקתי\nנועם ניסיוני", "ראשון 10:00"), r("דוגמה גימל\n(מכון לדוגמה)", "ראשון 11:30"), r("דוגמה דלת\n(אחר לגמרי)", "ראשון 13:00")];
    const read = track(rows, { escorts: ["שירה בדקני", "נועם ניסיוני"] });
    expect(read.lines.map((l) => [l.text, l.as])).toEqual([
      ["(מלווה: שירה בדקני)", "skip"],
      ["נועם ניסיוני", "skip"],
      ["(מכון לדוגמה)", "affiliation"],
      ["(אחר לגמרי)", null],
    ]);
    expect(read.speakers.map((x) => [x.key, x.affiliation])).toEqual([["מרצה 07", null], ["חדש בדיקתי", null], ["דוגמה גימל", "מכון לדוגמה"], ["דוגמה דלת", null]]);
  });

  it("the candidates read a cell as the tracking sheet does: a second line or «+» is a line to decide — never glued to the name", () => {
    const grid = [["מרצה", "מוסד"], ["ד\"ר גימל בדיקתי\nאוניברסיטת בדיקה", ""], ["הרב זין בדיקתי\nהרבנית חית בדיקתית", ""], ["טית בדיקתית\n(מדרשת בדיקה)", "מוסד קיים"], ["יוד בדיקתי + כף בדיקתית", ""]];
    const m: Mapping = ["name", "affiliation"];
    const first = readCandidateSheet(grid, m, opts);
    expect(first.rows.map((x) => [x.ref, x.data?.name, x.data?.affiliation])).toEqual([
      ["2", "גימל בדיקתי", "אוניברסיטת בדיקה"],
      ["3", "זין בדיקתי", null],
      ["4", "טית בדיקתית", "מוסד קיים, מדרשת בדיקה"],
      ["5", "יוד בדיקתי", null],
    ]);
    expect(first.lines.map((l) => [l.id, l.text, l.as])).toEqual([
      ["2:2", "אוניברסיטת בדיקה", "affiliation"],
      ["3:2", "הרבנית חית בדיקתית", null],
      ["4:2", "(מדרשת בדיקה)", "affiliation"],
      ["5:2", "כף בדיקתית", null],
    ]);
    // decided: a candidate of its own (its name and title), or left out — the row's other columns stay the first's
    const decided = readCandidateSheet(grid, m, { ...opts, lineAs: new Map([["3:2", "speaker" as const], ["5:2", "skip" as const]]) });
    expect(decided.rows.map((x) => [x.ref, x.data?.title ?? null, x.data?.name, x.data?.gender ?? null])).toEqual([
      ["2", "ד״ר", "גימל בדיקתי", null],
      ["3", "הרב", "זין בדיקתי", "m"],
      ["3:2", "הרבנית", "חית בדיקתית", "f"],
      ["4", null, "טית בדיקתית", null],
      ["5", null, "יוד בדיקתי", null],
    ]);
    const preview = previewCandidates(decided.rows, contextOf([], { phones: [], contacts: [] }));
    const p = candidatesPayload(preview, new Map<string, Choice>(), "x", null)!;
    expect(p.rows.map((x) => [x.row, x.name])).toEqual([[2, "גימל בדיקתי"], [3, "זין בדיקתי"], [3, "חית בדיקתית"], [4, "טית בדיקתית"], [5, "יוד בדיקתי"]]);
  });

  it("a line of a row left out anyway waits for nothing (item 6)", () => {
    const read = track([r("דוגמה אלף\nשם אחר לגמרי", "שישי 8:30"), r("דוגמה בית\nעוד שם", "ראשון 8:30")]);
    expect(read.lines.map((l) => [l.row, l.as])).toEqual([[2, null], [3, null]]);
    const plans = planLessons(read, { decisions: new Map(), categories: new Map(), sources: new Map() })!;
    expect(openLines(read, plans).map((l) => l.row)).toEqual([3]); // row 2: «יום מחוץ לשבוע» — skipped
  });
});

describe("סבב רביעי, items 5–6: a workbook of many sheets; «כפולה» set off in any bracket", () => {
  it("a workbook listing more than 255 sheets is refused at once (import_too_big) — 255 are read", () => {
    const book = (n: number) =>
      zipSync({
        "xl/workbook.xml": strToU8(`<workbook xmlns:r="r"><sheets>${'<sheet name="s" r:id="rId1"/>'.repeat(n)}</sheets></workbook>`),
        "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
        "xl/worksheets/sheet1.xml": strToU8("<worksheet><sheetData/></worksheet>"),
      });
    expect(IMPORT_LIMITS.sheets).toBe(255);
    expect(readXlsx(book(255)).sheets).toHaveLength(255);
    const t0 = performance.now();
    expect(code(() => readXlsx(book(256)))).toBe("import_too_big");
    expect(code(() => readXlsx(book(144_489)))).toBe("import_too_big");
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("«[כפולה]», «(כפולה!)», «- כפולה.» in a title are said; the title is never cut", () => {
    const read = track([r("דוגמה אלף", "ראשון 8:30", "נאמנות [כפולה]"), r("דוגמה בית", "ראשון 10:00", "נאמנות (כפולה!)"), r("דוגמה גימל", "ראשון 11:30", "נאמנות - כפולה."), r("דוגמה דלת", "ראשון 13:00", "זהות כפולה")]);
    expect(read.rows.map((x) => [x.title, x.warnings.some((w) => w.startsWith("בכותרת כתוב «כפולה»"))])).toEqual([
      ["נאמנות [כפולה]", true],
      ["נאמנות (כפולה!)", true],
      ["נאמנות - כפולה.", true],
      ["זהות כפולה", false],
    ]);
  });
});
