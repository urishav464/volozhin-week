// An uploaded .xlsx or .docx, read by our own small readers on fflate: what they read, and every way a file is
// refused — not a zip, encrypted, zip64, too many parts, a part that inflates past its limit whatever the zip says
// (a zip bomb), a broken deflate stream, a DOCTYPE. Every file here is built in the test, synthetic.
import { deflateSync, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CommandError } from "../data/commands";
import { toXlsx } from "../exports/xlsx";
import { readDocx, documentGrid } from "./docxRead";
import { IMPORT_LIMITS } from "./limits";
import { readXlsx, numberText, serialText, cellRef } from "./xlsxRead";
import { xmlEvents, unescapeXml } from "./xml";
import { boundedInflate, newBudget, readEntry, zipEntries } from "./zip";

const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${(e as Error).message}`;
  }
};

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A workbook from its parts — sheets by name, a shared strings part and a styles part when given. */
function workbook(sheets: [string, string][], extra: { shared?: string; styles?: string } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook ${NS}><sheets>${sheets.map(([n], i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}<Relationship Id="rS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rT" Type="${REL}/styles" Target="/xl/styles.xml"/></Relationships>`,
    ),
  };
  sheets.forEach(([, xml], i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet ${NS}>${xml}</worksheet>`)));
  if (extra.shared) files["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst ${NS}>${extra.shared}</sst>`);
  if (extra.styles) files["xl/styles.xml"] = strToU8(`<?xml version="1.0"?><styleSheet ${NS}>${extra.styles}</styleSheet>`);
  return zipSync(files);
}

/** The central directory entry of `name`: its declared uncompressed size rewritten (a zip that lies). */
function lieAboutSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = zip.slice();
  const target = strToU8(name);
  for (let o = 0; o + 46 < out.length; o++) {
    if (out[o] !== 0x50 || out[o + 1] !== 0x4b || out[o + 2] !== 0x01 || out[o + 3] !== 0x02) continue;
    const len = out[o + 28] | (out[o + 29] << 8);
    if (len === target.length && target.every((b, i) => out[o + 46 + i] === b)) {
      new DataView(out.buffer).setUint32(o + 24, size, true);
      return out;
    }
  }
  throw new Error(`no entry ${name}`);
}

describe("xml — the tokenizer the readers share", () => {
  it("reads tags, attributes, text, CDATA and the five entities and character references — nothing else expands", () => {
    const ev = [...xmlEvents('<?xml version="1.0"?><a x="1" y=\'&lt;2&gt;\'><b/>t&amp;t<![CDATA[<raw>]]>&#x5D0;&#1489;&custom;<!-- c --></a>')];
    expect(ev).toEqual([
      { t: "open", name: "a", attrs: { x: "1", y: "<2>" }, self: false },
      { t: "open", name: "b", attrs: {}, self: true },
      { t: "close", name: "b" },
      { t: "text", v: "t&t" },
      { t: "text", v: "<raw>" },
      { t: "text", v: "אב&custom;" },
      { t: "close", name: "a" },
    ]);
    expect(unescapeXml("&#0;&#x110000;")).toBe("");
  });

  it("refuses a DOCTYPE (no entity is ever declared, so none can blow up) and a tag that never closes", () => {
    expect(code(() => [...xmlEvents('<!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>')])).toBe("import_bad_file");
    expect(code(() => [...xmlEvents("<a><b")])).toBe("import_bad_file");
    expect(code(() => [...xmlEvents("<a><!-- never")])).toBe("import_bad_file");
  });
});

