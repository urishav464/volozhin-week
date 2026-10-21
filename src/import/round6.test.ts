// The import review's sixth and last round (DECISIONS «ביקורת: ייבוא ואבן דרך 6», סבב שישי), each a rule with a test
// that fails without it: «עריכה» of a speaker card (the admin's name, title and affiliation replace what was read —
// matched again, checked again); a name's own line split at «, », a spaced dash and «והרב…» like a trailing bracket
// (and the escorts' file matching the bare name); «לא לייבא» proposed from a name only when the line IS an escort's
// name; a two-digit-year date never starts a phone, a number's rest leaves with it, and +972 / 00972 are of a fixed
// length; a channel after «לא» is not asked for. Synthetic names; every realistic number is BUILT here from its parts.
import { describe, expect, it } from "vitest";
import { cleanSpeakerRow } from "../data/importRules";
import { DEFAULT_TITLES } from "../data/speakerRules";
import type { Speaker } from "../domain/types";
import { candidatesPayload, contextOf, previewCandidates, readCandidateSheet, undecided } from "./candidates";
import { cleanEdit, editProblem, validEdit } from "./edit";
import { channelOf, escortsPayload, previewEscorts, readEscorts, splitPhrases, suggestChannel } from "./escorts";
import type { Mapping } from "./fields";
import { lineContext, lineProposal, nameTails } from "./lines";
import { hasContact, scrubContacts, stripContacts } from "./phone";
import { archivePayload, openLines, planLessons, previewTrackingSpeakers, readTracking } from "./tracking";

const sp = (id: number, name: string, extra: Partial<Speaker> = {}): Speaker => ({
  id, title: null, name, disambiguator: null, gender: null, affiliation: null, bio_short: null, topics: [], contact_pref: null,
  vetted: "approved", vetted_by: null, vetted_note: null, retired: false, name_key: name, version: 1, ...extra,
});
const POOL = contextOf([sp(1, "יואב בדיקתי"), sp(2, "מרצה 12"), sp(3, "מרצה 05"), sp(4, "גפן דולב")], { phones: [], contacts: [] });
const opts = { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true };
/** A number from its parts — so that no phone is ever written in this file. */
const num = (...parts: string[]) => parts.join("");
const plan = (read: ReturnType<typeof readTracking>) => planLessons(read, { decisions: new Map(), categories: new Map(), sources: new Map() })!;
const META = { label: "בדיקה", start_date: null, source: "tracking-5786", titles_from: null };

