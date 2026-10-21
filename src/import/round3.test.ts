// The import review's third round (DECISIONS «ביקורת: ייבוא ואבן דרך 6», סבב שלישי), each a rule with a test that fails
// without it: the XML tokenizer linear in a tag's length (and a tag's length bounded); a self-closing skipped mark never
// ends an outer skip; «שיעור להורים» after «כפולה»; «(כפולה)» set off in a title said; the escorts' guard from the
// header row down; a contact never an affiliation, a name or a title; the phone the choices give shown before the commit;
// an escort named by a word of the name. Synthetic names, numbers no one has («000-000-…»).
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CommandError } from "../data/commands";
import { DEFAULT_TITLES } from "../data/speakerRules";
import type { Speaker } from "../domain/types";
import { contextOf, previewCandidates, readCandidates } from "./candidates";
import { documentGrid, readDocx } from "./docxRead";
import { escortColumns, escortNames, escortsPayload, namedEscort, previewEscorts, readEscorts, splitPhrases } from "./escorts";
import { defaultMapping, findHeaderRow, type Mapping } from "./fields";
import { IMPORT_LIMITS } from "./limits";
import { hasContact, scrubContacts, stripContacts } from "./phone";
import { archivePayload, phonesAfterChoices, planLessons, previewTrackingSpeakers, readTracking } from "./tracking";
import { attributes, MAX_TAG } from "./xml";
import { readXlsx } from "./xlsxRead";

const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${(e as Error).message}`;
  }
};
const timed = (fn: () => unknown) => {
  const t0 = performance.now();
  const c = code(fn);
  return { code: c, ms: performance.now() - t0 };
};
const sp = (id: number, name: string, extra: Partial<Speaker> = {}): Speaker => ({
  id, title: null, name, disambiguator: null, gender: null, affiliation: null, bio_short: null, topics: [], contact_pref: null,
  vetted: "approved", vetted_by: null, vetted_note: null, retired: false, name_key: name, version: 1, ...extra,
});
const EMPTY = contextOf([], { phones: [], contacts: [] });
const H = ["מרצה", "שיעור ב", "כותרת", "מקורות (נשלח?)", "הסעה/תשלום", "טלפון", "קיבל הודעת סיכום מ", "נושא"];
const opts = { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true };
const track = (rows: string[][], o: Partial<Parameters<typeof readTracking>[2]> = {}) => readTracking([H, ...rows], defaultMapping("tracking", H, H.length), { ...opts, ...o });
/** A tracking row: speaker, when, title, phone — the rest empty. */
const r = (speaker: string, when: string, title = "", phone = "") => [speaker, when, title, "", "", phone, "", ""];
const plan = (read: ReturnType<typeof track>, skipped?: Set<string>) => planLessons(read, { decisions: new Map(), categories: new Map(), sources: new Map(), skipped })!;
const META = { label: "x", start_date: null, source: "x", titles_from: null };
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

describe("סבב שלישי: the XML tokenizer reads a tag in one pass, and a tag past 64K is no Office file", () => {
  it("attributes as before: both quotes, a prefix, spaces around «=», entities — and a name with no «=», or no quote, passed over", () => {
    expect(attributes(` w:val="a&amp;b" r:id='rId1'  x = "1" `)).toEqual({ "w:val": "a&b", "r:id": "rId1", x: "1" });
    expect(attributes(` lone b=unquoted c="ok" /`)).toEqual({ c: "ok" });
    expect(attributes(` a="1" a="2"`)).toEqual({ a: "2" });
    expect(attributes(` a="never closed`)).toEqual({});
  });

  it("the review's shape — one long attribute-like token in document.xml or in _rels/.rels — refused at once (a 476-byte .docx took 70 s)", () => {
    const k = 200_000;
    const docx = zipSync({ "word/document.xml": strToU8(`<w:document ${W}><w:body><w:p ${"a".repeat(k)}/><w:p><w:r><w:t>שם</w:t></w:r></w:p></w:body></w:document>`) }, { level: 9 });
    expect(docx.length).toBeLessThan(1000);
    const d = timed(() => readDocx(docx));
    expect(d.code).toBe("import_too_big");
    expect(d.ms).toBeLessThan(200);
    const xlsx = zipSync(
      {
        "_rels/.rels": strToU8(`<Relationships ${"b".repeat(k)}><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
        "xl/workbook.xml": strToU8('<workbook xmlns:r="r"><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      },
      { level: 9 },
    );
    const x = timed(() => readXlsx(xlsx).read(0));
    expect(x.code).toBe("import_too_big");
    expect(x.ms).toBeLessThan(200);
  });

  it("a token just under the bound is read in one pass (linear: 50,000 characters took 4 s before)", () => {
    const k = MAX_TAG - 100;
    const xml = `<w:document ${W}><w:body><w:p ${"a".repeat(k)}/><w:p ${"a=".repeat(k / 4)}/><w:p><w:r><w:t>שם</w:t></w:r></w:p></w:body></w:document>`;
    const t0 = performance.now();
    expect(documentGrid(xml)).toEqual([["שם"]]);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("סבב שלישי: a part of an Office file is refused past 4MB, all of them past 8MB («הצעה») — what is read takes under a second", () => {
  const sheet = (body: string) =>
    zipSync(
      {
        "_rels/.rels": strToU8('<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
        "xl/workbook.xml": strToU8('<workbook xmlns:r="r"><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>'),
        "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
        "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row r="1">${body}</row></sheetData></worksheet>`),
      },
      { level: 9 },
    );
  it("the review's floor: a small file of millions of empty cells — refused past the part's limit, read fast under it", () => {
    const MB = 1024 * 1024;
    expect(IMPORT_LIMITS.entryBytes).toBe(4 * MB);
    expect(IMPORT_LIMITS.totalBytes).toBe(8 * MB);
    const over = sheet("<c/>".repeat((5 * MB) / 4));
    expect(over.length).toBeLessThan(64 * 1024);
    expect(timed(() => readXlsx(over).read(0)).code).toBe("import_too_big");
    const under = timed(() => readXlsx(sheet("<c/>".repeat((3.9 * MB) / 4))).read(0));
    expect(under.code).toBe("ok");
    expect(under.ms).toBeLessThan(1500); // ~0.35 s here; 12MB of the same took 2.5 s inside the old limits
  });
});

