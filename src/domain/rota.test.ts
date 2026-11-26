// src/domain/rota.ts: the three shifts, cut by Sunday's opening and Thursday's close (≡ app.rota_shift_active, which
// tests/sql/rota.test.ts compares value for value), the neighbours across a night, the groups' codes and their loads.
import { describe, expect, it } from "vitest";
import type { RotaAssignment, RotaData } from "../data/rota";
import {
  adjacent, canDrive, codeOf, cohortDutyIds, cohortHelps, DEFAULT_ROTA_SHIFTS, dietSplit, groupCode, groupHelpsIn, helpingGroups, loadsOf, needOf, presentAt, rotaShiftActive,
  rotaShiftRange, rotaShiftsOf, rotaSlots, shiftBounds, slotIndex, slotKey, splitSizes, staffOn,
} from "./rota";

const week = (first_day_from: number | null = 510, last_day_until = 1140, rota_shifts?: { cuts: [number, number]; labels: [string, string, string] }) => ({
  first_day_from,
  last_day_until,
  settings: rota_shifts ? { rota_shifts } : {},
});

describe("the shifts", () => {
  it("are last year's unless the edition set its own", () => {
    expect(rotaShiftsOf(week())).toEqual({ cuts: [870, 1350], labels: ["בוקר", "אחר צהריים", "לילה"] });
    expect(rotaShiftsOf(week(510, 1140, { cuts: [840, 1320], labels: ["א", "ב", "ג"] })).cuts).toEqual([840, 1320]);
    // a malformed setting reads as last year's
    expect(rotaShiftsOf({ settings: { rota_shifts: { cuts: null } as never } })).toBe(DEFAULT_ROTA_SHIFTS);
    expect([0, 1, 2].map((s) => shiftBounds(DEFAULT_ROTA_SHIFTS, s as 0 | 1 | 2))).toEqual([
      { from: 390, to: 870 },
      { from: 870, to: 1350 },
      { from: 1350, to: 1830 },
    ]);
  });

  it("Sunday: a shift that ends by the opening is not part of the week; one that ends after it is, from the opening", () => {
    expect([0, 1, 2].map((s) => rotaShiftActive(week(510), 0, s as 0 | 1 | 2))).toEqual([true, true, true]);
    // opening at 14:30 exactly: the morning ends at 14:30 — not after it
    expect([0, 1, 2].map((s) => rotaShiftActive(week(870), 0, s as 0 | 1 | 2))).toEqual([false, true, true]);
    expect(rotaShiftActive(week(875), 0, 0)).toBe(false);
    expect(rotaShiftActive(week(865), 0, 0)).toBe(true);
    // an evening opening (20:00): only the afternoon's tail and the night
    expect([0, 1, 2].map((s) => rotaShiftActive(week(1200), 0, s as 0 | 1 | 2))).toEqual([false, true, true]);
    expect(rotaShiftActive(week(1350), 0, 1)).toBe(false);
    // the opening not known yet: the whole Sunday
    expect([0, 1, 2].map((s) => rotaShiftActive(week(null), 0, s as 0 | 1 | 2))).toEqual([true, true, true]);
    expect(rotaShiftRange(week(510), 0, 0)).toEqual({ start: 510, end: 870 });
    expect(rotaShiftRange(week(1200), 0, 1)).toEqual({ start: 1200, end: 1350 });
    expect(rotaShiftRange(week(null), 0, 0)).toEqual({ start: 390, end: 870 });
    expect(rotaShiftRange(week(870), 0, 0)).toBeNull();
  });

  it("a shift's staff (v20, no lead): every staff shift of that day whose hours overlap the shift as the week has it", () => {
    const on = (id: number, day: 0 | 1 | 2 | 3 | 4, start_min: number, end_min: number) => ({ id, day, start_min, end_min });
    const staff = [on(1, 1, 840, 1350), on(2, 1, 390, 870), on(3, 1, 1350, 1830), on(4, 2, 390, 1830), on(5, 0, 390, 500)];
    const ids = (day: 0 | 1 | 2 | 3 | 4, shift: 0 | 1 | 2, e = week()) => staffOn(e, staff, day, shift).map((x) => x.id);
    expect([0, 1, 2].map((s) => ids(1, s as 0 | 1 | 2))).toEqual([[1, 2], [1], [3]]); // 14:00–22:30 crosses the cut; 22:30 is the night's start, not theirs
    expect([0, 1, 2].map((s) => ids(2, s as 0 | 1 | 2))).toEqual([[4], [4], [4]]); // a whole day
    expect(ids(0, 0)).toEqual([]); // 06:30–08:20 ends before Sunday's opening (08:30)
    expect(ids(0, 0, week(null))).toEqual([5]); // the opening not known: the whole morning
    expect(ids(4, 2)).toEqual([]); // not part of the week
  });

  it("Thursday: a shift that begins at or after the close is not part of the week; one before it is, until the close", () => {
    expect([0, 1, 2].map((s) => rotaShiftActive(week(510, 1140), 4, s as 0 | 1 | 2))).toEqual([true, true, false]);
    expect(rotaShiftRange(week(510, 1140), 4, 1)).toEqual({ start: 870, end: 1140 });
    expect(rotaShiftRange(week(510, 1140), 4, 0)).toEqual({ start: 390, end: 870 });
    // closing at 14:30: the afternoon begins at the close — out
    expect(rotaShiftActive(week(510, 870), 4, 1)).toBe(false);
    expect(rotaShiftActive(week(510, 875), 4, 1)).toBe(true);
    // a late close: Thursday has its night
    expect(rotaShiftActive(week(510, 1440), 4, 2)).toBe(true);
    expect(rotaShiftRange(week(510, 1440), 4, 2)).toEqual({ start: 1350, end: 1440 });
    // the middle days are whole whatever the opening and the close
    for (const d of [1, 2, 3] as const) expect([0, 1, 2].map((s) => rotaShiftActive(week(1350, 400), d, s as 0 | 1 | 2))).toEqual([true, true, true]);
  });

  it("moved cuts move the blocks the rules cut", () => {
    const e = week(840, 1300, { cuts: [840, 1320], labels: ["א", "ב", "ג"] });
    expect(rotaShiftActive(e, 0, 0)).toBe(false); // ends at 14:00, the opening
    expect(rotaShiftActive(e, 4, 1)).toBe(true); // begins at 14:00, before 21:40
    expect(rotaShiftRange(e, 4, 1)).toEqual({ start: 840, end: 1300 });
    expect(rotaShiftActive(e, 4, 2)).toBe(false);
  });

  it("the week's slots: fourteen last year (Thursday has no night), in time order", () => {
    const s = rotaSlots(week());
    expect(s).toHaveLength(14);
    expect(s[0]).toEqual({ day: 0, shift: 0 });
    expect(s.at(-1)).toEqual({ day: 4, shift: 1 });
    expect(s.map((x) => slotIndex(x.day, x.shift))).toEqual([...s.map((x) => slotIndex(x.day, x.shift))].sort((a, b) => a - b));
    expect(rotaSlots(week(870))).toHaveLength(13);
    expect(slotKey(2, 1)).toBe("2:1");
  });
});

