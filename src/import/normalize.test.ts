// The import's normalisation, one rule at a time: the title split, gender only from הרב / הרבנית, phones (and their
// key, app.phone_key's twin), the scrub of free text, the day/time of «שיעור ב» with last year's odd values, the
// sources' translations, and the matching thresholds. Synthetic names and numbers only — no phone here has a real shape.
import { describe, expect, it } from "vitest";
import { DEFAULT_TITLES } from "../data/speakerRules";
import type { Speaker } from "../domain/types";
import { defaultMapping, headerKey, looksLikeHeader, setMapping } from "./fields";
import { actionOf, fillPlan, matchSpeaker } from "./match";
import { normalizeEmail, normalizePhone, phoneKey, scrubContacts } from "./phone";
import { defaultSourcesRule, sourcesKey, translateSources } from "./sources";
import { pickTitleCell, splitSpeakers, splitTitle, titleGender } from "./speakerName";
import { parseWhen, rowEnd } from "./when";

const T = DEFAULT_TITLES;

describe("the title split and gender", () => {
  it("splits each of the edition's titles off the name, in the sheet's spellings too", () => {
    expect(splitTitle("הרב מרצה לדוגמה 1", T)).toEqual({ title: "הרב", name: "מרצה לדוגמה 1" });
    expect(splitTitle("הרבנית מרצה לדוגמה 2", T)).toEqual({ title: "הרבנית", name: "מרצה לדוגמה 2" });
    for (const dr of ['ד"ר', "ד''ר", "ד״ר", "דר'", "דוקטור"]) expect(splitTitle(`${dr} מרצה לדוגמה 3`, T)).toEqual({ title: "ד״ר", name: "מרצה לדוגמה 3" });
    for (const pr of ["פרופ'", "פרופ׳", "פרופ.", "פרופסור"]) expect(splitTitle(`${pr} מרצה לדוגמה 4`, T)).toEqual({ title: "פרופ׳", name: "מרצה לדוגמה 4" });
    expect(splitTitle("  מרצה   לדוגמה 5 ", T)).toEqual({ title: null, name: "מרצה לדוגמה 5" });
    expect(splitTitle("הרב", T)).toEqual({ title: null, name: "הרב" }); // a title alone is not a name
  });

  it("«הרבנית» is never read as «הרב» + «ית…» — the longer title first", () => {
    expect(splitTitle("הרבנית מרצה", T).title).toBe("הרבנית");
    expect(splitTitle("הרבנית מרצה", ["הרב", "הרבנית"]).title).toBe("הרבנית");
  });

  it("only the edition's own titles: a spelling of a title the edition does not list stays in the name", () => {
    expect(splitTitle('ד"ר מרצה', ["הרב"])).toEqual({ title: null, name: 'ד"ר מרצה' });
    expect(splitTitle("הרה״ג מרצה", ["הרה״ג", ...T])).toEqual({ title: "הרה״ג", name: "מרצה" });
    expect(pickTitleCell("ד''ר", T)).toBe("ד״ר");
    expect(pickTitleCell("מר", T)).toBeNull();
  });

  it("gender from הרב (m) and הרבנית (f) only — never from anything else", () => {
    expect(titleGender("הרב")).toBe("m");
    expect(titleGender("הרבנית")).toBe("f");
    for (const t of ["ד״ר", "פרופ׳", null, "הרה״ג"]) expect(titleGender(t)).toBeNull();
  });

  it("splits a cell of several speakers; the first leads", () => {
    expect(splitSpeakers("מרצה א + מרצה ב")).toEqual(["מרצה א", "מרצה ב"]);
    expect(splitSpeakers("מרצה א\nמרצה ב; מרצה ג & מרצה ד")).toEqual(["מרצה א", "מרצה ב", "מרצה ג", "מרצה ד"]);
    expect(splitSpeakers("מרצה א / מרצה ב")).toEqual(["מרצה א", "מרצה ב"]);
  });
});

