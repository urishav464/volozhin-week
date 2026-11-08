// The week's «תורנויות» lens (rotaLens.ts), on a synthetic rota: five days of three shifts, Thursday's night not part of
// the week (and a stale row on it still shown), Sunday cut by the opening, the duties in their order with the groups in
// theirs, a duty with no group left out, «מוצע» kept per group, the leads by name or by a cohort's staff, the words a
// screen reader hears — and the same answer whatever order the rows came in.
import { describe, expect, it } from "vitest";
import type { RotaData } from "../data/rota";
import { lensShiftText, rotaLens } from "./rotaLens";

const EDITION = { first_day_from: 510, last_day_until: 1140, settings: {} };

function rota(): RotaData {
  return {
    cohorts: [
      { id: 2, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", diets: [], sort: 2 },
      { id: 1, edition_id: 1, letter: "א", name: "מכינה לדוגמה א", diets: [], sort: 1 },
    ],
    presence: [],
    groups: [
      { id: 21, edition_id: 1, cohort_id: 2, number: 1, size: null, head_name: null },
      { id: 12, edition_id: 1, cohort_id: 1, number: 2, size: 7, head_name: null },
      { id: 11, edition_id: 1, cohort_id: 1, number: 1, size: 8, head_name: null },
    ],
    duties: [
      { id: 2, edition_id: 1, name: "מטבח", description: null, need_morning: 1, need_afternoon: 1, need_night: 1, min_people: null, sort: 2 },
      { id: 1, edition_id: 1, name: "בית מדרש", description: null, need_morning: 4, need_afternoon: 4, need_night: 4, min_people: null, sort: 1 },
      { id: 3, edition_id: 1, name: "נקיון", description: null, need_morning: 1, need_afternoon: 1, need_night: null, min_people: null, sort: 3 },
    ],
    assignments: [
      { id: 1, edition_id: 1, day: 0, shift: 0, duty_id: 2, group_id: 21, source: "hand" },
      { id: 2, edition_id: 1, day: 0, shift: 0, duty_id: 1, group_id: 12, source: "suggested" },
      { id: 3, edition_id: 1, day: 0, shift: 0, duty_id: 1, group_id: 11, source: "hand" },
      { id: 4, edition_id: 1, day: 2, shift: 2, duty_id: 1, group_id: 21, source: "hand" },
      // Thursday's night: not a shift of the week (it closes at 19:00) — a stale row, still shown
      { id: 5, edition_id: 1, day: 4, shift: 2, duty_id: 3, group_id: 12, source: "hand" },
    ],
    staff: [
      { id: 1, edition_id: 1, day: 0, start_min: 390, end_min: 870, member_id: null, name: "שם לדוגמה", cohort_id: null, kind: "lead", note: null },
      { id: 2, edition_id: 1, day: 0, start_min: 870, end_min: 1350, member_id: null, name: "שם לדוגמה 2", cohort_id: null, kind: "shift", note: null },
      { id: 3, edition_id: 1, day: 2, start_min: 1350, end_min: 1830, member_id: null, name: null, cohort_id: 2, kind: "lead", note: null },
    ],
    prep: [],
  };
}

describe("rotaLens", () => {
  it("five days of three shifts, each with the range the week has", () => {
    const cells = rotaLens(EDITION, rota());
    expect(cells).toHaveLength(5);
    for (const day of cells) expect(day.map((c) => c.shift)).toEqual([0, 1, 2]);
    expect(cells[0][0].range).toEqual({ start: 510, end: 870 }); // Sunday from the 08:30 opening
    expect(cells[1][2].range).toEqual({ start: 1350, end: 1830 });
    expect(cells[4][1].range).toEqual({ start: 870, end: 1140 }); // Thursday to the 19:00 close
    expect(cells[4][2].range).toBeNull(); // no night on Thursday
  });

  it("the duties in their order, the groups in theirs, «מוצע» per group, a duty with none left out", () => {
    const sunday = rotaLens(EDITION, rota())[0][0];
    expect(sunday.duties.map((d) => d.name)).toEqual(["בית מדרש", "מטבח"]); // «נקיון» has no group there
    expect(sunday.duties[0].groups).toEqual([
      { id: 11, code: "א1", suggested: false },
      { id: 12, code: "א2", suggested: true },
    ]);
    expect(sunday.duties[1].groups.map((g) => g.code)).toEqual(["נ1"]);
    expect(rotaLens(EDITION, rota())[1][0].duties).toEqual([]);
  });

  it("a stale row on a shift the week has not is still shown", () => {
    const night = rotaLens(EDITION, rota())[4][2];
    expect(night.range).toBeNull();
    expect(night.duties.map((d) => `${d.name}:${d.groups.map((g) => g.code)}`)).toEqual(["נקיון:א2"]);
    expect(night.leads).toEqual([]);
  });

  it("the leads by name or by a cohort's staff — a plain staff shift is not one", () => {
    const cells = rotaLens(EDITION, rota());
    expect(cells[0][0].leads).toEqual(["שם לדוגמה"]);
    expect(cells[0][1].leads).toEqual([]);
    expect(cells[2][2].leads).toEqual(["צוות מכינה לדוגמה נ"]);
  });

  it("said in words: the duties, then the leads; «אין שיבוצים» when empty", () => {
    const cells = rotaLens(EDITION, rota());
    expect(lensShiftText(cells[0][0])).toBe("בית מדרש: א1 א2 · מטבח: נ1 · אחראי/ת: שם לדוגמה");
    expect(lensShiftText(cells[1][1])).toBe("אין שיבוצים");
  });

  it("the same answer whatever order the rows came in", () => {
    const a = rota();
    const b = rota();
    b.assignments.reverse();
    b.groups.reverse();
    b.duties.reverse();
    b.cohorts.reverse();
    b.staff.reverse();
    expect(rotaLens(EDITION, b)).toEqual(rotaLens(EDITION, a));
  });

  it("never more than the rota: no phone key anywhere", () => {
    expect(JSON.stringify(rotaLens(EDITION, rota()))).not.toMatch(/phone/);
  });
});