describe("neighbours", () => {
  it("two shifts in a row are neighbours — a night and the next morning too; across a gap they are not", () => {
    expect(adjacent({ day: 0, shift: 0 }, { day: 0, shift: 1 })).toBe(true);
    expect(adjacent({ day: 0, shift: 1 }, { day: 0, shift: 2 })).toBe(true);
    expect(adjacent({ day: 0, shift: 2 }, { day: 1, shift: 0 })).toBe(true); // the night, then the morning after it
    expect(adjacent({ day: 1, shift: 0 }, { day: 0, shift: 2 })).toBe(true);
    expect(adjacent({ day: 0, shift: 0 }, { day: 0, shift: 2 })).toBe(false);
    expect(adjacent({ day: 0, shift: 2 }, { day: 1, shift: 1 })).toBe(false);
    expect(adjacent({ day: 1, shift: 0 }, { day: 1, shift: 0 })).toBe(false);
    expect(adjacent({ day: 3, shift: 2 }, { day: 4, shift: 0 })).toBe(true);
  });
});

const data: Pick<RotaData, "cohorts" | "groups" | "presence"> = {
  cohorts: [
    { id: 1, edition_id: 1, letter: "א", name: "מכינה לדוגמה א", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 1 },
    { id: 2, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2 },
  ],
  groups: [
    { id: 11, edition_id: 1, cohort_id: 1, number: 1, size: 8, head_name: null },
    { id: 12, edition_id: 1, cohort_id: 1, number: 2, size: null, head_name: null },
    { id: 21, edition_id: 1, cohort_id: 2, number: 5, size: 6, head_name: null },
  ],
  presence: [
    { cohort_id: 1, day: 0, shift: 0 },
    { cohort_id: 1, day: 0, shift: 1 },
    { cohort_id: 1, day: 0, shift: 2 },
    { cohort_id: 1, day: 1, shift: 0 },
    { cohort_id: 2, day: 1, shift: 0 },
    // Thursday night is not part of the week: presence there is not counted
    { cohort_id: 2, day: 4, shift: 2 },
  ],
};