describe("phones and e-mails", () => {
  it("the key: digits; 972 / 00972 / +972 (0) as a leading 0; a zero Excel dropped given back; null under 6 digits", () => {
    expect(phoneKey("011-111-1111")).toBe("0111111111");
    expect(phoneKey("+972 11 111 1111")).toBe("0111111111");
    expect(phoneKey("00972-11-1111111")).toBe("0111111111");
    expect(phoneKey("+972 (0)11 111 1111")).toBe("0111111111");
    expect(phoneKey("111111111")).toBe("0111111111"); // 9 digits, the leading 0 eaten by a number cell
    expect(phoneKey("11111111")).toBe("011111111");
    expect(phoneKey("1111111111")).toBe("1111111111"); // ten digits: as they are
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey("טלפון לדוגמה")).toBeNull();
  });

  it("stores a plain number as its key, a number with words as typed, and refuses what is not a phone", () => {
    expect(normalizePhone("011-111-1111")).toEqual({ value: "0111111111", key: "0111111111", problem: false });
    expect(normalizePhone("‏+1 111 111 1111")).toEqual({ value: "+11111111111", key: "11111111111", problem: false });
    expect(normalizePhone("בבית 011-111-1111")).toEqual({ value: "בבית 011-111-1111", key: "0111111111", problem: false });
    expect(normalizePhone("אין")).toEqual({ value: null, key: null, problem: true });
    expect(normalizePhone("")).toEqual({ value: null, key: null, problem: false });
    expect(normalizePhone(`ארוך ${"א".repeat(40)} 011-111-1111`).problem).toBe(true);
    // two numbers in one cell: never one 20-digit «phone» — kept as typed
    expect(normalizePhone("011-111-1111 022-222-2222").value).toBe("011-111-1111 022-222-2222");
  });

  it("an e-mail with @ and a dot after it, «mailto:» away", () => {
    expect(normalizeEmail("mailto:someone@example.org ")).toEqual({ value: "someone@example.org", problem: false });
    expect(normalizeEmail("לא מייל")).toEqual({ value: null, problem: true });
  });

  it("takes every phone and e-mail out of free text the team reads, and says so", () => {
    expect(scrubContacts("הסעה מהתחנה, נהג 011-111-1111, או x@example.org")).toEqual({ text: "הסעה מהתחנה, נהג [טלפון הוסר], או [מייל הוסר]", scrubbed: true });
    expect(scrubContacts("300 ש״ח, שיעור 8:30-10:00")).toEqual({ text: "300 ש״ח, שיעור 8:30-10:00", scrubbed: false });
  });
});

describe("«שיעור ב» — day and time, with last year's odd values", () => {
  it("a day name or letter and a start; the end is the grid row's", () => {
    expect(parseWhen("ראשון 8:30")).toEqual({ day: 0, start: 510, end: null, rest: "" });
    expect(parseWhen("יום ב' 10:00")).toEqual({ day: 1, start: 600, end: null, rest: "" });
    expect(parseWhen("ג׳ 14:30")).toMatchObject({ day: 2, start: 870 });
    expect(parseWhen("יום ד 16.00")).toMatchObject({ day: 3, start: 960 });
    expect(rowEnd(510)).toBe(600);
    expect(rowEnd(515)).toBeNull();
  });

  it("the night belongs to the day named (00:30 → 1470), and a range ending 06:30 ends the grid's day", () => {
    expect(parseWhen("רביעי 00:30")).toMatchObject({ day: 3, start: 1470 });
    expect(parseWhen("שני 5:00-6:30")).toMatchObject({ day: 1, start: 1740, end: 1830 });
    expect(parseWhen("שלישי 23:30-01:00")).toMatchObject({ day: 2, start: 1410, end: 1500 });
  });

  it("a range typed right to left is read the right way; the rest of the cell is kept", () => {
    expect(parseWhen("שני 11:30-10:00")).toEqual({ day: 1, start: 600, end: 690, rest: "" });
    expect(parseWhen("חמישי 17:30 שיעור להורים")).toEqual({ day: 4, start: 1050, end: null, rest: "שיעור להורים" });
    expect(parseWhen("ראשון 8:30 (כפולה)")).toMatchObject({ day: 0, start: 510, rest: "כפולה" });
  });

  it("refuses with a reason: no day, a day outside the week, no time, a time off the 5-minute grid", () => {
    expect(parseWhen("8:30")).toBe("no_day");
    expect(parseWhen("שישי 8:30")).toBe("not_in_week");
    expect(parseWhen("מוצ\"ש 20:00")).toBe("not_in_week");
    expect(parseWhen("ראשון בבוקר")).toBe("no_time");
    expect(parseWhen("ראשון 8:32")).toBe("bad_time");
    expect(parseWhen("ראשון 8:30 9:00 10:00 11:00")).toBe("bad_time");
    expect(parseWhen("שני 8:30-20:30")).toBe("bad_time"); // twelve hours: not a lesson
  });
});

