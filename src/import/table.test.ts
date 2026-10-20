// A pasted table's text/plain (Excel, Google Sheets, Word) and the html walk (Google Docs, Word): what comes out,
// what is refused. Synthetic values only.
import { describe, expect, it } from "vitest";
import { CommandError } from "../data/commands";
import { gridFromClipboard } from "./clipboard";
import { gridFromHtml, gridFromNodes, type MiniNode } from "./html";
import { DEFAULT_TITLES } from "../data/speakerRules";
import { defaultMapping } from "./fields";
import { readTracking } from "./tracking";
import { IMPORT_LIMITS } from "./limits";
import { cleanCell, cleanGrid, tsvGrid } from "./table";

const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${(e as Error).message}`;
  }
};

describe("tsvGrid — text/plain as a spreadsheet puts it on the clipboard", () => {
  it("reads cells by tabs and rows by line breaks, CRLF too, and drops the empty rows and columns", () => {
    expect(tsvGrid("מרצה\tשיעור ב\r\nמרצה לדוגמה 1\tראשון 8:30\r\n\r\n\t\r\n")).toEqual([
      ["מרצה", "שיעור ב"],
      ["מרצה לדוגמה 1", "ראשון 8:30"],
    ]);
    expect(tsvGrid("a\t\tc\nd\t\tf")).toEqual([
      ["a", "c"],
      ["d", "f"],
    ]);
  });

  it("reads a quoted cell holding a line break, a tab and doubled quotes as one cell", () => {
    expect(tsvGrid('"שורה א\nשורה ב"\tב\n"עם\tטאב"\t"תנ""ך"')).toEqual([
      ["שורה א\nשורה ב", "ב"],
      ["עם טאב", 'תנ"ך'],
    ]);
  });

  it("keeps a quote that opens a cell but never closes it as a character, the rest of the line still read", () => {
    expect(tsvGrid('"פתוח\tב\nג\tד')).toEqual([
      ['"פתוח', "ב"],
      ["ג", "ד"],
    ]);
    expect(tsvGrid('"a" b\tc')).toEqual([['"a" b', "c"]]);
  });

  it("a last empty cell after a trailing tab, rows of different widths made even", () => {
    expect(tsvGrid("a\tb\t\nc")).toEqual([
      ["a", "b"],
      ["c", ""],
    ]);
  });

  it("cleans each cell: bidi marks out, NBSP a space, spaces collapsed, blank lines gone", () => {
    expect(cleanCell("‏  מרצה  לדוגמה \n\n  שורה  ‫")).toBe("מרצה לדוגמה\nשורה");
  });

  it("refuses a paste past the limits: too much text, too many rows, columns or cells, a cell too long", () => {
    expect(code(() => tsvGrid("x".repeat(IMPORT_LIMITS.textChars + 1)))).toBe("import_too_big");
    expect(code(() => cleanGrid(Array.from({ length: IMPORT_LIMITS.rows + 1 }, (_, i) => [`r${i}`])))).toBe("import_too_big");
    expect(code(() => cleanGrid([Array.from({ length: IMPORT_LIMITS.cols + 1 }, (_, i) => `c${i}`)]))).toBe("import_too_big");
    expect(code(() => cleanGrid([["x".repeat(IMPORT_LIMITS.cellChars + 1)]]))).toBe("import_too_big");
    expect(code(() => cleanGrid(Array.from({ length: IMPORT_LIMITS.rows }, () => Array.from({ length: 21 }, () => "v"))))).toBe("import_too_big");
    // at the limits exactly: read
    expect(cleanGrid(Array.from({ length: IMPORT_LIMITS.rows }, () => ["v"]))).toHaveLength(IMPORT_LIMITS.rows);
  });
});

// ---------------------------------------------------------------- the html walk, on a tree built here

/** An element as DOMParser gives it: upper-case tag, attributes, children. */
function h(tag: string, attrs: Record<string, string> | null, ...children: (MiniNode | string)[]): MiniNode {
  return {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    nodeValue: null,
    childNodes: children.map((c) => (typeof c === "string" ? { nodeType: 3, nodeName: "#text", nodeValue: c, childNodes: [] } : c)),
    getAttribute: (n) => attrs?.[n] ?? null,
  };
}
const doc = (...children: MiniNode[]): MiniNode => ({ nodeType: 9, nodeName: "#document", nodeValue: null, childNodes: [h("html", null, ...children)] });
const comment = (v: string): MiniNode => ({ nodeType: 8, nodeName: "#comment", nodeValue: v, childNodes: [] });

describe("gridFromNodes — a pasted table's cells, text only", () => {
  it("reads the rows of thead and tbody, td and th, in order", () => {
    const t = h("table", null, h("thead", null, h("tr", null, h("th", null, "מרצה"), h("th", null, "שיעור ב"))), h("tbody", null, h("tr", null, h("td", null, "מרצה לדוגמה 1"), h("td", null, "שני 10:00"))));
    expect(gridFromNodes(doc(h("body", null, t)))).toEqual([
      ["מרצה", "שיעור ב"],
      ["מרצה לדוגמה 1", "שני 10:00"],
    ]);
  });

  it("never reads the head, a style, a script, a comment or a form's own text", () => {
    const t = h("table", null, h("tr", null, h("td", null, h("script", null, "alert(1)"), "א", comment("x"), h("style", null, ".a{}")), h("td", null, h("button", null, "לחצו"), "ב")));
    expect(gridFromNodes(doc(h("head", null, h("style", null, "td{}"), h("title", null, "כותרת")), h("body", null, t)))).toEqual([["א", "ב"]]);
  });

  it("a <br> and Word's paragraphs inside a cell are lines of it; a nested table is the cell's text", () => {
    const word = h("td", null, h("p", { class: "MsoNormal" }, h("span", null, "דרך המזכירה")), h("p", null, "רק בוואטסאפ", h("o:p", null)));
    const excel = h("td", null, "שורה א", h("br", { style: "mso-data-placement:same-cell" }), "שורה ב");
    const nested = h("td", null, h("table", null, h("tr", null, h("td", null, "פנימי 1"), h("td", null, "פנימי 2"))));
    expect(gridFromNodes(doc(h("body", null, h("table", null, h("tr", null, word, excel, nested)))))).toEqual([["דרך המזכירה\nרק בוואטסאפ", "שורה א\nשורה ב", "פנימי 1 פנימי 2"]]);
  });

  it("gives a rowspan's text to each row it spans (a day merged down), and leaves a colspan's other columns empty", () => {
    const t = h(
      "table",
      null,
      h("tr", null, h("td", { rowspan: "2" }, "ראשון"), h("td", null, "8:30"), h("td", { colspan: "2" }, "כותרת רחבה")),
      h("tr", null, h("td", null, "10:00"), h("td", null, "א"), h("td", null, "ב")),
      h("tr", null, h("td", null, "שני"), h("td", null, "8:30"), h("td", null, "ג"), h("td", null, "ד")),
    );
    expect(gridFromNodes(doc(h("body", null, t)))).toEqual([
      ["ראשון", "8:30", "כותרת רחבה", ""],
      ["ראשון", "10:00", "א", "ב"],
      ["שני", "8:30", "ג", "ד"],
    ]);
  });

  it("several tables (a Google Doc with one per day) are read one after the other; text outside them is not", () => {
    const t1 = h("table", null, h("tr", null, h("td", null, "א1"), h("td", null, "א2")));
    const t2 = h("table", null, h("tr", null, h("td", null, "ב1"), h("td", null, "ב2")));
    expect(gridFromNodes(doc(h("body", null, h("p", null, "תבנית ההודעה"), t1, h("h2", null, "יום שני"), t2)))).toEqual([
      ["א1", "א2"],
      ["ב1", "ב2"],
    ]);
  });

  it("with no table, every line is a row and its tabs split it into cells", () => {
    expect(gridFromNodes(doc(h("body", null, h("p", null, "מרצה\tהערות"), h("div", null, "מרצה לדוגמה 1\tדרך המזכירה"))))).toEqual([
      ["מרצה", "הערות"],
      ["מרצה לדוגמה 1", "דרך המזכירה"],
    ]);
  });

  it("never reads Word's list marker («·», «1.» in an mso-list:Ignore span, a line break in its spacing) as the cell's text", () => {
    const marker = (m: string) => h("span", { style: "mso-list:Ignore" }, m, h("span", { style: 'font:7.0pt "Times New Roman"' }, "\u00a0\u00a0\u00a0\n"));
    const t = h(
      "table",
      null,
      h("tr", null, h("td", null, "מרצה"), h("td", null, "שיעור ב")),
      h("tr", null, h("td", null, h("p", { class: "MsoListParagraph", style: "mso-list:l0 level1 lfo1" }, comment("[if !supportLists]"), marker("·"), comment("[endif]"), "הרב בדיקה בתבליט")), h("td", null, "ראשון 8:30")),
      h("tr", null, h("td", null, h("p", { class: "MsoListParagraph" }, marker("2."), "הרבנית בדיקה ממוספרת")), h("td", null, "ראשון 10:00")),
    );
    const grid = gridFromNodes(doc(h("body", null, t)));
    expect(grid.slice(1).map((row) => row[0])).toEqual(["הרב בדיקה בתבליט", "הרבנית בדיקה ממוספרת"]);
    const read = readTracking(grid, defaultMapping("tracking", grid[0], grid[0].length), { headerRow: true, titles: DEFAULT_TITLES, genderFromTitle: true });
    expect(read.speakers.map((x) => [x.name, x.title])).toEqual([
      ["בדיקה בתבליט", "הרב"],
      ["בדיקה ממוספרת", "הרבנית"],
    ]);
  });

  it("refuses a huge html before parsing it, and a span that would make the table explode", () => {
    let parsed = false;
    const parse = () => {
      parsed = true;
      return doc();
    };
    expect(code(() => gridFromHtml("<table>" + "x".repeat(IMPORT_LIMITS.htmlChars), parse))).toBe("import_too_big");
    expect(parsed).toBe(false);
    const wide = h("table", null, h("tr", null, h("td", { colspan: "999999" }, "x"), h("td", { colspan: "999999" }, "y"), h("td", { colspan: "999999" }, "z"), h("td", { colspan: "999999" }, "w"), h("td", { colspan: "999999" }, "v")));
    expect(code(() => gridFromNodes(doc(h("body", null, wide))))).toBe("import_too_big");
  });
});

describe("gridFromClipboard — which of the clipboard's kinds is read", () => {
  const tree = doc(h("body", null, h("table", null, h("tr", null, h("td", null, "מה-HTML"), h("td", null, "ב")))));
  const clip = (html: string, text: string) => ({ getData: (t: string) => (t === "text/html" ? html : t === "text/plain" ? text : "") });

  it("the html when it holds a table (Excel, Sheets, Docs, Word)", () => {
    expect(gridFromClipboard(clip("<table><tr><td>…</td></tr></table>", "מהטקסט\tב"), () => tree)).toEqual({ grid: [["מה-HTML", "ב"]], source: "html" });
  });

  it("the plain text when the html has no table, or there is no html", () => {
    expect(gridFromClipboard(clip("<p>פסקה</p>", "מהטקסט\tב"), () => tree)).toEqual({ grid: [["מהטקסט", "ב"]], source: "text" });
    expect(gridFromClipboard(clip("", "א\tב\nג\tד"))).toEqual({ grid: [["א", "ב"], ["ג", "ד"]], source: "text" });
  });
});