describe("סבב שלישי: a self-closing skipped mark (a moved or deleted paragraph's mark) never ends an outer skip", () => {
  const box = (mark: string) =>
    `<w:document ${W}><w:body><w:p><w:r><w:t>שם</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>הערה</w:t></w:r></w:p>` +
    `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent><w:p><w:r><w:t>מרצה בתיבה</w:t></w:r></w:p></w:txbxContent></w:drawing></mc:Choice>` +
    `<mc:Fallback><w:pict><w:txbxContent><w:p><w:pPr><w:rPr>${mark}</w:rPr></w:pPr><w:r><w:t>מרצה בתיבה</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p></w:body></w:document>`;
  it("a text box's fallback copy stays unread with <w:moveFrom/> or <w:del/> in it", () => {
    for (const mark of ["", '<w:moveFrom w:id="1" w:author="x"/>', '<w:del w:id="1" w:author="x"/>']) {
      expect(documentGrid(box(mark)), mark).toEqual([["שם", "הערה"], ["מרצה בתיבה", ""]]);
    }
    // and a self-closing mark outside any skip skips nothing after it
    expect(documentGrid(`<w:document ${W}><w:body><w:p><w:pPr><w:rPr><w:del w:id="1"/></w:rPr></w:pPr><w:r><w:t>נשאר</w:t></w:r></w:p></w:body></w:document>`)).toEqual([["נשאר"]]);
  });
});