describe("סבב שישי, 1: «עריכה» — the admin's name, title and affiliation replace what was read, matched again, checked again", () => {
  const grid = [["מרצה", "מוסד"], ["הרב יואב בדיקתי-ישיבת הר בדיקה", ""], ["הרבנית גימל בדיקתית", "מכון לדוגמה"]];
  const m: Mapping = ["name", "affiliation"];

  it("the candidates: a glued name edited to «יואב בדיקתי», affiliation «ישיבת הר בדיקה» — the pool's speaker, completed", () => {
    const before = previewCandidates(readCandidateSheet(grid, m, opts).rows, POOL);
    // a bare hyphen is never a split («בן-דוד»): the glued name is read whole, and is «חדש»
    expect(before[0]).toMatchObject({ status: "new", edited: false, fields: { title: "הרב", name: "יואב בדיקתי-ישיבת הר בדיקה", affiliation: null } });
    const edits = new Map([["2", { title: "הרב", name: " יואב  בדיקתי ", affiliation: "ישיבת הר בדיקה" }]]);
    const read = readCandidateSheet(grid, m, { ...opts, edits });
    const after = previewCandidates(read.rows, POOL);
    expect(after[0]).toMatchObject({ status: "match", edited: true, fields: { title: "הרב", name: "יואב בדיקתי", affiliation: "ישיבת הר בדיקה" } });
    expect(after[0].match?.target).toBe(1);
    expect(after[0].fills).toEqual(["תואר: הרב", "מגדר: זכר (הצעה, מהתואר)", "מוסד"]);
    const p = candidatesPayload(after, new Map(), "brainstorm-5786", null)!;
    expect(p.rows[0]).toMatchObject({ action: "merge", speaker_id: 1, title: "הרב", name: "יואב בדיקתי", gender: "m", affiliation: "ישיבת הר בדיקה" });
    expect(() => cleanSpeakerRow(p.rows[0], DEFAULT_TITLES)).not.toThrow();
    // the title edited: the gender by the same rule — and only by it
    const f = readCandidateSheet(grid, m, { ...opts, edits: new Map([["3", { title: null, name: "גימל בדיקתית", affiliation: null }]]) }).rows[1];
    expect(f.data).toMatchObject({ title: null, gender: null, affiliation: null });
  });

  it("an edit is checked as the file's text is: a phone or an e-mail, no name, a title not in the list — not saved, and ignored by the read", () => {
    const phone = num("052", "-", "1234567");
    expect(editProblem({ title: null, name: `יואב בדיקתי ${phone}`, affiliation: null }, DEFAULT_TITLES)).toMatch(/טלפון או מייל/);
    expect(editProblem({ title: null, name: "יואב בדיקתי", affiliation: "someone@example.org" }, DEFAULT_TITLES)).toMatch(/טלפון או מייל/);
    expect(editProblem({ title: null, name: " ", affiliation: null }, DEFAULT_TITLES)).toBe("צריך שם");
    expect(editProblem({ title: "רבי", name: "יואב בדיקתי", affiliation: null }, DEFAULT_TITLES)).toBe("התואר לא ברשימת התארים");
    expect(editProblem({ title: "הרב", name: "יואב בדיקתי", affiliation: "" }, DEFAULT_TITLES)).toBeNull();
    expect(cleanEdit({ title: "", name: " א  ב ", affiliation: "  " })).toEqual({ title: null, name: "א ב", affiliation: null });
    expect(validEdit({ title: null, name: `יואב ${phone}`, affiliation: null }, DEFAULT_TITLES)).toBeNull();
    const read = readCandidateSheet(grid, m, { ...opts, edits: new Map([["2", { title: null, name: `יואב בדיקתי ${phone}`, affiliation: null }]]) });
    expect(read.rows[0]).toMatchObject({ edited: false, data: { name: "יואב בדיקתי-ישיבת הר בדיקה" } });
  });

  it("an edit that makes a row another row's name: «כפול בטבלה», and it may be taken back", () => {
    const g = [["מרצה"], ["יואב בדיקתי"], ["יואב בדיקתי-ישיבת הר בדיקה"]];
    const read = readCandidateSheet(g, ["name"], { ...opts, edits: new Map([["3", { title: null, name: "יואב בדיקתי", affiliation: null }]]) });
    expect(read.rows[1]).toMatchObject({ skip: "כפול בטבלה (כמו שורה 2)", edited: true, fields: { name: "יואב בדיקתי" } });
  });

  it("the tracking sheet: a speaker edited by its key as read — matched again; two names edited into one are one speaker", () => {
    const g = [["מרצה", "שיעור ב", "כותרת"], ["הרב יואב בדיקתי-ישיבת הר בדיקה", "ראשון 8:30", "א"], ["יואב בדיקתי", "ראשון 10:00", "ב"], ["מרצה12", "ראשון 11:30", "ג"]];
    const m3: Mapping = ["speaker", "when", "title"];
    const first = readTracking(g, m3, opts);
    expect(first.speakers.map((s) => [s.key, s.from, s.edited])).toEqual([["יואב בדיקתי ישיבת הר בדיקה", ["יואב בדיקתי ישיבת הר בדיקה"], false], ["יואב בדיקתי", ["יואב בדיקתי"], false], ["מרצה12", ["מרצה12"], false]]);
    const edits = new Map([
      ["יואב בדיקתי ישיבת הר בדיקה", { title: "הרב", name: "יואב בדיקתי", affiliation: "ישיבת הר בדיקה" }],
      ["מרצה12", { title: null, name: "מרצה 12", affiliation: null }],
    ]);
    const read = readTracking(g, m3, { ...opts, edits });
    expect(read.speakers.map((s) => [s.title, s.name, s.affiliation, s.rows, s.from, s.edited])).toEqual([
      ["הרב", "יואב בדיקתי", "ישיבת הר בדיקה", [2, 3], ["יואב בדיקתי ישיבת הר בדיקה", "יואב בדיקתי"], true],
      [null, "מרצה 12", null, [4], ["מרצה12"], true],
    ]);
    const speakers = previewTrackingSpeakers(read, POOL);
    expect(speakers.map((s) => [s.status, s.match.target])).toEqual([["match", 1], ["match", 2]]);
    const p = archivePayload(plan(read), speakers, new Map(), META)!;
    expect(p.speakers.map((s) => [s.action, s.speaker_id, s.title, s.name, s.gender, s.affiliation])).toEqual([["merge", 1, "הרב", "יואב בדיקתי", "m", "ישיבת הר בדיקה"], ["merge", 2, null, "מרצה 12", null, null]]);
    expect(p.lessons.map((l) => l.speakers)).toEqual([[0], [0], [1]]);
  });

  it("the tracking sheet: a name beside the first is a line — proposed a co-speaker, an institution's an affiliation; the speaker knows its line", () => {
    const g = [["מרצה", "שיעור ב", "כותרת"], ["מרצה 12 / ישיבת הגולן", "ראשון 8:30", "א"], ["מרצה 05 + גפן דולב (מכון לדוגמה)", "ראשון 10:00", "ב"]];
    const read = readTracking(g, ["speaker", "when", "title"], opts);
    expect(read.lines.map((l) => [l.id, l.kind, l.text, l.as])).toEqual([
      ["2:2", "beside", "ישיבת הגולן", "affiliation"], // never a speaker «ישיבת הגולן» again
      ["3:2", "beside", "גפן דולב (מכון לדוגמה)", "speaker"], // read by its own name; its bracket a line of it
      ["3:2.1", "bracket", "(מכון לדוגמה)", "affiliation"],
    ]);
    expect(read.speakers.map((s) => [s.name, s.affiliation, s.lines])).toEqual([["מרצה 12", "ישיבת הגולן", []], ["מרצה 05", null, []], ["גפן דולב", "מכון לדוגמה", ["3:2"]]]);
  });
});