describe("zip — the parts, read with care", () => {
  it("lists the parts without inflating any, and reads one", () => {
    const z = zipSync({ "a.txt": strToU8("שלום"), "b.txt": strToU8("x") });
    const entries = zipEntries(z);
    expect(entries.map((e) => e.name)).toEqual(["a.txt", "b.txt"]);
    expect(new TextDecoder().decode(readEntry(z, entries[0], newBudget()))).toBe("שלום");
  });

  it("refuses what is not a zip, a zip64 directory, too many parts, an encrypted part", () => {
    expect(code(() => zipEntries(strToU8("not a zip at all, just text")))).toBe("import_bad_file");
    const z = zipSync({ "a.txt": strToU8("x") });
    const z64 = z.slice();
    const eocd = z64.length - 22;
    z64[eocd + 10] = 0xff;
    z64[eocd + 11] = 0xff;
    expect(code(() => zipEntries(z64))).toBe("import_bad_file");
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i <= IMPORT_LIMITS.zipEntries; i++) many[`f${i}`] = new Uint8Array(0);
    expect(code(() => zipEntries(zipSync(many, { level: 0 })))).toBe("import_too_big");
    const enc = z.slice();
    const cd = zipEntries(z)[0];
    enc[cd.offset + 6] |= 1; // the local header's flag
    const encEntries = zipEntries(z).map((e) => ({ ...e, flags: e.flags | 1 }));
    expect(code(() => readEntry(enc, encEntries[0], newBudget()))).toBe("import_encrypted");
    expect(code(() => zipEntries(new Uint8Array(IMPORT_LIMITS.fileBytes + 1)))).toBe("import_too_big");
  });

  it("stops inflating past the limit, whatever the zip says — a zip bomb costs a limit's worth, never the bomb", () => {
    const zeros = new Uint8Array(IMPORT_LIMITS.entryBytes + 1024 * 1024);
    const bomb = zipSync({ "xl/worksheets/sheet1.xml": zeros });
    expect(bomb.length).toBeLessThan(200_000);
    // the truth: refused before inflating
    expect(code(() => readEntry(bomb, zipEntries(bomb)[0], newBudget()))).toBe("import_too_big");
    // a lie: «100 bytes» — the inflate itself stops at the limit
    const liar = lieAboutSize(bomb, "xl/worksheets/sheet1.xml", 100);
    expect(zipEntries(liar)[0].size).toBe(100);
    expect(code(() => readEntry(liar, zipEntries(liar)[0], newBudget()))).toBe("import_too_big");
    expect(code(() => boundedInflate(deflateSync(new Uint8Array(100_001)), 100_000))).toBe("import_too_big");
    expect(boundedInflate(deflateSync(new Uint8Array(100_000)), 100_000)).toHaveLength(100_000);
    // the budget across parts: two parts each under the part limit, together over what is left
    const two = zipSync({ a: new Uint8Array(1000), b: new Uint8Array(1000) });
    const budget = { left: 1500 };
    const [a, b] = zipEntries(two);
    readEntry(two, a, budget);
    expect(code(() => readEntry(two, b, budget))).toBe("import_too_big");
  });

  it("refuses a deflate stream cut short or broken", () => {
    const data = deflateSync(strToU8("שלום ".repeat(1000)));
    expect(code(() => boundedInflate(data.subarray(0, data.length >> 1), 1e6))).toBe("import_bad_file");
    expect(code(() => boundedInflate(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 1e6))).toBe("import_bad_file");
  });
});