describe("סבב שלישי: «שיעור להורים» read on the same string the note is built from — after «כפולה» too", () => {
  it("every case of the review's probe", () => {
    const cases: [string, string, string | null, boolean][] = [
      ["שני 20:00 שיעור להורים", "שיעור", "שיעור להורים", false],
      ["שני 20:00 (שיעור להורים)", "שיעור", "שיעור להורים", false],
      ["שני 20:00 - שיעור להורים", "שיעור", "שיעור להורים", false],
      ["שני 20:00 כפולה שיעור להורים", "שיעור", "שיעור להורים", false],
      ["שני 20:00 - כפולה, שיעור להורים", "שיעור", "שיעור להורים", false],
      ["שני 20:00 שיעור להורים כפולה", "שיעור", "שיעור להורים", false],
      ["שני 20:00 לשיעור להורים", "שיעור", null, true],
      ["שיעור להורים שני 20:00", "שיעור", "שיעור להורים", false],
      ["שני 20:00", "שיעור להורים: חינוך היום", "שיעור להורים", false],
      ["שני 20:00", "מה ראינו בשיעור להורים אשתקד", null, false],
    ];
    const read = track(cases.map(([w, t], i) => r(`מרצה פרובה ${String.fromCharCode(0x5d0 + i)}`, w, t)));
    expect(read.rows.map((x) => [x.audience, x.notes.length > 0])).toEqual(cases.map(([, , a, note]) => [a, note]));
    // never lost without a trace: the marker is the audience, or the cell is kept in the note
    expect(read.rows.every((x) => x.audience != null || x.notes.length > 0 || !/להורים/.test(x.when?.rest ?? ""))).toBe(true);
  });
});

describe("סבב שלישי: «(כפולה)» set off in a title — the title whole, the row single, and the lesson says so", () => {
  it("«נאמנות (כפולה)», «שיעור - כפולה»: a warning on the lesson; «זהות כפולה» (a word of the title) and a real marker: none", () => {
    const read = track([r("דוגמה אלף", "שלישי 10:00", "נאמנות (כפולה)"), r("דוגמה בית", "שלישי 11:30", "שיעור - כפולה"), r("דוגמה גימל", "שלישי 13:00", "זהות כפולה"), r("דוגמה דלת", "שלישי 20:00 כפולה", "אמונה (כפולה)")]);
    const said = "בכותרת כתוב «כפולה» — השורה לא סומנה ככפולה. אם זו כפולה, כותבים «כפולה» בעמודת «שיעור ב»";
    expect(read.rows.map((x) => [x.title, x.double, x.warnings.includes(said)])).toEqual([
      ["נאמנות (כפולה)", false, true],
      ["שיעור - כפולה", false, true],
      ["זהות כפולה", false, false],
      ["אמונה (כפולה)", true, false],
    ]);
    const plans = planLessons(read, { decisions: new Map([[5, "parallel"]]), categories: new Map(), sources: new Map() })!;
    expect(plans[0].warnings).toContain(said); // on the lesson, where the admin reads it
  });
});

describe("סבב שלישי: the escorts' guard reads the header row chosen and below — never a title above it", () => {
  it("a title paragraph «מלווים» / «מלווה» / «מלווים 2026» over the table: «מרצה» mappable, «מלווה» not", () => {
    for (const title of ["מלווים", "מלווה", "מלווים 2026"]) {
      const grid = [[title, "", ""], ["מרצה", "מלווה", "הערות"], ["מרצה 07", "חניכה לדוגמה", "דרך המזכירה"]];
      expect(findHeaderRow("escorts", grid), title).toBe(1);
      expect([...escortColumns(grid, 1)], title).toEqual([1]);
      // no header row chosen: the title's column is blocked, on the safe side — the header row is the way out
      expect([...escortColumns(grid, null)], title).toEqual([0, 1]);
    }
    // the rows above the header row are not looked at: a title over another column blocks nothing
    expect([...escortColumns([["", "", "מלווים"], ["מרצה", "מלווה", "הערות"], ["מרצה 07", "חניכה לדוגמה", "דרך המזכירה"]], 1)]).toEqual([1]);
    // a field's own header in the row chosen is never blocked, whatever a row below says
    expect([...escortColumns([["מרצה", "הערות"], ["מלווה", "דרך המזכירה"]], 0)]).toEqual([]);
  });
});

