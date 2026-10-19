import { describe, expect, it } from "vitest";
import { nameKey } from "../domain/nameKey";
import { parseRosterPaste, previewPaste } from "./roster";

describe("pasting the trainees' list", () => {
  it("reads one name per line, trimming and single-spacing", () => {
    expect(parseRosterPaste("חניך/ה לדוגמה 01\n\n   חניך/ה   לדוגמה 02  \r\nחניך/ה לדוגמה 03").map((n) => n.full_name)).toEqual([
      "חניך/ה לדוגמה 01",
      "חניך/ה לדוגמה 02",
      "חניך/ה לדוגמה 03",
    ]);
  });
  it("reads a spreadsheet column — the name cell, never a number, phone or e-mail beside it", () => {
    const sheet = ["1\tחניך/ה לדוגמה 01\t123-4567890", "2\tחניך/ה לדוגמה 02\tsomeone@example.org", '3\t"חניך/ה לדוגמה 03"'].join("\n");
    expect(parseRosterPaste(sheet).map((n) => n.full_name)).toEqual(["חניך/ה לדוגמה 01", "חניך/ה לדוגמה 02", "חניך/ה לדוגמה 03"]);
  });
  it("skips a header row, list markers and lines with no name", () => {
    expect(parseRosterPaste("שם מלא\n1. חניך/ה לדוגמה 01\n- חניך/ה לדוגמה 02\n---\n42").map((n) => n.full_name)).toEqual([
      "חניך/ה לדוגמה 01",
      "חניך/ה לדוגמה 02",
    ]);
  });
  it("reads a gender cell beside the name", () => {
    expect(parseRosterPaste("חניך/ה לדוגמה 01\tנ\nחניך/ה לדוגמה 02\tזכר\nחניך/ה לדוגמה 03").map((n) => n.gender)).toEqual(["f", "m", null]);
  });
  it("previews new, already listed, and repeated within the paste — by name key", () => {
    const pasted = parseRosterPaste("חניך/ה לדוגמה 01\nחניך/ה לדוגמה 02\nחניך/ה  לדוגמה-02\nחניך/ה לדוגמה 03");
    const existing = new Set([nameKey("חניך/ה לדוגמה 03")]);
    expect(previewPaste(pasted, existing).map((p) => p.status)).toEqual(["new", "new", "repeat", "exists"]);
  });
});