describe("סבב שישי, 2: a name's own line split at «, », a spaced dash and «ו» before a title — like a trailing bracket", () => {
  it("nameTails: the parts in order, never a bare hyphen, never inside brackets", () => {
    const t = (x: string) => nameTails(x, DEFAULT_TITLES);
    expect(t("הרב פלוני - ישיבת בדיקה")).toEqual({ name: "הרב פלוני", brackets: [], tails: ["ישיבת בדיקה"] });
    expect(t("ד\"ר פלונית, אוניברסיטת בדיקה")).toEqual({ name: "ד\"ר פלונית", brackets: [], tails: ["אוניברסיטת בדיקה"] });
    expect(t("פלוני – מכון בדיקה — ראש המכון")).toEqual({ name: "פלוני", brackets: [], tails: ["מכון בדיקה", "ראש המכון"] });
    expect(t("הרב אבי בדיקתי והרב גיל בדיקתי")).toEqual({ name: "הרב אבי בדיקתי", brackets: [], tails: ["הרב גיל בדיקתי"] });
    expect(t("פלוני וד\"ר אלמונית")).toEqual({ name: "פלוני", brackets: [], tails: ["ד\"ר אלמונית"] });
    expect(t("פלוני ופרופ׳ אלמוני והרבנית פלמונית")).toEqual({ name: "פלוני", brackets: [], tails: ["פרופ׳ אלמוני", "הרבנית פלמונית"] });
    expect(t("מרצה 12 (מלווה: שירה) - ישיבת בדיקה")).toEqual({ name: "מרצה 12", brackets: ["(מלווה: שירה)"], tails: ["ישיבת בדיקה"] });
    for (const whole of ["פלוני בן-דוד", "פלוני-אלמוני", "פלוני והרבה אחרים", "פלוני (ישיבת א, ירושלים)", "פלוני,אלמוני", "- פלוני"]) {
      expect(t(whole).tails, whole).toEqual([]);
    }
    expect(t("פלוני (ישיבת א - ירושלים)")).toEqual({ name: "פלוני", brackets: ["(ישיבת א - ירושלים)"], tails: [] });
  });

  const H = ["מרצה", "שיעור ב", "כותרת", "מלווה"];
  const grid = [
    H,
    ["הרב יואב בדיקתי - ישיבת הר בדיקה", "ראשון 8:30", "א", ""],
    ["מרצה 12 - מלווה: שירה בדקני", "ראשון 10:00", "ב", "שירה בדקני"],
    ["מרצה 05, שירה", "ראשון 11:30", "ג", ""],
    ["הרב אבי בדיקתי והרב גיל בדיקתי", "שני 8:30", "ד", ""],
    ["ד\"ר גפן דולב – אוניברסיטת בדיקה – מלווה: שירה", "שני 10:00", "ה", ""],
  ];
  const m: Mapping = ["speaker", "when", "title", null];
  const escorts = ["שירה בדקני"];

  it("tracking: each tail a line of the name — an institution an affiliation, an escort «לא לייבא», a second name waits; the name matches the pool", () => {
    const read = readTracking(grid, m, { ...opts, escorts });
    expect(read.lines.map((l) => [l.id, l.kind, l.text, l.ofName, l.as])).toEqual([
      ["2:1.1", "tail", "ישיבת הר בדיקה", "יואב בדיקתי", "affiliation"],
      ["3:1.1", "tail", "מלווה: שירה בדקני", "מרצה 12", "skip"],
      ["4:1.1", "tail", "שירה", "מרצה 05", "skip"], // the whole of it one escort's name
      ["5:1.1", "tail", "הרב גיל בדיקתי", "אבי בדיקתי", null],
      ["6:1.1", "tail", "אוניברסיטת בדיקה", "גפן דולב", "affiliation"],
      ["6:1.2", "tail", "מלווה: שירה", "גפן דולב", "skip"],
    ]);
    const speakers = previewTrackingSpeakers(read, POOL);
    expect(speakers.map((s) => [s.speaker.name, s.speaker.affiliation, s.status])).toEqual([
      ["יואב בדיקתי", "ישיבת הר בדיקה", "match"],
      ["מרצה 12", null, "match"],
      ["מרצה 05", null, "match"],
      ["אבי בדיקתי", null, "new"],
      ["גפן דולב", "אוניברסיטת בדיקה", "match"],
    ]);
    expect(openLines(read, plan(read)).map((l) => l.id)).toEqual(["5:1.1"]); // «ייבוא» waits for it
    const decided = readTracking(grid, m, { ...opts, escorts, lineAs: new Map([["5:1.1", "speaker" as const]]) });
    expect(decided.speakers.map((s) => s.name)).toContain("גיל בדיקתי");
    const p = archivePayload(plan(decided), previewTrackingSpeakers(decided, POOL), new Map(), META)!;
    expect(JSON.stringify(p)).not.toMatch(/שירה|מלווה| - |, /);
  });

  it("the candidates: the same — the name matched without its tails", () => {
    const cg = [["מרצה", "חניך/ה"], ["הרב יואב בדיקתי - ישיבת הר בדיקה", ""], ["מרצה 12, מלווה: שירה בדקני", "שירה בדקני"], ["ד\"ר מרצה 05 וד\"ר גפן דולב", ""]];
    const read = readCandidateSheet(cg, ["name", null], { ...opts, escorts });
    expect(read.lines.map((l) => [l.id, l.kind, l.text, l.as])).toEqual([
      ["2:1.1", "tail", "ישיבת הר בדיקה", "affiliation"],
      ["3:1.1", "tail", "מלווה: שירה בדקני", "skip"],
      ["4:1.1", "tail", "ד\"ר גפן דולב", null],
    ]);
    const decided = readCandidateSheet(cg, ["name", null], { ...opts, escorts, lineAs: new Map([["4:1.1", "speaker" as const]]) });
    const preview = previewCandidates(decided.rows, POOL);
    expect(preview.map((r) => [r.ref, r.data?.title, r.data?.name, r.data?.affiliation, r.status, r.match?.target])).toEqual([
      ["2", "הרב", "יואב בדיקתי", "ישיבת הר בדיקה", "match", 1],
      ["3", null, "מרצה 12", null, "match", 2],
      ["4", "ד״ר", "מרצה 05", null, "match", 3],
      ["4:1.1", "ד״ר", "גפן דולב", null, "match", 4],
    ]);
    expect(JSON.stringify(candidatesPayload(preview, new Map(), "x", null))).not.toMatch(/שירה|מלווה/);
  });

  it("the escorts' file: the bare name — brackets and tails out — matches the pool; nothing of them is sent", () => {
    const g = [["מרצה", "מלווה", "הערות"], ["הרב מרצה 05 (ישיבת בדיקה)", "שירה בדקני", "להתקשר אחרי 20:00"], ["מרצה 12 - מלווה: שירה", "", "דרך המזכירה"]];
    const rows = readEscorts(g, ["speaker", null, "phrases"], { headerRow: 0, titles: DEFAULT_TITLES });
    expect(rows.map((r) => [r.key, r.name])).toEqual([["מרצה 05", "מרצה 05"], ["מרצה 12", "מרצה 12"]]);
    const preview = previewEscorts(rows, POOL, ["שירה בדקני"]);
    expect(preview.map((x) => [x.name, x.status, x.target?.id])).toEqual([["מרצה 05", "match", 3], ["מרצה 12", "match", 2]]);
    const p = escortsPayload(preview, new Map(), new Map(preview.map((x) => [x.key, { channel: x.suggested ?? "phone", note: "" }])))!;
    expect(p.rows).toEqual([{ row: 2, speaker_id: 3, channel: "phone", note: null }, { row: 3, speaker_id: 2, channel: "secretary", note: null }]);
  });
});