describe("the sources' translations", () => {
  it("DESIGN's three, «הצעה» for a few more, pending for an empty cell, «אחר» with the words kept for the rest", () => {
    expect(defaultSourcesRule("כן")).toEqual({ kind: "sheet", print: "none", origin: "design" });
    expect(defaultSourcesRule("כן + סרטון")).toEqual({ kind: "sheet_video", print: "none", origin: "design" });
    expect(defaultSourcesRule(" להדפיס  לפני")).toEqual({ kind: "sheet", print: "before", origin: "design" });
    expect(defaultSourcesRule("מצגת")).toMatchObject({ kind: "presentation", origin: "suggested" });
    expect(defaultSourcesRule("")).toEqual({ kind: "pending", print: "none", origin: "empty" });
    expect(defaultSourcesRule("נשלח במייל")).toEqual({ kind: "other", print: "none", origin: "unknown" });
    expect(sourcesKey('כן+"סרטון"')).toBe("כן+סרטון");
  });

  it("the admin's table wins; an «אחר» keeps the sheet's words in the sources note", () => {
    const table = new Map([["כן", { kind: "sheet_presentation" as const, print: "same_day" as const }]]);
    expect(translateSources("כן", table)).toEqual({ sources_kind: "sheet_presentation", print_when: "same_day", sources_note: null });
    expect(translateSources("נשלח במייל", new Map())).toEqual({ sources_kind: "other", print_when: "none", sources_note: "נשלח במייל" });
  });
});

describe("the mapping", () => {
  it("recognizes only the headers DESIGN's appendix names, spelled loosely", () => {
    const header = ["מרצה", "שיעור ב'", "כותרת", "מקורות - נשלח?", "הסעה / תשלום", "טלפון", "קיבל הודעת סיכום מ:", "נושא", "מלווה"];
    expect(defaultMapping("tracking", header, header.length)).toEqual(["speaker", "when", "title", "sources", "transport", "phone", "confirmFrom", "topic", null]);
    expect(defaultMapping("candidates", ["מרצה", "טווח ימים", "העדפה", "חניך/ה"], 4)).toEqual(["name", "status", null, null]);
    expect(headerKey("  קיבל הודעת סיכום מ ")).toBe(headerKey("קיבל הודעת סיכום מ"));
    expect(looksLikeHeader("tracking", ["x", "שיעור ב"])).toBe(true);
    expect(looksLikeHeader("escorts", ["מלווה", "הערות"])).toBe(false);
  });

  it("a single field moves from the column it was on; a field of many columns stays on each", () => {
    expect(setMapping("tracking", ["speaker", null, null], 2, "speaker")).toEqual([null, null, "speaker"]);
    expect(setMapping("tracking", ["note", null, null], 2, "note")).toEqual(["note", null, "note"]);
  });
});

const sp = (id: number, name: string, extra: Partial<Speaker> = {}): Speaker => ({
  id, title: null, name, disambiguator: null, gender: null, affiliation: null, bio_short: null, topics: [], contact_pref: null,
  vetted: "approved", vetted_by: null, vetted_note: null, retired: false, name_key: name, version: 1, ...extra,
});

