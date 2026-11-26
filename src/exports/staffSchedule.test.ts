// src/exports/staffSchedule.ts — the staff's schedule (v20): a column a day, a row a time row of the grid the week has, in
// each cell the staff whose hours overlap it (the hours beside a name in its first row), the night rows the day's before
// them, the shifts no row holds kept apart; never a phone, a note or a transport in the sheet. And the logistics side's
// legs: a pickup before 06:30 is the previous day's night, a round trip's way back at the teaching's end. Synthetic only.
import { describe, expect, it } from "vitest";
import { EMPTY_ROTA, type RotaData, type RotaStaffShift } from "../data/rota";
import { LRM } from "../domain/time";
import { emptyWeek } from "../testing/week";
import { SHEET } from "./rota";
import {
  dayRowIndexes, legText, onStaffClock, OUTSIDE_ROWS, placeLegs, rowAt, rowEndsFrom, staffSchedule, staffScheduleRows, staffScheduleTable, type TransportLeg,
} from "./staffSchedule";

type D = 0 | 1 | 2 | 3 | 4;
const on = (id: number, day: D, start_min: number, end_min: number, who: Partial<RotaStaffShift>): RotaStaffShift => ({
  id, edition_id: 1, day, start_min, end_min, member_id: null, name: null, cohort_id: null, note: null, ...who,
});

function rota(staff?: RotaStaffShift[]): RotaData {
  return {
    ...EMPTY_ROTA,
    cohorts: [{ id: 3, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 1 }],
    staff: staff ?? [on(1, 1, 510, 870, { name: "איש/אשת צוות לדוגמה" }), on(2, 1, 1350, 1830, { cohort_id: 3 }), on(3, 1, 600, 700, { name: "שם לדוגמה", note: "הקפצת מרצה (לדוגמה)" })],
  };
}

/** The sheet's row of a grid row that starts at `start` (its first cell: LRM + «HH:MM–»). */
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const rowOf = (rows: string[][], start: number) => rows.find((r) => r[0].startsWith(`${LRM}${hhmm(start)}–`))!;

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
    expect(dayRowIndexes(rows, 0).every((i) => rows[i].end > 510)).toBe(true);
    expect(dayRowIndexes(rows, 4).every((i) => rows[i].start < 1140)).toBe(true);
  });

  it("each cell the staff whose hours overlap the row (half-open: 14:30 does not touch a row from 14:30)", () => {
    const { rows } = staffSchedule(emptyWeek(), rota());
    const at = (start: number, day: D) => rows.find((r) => r.start === start)!.cells[day]!.map((s) => s.id);
    expect(at(510, 1)).toEqual([1]); // 08:30–10:00: the morning only
    expect(at(600, 1)).toEqual([1, 3]); // 10:00–11:30: both
    expect(at(690, 1)).toEqual([1, 3]); // 11:30–13:00: 10:00–11:40 still on
    expect(at(780, 1)).toEqual([1]);
    expect(at(870, 1)).toEqual([]); // ends at 14:30
    expect(at(600, 0)).toEqual([]); // Sunday: nobody
  });

  it("the night rows are the day's before them: a night shift is in its own day's 00:00–06:30, never the next day's", () => {
    const { rows } = staffSchedule(emptyWeek(), rota());
    for (const start of [1440, 1470, 1560, 1650, 1740]) {
      const r = rows.find((x) => x.start === start)!;
      expect(r.cells[1]!.map((s) => s.id)).toEqual([2]);
      expect(r.cells[2]!.map((s) => s.id)).toEqual([]);
    }
  });

  it("the sheet: the names, the hours beside one in the first row it is on; «—» when nobody; blank when the row is not that day's", () => {
    const w = emptyWeek();
    const t = staffScheduleTable(w, rota());
    expect(t.name).toBe(SHEET.staff);
    expect(t.headers).toEqual(["שעה", "בלו״ז", "ראשון", "שני", "שלישי", "רביעי", "חמישי"]);
    expect(t.landscape).toBe(true);
    expect(rowOf(t.rows, 510)[3]).toBe(`איש/אשת צוות לדוגמה ${LRM}08:30–14:30`);
    expect(rowOf(t.rows, 600)[3]).toBe(`איש/אשת צוות לדוגמה, שם לדוגמה ${LRM}10:00–11:40`);
    expect(rowOf(t.rows, 690)[3]).toBe("איש/אשת צוות לדוגמה, שם לדוגמה");
    expect(rowOf(t.rows, 600)[2]).toBe("—"); // Sunday 10:00: nobody
    expect(rowOf(t.rows, 1350)[3]).toBe(`צוות מכינה לדוגמה נ ${LRM}22:30–06:30`);
    expect(rowOf(t.rows, 1470)[3]).toBe("צוות מכינה לדוגמה נ"); // Monday's night
    expect(rowOf(t.rows, 390)[2]).toBe(""); // Sunday before the opening: not the week's
    expect(rowOf(t.rows, 1200)[6]).toBe(""); // Thursday after the close
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
    // names only: never a note (its words could be a transport's), never a phone
    expect(JSON.stringify(t)).not.toMatch(/טלפון|הקפצת|הסעה/);
  });

  it("a staff shift no row of its day holds (after Thursday's close) is never lost: listed apart, the sheet's last row", () => {
    const data = rota([on(1, 4, 1200, 1290, { name: "שם לדוגמה" }), on(2, 4, 510, 600, { name: "שם לדוגמה 2" })]);
    const s = staffSchedule(emptyWeek(), data);
    expect(s.outside.map((x) => x.map((y) => y.id))).toEqual([[], [], [], [], [1]]);
    expect(s.first.has(1)).toBe(false);
    expect(s.first.get(2)).toBe(s.rows.findIndex((r) => r.start === 510));
    const t = staffScheduleTable(emptyWeek(), data);
    expect(t.rows.at(-1)).toEqual(["", OUTSIDE_ROWS, "", "", "", "", `שם לדוגמה ${LRM}20:00–21:30`]);
    // with nothing outside, no such row
    expect(staffScheduleTable(emptyWeek(), rota()).rows.some((r) => r[1] === OUTSIDE_ROWS)).toBe(false);
  });

  it("«+» from a row: its end and every later row's end that day, distinct, in order — Thursday stops at the close", () => {
    const { rows } = staffSchedule(emptyWeek(), rota());
    const i = rows.findIndex((r) => r.start === 510);
    const ends = rowEndsFrom(rows, 1, i);
    expect(ends[0]).toBe(600);
    expect(ends.at(-1)).toBe(1830);
    expect(new Set(ends).size).toBe(ends.length);
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
    expect(rowEndsFrom(rows, 4, i).at(-1)).toBe(1140);
    // a row the day has not: nothing to offer
    expect(rowEndsFrom(rows, 0, rows.findIndex((r) => r.start === 390))).toEqual([]);
  });
});