describe("סבב שלישי: a second line — an affiliation only in brackets or with an institution's word; any other waits", () => {
  it("«ישיבת…», «מכון…» an affiliation; a name new to the sheet and the pool undecided — neither, until chosen", () => {
    const read = track([r("דוגמה אלף\nישיבת הר לדוגמה", "ראשון 8:30"), r("רחל בדיקתית\nלאה ניסויית", "ראשון 10:00", "", "000-000-0021")]);
    expect(read.lines.map((l) => [l.text, l.as])).toEqual([
      ["ישיבת הר לדוגמה", "affiliation"],
      ["לאה ניסויית", null],
    ]);
    expect(read.speakers.map((s) => [s.key, s.affiliation])).toEqual([
      ["דוגמה אלף", "ישיבת הר לדוגמה"],
      ["רחל בדיקתית", null],
    ]);
    // chosen a speaker: two in the row, the phone waits for the choices
    const two = track([r("רחל בדיקתית\nלאה ניסויית", "ראשון 10:00", "", "000-000-0021")], { lineAs: new Map([["2:2", "speaker"]]) });
    expect(two.speakers.map((s) => s.key)).toEqual(["רחל בדיקתית", "לאה ניסויית"]);
  });
});

describe("סבב שלישי: a phone or an e-mail in the speaker's cell is never an affiliation, a name or a title", () => {
  it("a phone line, an e-mail line, «(טל' …)»: out of the cell — the row's phone (its column empty), the speaker's e-mail; never «שיוך מוסדי»", () => {
    const read = track([
      r("הרב בדיקה טלפוני\n000-000-0091", "ראשון 8:30", "שורה שנייה טלפון"),
      r("ד״ר בדיקה מיילית\nsomeone@example.org", "ראשון 10:00", "שורה שנייה מייל"),
      r("מרצה 07\n(טל' 000-000-0095)", "ראשון 11:30", "בסוגריים", "000-000-0096"),
      r("הרב בדיקה שורתי 000-000-0081", "ראשון 13:00-14:30", "טלפון ליד השם"),
      r("דוגמה אלף", "ראשון 14:30", "כותרת 000-000-0082"),
    ]);
    expect(read.lines).toEqual([]);
    expect(read.speakers.map((s) => [s.key, s.affiliation, s.phone, s.email])).toEqual([
      ["בדיקה טלפוני", null, "0000000091", null],
      ["בדיקה מיילית", null, null, "someone@example.org"],
      ["מרצה 07", null, "0000000096", null], // the column's own phone; the cell's other one dropped
      ["בדיקה שורתי", null, "0000000081", null],
      ["דוגמה אלף", null, null, null],
    ]);
    expect(read.rows.map((x) => x.warnings)).toEqual([
      ["הטלפון שבתא המרצה נלקח כטלפון של השורה"],
      ["המייל שבתא המרצה נשמר כמייל של המרצה"],
      ["הוסר טלפון מתא המרצה — לא נשמר"],
      ["הטלפון שבתא המרצה נלקח כטלפון של השורה"],
      ["הוסר טלפון או מייל מהכותרת — לא נשמר"],
    ]);
    const p = archivePayload(plan(read), previewTrackingSpeakers(read, EMPTY), new Map(), META)!;
    for (const s of p.speakers) for (const f of [s.name, s.title, s.affiliation, ...s.topics, s.notes]) expect(hasContact(f), String(f)).toBe(false);
    for (const l of p.lessons) for (const f of [l.title, l.audience, l.sources_note, l.import_note]) expect(hasContact(f), String(f)).toBe(false);
    expect(p.lessons.map((l) => l.title)).toEqual(["שורה שנייה טלפון", "שורה שנייה מייל", "בסוגריים", "טלפון ליד השם", "כותרת"]);
  });

  it("the candidates: a phone beside the name is the row's (its column empty) — or dropped, and said; the other fields lose theirs", () => {
    const head = ["מרצה", "טלפון", "מוסד", "נושאים", "הערות"];
    const m: Mapping = ["name", "phone", "affiliation", "topics", "note"];
    const read = readCandidates(
      [
        head,
        ["הרבנית בדיקה מועמדת 000-000-0082", "", "ישיבת דוגמה, טל: 000-000-0083", "תנ״ך, 000-000-0084", "להתקשר אחרי 20:00 למספר 000-000-0085"],
        ["הרב בדיקה שנייה someone@example.org 000-000-0086", "000-000-0087", "", "", ""],
      ],
      m,
      { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true },
    );
    expect(read.map((x) => x.data && [x.data.name, x.data.phone, x.data.email, x.data.affiliation, x.data.topics, x.data.notes])).toEqual([
      ["בדיקה מועמדת", "0000000082", null, "ישיבת דוגמה", ["תנ״ך"], "הערות: להתקשר אחרי 20:00 למספר [טלפון הוסר]"],
      ["בדיקה שנייה", "0000000087", "someone@example.org", null, [], null],
    ]);
    expect(read[0].warnings).toEqual(["הוסר טלפון או מייל מ«מוסד» — לא נשמר", "הוסר טלפון או מייל מ«נושאים» — לא נשמר", "הטלפון שהיה בתא השם נשמר כטלפון של המרצה", "הוסר טלפון או מייל מההערה — לא נשמר"]);
    expect(read[1].warnings).toEqual(["הוסר טלפון מתא השם — לא נשמר", "המייל שהיה בתא השם נשמר כמייל של המרצה"]);
    expect(previewCandidates(read, EMPTY).map((x) => x.status)).toEqual(["new", "new"]);
  });

  it("stripContacts: the labels and brackets go with them; two numbers in one cell; a second line; a date, a range of years or times stay", () => {
    expect(stripContacts("(טל' 000-000-0095)")).toEqual({ text: "", phones: ["000-000-0095"], emails: [] });
    // «/» between two numbers, a space beside it (סבב חמישי): two phones — a number of no fixed length never runs into the next
    expect(stripContacts("פלוני אלמוני - 000-000-0001 / 000-000-0002")).toEqual({ text: "פלוני אלמוני", phones: ["000-000-0001", "000-000-0002"], emails: [] });
    expect(stripContacts("פלוני אלמוני - 000-000-0001, 000-000-0002")).toEqual({ text: "פלוני אלמוני", phones: ["000-000-0001", "000-000-0002"], emails: [] });
    expect(stripContacts("פלוני\nמייל: someone@example.org")).toEqual({ text: "פלוני", phones: [], emails: ["someone@example.org"] });
    expect(stripContacts("+972-00-000-0003 או 000-000-0004").text).toBe("");
    for (const t of ["12.3.2026 20:00", "1948-1967", "8.30-10.00", "תשפ״ו 2025–2026"]) {
      expect(hasContact(t), t).toBe(false);
      expect(stripContacts(t).text).toBe(t);
    }
    // a bidi mark or a non-breaking hyphen between the digits is still a number
    expect(hasContact("000‏-‏000‏-0005")).toBe(true);
    expect(hasContact("000‑000‑0006")).toBe(true);
    expect(scrubContacts("לפני 000‑000‑0006 אחרי").text).toBe("לפני [טלפון הוסר] אחרי");
  });
});