describe("codes, presence, needs", () => {
  it("a group's code is its cohort's letter and its number", () => {
    expect(groupCode("א", 1)).toBe("א1");
    expect(groupCode("נ", 5)).toBe("נ5");
    expect(codeOf(data, data.groups[2])).toBe("נ5");
    expect(codeOf(data, { cohort_id: 9, number: 3 })).toBe("?3");
  });

  it("present only where a row says so", () => {
    expect(presentAt(data, 1, 0, 2)).toBe(true);
    expect(presentAt(data, 2, 0, 2)).toBe(false);
    expect(presentAt(data, 1, 2, 0)).toBe(false);
  });

  it("a duty's need per shift; null is not set", () => {
    const d = { need_morning: 4, need_afternoon: 0, need_night: null };
    expect([0, 1, 2].map((s) => needOf(d, s as 0 | 1 | 2))).toEqual([4, 0, null]);
  });
});

describe("loadsOf", () => {
  const a = (id: number, day: number, shift: number, duty: number, group: number): RotaAssignment =>
    ({ id, edition_id: 1, day, shift, duty_id: duty, group_id: group, source: "hand" }) as RotaAssignment;

  it("counts shifts, nights, per duty, the shifts present (the week's only) and the pairs in a row", () => {
    const loads = loadsOf(
      data,
      [a(1, 0, 1, 100, 11), a(2, 0, 2, 100, 11), a(3, 1, 0, 200, 11), a(4, 2, 1, 200, 11), a(5, 1, 0, 100, 21), a(6, 0, 0, 100, 12)],
      week(),
    );
    expect(loads.get(11)).toEqual({ shifts: 4, nights: 1, byDuty: new Map([[100, 2], [200, 2]]), present: 4, backToBack: 2 });
    expect(loads.get(12)).toEqual({ shifts: 1, nights: 0, byDuty: new Map([[100, 1]]), present: 4, backToBack: 0 });
    expect(loads.get(21)).toEqual({ shifts: 1, nights: 0, byDuty: new Map([[100, 1]]), present: 1, backToBack: 0 });
  });

  it("a group with nothing has an empty load; the order of the assignments does not matter", () => {
    const rows = [a(1, 2, 1, 1, 11), a(2, 0, 2, 1, 11), a(3, 1, 0, 1, 11)];
    expect(loadsOf(data, rows, week()).get(11)).toEqual(loadsOf(data, [...rows].reverse(), week()).get(11));
    expect(loadsOf(data, [], week()).get(21)).toEqual({ shifts: 0, nights: 0, byDuty: new Map(), present: 1, backToBack: 0 });
  });
});