describe("readXlsx — a workbook's cells as text", () => {
  it("reads a file our own writer made (inline strings), its first sheet", () => {
    const bytes = toXlsx([{ name: "מעקב", headers: ["מרצה", "שיעור ב"], rows: [["מרצה לדוגמה 1", "ראשון 8:30"]] }]);
    const book = readXlsx(bytes);
    expect(book.sheets.map((s) => s.name)).toEqual(["מעקב"]);
    expect(book.read()).toEqual([
      ["מרצה", "שיעור ב"],
      ["מרצה לדוגמה 1", "ראשון 8:30"],
    ]);
  });

  it("shared strings (rich text joined, phonetic runs never), numbers as typed, a time and a date by their format, booleans", () => {
    const shared = '<si><t>מרצה</t></si><si><r><t>מרצה </t></r><r><rPr><b/></rPr><t xml:space="preserve">לדוגמה 2</t></r><rPh><t>X</t></rPh></si>';
    const styles = '<numFmts count="1"><numFmt numFmtId="164" formatCode="[$-he-IL]h:mm;@"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/><xf numFmtId="0"/></cellXfs>';
    const sheet =
      '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>טלפון</t></is></c><c r="C1" t="inlineStr"><is><t>שעה</t></is></c><c r="D1" t="inlineStr"><is><t>תאריך</t></is></c><c r="E1" t="inlineStr"><is><t>?</t></is></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>111111111</v></c><c r="C3" s="1"><v>0.35416666666666669</v></c><c r="D3" s="2"><v>46081</v></c><c r="E3" t="b"><v>1</v></c><c r="F3"><f>1+1</f><v>2</v></c></row></sheetData>';
    const grid = readXlsx(workbook([["גיליון1", sheet]], { shared, styles })).read();
    expect(grid).toEqual([
      ["מרצה", "טלפון", "שעה", "תאריך", "?", ""],
      ["מרצה לדוגמה 2", "111111111", "08:30", "2026-02-28", "✓", "2"],
    ]);
    expect(numberText("5.01E8")).toBe("501000000");
    expect(numberText("0.1000000000000000055")).toBe("0.1");
    expect(serialText("0.9993055555555556")).toBe("23:59");
    expect(serialText("46081.5")).toBe("2026-02-28 12:00");
    expect(serialText("45658")).toBe("2025-01-01");
    expect(cellRef("AB12")).toEqual([11, 27]);
  });

  it("reads a checkbox as «✓» or nothing — never TRUE/FALSE — and drops a row of checkboxes alone (Google Sheets runs them to row 999)", () => {
    const box = (ref: string, v: 0 | 1) => `<c r="${ref}" t="b"><v>${v}</v></c>`;
    const text = (ref: string, t: string) => `<c r="${ref}" t="inlineStr"><is><t>${t}</t></is></c>`;
    const sheet =
      `<sheetData><row r="1">${text("A1", "שם המרצה")}${text("B1", "תשלום ?")}</row>` +
      `<row r="2">${text("A2", "מרצה לדוגמה")}${box("B2", 1)}</row>` +
      `<row r="3">${text("A3", "מרצה אחר לדוגמה")}${box("B3", 0)}</row>` +
      `<row r="4">${box("A4", 0)}${box("B4", 1)}</row>` +
      `<row r="999">${box("A999", 0)}${box("B999", 0)}</row></sheetData>`;
    expect(readXlsx(workbook([["מעקב", sheet]])).read()).toEqual([
      ["שם המרצה", "תשלום ?"],
      ["מרצה לדוגמה", "✓"],
      ["מרצה אחר לדוגמה", ""],
    ]);
  });

  it("lists every sheet and reads a chosen one; a merge gives its value to each row down its first column", () => {
    const one = '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ראשון</t></is></c></row></sheetData>';
    const two =
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>שני</t></is></c><c r="B1" t="inlineStr"><is><t>8:30</t></is></c></row><row r="2"><c r="B2" t="inlineStr"><is><t>10:00</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:A2"/></mergeCells>';
    const book = readXlsx(workbook([["א", one], ["ב", two]]));
    expect(book.sheets.map((s) => s.name)).toEqual(["א", "ב"]);
    expect(book.read(1)).toEqual([
      ["שני", "8:30"],
      ["שני", "10:00"],
    ]);
    expect(book.read(0)).toEqual([["ראשון"]]);
  });

  it("refuses a workbook with no sheet, a sheet with cells past the limits, a part that is not XML", () => {
    expect(code(() => readXlsx(workbook([])))).toBe("import_bad_file");
    const far = `<sheetData><row r="${IMPORT_LIMITS.rows + 1}"><c r="A${IMPORT_LIMITS.rows + 1}" t="inlineStr"><is><t>x</t></is></c></row></sheetData>`;
    expect(code(() => readXlsx(workbook([["x", far]])).read())).toBe("import_too_big");
    const wide = `<sheetData><row r="1"><c r="ZZ1" t="inlineStr"><is><t>x</t></is></c></row></sheetData>`;
    expect(code(() => readXlsx(workbook([["x", wide]])).read())).toBe("import_too_big");
    expect(code(() => readXlsx(workbook([["x", "<sheetData><row"]])).read())).toBe("import_bad_file");
    expect(code(() => readXlsx(zipSync({ "a.txt": strToU8("x") })))).toBe("import_bad_file");
  });

  it("refuses a small file of very many merges (each a column down a sheet) instead of freezing on them", () => {
    const head = '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>שני</t></is></c></row></sheetData>';
    const many = `${head}<mergeCells>${'<mergeCell ref="A1:A3000"/>'.repeat(30)}</mergeCells>`;
    expect(code(() => readXlsx(workbook([["גיליון", many]])).read(0))).toBe("import_too_big");
    const few = `${head}<mergeCells><mergeCell ref="A1:A3"/></mergeCells>`;
    expect(readXlsx(workbook([["גיליון", few]])).read(0)).toEqual([["שני"], ["שני"], ["שני"]]);
  });

  it("a styled empty sheet far down costs nothing: only cells with a value count", () => {
    const sheet = '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row><row r="900000"><c r="XFD900000" s="1"/></row></sheetData>';
    expect(readXlsx(workbook([["x", sheet]])).read()).toEqual([["x"]]);
  });
});

