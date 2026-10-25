// What the dry run on last year's own files found (DECISIONS «הרצה יבשה של הייבוא»), each held here on a synthetic
// table of the same shape — never a word of the real files.
import { describe, expect, it } from "vitest";
import { DEFAULT_TITLES } from "../data/speakerRules";
import { cleanSpeakerRow } from "../data/importRules";
import type { SpeakerRow } from "../data/imports";
import { readCandidates } from "./candidates";
import { escortColumns, escortLike, readEscorts } from "./escorts";
import { defaultMapping, findHeaderRow } from "./fields";
import { lineContext, lineProposal } from "./lines";
import { genderCell, MEMORIAL_LINE } from "./speakerName";

describe("the dry run of 5786's files", () => {
  it("knows the speaker's column as they head it — «שם המרצה», «שם המרצה:» — and the candidates' «נושא השיעור» and «טווח ימים…»", () => {
    const candidates = [
      ["שם המרצה", "מגדר", "פרטים על המרצה", "נושא השיעור", "", "תשלום ?", "טווח ימים אפשריים", "חניך שפונה"],
      ["מרצה לדוגמה", "ז", "מוסד לדוגמה", "נושא לדוגמה", "", "✓", "גמיש", "חניך/ה לדוגמה"],
    ];
    expect(findHeaderRow("candidates", candidates)).toBe(0);
    expect(defaultMapping("candidates", candidates[0], 8)).toEqual(["name", "gender", null, "topics", null, null, "status", null]);
    const escorts = [["קובץ המלווים לדוגמה"], ["שם המרצה:", "שיעור ב :", "המלווה", "מס' טלפון מ:", ""], ["מרצה לדוגמה", "ראשון 8:30", "מלווה לדוגמה", "", ""]];
    expect(findHeaderRow("escorts", escorts)).toBe(1);
    expect(defaultMapping("escorts", escorts[1], 5)[0]).toBe("speaker");
    expect(findHeaderRow("tracking", [["שם מרצה", "שיעור ב"]])).toBe(0);
    // a prefix only where one is given: «מרצה נוסף» is no speaker's column
    expect(defaultMapping("candidates", ["מרצה נוסף", "שם המרצה"], 2)).toEqual([null, "name"]);
  });

  it("guards a trainees' column headed with words after the trainee's («חניך שפונה») even with no header row chosen", () => {
    const grid = [
      ["כותרת לא מוכרת", "עוד עמודה", "חניך שפונה"],
      ["מרצה לדוגמה", "נושא לדוגמה", "חניך/ה לדוגמה"],
    ];
    expect(escortColumns(grid, null)).toEqual(new Set([2]));
    expect(escortLike(grid, null)).toBe(true);
    // a title paragraph (one cell) above the table is not its header
    const titled = [["רשימה לדוגמה של חניכים", "", ""], ...grid]; // a grid is rectangular (cleanGrid)
    expect(escortColumns(titled, null)).toEqual(new Set([2]));
    // a data cell of many words that speaks of an escort does not block its column («המלווה יתקשר…»)
    expect(escortColumns([["א", "ב"], ["מרצה", "המלווה יתקשר למרצה יום לפני השיעור"]], null)).toEqual(new Set());
  });

  it("reads a second speaker of an escorts' cell — a person's line, never a dedication under the name", () => {
    const grid = [
      ["שם המרצה", "הערות"],
      ["הרב מרצה לדוגמה\nד״ר מרצה שני לדוגמה", "רק בוואטסאפ"],
      ["מרצה שלישי לדוגמה + הרבנית מרצה רביעית", "דרך המזכירה"],
      ["הרב מרצה חמישי לדוגמה\nלע״נ חלל/ה לדוגמה", "במייל"],
      ["הרב מרצה שישי לדוגמה\nחלל/ה לדוגמה ז״ל", "במייל"],
      ["", "שורה בלי מרצה"],
    ];
    const rows = readEscorts(grid, ["speaker", "phrases"], { headerRow: 0, titles: DEFAULT_TITLES });
    expect(rows.map((r) => [r.row, r.name, r.skip])).toEqual([
      [2, "מרצה לדוגמה", null],
      [2, "מרצה שני לדוגמה", null],
      [3, "מרצה שלישי לדוגמה", null],
      [3, "מרצה רביעית", null],
      [4, "מרצה חמישי לדוגמה", null], // the dedication under it is no speaker
      [5, "מרצה שישי לדוגמה", null],
      [6, "", "אין מרצה"],
    ]);
    expect(rows[1].phrases).toEqual(["רק בוואטסאפ"]);
  });

  it("reads the candidates' «מגדר» column (גבר / אישה …); a title of the other gender leaves none, said beside the row", () => {
    const grid = [
      ["שם המרצה", "מגדר"],
      ["מרצה אלף", "גבר"],
      ["מרצה בית", "אישה"],
      ["הרבנית מרצה גימל", ""],
      ["הרב מרצה דלת", "אישה"],
      ["מרצה הא", "?"],
    ];
    const m = defaultMapping("candidates", grid[0], 2);
    expect(m).toEqual(["name", "gender"]);
    const rows = readCandidates(grid, m, { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true });
    expect(rows.map((r) => r.data?.gender ?? null)).toEqual(["m", "f", "f", null, null]);
    expect(rows[3].warnings.join(" ")).toContain("עמודת המגדר לא מסכימים");
    expect(genderCell("זכר")).toBe("m");
    expect(genderCell("נ׳")).toBe("f");
    // every row passes import_commit's browser twin: a gender with no title is allowed (v13), the other one never
    expect(cleanSpeakerRow({ row: 2, action: "new", name: "מרצה אלף", title: null, gender: "m" } as SpeakerRow, DEFAULT_TITLES).gender).toBe("m");
    expect(() => cleanSpeakerRow({ row: 5, action: "new", name: "מרצה דלת", title: "הרב", gender: "f" } as SpeakerRow, DEFAULT_TITLES)).toThrow();
  });

  it("proposes «לא לייבא» for a dedication line under a name («לע״נ …», «… ז״ל», «הי״ד»)", () => {
    const c = lineContext([], DEFAULT_TITLES);
    expect(lineProposal("לע״נ חלל/ה לדוגמה", c).as).toBe("skip");
    expect(lineProposal("חלל/ה לדוגמה הי״ד", c).as).toBe("skip");
    expect(lineProposal("ישיבת דוגמה", c).as).toBe("affiliation");
    expect(MEMORIAL_LINE.test("ד״ר זלמן לדוגמה")).toBe(false);
  });
});