describe("matching — «חדש · תואם · עמום»", () => {
  const pool = [sp(1, "מרצה 07"), sp(2, "מרצה 01"), sp(3, "מרצה 02"), sp(4, "שם כפול", { disambiguator: "א" }), sp(5, "שם כפול", { disambiguator: "ב" })];
  const none = new Map<string, number[]>();

  it("the same name key is «תואם»; taken twice, «עמום» without «new» (a namesake needs a disambiguator)", () => {
    expect(matchSpeaker("מרצה 07", null, pool, none)).toMatchObject({ status: "match", target: 1, via: "name" });
    const twice = matchSpeaker("שם כפול", null, pool, none);
    expect(twice).toMatchObject({ status: "ambiguous", allowNew: false });
    expect(twice.candidates.map((c) => c.id)).toEqual([4, 5]);
  });

  it("the same phone is «תואם» — after the name, before the similar names", () => {
    expect(matchSpeaker("שם אחר לגמרי", "0111111111", pool, new Map([["0111111111", [3]]]))).toMatchObject({ status: "match", target: 3, via: "phone" });
    expect(matchSpeaker("שם אחר לגמרי", "0111111111", pool, new Map([["0111111111", [2, 3]]]))).toMatchObject({ status: "ambiguous", via: "phone", allowNew: true });
  });

  it("similarity ≥ 0.6 (inclusive, pg_trgm's) is «עמום» with the candidates; below it «חדש»", () => {
    // «מרצה 07ב» ~ «מרצה 07»: 0.7; «מרצה 03» ~ «מרצה 01» and «מרצה 02»: exactly 0.6 — still similar
    expect(matchSpeaker("מרצה 07ב", null, pool, none)).toMatchObject({ status: "ambiguous", via: "similar", allowNew: true });
    const exact = matchSpeaker("מרצה 03", null, pool, none);
    expect(exact.status).toBe("ambiguous");
    expect(exact.candidates.map((c) => [c.id, c.similarity])).toEqual([
      [1, Math.fround(0.6)],
      [2, Math.fround(0.6)],
      [3, Math.fround(0.6)],
    ]);
    expect(matchSpeaker("מרצה 5", null, pool, none).status).toBe("new"); // 0.5
    expect(matchSpeaker("מרצה לדוגמה 1", null, pool, none).status).toBe("new");
  });

  it("the action: a match merges, a new is new, an «עמום» waits for a choice the candidates allow", () => {
    const m = matchSpeaker("מרצה 07ב", null, pool, none);
    expect(actionOf("ambiguous", m, undefined)).toBeNull();
    expect(actionOf("ambiguous", m, { action: "merge", target: 1 })).toEqual({ action: "merge", target: 1 });
    expect(actionOf("ambiguous", m, { action: "merge", target: 5 })).toBeNull(); // not a candidate
    expect(actionOf("ambiguous", matchSpeaker("שם כפול", null, pool, none), { action: "new" })).toBeNull();
    expect(actionOf("match", matchSpeaker("מרצה 07", null, pool, none), { action: "skip" })).toEqual({ action: "skip" });
  });
});

describe("«fill empty only» — what a match would fill", () => {
  const row = { title: "הרב", gender: "m" as const, affiliation: "מוסד לדוגמה", topics: ["תנ\"ך"], phone: "0111111111", email: null, notes: "טווח ימים: א-ב" };

  it("every field the pool speaker lacks and the row has", () => {
    expect(fillPlan(sp(1, "x"), { phone: false, email: false, secretary_note: false, notes: false }, row)).toEqual(["תואר", "מגדר (הצעה, מהתואר)", "מוסד", "נושאים", "טלפון", "הערות"]);
  });

  it("never a field the pool speaker has — its own record or its contacts", () => {
    const full = sp(1, "x", { title: "ד״ר", gender: "f", affiliation: "מוסד אחר", topics: ["פילוסופיה"] });
    expect(fillPlan(full, { phone: true, email: false, secretary_note: false, notes: true }, row)).toEqual([]);
  });
});
