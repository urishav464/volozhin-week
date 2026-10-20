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
  });

  it("prints every column on one page's width, A4, as many pages down as it takes", () => {
    const sheet = text("xl/worksheets/sheet1.xml");
    expect(sheet).toContain('<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
    // fitToPage lives in sheetPr, the worksheet's first child (before <dimension>)
    expect(sheet).toMatch(/<worksheet [^>]*><sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr><dimension /);
    expect(strFromU8(unzipSync(toXlsx([{ ...T, landscape: false }]))["xl/worksheets/sheet1.xml"])).toContain('orientation="portrait" fitToWidth="1" fitToHeight="0"');
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

  it("removes what XML forbids before the formula guard: a control character never smuggles «=» in", () => {
    const cellText = (v: string) => /<row r="2">.*?<t xml:space="preserve">(.*?)<\/t>/.exec(xlsxParts([{ name: "s", headers: ["h"], rows: [[v]] }])["xl/worksheets/sheet1.xml"])![1];
    expect(cellText('\u0001=HYPERLINK("http://x","y")')).toBe("'=HYPERLINK(&quot;http://x&quot;,&quot;y&quot;)");
    expect(cellText("\u000B=1+1")).toBe("'=1+1");
    expect(cellText("\u001F\u0002@cmd")).toBe("'@cmd");
    expect(cellText("\uFFFE-1")).toBe("'-1");
    expect(cellText("\u0001שיעור")).toBe("שיעור");
  });

  it("names columns and sheets the way Excel accepts", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
    const taken = new Set<string>();
    expect(sheetName('לו"ז [תשפ"ז]: גרסה/2', taken)).toBe('לו"ז  תשפ"ז   גרסה 2');
    expect(sheetName('לו"ז  תשפ"ז   גרסה 2', taken)).toBe('לו"ז  תשפ"ז   גרסה 2 2');
    expect([...sheetName("א".repeat(40), new Set())]).toHaveLength(31);
    expect(sheetName("   ", new Set())).toBe("גיליון");
    // never beginning or ending with an apostrophe (Excel would repair the file): «מחזור ב'» is a natural label
    expect(sheetName("טבלת מעקב מחזור ב'", new Set())).toBe("טבלת מעקב מחזור ב");
    expect(sheetName("'ציטוט' ב' '", new Set())).toBe("ציטוט' ב");
    expect(sheetName(`${"א".repeat(30)}'ב`, new Set())).toBe("א".repeat(30)); // the cut leaves one at the end
    expect(sheetName("'".repeat(3), new Set())).toBe("גיליון");
    expect(strFromU8(unzipSync(toXlsx([{ ...T, name: "לו\"ז מחזור ב'" }]))["xl/workbook.xml"])).toContain('<sheet name="לו&quot;ז מחזור ב" ');
  });

  it("writes several sheets, one fill list for all of them", () => {
    const parts = xlsxParts([T, { ...T, name: "שני", fills: [null, null, "FFEDD5"] }]);
    expect(parts["xl/workbook.xml"]).toContain('<sheet name="שני" sheetId="2" r:id="rId2"/>');
    expect(parts["xl/styles.xml"]).toContain('<fills count="4">');
    expect(parts["xl/worksheets/sheet2.xml"]).toMatch(/<row r="4"><c r="A4" t="inlineStr" s="4">/);
  });
});
