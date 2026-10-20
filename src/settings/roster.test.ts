import { describe, expect, it } from "vitest";
import { nameKey } from "../domain/nameKey";
import { parseRosterPaste, pasteColumns, previewPaste } from "./roster";

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
  it("reads ONE column of a spreadsheet — an address, a city or a parent's name beside it is never taken for the name", () => {
    const sheet = [
      "רחוב לדוגמה 12, עיר לדוגמה\tעיר לדוגמה\tחניך/ה לדוגמה 01\t123-4567890",
      "רח' לדוגמה 3\tעיר לדוגמה\tחניך/ה לדוגמה 02\t123-4567890",
      "ת.ד. 5\tעיר אחרת לדוגמה\tחניך/ה לדוגמה 03\t",
    ].join("\n");
    // the address column is no name; the city repeats, the names do not → the names' column by default
    const cols = pasteColumns(sheet);
    expect(cols.columns.map((c) => c.index)).toEqual([1, 2]);
    expect(cols.best).toBe(2);
    expect(parseRosterPaste(sheet).map((n) => n.full_name)).toEqual(["חניך/ה לדוגמה 01", "חניך/ה לדוגמה 02", "חניך/ה לדוגמה 03"]);
    // the admin may pick the other column (the preview shows it), and then that one is read in every row
    expect(parseRosterPaste(sheet, 1).map((n) => n.full_name)).toEqual(["עיר לדוגמה", "עיר לדוגמה", "עיר אחרת לדוגמה"]);
  });
  it("takes the column under a «שם» header, and never mixes columns between rows", () => {
    const sheet = ["שם ההורה\tשם\tמגדר", "הורה לדוגמה 01\tחניך/ה לדוגמה 01\tנ", "הורה לדוגמה 02\tחניך/ה לדוגמה 02\tז"].join("\n");
    expect(pasteColumns(sheet).best).toBe(1);
    expect(parseRosterPaste(sheet).map((n) => [n.full_name, n.gender])).toEqual([
      ["חניך/ה לדוגמה 01", "f"],
      ["חניך/ה לדוגמה 02", "m"],
    ]);
    expect(parseRosterPaste(sheet, 0).map((n) => n.full_name)).toEqual(["הורה לדוגמה 01", "הורה לדוגמה 02"]); // the header row is never a name
    // a row whose name cell is empty is skipped — not filled from a neighbouring cell
    expect(parseRosterPaste("1\tחניך/ה לדוגמה 01\n2\t\tעיר לדוגמה", 1).map((n) => n.full_name)).toEqual(["חניך/ה לדוגמה 01"]);
  });
  it("reads a typed line as it is and a spreadsheet row by its column, in one paste", () => {
    expect(parseRosterPaste("חניך/ה לדוגמה 01\nחניך/ה לדוגמה 02\n3\tחניך/ה לדוגמה 03\tנ").map((n) => [n.full_name, n.gender])).toEqual([
      ["חניך/ה לדוגמה 01", null],
      ["חניך/ה לדוגמה 02", null],
      ["חניך/ה לדוגמה 03", "f"],
    ]);
    expect(pasteColumns("חניך/ה לדוגמה 01\nחניך/ה לדוגמה 02").columns).toEqual([]); // no spreadsheet, nothing to pick
  });
  it("never keeps an address, even typed as a line of its own", () => {
    expect(parseRosterPaste("חניך/ה לדוגמה 01\nרחוב לדוגמה 12\nשדרות לדוגמה, 4").map((n) => n.full_name)).toEqual(["חניך/ה לדוגמה 01"]);
  });
  it("previews new, already listed, and repeated within the paste — by name key", () => {
    const pasted = parseRosterPaste("חניך/ה לדוגמה 01\nחניך/ה לדוגמה 02\nחניך/ה  לדוגמה-02\nחניך/ה לדוגמה 03");
    const existing = new Set([nameKey("חניך/ה לדוגמה 03")]);
    expect(previewPaste(pasted, existing).map((p) => p.status)).toEqual(["new", "new", "repeat", "exists"]);
  });
});