describe("readDocx — paragraphs and table cells as text", () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
  const p = (...runs: string[]) => `<w:p><w:r>${runs.join("")}</w:r></w:p>`;
  const t = (s: string) => `<w:t xml:space="preserve">${s}</w:t>`;
  const tc = (body: string, pr = "") => `<w:tc><w:tcPr>${pr}</w:tcPr>${body}</w:tc>`;

  it("a paragraph is a row (its tabs make cells), a table row is a row; spans, merges and nested tables", () => {
    const xml =
      `<w:document ${W}><w:body>` +
      p(t("מרצה"), "<w:tab/>", t("הערות")) +
      p(t("מרצה לדוגמה 1"), "<w:tab/>", t("דרך"), t(" המזכירה")) +
      "<w:tbl><w:tr>" +
      tc(p(t("מרצה לדוגמה 2")), '<w:vMerge w:val="restart"/>') +
      tc(p(t("רק")) + p(t("בוואטסאפ")), '<w:gridSpan w:val="2"/>') +
      "</w:tr><w:tr>" +
      tc(p(""), "<w:vMerge/>") +
      tc(p(t("א"), "<w:br/>", t("ב"))) +
      tc("<w:tbl><w:tr>" + tc(p(t("פנימי"))) + "</w:tr></w:tbl>" + p(t("אחרי"))) +
      "</w:tr></w:tbl>" +
      `</w:body></w:document>`;
    expect(documentGrid(xml)).toEqual([
      ["מרצה", "הערות", ""],
      ["מרצה לדוגמה 1", "דרך המזכירה", ""],
      ["מרצה לדוגמה 2", "רק\nבוואטסאפ", ""],
      ["מרצה לדוגמה 2", "א\nב", "פנימי\nאחרי"],
    ]);
  });

  it("never the deleted text of tracked changes, a text box's fallback copy, or a field's instruction", () => {
    const xml =
      `<w:document ${W}><w:body>` +
      p(t("נשאר"), `<w:del><w:r><w:delText>נמחק</w:delText></w:r></w:del>`) +
      `<w:p><w:r><mc:AlternateContent><mc:Choice>${t("תיבה")}</mc:Choice><mc:Fallback>${t("עותק")}</mc:Fallback></mc:AlternateContent></w:r></w:p>` +
      p("<w:instrText>HYPERLINK x</w:instrText>", t("קישור")) +
      `</w:body></w:document>`;
    expect(documentGrid(xml)).toEqual([["נשאר"], ["תיבה"], ["קישור"]]);
  });

  it("reads a real Word file (made with the docx package) through its zip", async () => {
    const { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } = await import("docx");
    const cell = (s: string) => new TableCell({ children: [new Paragraph({ children: [new TextRun(s)] })] });
    const doc = new Document({
      sections: [{ children: [new Paragraph("קובץ המלווים לדוגמה"), new Table({ rows: [new TableRow({ children: [cell("מרצה"), cell("מלווה"), cell("הערות")] }), new TableRow({ children: [cell("מרצה לדוגמה 1"), cell("חניך/ה לדוגמה"), cell("דרך המזכירה")] })] })] }],
    });
    const grid = readDocx(new Uint8Array(await Packer.toArrayBuffer(doc)));
    expect(grid).toEqual([
      ["קובץ המלווים לדוגמה", "", ""],
      ["מרצה", "מלווה", "הערות"],
      ["מרצה לדוגמה 1", "חניך/ה לדוגמה", "דרך המזכירה"],
    ]);
  });

  it("a paragraph's tab STOPS are not tabs: a header without them and lines with them (a list, a tracked change) line up", () => {
    const stops = '<w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/><w:tab w:val="clear" w:pos="1440"/></w:tabs><w:bidi/></w:pPr>';
    const changed = '<w:pPr><w:pPrChange w:id="1"><w:pPr><w:tabs><w:tab w:val="right" w:pos="4320"/></w:tabs></w:pPr></w:pPrChange></w:pPr>';
    const row = (pr: string, a: string, b: string) => `<w:p>${pr}<w:r>${t(a)}</w:r><w:r><w:tab/></w:r><w:r>${t(b)}</w:r></w:p>`;
    const xml = `<w:document ${W}><w:body>${row("", "שם", "הערה")}${row(stops, "מרצה א לדוגמה", "דרך המזכירה")}${row(changed, "מרצה ב לדוגמה", "רק בוואטסאפ")}<w:p><w:pPr><w:tabs/></w:pPr></w:p></w:body></w:document>`;
    expect(documentGrid(xml)).toEqual([
      ["שם", "הערה"],
      ["מרצה א לדוגמה", "דרך המזכירה"],
      ["מרצה ב לדוגמה", "רק בוואטסאפ"],
    ]);
  });

  it("refuses millions of empty paragraphs as they come — not after building them all", () => {
    // past the limit, then a broken tag: refused at the limit, before the reader ever gets to the end
    const xml = `<w:document ${W}><w:body>${"<w:p></w:p>".repeat(IMPORT_LIMITS.rows * 4 + 1)}<w:p><w:r`;
    expect(code(() => documentGrid(xml))).toBe("import_too_big");
    expect(code(() => documentGrid(`<w:document ${W}><w:body><w:p></w:p><w:p><w:r`))).not.toBe("import_too_big");
  });

  it("refuses a package with no document, and a document past the limits", () => {
    expect(code(() => readDocx(zipSync({ "_rels/.rels": strToU8("<Relationships/>") })))).toBe("import_bad_file");
    const rows = Array.from({ length: IMPORT_LIMITS.rows + 1 }, (_, i) => p(t(`שורה ${i}`))).join("");
    const big = zipSync({ "word/document.xml": strToU8(`<w:document ${W}><w:body>${rows}</w:body></w:document>`) });
    expect(code(() => readDocx(big))).toBe("import_too_big");
  });
});