describe("the transports on the staff's schedule (the logistics side)", () => {
  const leg = (extra: Partial<TransportLeg>): TransportLeg => ({ lessonId: 1, leg: "pickup", day: 1, min: 450, start: 510, speaker: "מרצה לדוגמה", state: "approved", ...extra });

  it("a lesson day's minute on the staff's clock: from 06:30 the same; before it the night of the day before (+24h); Sunday's stays", () => {
    expect(onStaffClock(1, 510)).toEqual({ day: 1, min: 510 });
    expect(onStaffClock(1, 390)).toEqual({ day: 1, min: 390 });
    expect(onStaffClock(1, 370)).toEqual({ day: 0, min: 1810 });
    expect(onStaffClock(3, 0)).toEqual({ day: 2, min: 1440 });
    expect(onStaffClock(0, 370)).toBeNull();
  });

  it("the row holding a minute: the one it falls in (of two that overlap, the later-starting one), else the last before it, else the day's first", () => {
    const { rows } = staffSchedule(emptyWeek(), rota());
    const start = (i: number) => rows[i].start;
    expect(start(rowAt(rows, 1, 425))).toBe(420); // 06:30–07:15 and 07:00–08:00: the later one
    expect(start(rowAt(rows, 1, 400))).toBe(390);
    expect(start(rowAt(rows, 1, 600))).toBe(600); // a row's start is its own
    expect(start(rowAt(rows, 1, 1830))).toBe(1740); // the day's very end: its last row
    expect(start(rowAt(rows, 0, 435))).toBe(510); // Sunday before the opening: Sunday's first row
  });

  it("a pickup in the row of its time; before 06:30 in the night rows of the day before; the way back at the teaching's end; no time at the lesson's start", () => {
    const { rows } = staffSchedule(emptyWeek(), rota());
    const placed = placeLegs(rows, [
      leg({ lessonId: 1, min: 450 }),
      leg({ lessonId: 2, min: 370 }), // Monday 06:10 → Sunday 05:00–06:30
      leg({ lessonId: 3, leg: "return", min: 585 }),
      leg({ lessonId: 4, min: null, start: 870 }),
      leg({ lessonId: 5, day: 0, min: 370 }), // Sunday 06:10: no day before it in the week
    ]);
    const by = (id: number, l: TransportLeg["leg"] = "pickup") => placed.find((p) => p.lessonId === id && p.leg === l)!;
    expect([by(1).col, rows[by(1).row].start]).toEqual([1, 420]);
    expect([by(2).col, rows[by(2).row].start]).toEqual([0, 1740]);
    expect([by(3, "return").col, rows[by(3, "return").row].start]).toEqual([1, 510]);
    expect([by(4).col, rows[by(4).row].start]).toEqual([1, 870]);
    expect([by(5).col, rows[by(5).row].start]).toEqual([0, 510]);
    // in the schedule's order: by column, then row
    expect(placed.map((p) => p.lessonId)).toEqual([5, 2, 1, 3, 4]);
  });

  it("a leg's words: «הסעה ‎HH:MM · מרצה», the way back «הסעה חזרה …», no time TBD, no speaker TBD", () => {
    expect(legText({ leg: "pickup", min: 370, speaker: "מרצה לדוגמה" })).toBe(`הסעה ${LRM}06:10 · מרצה לדוגמה`);
    expect(legText({ leg: "return", min: 1485, speaker: "מרצה לדוגמה" })).toBe(`הסעה חזרה ${LRM}00:45 · מרצה לדוגמה`);
    expect(legText({ leg: "pickup", min: null, speaker: "" })).toBe("הסעה TBD · TBD");
  });
});