describe("סבב שישי, 3: «לא לייבא» from a name only when the line IS an escort's name — else it waits", () => {
  const c = lineContext(["נועם ניסיוני", "שירה כהן", "תמר בר", "נועה חניכתי", "שלום הרטמני", "אורי מרכז"], DEFAULT_TITLES);
  it("strong: «מלווה»/«חניך», or every name word of ONE escort's name", () => {
    for (const t of ["(נועה חניכתי)", "שירה", "(שירה)", "ושירה כהן", "(מלווה: שם אחר)", "עם שירה", "(נועם ניסיוני (שנה ב))"]) expect(lineProposal(t, c).as, t).toBe("skip");
  });
  it("weak: a title, an institution's word, or only one word of a longer name — undecided, said, never «לא לייבא»", () => {
    // «(הרב כהן)», «(מרכז אורי)»: every word an escort's — but a title, an institution's word: waits
    for (const t of ["(ישיבת נועם)", "הרב דוד כהן", "דוד כהן", "+ הרב יוסף כהן", "(אוניברסיטת בר-אילן)", "(מכון שלום הרטמן)", "ד\"ר נועה בדיקתית", "(בתיאום מול שירה ונועם הרטמני)", "(הרב כהן)", "(מרכז אורי)"]) {
      const p = lineProposal(t, c);
      expect([t, p.as, p.held], t).toEqual([t, null, true]);
    }
    expect(lineProposal("(ישיבת חניכי בדיקה)", c)).toMatchObject({ as: null, held: true }); // a word about trainees beside an institution: waits
  });
  it("tracking: a co-speaker «הרב דוד כהן» beside an escort «שירה כהן» waits for the admin — and «ייבוא» with it", () => {
    const g = [["מרצה", "שיעור ב", "כותרת", "מלווה"], ["מרצה 12 + הרב דוד כהן", "ראשון 8:30", "א", "שירה כהן"], ["מרצה 05 (ישיבת נועם)", "ראשון 10:00", "ב", "נועם ניסיוני"]];
    const read = readTracking(g, ["speaker", "when", "title", null], { ...opts, escorts: ["שירה כהן", "נועם ניסיוני"] });
    expect(read.lines.map((l) => [l.id, l.text, l.as, l.held, l.escort])).toEqual([["2:2", "הרב דוד כהן", null, true, "כהן"], ["3:1.1", "(ישיבת נועם)", null, true, "נועם"]]);
    expect(openLines(read, plan(read))).toHaveLength(2);
  });
  it("the candidates: a co-candidate with a title who shares a first name with an escort waits", () => {
    const g = [["מרצה", "חניך/ה"], ["פרופ' רות בדיקתית + ד\"ר אורי בדיקתי", ""], ["בית בדיקתי", "אורי חניך"]];
    const read = readCandidateSheet(g, ["name", null], { ...opts, escorts: ["אורי חניך"] });
    expect(read.lines.map((l) => [l.text, l.as, l.held])).toEqual([["ד\"ר אורי בדיקתי", null, true]]);
    expect(undecided(previewCandidates(read.rows, POOL), new Map())).toEqual([]);
  });
});

