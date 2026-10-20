import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, plainText } from "./markdown";

describe("markdown-lite", () => {
  it("reads paragraphs, line breaks, bullet and numbered lists, headings and bold", () => {
    const blocks = parseMarkdown("# כותרת\n\nפסקה **מודגשת** אחת\nשורה שנייה\n\n- פריט א\n* פריט **ב**\n\n1. ראשון\n2) שני\n\n## משנה");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, line: [{ text: "כותרת", bold: false }] },
      {
        kind: "paragraph",
        lines: [
          [{ text: "פסקה ", bold: false }, { text: "מודגשת", bold: true }, { text: " אחת", bold: false }],
          [{ text: "שורה שנייה", bold: false }],
        ],
      },
      { kind: "bullets", items: [[{ text: "פריט א", bold: false }], [{ text: "פריט ", bold: false }, { text: "ב", bold: true }]] },
      { kind: "numbers", items: [[{ text: "ראשון", bold: false }], [{ text: "שני", bold: false }]] },
      { kind: "heading", level: 2, line: [{ text: "משנה", bold: false }] },
    ]);
  });

  it("keeps HTML, links and scripts as plain text — nothing becomes markup", () => {
    const evil = '<script>alert(1)</script> <img src=x onerror="alert(2)"> [קישור](javascript:alert(3)) <b>x</b>';
    const blocks = parseMarkdown(evil);
    expect(blocks).toEqual([{ kind: "paragraph", lines: [[{ text: evil, bold: false }]] }]);
    expect(parseInline("**<i>x</i>**")).toEqual([{ text: "<i>x</i>", bold: true }]);
  });

  it("leaves an unclosed ** as typed, and a list item's next line inside the item", () => {
    expect(parseInline("a **b")).toEqual([{ text: "a **b", bold: false }]);
    expect(parseMarkdown("- פריט\n  המשך\nעוד")).toEqual([
      { kind: "bullets", items: [[{ text: "פריט", bold: false }, { text: " ", bold: false }, { text: "המשך", bold: false }, { text: " ", bold: false }, { text: "עוד", bold: false }]] },
    ]);
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown(null)).toEqual([]);
    expect(plainText(parseMarkdown("# א\n\nב **ג**"))).toBe("א\n\nב ג");
  });

  it("reads the user guide (docs/GUIDE.he.md): a title, sections, and nothing it cannot draw", () => {
    const guide = readFileSync(new URL("../../docs/GUIDE.he.md", import.meta.url), "utf8");
    const blocks = parseMarkdown(guide);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(blocks.filter((b) => b.kind === "heading" && b.level === 2).length).toBeGreaterThanOrEqual(6);
    // no markup the renderer would show raw
    expect(guide).not.toMatch(/\]\(|<[a-z]/i);
  });
});
