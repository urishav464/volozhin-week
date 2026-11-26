// src/exports/staffSchedule.ts — the staff's schedule (v20; the foundation's first version, stream B's to deepen): a
// column a day, a row a time row of the grid the week has, in each cell the staff whose hours overlap it — never a phone,
// never a transport. Synthetic only.
import { describe, expect, it } from "vitest";
import { EMPTY_ROTA, type RotaData, type RotaStaffShift } from "../data/rota";
import { LRM } from "../domain/time";
import { emptyWeek } from "../testing/week";
import { SHEET } from "./rota";
import { staffScheduleRows, staffScheduleTable } from "./staffSchedule";

const on = (id: number, day: 0 | 1 | 2 | 3 | 4, start_min: number, end_min: number, who: Partial<RotaStaffShift>): RotaStaffShift => ({
  id, edition_id: 1, day, start_min, end_min, member_id: null, name: null, cohort_id: null, note: null, ...who,
});

function rota(): RotaData {
  return {
    ...EMPTY_ROTA,
    cohorts: [{ id: 3, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 1 }],
    staff: [on(1, 1, 510, 870, { name: "איש/אשת צוות לדוגמה" }), on(2, 1, 1350, 1830, { cohort_id: 3 }), on(3, 1, 600, 700, { name: "שם לדוגמה", note: "הקפצת מרצה (לדוגמה)" })],
  };
}

describe("the staff's schedule", () => {
  it("a row per time row the week has (Sunday from the opening, Thursday to the close), by time; a cell per day", () => {
    const w = emptyWeek(); // Sunday opens 08:30, Thursday closes 19:00
    const rows = staffScheduleRows(w, rota());
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.map((r) => r.start)).toEqual([...rows.map((r) => r.start)].sort((a, b) => a - b));
    for (const r of rows) {
      expect(r.cells).toHaveLength(5);
      const grid = w.rows.find((g) => g.start_min === r.start && g.end_min === r.end && g.label === r.label)!;
      // Sunday's rows before the opening and Thursday's after the close are not the week's
      if (grid.end_min <= 510) expect(r.cells[0]).toBeNull();
      if (grid.start_min >= 1140) expect(r.cells[4]).toBeNull();
    }
  });

  it("each cell the staff whose hours overlap the row, by name or «צוות <מכינה>»; «—» when nobody; blank when the row is not that day's", () => {
    const w = emptyWeek();
    const t = staffScheduleTable(w, rota());
    expect(t.name).toBe(SHEET.staff);
    expect(t.headers).toEqual(["שעה", "בלו״ז", "ראשון", "שני", "שלישי", "רביעי", "חמישי"]);
    const row = (start: number) => t.rows.find((r) => r[0].startsWith(`${LRM}`) && r[0].includes(`${String(Math.floor(start / 60) % 24).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}–`))!;
    expect(row(600)[3]).toBe("איש/אשת צוות לדוגמה, שם לדוגמה"); // Monday 10:00: both
    expect(row(600)[2]).toBe("—"); // Sunday 10:00: nobody
    expect(t.rows.some((r) => r[3] === "צוות מכינה לדוגמה נ")).toBe(true); // Monday night
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
    // never a phone, never a note's transport words: the cells are names only
    expect(JSON.stringify(t)).not.toMatch(/טלפון|הקפצת/);
  });
});