describe("סבב שלישי: the phone the choices give is shown on its speaker before «ייבוא» — what the payload sends", () => {
  it("a row of two, one left: «יש טלפון (משורה N, אחרי הבחירות)» comes from the same map the payload uses", () => {
    const read = track([r("מרצה 07 + זיטה חדשה לגמרי", "ראשון 8:30", "", "000-000-0097")]);
    const plans = plan(read, new Set(["זיטה חדשה לגמרי"]));
    expect([...phonesAfterChoices(plans)]).toEqual([["מרצה 07", { value: "0000000097", key: "0000000097", row: 2 }]]);
    const pool = [sp(7, "מרצה 07")];
    const speakers = previewTrackingSpeakers(read, contextOf(pool, { phones: [], contacts: [] }));
    const p = archivePayload(plans, speakers, new Map([["זיטה חדשה לגמרי", { action: "skip" as const }]]), META)!;
    expect(p.speakers.map((s) => [s.name, s.phone])).toEqual([["מרצה 07", "0000000097"]]);
  });
});

describe("סבב שלישי: an escort is named by ANY word of the name — a first name, a surname, a messy cell", () => {
  const grid = [
    ["מרצה", "מלווה", "הערות"],
    ["מרצה 01", "חניך לדוגמה 000-000-0001", "לתאם עם חניך בוואטסאפ"],
    ["מרצה 02", "חניכה דוגמנית (שנה ב)", "דוגמנית תתקשר ערב לפני דרך המזכירה"],
    ["מרצה 03", "חניך גימל וחניכה דלת", "לתאם מול חניכה דלת בטלפון"],
    ["מרצה 04", "חניך הא - 000-000-0002", "חניך הא יתאם במייל"],
    ["מרצה 05", "אין", "אין לו וואטסאפ — רק דרך המזכירה"],
    ["מרצה 06", "מגיע לבד", "רק במייל"],
    ["מרצה 07", "ח. לדוגמה", "ח. לדוגמה במייל"],
  ];
  const m: Mapping = ["speaker", null, "phrases"];
  const rows = readEscorts(grid, m, { headerRow: 0, titles: DEFAULT_TITLES });
  const names = escortNames(grid, 0, escortColumns(grid, 0));

  it("the names: digits, phones and brackets out, «ו» and « - » split, «אין» and «מגיע לבד» no one's", () => {
    expect(names).toEqual(["חניך לדוגמה", "חניכה דוגמנית", "חניך גימל וחניכה דלת", "חניך הא", "ח. לדוגמה"]);
    expect(splitPhrases("ח. לדוגמה במייל. רק בערב")).toEqual(["ח. לדוגמה במייל", "רק בערב"]); // an initial is no sentence end
  });

  it("a first name or a surname alone is said beside the phrase; a filler value names no one (a warning — nothing of the file is saved, סבב רביעי)", () => {
    const pool = [1, 2, 3, 4, 5, 6, 7].map((i) => sp(i, `מרצה 0${i}`));
    const ctx = contextOf(pool, { phones: [], contacts: [] });
    const ps = previewEscorts(rows, ctx, names).flatMap((x) => x.phrases);
    expect(ps.map((p) => [p.text, p.escort])).toEqual([
      ["לתאם עם חניך בוואטסאפ", "חניך"],
      ["דוגמנית תתקשר ערב לפני דרך המזכירה", "דוגמנית"],
      ["לתאם מול חניכה דלת בטלפון", "חניכה"],
      ["חניך הא יתאם במייל", "חניך"],
      ["אין לו וואטסאפ — רק דרך המזכירה", null], // «אין» in the escorts' column is nobody's name
      ["רק במייל", null],
      ["ח. לדוגמה במייל", "לדוגמה"],
    ]);
    expect(namedEscort("שירה תתקשר יום לפני דרך המזכירה", ["שירה לדוגמה"])).toBe("שירה");
    expect(namedEscort("להתקשר לשירה דרך המזכירה", ["שירה לדוגמה"])).toBe("שירה"); // a prefix letter
    expect(namedEscort("לדוגמה: דרך המזכירה", ["שירה לדוגמה"])).toBe("לדוגמה");
    expect(namedEscort("דרך המזכירה", ["שירה לדוגמה"])).toBeNull();
  });

  it("the payload is the channel chosen and the admin's own note — no escort's word, whatever the phrases said", () => {
    const pool = [1, 2, 3, 4, 5, 6, 7].map((i) => sp(i, `מרצה 0${i}`));
    const ctx = contextOf(pool, { phones: [], contacts: [] });
    const preview = previewEscorts(rows, ctx, names);
    const answers = new Map(preview.map((x) => [x.key, { channel: x.suggested, note: "" }]));
    const payload = escortsPayload(preview, new Map(), answers)!;
    expect(payload.rows.map((x) => [x.row, x.channel, x.note])).toEqual([
      [2, "whatsapp", null],
      [3, "secretary", null],
      [4, "phone", null],
      [5, "email", null],
      [7, "email", null],
      [8, "email", null],
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/[א-ת]/); // not one Hebrew letter of the file
  });
});