describe("סבב שישי, 4: a two-digit-year date never starts a phone; a number's rest leaves with it; +972 and 00972 of a fixed length", () => {
  const mobile = num("052", "1234567");
  const forms = [
    num("052", "-", "1234567"), num("052", " ", "123", " ", "4567"), num("(052)", " ", "1234567"), num("052", "-", "123", "-", "4567"), num("072", " ", "123", " ", "4567"),
    num("05", "-21-23-45-67"), num("03", "-12-34-56-7"),
  ];
  it("«אישר 03-11-25 052-…»: the date stays whole, the phone goes — every day, separator and form the reviewer mapped", () => {
    for (const date of ["03-11-25", "02-03-26", "08-12-25", "09-01-26", "04-05-26", "03 11 25", "31-12-25", "1-1-26"]) {
      for (const sep of [" ", "\n", " (", " - "]) {
        for (const f of forms) {
          const text = `אישר ${date}${sep}${f}${sep === " (" ? ")" : ""}`;
          expect(scrubContacts(text).text, JSON.stringify(text)).toBe(`אישר ${date}${sep === " (" ? " " : sep}[טלפון הוסר]`);
          expect(stripContacts(text).text, JSON.stringify(text)).toBe(`אישר ${date}`);
          expect(hasContact(`אישר ${date}`)).toBe(false);
        }
      }
    }
  });
  it("not a date: a day past 31, a month past 12, or pairs that go on — a phone as before", () => {
    for (const t of [num("03-12-34-56-7"), num("03 12 34 56 7"), num("05-21-23-45-67"), num("05 01 23 45 67"), num("08-65-43-21-0"), num("02-12-34-567")]) {
      expect(hasContact(`מרצה ${t}`), t).toBe(true);
    }
    // a date, and a number after it that begins otherwise than a pair: the date whole
    for (const [date, phone] of [["16 11 09", num("1-599-", "123-456")], ["06 09 44", num("04 123 ", "4567")], ["07 04 69", num("09‑123‑", "4567")], ["17 09 11", num("07-12-34-", "56-78")]]) {
      expect(stripContacts(`נקבע ${date} ${phone}`).text, phone).toBe(`נקבע ${date}`);
    }
    // a range of two dates is text
    for (const t of ["05-10-26 - 07-10-26", "07-03-26 - 09-03-26"]) {
      expect(hasContact(t), t).toBe(false);
      expect(scrubContacts(`נקבע ${t}`).text).toBe(`נקבע ${t}`);
    }
  });
  it("a number's rest after a phone taken out (4 digits or more) leaves with it; an amount, a count, a year, a time stay", () => {
    expect(scrubContacts(`להתקשר ${mobile}-8910 בערב`).text).toBe("להתקשר [טלפון הוסר] בערב");
    expect(stripContacts(`פלוני ${num("052-", "123-", "4567")} 5678`).text).toBe("פלוני");
    for (const after of [" 400 ₪", " 1,500 ₪", " 2 נוסעים", " 1948-1949", " 2027", " 20:00", "\n3500 ₪", " 12.3.2026", "-891"]) {
      expect(scrubContacts(`${mobile}${after}`).text, after).toBe(`[טלפון הוסר]${after}`);
    }
  });
  it("+972 and 00972 are Israeli numbers, of a fixed length — never a number abroad that runs into an amount after it", () => {
    const plus = num("+972", " ", "52", "-123-", "4567");
    for (const [text, out] of [
      [`${plus} - 400 ₪`, "[טלפון הוסר] - 400 ₪"],
      [`${plus}\n350 ₪ לשיעור`, "[טלפון הוסר]\n350 ₪ לשיעור"],
      [`${plus} 1,500 ₪`, "[טלפון הוסר] 1,500 ₪"],
      [`${num("00972", "-52-", "1234567")} 2 נוסעים`, "[טלפון הוסר] 2 נוסעים"],
      [`${plus} 40,000 ש"ח תקציב`, "[טלפון הוסר] 40,000 ש\"ח תקציב"],
      [`${plus} 1948-1949`, "[טלפון הוסר] 1948-1949"],
      [`${plus} 14-18.2.2027`, "[טלפון הוסר] 14-18.2.2027"],
      [`${num("+972", " (0)52 ", "1234567")} 40 משתתפים`, "[טלפון הוסר] 40 משתתפים"],
    ] as const) {
      expect(scrubContacts(text).text, text).toBe(out);
    }
    // a number abroad is still of no fixed length; a +972 that is no Israeli number is still a phone
    expect(stripContacts(num("+44", " 20 ", "7946 0958")).text).toBe("");
    expect(hasContact(num("+972", " 1 ", "2345 6789"))).toBe(true);
  });
});

describe("סבב שישי, 5: a channel after «לא», «אין» or «בלי» is not asked for; phrases split at «, »", () => {
  it("«רק בוואטסאפ, לא להתקשר בשבת» → WhatsApp", () => {
    expect(splitPhrases("רק בוואטסאפ, לא להתקשר בשבת")).toEqual(["רק בוואטסאפ", "לא להתקשר בשבת"]);
    expect(channelOf("רק בוואטסאפ, לא להתקשר בשבת")).toBe("whatsapp");
    expect(suggestChannel(splitPhrases("רק בוואטסאפ, לא להתקשר בשבת").map((p) => ({ channel: channelOf(p), money: false })))).toBe("whatsapp");
    expect(channelOf("בלי טלפון, רק מייל")).toBe("email");
    expect(channelOf("אין לו וואטסאפ")).toBeNull();
    expect(channelOf("לא כדאי להתקשר")).toBeNull();
    expect(channelOf("ולא במייל — דרך המזכירה")).toBe("secretary");
    expect(channelOf("להתקשר, לא לשלוח הודעה")).toBe("phone");
  });
});