describe("סבב שני: a small file that multiplies a long cell or a row's width is refused at once — never read for seconds first", () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const docx = (body: string) => zipSync({ "word/document.xml": strToU8(`<w:document ${W}><w:body>${body}</w:body></w:document>`) });
  /** The refusal (or "ok") and how long it took. */
  const timed = (fn: () => unknown) => {
    const t0 = performance.now();
    const c = code(fn);
    return { code: c, ms: performance.now() - t0 };
  };
  /** A sheet of `cells` cells (60 a row), each pointing to the one shared string of `chars` characters. */
  const shared = (cells: number, chars: number) => {
    const col = (c: number) => (c < 26 ? String.fromCharCode(65 + c) : `A${String.fromCharCode(65 + c - 26)}`);
    let rows = "";
    for (let r = 0; r * 60 < cells; r++) {
      let cs = "";
      for (let c = 0; c < 60 && r * 60 + c < cells; c++) cs += `<c r="${col(c)}${r + 1}" t="s"><v>0</v></c>`;
      rows += `<row r="${r + 1}">${cs}</row>`;
    }
    return workbook([["s", `<sheetData>${rows}</sheetData>`]], { shared: `<si><t>${"א".repeat(chars)}</t></si>` });
  };

  it("an .xlsx of 3,000 cells pointing to one 5,000,000-character string: refused at the first cell (it took 40 s)", () => {
    const r = timed(() => readXlsx(shared(3000, 5_000_000)).read(0));
    expect(r.code).toBe("import_too_big");
    expect(r.ms).toBeLessThan(3000);
  });

  it("every cell within its limit, together past the table's text: refused as the cells are put", () => {
    expect(code(() => readXlsx(shared(1200, 4_999)).read(0))).toBe("import_too_big");
    expect(readXlsx(shared(120, 4_999)).read(0)).toHaveLength(2); // a long cell, a few times: read
  });

  it("a .docx row of gridSpan cells, a paragraph of tabs, tables nested deep: refused as they come (they read as an empty table)", () => {
    expect(code(() => readDocx(docx(`<w:tbl><w:tr>${'<w:tc><w:tcPr><w:gridSpan w:val="60"/></w:tcPr><w:p/></w:tc>'.repeat(5000)}</w:tr></w:tbl>`)))).toBe("import_too_big");
    expect(code(() => readDocx(docx(`<w:p><w:r>${"<w:tab/>".repeat(100_000)}</w:r></w:p>`)))).toBe("import_too_big");
    expect(code(() => readDocx(docx("<w:tbl>".repeat(1000))))).toBe("import_too_big");
    // a cell's text, and all of a document's, counted as read
    expect(code(() => documentGrid(`<w:document ${W}><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>${"א".repeat(IMPORT_LIMITS.rawCellChars + 1)}</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`))).toBe("import_too_big");
    // within: a row of 4 cells spanning 60, three tables deep, a paragraph of 10 tabs — read
    expect(code(() => documentGrid(`<w:document ${W}><w:body><w:tbl><w:tr>${'<w:tc><w:tcPr><w:gridSpan w:val="60"/></w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>'.repeat(4)}</w:tr></w:tbl></w:body></w:document>`))).toBe("ok");
    expect(documentGrid(`<w:document ${W}><w:body><w:p><w:r><w:t>a</w:t>${"<w:tab/>".repeat(10)}<w:t>b</w:t></w:r></w:p></w:body></w:document>`)).toEqual([["a", "b"]]);
  });

  it("the gridSpan file the review built (524,288 cells of 60): refused within a second or so (it took 12 s and 0.8 GB, then read as empty)", () => {
    const r = timed(() => readDocx(docx(`<w:tbl><w:tr>${'<w:tc><w:tcPr><w:gridSpan w:val="60"/></w:tcPr><w:p/></w:tc>'.repeat(524_288)}</w:tr></w:tbl>`)));
    expect(r.code).toBe("import_too_big");
    expect(r.ms).toBeLessThan(3000);
  }, 60_000);

  it("refused AS IT READS — the rest of the file is never reached (a broken tag after the excess is never seen)", () => {
    const broken = "<w:p><w:r"; // read to the end, this is import_bad_file
    const body = (x: string) => `<w:document ${W}><w:body>${x}${broken}`;
    const span = '<w:tc><w:tcPr><w:gridSpan w:val="60"/></w:tcPr><w:p/></w:tc>';
    expect(code(() => documentGrid(body(`<w:tbl><w:tr>${span.repeat(5)}`)))).toBe("import_too_big"); // a row's width
    expect(code(() => documentGrid(body(`<w:tbl><w:tr>${span.repeat(4)}</w:tr></w:tbl>`)))).toBe("import_bad_file"); // within it: read on
    expect(code(() => documentGrid(body(`<w:p><w:r>${"<w:tab/>".repeat(IMPORT_LIMITS.rowCells)}`)))).toBe("import_too_big"); // a paragraph's tabs
    expect(code(() => documentGrid(body(`<w:p><w:r>${"<w:tab/>".repeat(IMPORT_LIMITS.rowCells - 2)}</w:r></w:p>`)))).toBe("import_bad_file");
    expect(code(() => documentGrid(body("<w:tbl>".repeat(IMPORT_LIMITS.nesting + 1))))).toBe("import_too_big"); // the nesting
    expect(code(() => documentGrid(body(`<w:tbl><w:tr><w:tc><w:p><w:r><w:t>${"א".repeat(IMPORT_LIMITS.rawCellChars + 1)}</w:t>`)))).toBe("import_too_big"); // a cell's text
    const page = `<w:p><w:r><w:t>${"א".repeat(9_000)}</w:t></w:r></w:p>`;
    expect(code(() => documentGrid(body(page.repeat(Math.ceil(IMPORT_LIMITS.gridChars / 9_000) + 1))))).toBe("import_too_big"); // all the text
    // the xlsx: a shared string too long for one cell — refused at the first cell that points to it
    const sheet = `<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row`; // «<row</worksheet>»: a tag cut short
    expect(code(() => readXlsx(workbook([["s", sheet]], { shared: `<si><t>${"א".repeat(IMPORT_LIMITS.rawCellChars + 1)}</t></si>` })).read(0))).toBe("import_too_big");
    expect(code(() => readXlsx(workbook([["s", sheet]], { shared: "<si><t>א</t></si>" })).read(0))).toBe("import_bad_file");
  });

  it("a tracked move is read once, where it moved to — never its old place (w:moveFrom) as well", () => {
    const p = (a: string, b: string) => `<w:p><w:r><w:t>${a}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${b}</w:t></w:r></w:p>`;
    const g = readDocx(
      docx(
        p("שם", "הערה") +
          '<w:p><w:moveFromRangeStart w:id="0" w:name="m"/><w:moveFrom w:id="1" w:author="x"><w:r><w:t>מרצה מוזז לדוגמה</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="0"/></w:p>' +
          '<w:p><w:moveTo w:id="2" w:author="x"><w:r><w:t>מרצה מוזז לדוגמה</w:t></w:r></w:moveTo></w:p>',
      ),
    );
    expect(g).toEqual([["שם", "הערה"], ["מרצה מוזז לדוגמה", ""]]);
  });
});
