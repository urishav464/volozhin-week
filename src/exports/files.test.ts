// The file formats: CSV (BOM, CRLF, quoting, the formula guard) and the xlsx
// writer (unzipped here: the parts Excel needs, a right-to-left sheet with a
// bold frozen header repeated on print, column widths, row fills, XML-safe text).
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BOM, csvBytes, toCsv } from "./csv";
import { guardCell, type Table } from "./table";
import { columnName, sheetName, toXlsx, xlsxParts, xmlText } from "./xlsx";

const T: Table = {
  name: "בדיקה",
  headers: ["מרצה", "כותרת"],
  rows: [
    ["ד״ר פלונית", "שיעור, עם פסיק"],
    ["מרצה \"במירכאות\"", "שורה\nשנייה"],
    ["=1+1", "@SUM(A1)"],
  ],
  widths: [30, 40],
  fills: [null, "cffafe", null],
  landscape: true,
};

describe("the formula guard", () => {
  it("prefixes an apostrophe to a cell that starts with = + - @, a tab or a line break — and nothing else", () => {
    for (const v of ["=HYPERLINK(\"x\")", "+972", "-1", "@cmd", "\tx", "\rx", "\nx"]) expect(guardCell(v), JSON.stringify(v)).toBe(`'${v}`);
    for (const v of ["", "שיעור", "08:30–09:45", "1,500 ₪", " =x", "W−42", "'already"]) expect(guardCell(v), JSON.stringify(v)).toBe(v);
  });
});

describe("CSV", () => {
  const csv = toCsv(T);

  it("starts with a UTF-8 byte-order mark and ends every record with CRLF", () => {
    expect(csv.startsWith(BOM)).toBe(true);
    expect([...csvBytes(T).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.endsWith("\r\n")).toBe(true);
    // the only bare LF is the one inside a quoted cell
    expect(csv.replace(/\r\n/g, "").split("\n")).toHaveLength(2);
  });

  it("quotes a cell with a comma, a quote or a line break, doubling its quotes", () => {
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("מרצה,כותרת");
    expect(lines[1]).toBe('ד״ר פלונית,"שיעור, עם פסיק"');
    expect(lines[2]).toBe('"מרצה ""במירכאות""","שורה\nשנייה"');
  });

  it("guards formulas in every cell, headers too", () => {
    const lines = toCsv({ headers: ["=h"], rows: [["=1+1"], ["-2"], ["+3"], ["@4"], ["\t5"]] }).slice(1).split("\r\n");
    expect(lines.slice(0, 6)).toEqual(["'=h", "'=1+1", "'-2", "'+3", "'@4", "'\t5"]);
    expect(toCsv(T)).toContain("'=1+1,'@SUM(A1)");
  });
});

describe("xlsx", () => {
  const files = unzipSync(toXlsx([T]));
  const text = (p: string) => strFromU8(files[p]);

  it("is a zip with the parts a spreadsheet needs", () => {
    expect(Object.keys(files).sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].sort(),
    );
    expect(text("[Content_Types].xml")).toContain('PartName="/xl/worksheets/sheet1.xml"');
    expect(text("xl/workbook.xml")).toContain('<sheet name="בדיקה" sheetId="1" r:id="rId1"/>');
    expect(text("xl/_rels/workbook.xml.rels")).toContain('Target="styles.xml"');
  });

  it("writes a right-to-left sheet whose bold header row is frozen and repeated on every printed page", () => {
    const sheet = text("xl/worksheets/sheet1.xml");
    expect(sheet).toContain('<sheetView rightToLeft="1"');
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toMatch(/<row r="1"><c r="A1" t="inlineStr" s="1">/);
    expect(text("xl/styles.xml")).toMatch(/<font><b\/>/);
    expect(text("xl/styles.xml")).toMatch(/<cellXfs count="4"><xf[^>]*\/><xf numFmtId="0" fontId="1"/); // style 1 = the bold font
    expect(text("xl/workbook.xml")).toContain(`<definedName name="_xlnm.Print_Titles" localSheetId="0">'בדיקה'!$1:$1</definedName>`);
    expect(sheet).toContain('<pageSetup paperSize="9" orientation="landscape"/>');
  });

  it("sizes the columns and fills a row with its colour", () => {
    const sheet = text("xl/worksheets/sheet1.xml");
    expect(sheet).toContain('<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="40" customWidth="1"/></cols>');
    expect(text("xl/styles.xml")).toContain('<fgColor rgb="FFCFFAFE"/>');
    expect(sheet).toMatch(/<row r="3"><c r="A3" t="inlineStr" s="3">/); // the second body row carries the fill
    expect(sheet).toMatch(/<row r="2"><c r="A2" t="inlineStr" s="2">/);
    expect(sheet).toContain('<dimension ref="A1:B4"/>');
  });

  it("keeps every cell text: escaped, guarded against formulas, no formula element anywhere", () => {
    const sheet = text("xl/worksheets/sheet1.xml");
    expect(sheet).toContain("<t xml:space=\"preserve\">מרצה &quot;במירכאות&quot;</t>");
    expect(sheet).toContain("<t xml:space=\"preserve\">'=1+1</t>");
    expect(sheet).toContain("<t xml:space=\"preserve\">'@SUM(A1)</t>");
    expect(sheet).not.toContain("<f>");
    expect(xmlText("a<b>&\u0001c\uD800")).toBe("a&lt;b&gt;&amp;c");
  });

  it("names columns and sheets the way Excel accepts", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
    const taken = new Set<string>();
    expect(sheetName('לו"ז [תשפ"ז]: גרסה/2', taken)).toBe('לו"ז  תשפ"ז   גרסה 2');
    expect(sheetName('לו"ז  תשפ"ז   גרסה 2', taken)).toBe('לו"ז  תשפ"ז   גרסה 2 2');
    expect([...sheetName("א".repeat(40), new Set())]).toHaveLength(31);
    expect(sheetName("   ", new Set())).toBe("גיליון");
  });

  it("writes several sheets, one fill list for all of them", () => {
    const parts = xlsxParts([T, { ...T, name: "שני", fills: [null, null, "FFEDD5"] }]);
    expect(parts["xl/workbook.xml"]).toContain('<sheet name="שני" sheetId="2" r:id="rId2"/>');
    expect(parts["xl/styles.xml"]).toContain('<fills count="4">');
    expect(parts["xl/worksheets/sheet2.xml"]).toMatch(/<row r="4"><c r="A4" t="inlineStr" s="4">/);
  });
});