describe("a cohort's flag (v19) and the duties it helps in (v20)", () => {
  it("«הצוות שלה יכול להסיע» is off unless set on — a cohort from before v19 has none", () => {
    expect(canDrive({})).toBe(false);
    expect(canDrive({ can_drive: false })).toBe(false);
    expect(canDrive({ can_drive: true })).toBe(true);
  });

  it("v20: a cohort helps when it has a duty; a group may take a duty its cohort helps in; helpingGroups keeps their order — a group whose cohort is gone helps in nothing", () => {
    const data = {
      cohortDuties: [{ cohort_id: 1, duty_id: 7 }, { cohort_id: 1, duty_id: 8 }, { cohort_id: 3, duty_id: 8 }],
      groups: [{ id: 11, cohort_id: 1 }, { id: 21, cohort_id: 2 }, { id: 31, cohort_id: 3 }, { id: 22, cohort_id: 2 }, { id: 91, cohort_id: 9 }],
    };
    expect([1, 2, 3, 9].map((c) => cohortHelps(data, c))).toEqual([true, false, true, false]);
    expect(cohortDutyIds(data, 1)).toEqual([7, 8]);
    expect(cohortDutyIds(data, 2)).toEqual([]);
    expect([groupHelpsIn(data, { cohort_id: 1 }, 7), groupHelpsIn(data, { cohort_id: 3 }, 7), groupHelpsIn(data, { cohort_id: 3 }, 8)]).toEqual([true, false, true]);
    expect(helpingGroups(data).map((g) => g.id)).toEqual([11, 31]);
    expect(helpingGroups({ cohortDuties: [], groups: [] })).toEqual([]);
  });
});

describe("v20: «חלוקה לקבוצות» and the meals by diet", () => {
  it("splitSizes: ⌈trainees / per group⌉ groups, as equal as possible, the larger first, the sum the trainees", () => {
    expect(splitSizes(23, 8)).toEqual([8, 8, 7]);
    expect(splitSizes(24, 8)).toEqual([8, 8, 8]);
    expect(splitSizes(25, 8)).toEqual([7, 6, 6, 6]); // four groups: as equal as possible, not 8, 8, 8, 1
    expect(splitSizes(5, 8)).toEqual([5]);
    expect(splitSizes(1, 1)).toEqual([1]);
    for (const [t, p] of [[0, 8], [10, 0], [-3, 2], [10.5, 3], [10, 2.5]]) expect(splitSizes(t, p), `${t}/${p}`).toEqual([]);
    for (let t = 1; t <= 120; t++) {
      for (let p = 1; p <= 15; p++) {
        const s = splitSizes(t, p);
        expect(s.reduce((a, b) => a + b, 0), `${t}/${p}`).toBe(t);
        expect(s.length, `${t}/${p}`).toBe(Math.ceil(t / p));
        expect(Math.max(...s) - Math.min(...s), `${t}/${p}`).toBeLessThanOrEqual(1);
        expect(Math.max(...s), `${t}/${p}`).toBeLessThanOrEqual(p);
        expect([...s].sort((a, b) => b - a), `${t}/${p}`).toEqual(s);
      }
    }
  });

  it("dietSplit: «מהם גם וגם» counted once — veg only, gf only, both, the regular rest; TBD where a number it needs is", () => {
    expect(dietSplit({ trainees: 23, diet_veg: 4, diet_gf: 3, diet_both: 2 })).toEqual({ trainees: 23, veg_only: 2, gf_only: 1, both: 2, regular: 18 });
    expect(dietSplit({ trainees: 10, diet_veg: 0, diet_gf: 0, diet_both: 0 })).toEqual({ trainees: 10, veg_only: 0, gf_only: 0, both: 0, regular: 10 });
    expect(dietSplit({ trainees: null, diet_veg: 4, diet_gf: 3, diet_both: 2 })).toEqual({ trainees: null, veg_only: 2, gf_only: 1, both: 2, regular: null });
    expect(dietSplit({ trainees: 23, diet_veg: 4, diet_gf: 3, diet_both: null })).toEqual({ trainees: 23, veg_only: null, gf_only: null, both: null, regular: null });
  });
});
