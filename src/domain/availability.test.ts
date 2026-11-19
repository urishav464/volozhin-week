import { describe, expect, it } from "vitest";
import { emptyWeek } from "../testing/week";
import { activeLessonRows, type AvailabilityRange, coveredRows, dayKind, nextKind, rangesToSlots, slotFit, slotKey, slotsBySpeaker } from "./availability";
import type { Day } from "./time";
import type { GridRow, SlotAvailability } from "./types";

const w = emptyWeek(); // opens Sunday 08:30 (510), closes Thursday at 19:00 (1140)
const row = (start: number) => w.rows.find((r) => r.kind === "lesson" && r.start_min === start)!;
const slot = (day: 0 | 1 | 2 | 3 | 4, start: number, kind: "can" | "cannot", speaker = 7): SlotAvailability => ({
  id: start * 10 + day,
  speaker_id: speaker,
  day,
  row_id: row(start).id,
  kind,
  note: null,
  updated_by: null,
});

describe("availability per slot (v14)", () => {
  it("a day's slots are its active lesson rows — Sunday from the opening, Thursday until the close", () => {
    expect(activeLessonRows(w.rows, w.edition, 0).map((r) => r.start_min)[0]).toBe(510);
    expect(activeLessonRows(w.rows, w.edition, 1).map((r) => r.start_min)[0]).toBe(390);
    expect(activeLessonRows(w.rows, w.edition, 4).every((r) => r.start_min < 1140)).toBe(true);
    expect(activeLessonRows(w.rows, w.edition, 2).every((r) => r.kind === "lesson")).toBe(true);
  });

  it("«לא» on any covered row wins; «יכול/ה» only when every covered row says so", () => {
    const mine = slotsBySpeaker([slot(3, 1470, "can"), slot(3, 1560, "can"), slot(3, 1650, "cannot")]).get(7);
    const night = coveredRows(w.rows, w.edition, 3, 1470, 1740); // a merged night, three rows
    expect(night).toHaveLength(3);
    expect(slotFit(mine, 3, night)).toBe("cannot");
    expect(slotFit(mine, 3, coveredRows(w.rows, w.edition, 3, 1470, 1650))).toBe("can");
    expect(slotFit(mine, 3, coveredRows(w.rows, w.edition, 3, 1350, 1560))).toBeNull(); // 22:30 says nothing
    expect(slotFit(undefined, 3, night)).toBeNull();
    expect(slotFit(mine, 3, [])).toBeNull();
  });

  it("a time split inside one row is judged by that row", () => {
    const mine = slotsBySpeaker([slot(4, 960, "can")]).get(7);
    expect(slotFit(mine, 4, coveredRows(w.rows, w.edition, 4, 960, 1020))).toBe("can");
  });

  it("a day at a glance, and a tap's cycle", () => {
    const mine = slotsBySpeaker([slot(1, 510, "can"), slot(1, 600, "cannot")]).get(7);
    // «יכול/ה» on one row and «לא» on another: part of the day («רק בשעות…»), never read as «לא»
    expect(dayKind(mine, 1, activeLessonRows(w.rows, w.edition, 1))).toBe("some");
    expect(dayKind(mine, 2, activeLessonRows(w.rows, w.edition, 2))).toBeNull();
    const only = slotsBySpeaker([slot(1, 510, "can")]).get(7);
    expect(dayKind(only, 1, activeLessonRows(w.rows, w.edition, 1))).toBe("can");
    const never = slotsBySpeaker([slot(1, 600, "cannot")]).get(7);
    expect(dayKind(never, 1, activeLessonRows(w.rows, w.edition, 1))).toBe("cannot");
    expect([nextKind(null), nextKind("can"), nextKind("cannot")]).toEqual(["can", "cannot", null]);
    expect(slotKey(2, 14)).toBe("2:14");
  });
});

describe("availability typed as time ranges (v18): rangesToSlots", () => {
  // the lesson rows of the 2026 grid, by start: 390–435, 510–600, 600–690, 690–780, 870–960, 960–1050, 1050–1140,
  // 1200–1290, 1350–1440 and the night's 1470–1560, 1560–1650, 1650–1740
  const LESSON_STARTS = [390, 510, 600, 690, 870, 960, 1050, 1200, 1350, 1470, 1560, 1650];
  const can = (day: Day, start: number, end: number): AvailabilityRange => ({ day, start, end, kind: "can" });
  const cannot = (day: Day, start: number, end: number): AvailabilityRange => ({ day, start, end, kind: "cannot" });
  const startOf = new Map(w.rows.map((r) => [r.id, r.start_min]));
  /** The marks as «day:row start:kind», in the order they came. */
  const marks = (days: readonly Day[], ranges: readonly AvailabilityRange[], rest: "can" | "cannot" | null = null, week = w) =>
    rangesToSlots(week.rows, week.edition, days, ranges, rest).map((x) => `${x.day}:${startOf.get(x.row_id)}:${x.kind}`);

  it("one can-range marks every lesson row it covers whole — and only lesson rows: never a meal, מכריכה לכריכה or a memorial time", () => {
    expect(marks([1], [can(1, 510, 780)])).toEqual(["1:510:can", "1:600:can", "1:690:can"]);
    // 13:00–14:30 holds the memorial times and lunch; 19:00–20:00 dinner; 21:30–22:30 מכריכה לכריכה: nothing to mark there
    expect(marks([1], [can(1, 780, 870), can(1, 1140, 1200), can(1, 1290, 1350)])).toEqual([]);
    const all = rangesToSlots(w.rows, w.edition, [2], [can(2, 390, 1830)], null);
    expect(all.map((x) => startOf.get(x.row_id))).toEqual(LESSON_STARTS);
    expect(all.every((x) => x.day === 2 && x.kind === "can" && w.rows.find((r) => r.id === x.row_id)!.kind === "lesson")).toBe(true);
  });

  it("a row a can-range covers only in part is not marked: the range must reach both of its ends", () => {
    expect(marks([1], [can(1, 540, 690)])).toEqual(["1:600:can"]); // 08:30–10:00 from 09:00: not «יכול/ה»
    expect(marks([1], [can(1, 510, 599)])).toEqual([]); // one minute short
    expect(marks([1], [can(1, 511, 600)])).toEqual([]); // one minute late
    expect(marks([1], [can(1, 510, 600)])).toEqual(["1:510:can"]); // exactly the row
    expect(marks([1], [can(1, 500, 610)])).toEqual(["1:510:can"]); // more than the row, less than its neighbours
  });

  it("two can-ranges that meet inside a row do NOT unite — each row needs one range that covers it whole", () => {
    expect(marks([1], [can(1, 510, 555), can(1, 555, 600)])).toEqual([]);
    expect(marks([1], [can(1, 510, 570), can(1, 540, 600)])).toEqual([]); // overlapping halves: still no single range
    // adjacent ranges that each cover a whole row mark both
    expect(marks([1], [can(1, 510, 600), can(1, 600, 690)])).toEqual(["1:510:can", "1:600:can"]);
    // and a row between two ranges that both stop inside it stays unmarked
    expect(marks([1], [can(1, 510, 640), can(1, 640, 780)])).toEqual(["1:510:can", "1:690:can"]);
  });

  it("a cannot-range marks every row it touches at all — a minute is enough; a range that only meets a row's edge does not touch it", () => {
    expect(marks([1], [cannot(1, 599, 601)])).toEqual(["1:510:cannot", "1:600:cannot"]);
    expect(marks([1], [cannot(1, 600, 690)])).toEqual(["1:600:cannot"]); // ends where 11:30 starts, starts where 08:30 ends
    expect(marks([1], [cannot(1, 780, 870)])).toEqual([]); // the lunch break alone: no lesson row
    expect(marks([1], [cannot(1, 435, 510)])).toEqual([]); // between the opening and 08:30
    expect(marks([1], [cannot(1, 434, 511)])).toEqual(["1:390:cannot", "1:510:cannot"]);
  });

  it("where they overlap, «לא» wins over «יכול/ה» — whatever the order of the ranges", () => {
    const expected = ["1:510:can", "1:600:cannot", "1:690:cannot"];
    expect(marks([1], [can(1, 510, 780), cannot(1, 650, 700)])).toEqual(expected);
    expect(marks([1], [cannot(1, 650, 700), can(1, 510, 780)])).toEqual(expected);
    expect(marks([1], [can(1, 510, 600), cannot(1, 510, 600)])).toEqual(["1:510:cannot"]);
  });

  it("the rest decides every row of the listed days that no range decides — and null leaves it unmarked", () => {
    expect(marks([3], [], null)).toEqual([]);
    expect(marks([3], [], "can")).toEqual(LESSON_STARTS.map((s) => `3:${s}:can`));
    expect(marks([3], [], "cannot")).toEqual(LESSON_STARTS.map((s) => `3:${s}:cannot`));
    // a partly covered row takes the rest; a covered one its range; a touched one «לא»
    expect(marks([1], [can(1, 540, 690), cannot(1, 1200, 1210)], "cannot").slice(0, 3)).toEqual(["1:390:cannot", "1:510:cannot", "1:600:can"]);
    const evenings = marks([1], [cannot(1, 1200, 1830)], "can");
    expect(evenings).toEqual([...[390, 510, 600, 690, 870, 960, 1050].map((s) => `1:${s}:can`), ...[1200, 1350, 1470, 1560, 1650].map((s) => `1:${s}:cannot`)]);
  });

  it("a day outside the list is untouched: its ranges are not looked at, and the rest is not for it", () => {
    expect(marks([1], [can(2, 510, 780), cannot(3, 390, 1830)])).toEqual([]);
    expect(marks([1], [can(1, 510, 600), can(2, 510, 600)], "cannot").every((m) => m.startsWith("1:"))).toBe(true);
    expect(marks([], [can(1, 510, 600)], "can")).toEqual([]);
    // a range marks its own day only
    expect(marks([1, 2], [can(2, 510, 600)])).toEqual(["2:510:can"]);
  });

  it("by day, then the row's start — the days as given in any order, once each", () => {
    expect(marks([3, 1, 3], [can(3, 600, 690), can(1, 690, 780), can(1, 510, 600)])).toEqual(["1:510:can", "1:690:can", "3:600:can"]);
    const out = rangesToSlots(w.rows, w.edition, [4, 0], [], "can");
    expect(out.map((x) => x.day)).toEqual([...out.map((x) => x.day)].sort((a, b) => a - b));
    expect(new Set(out.map((x) => `${x.day}:${x.row_id}`)).size).toBe(out.length);
  });

  it("the cut first and last days: only the rows in play — Sunday from the opening, Thursday until the close", () => {
    // Sunday opens 08:30: the 06:30 opening row is not in play, whatever the range or the rest says
    expect(marks([0], [can(0, 390, 600)])).toEqual(["0:510:can"]);
    expect(marks([0], [cannot(0, 390, 435)], "can")[0]).toBe("0:510:can");
    expect(marks([0], [], "cannot")).toEqual(LESSON_STARTS.filter((s) => s >= 510).map((s) => `0:${s}:cannot`));
    // Thursday closes 19:00: nothing from 19:00 on
    expect(marks([4], [can(4, 1050, 1830)])).toEqual(["4:1050:can"]);
    expect(marks([4], [cannot(4, 1140, 1830)], null)).toEqual([]);
    expect(marks([4], [], "can")).toEqual(LESSON_STARTS.filter((s) => s < 1140).map((s) => `4:${s}:can`));
    // a middle day has them all, the night included
    expect(marks([2], [can(2, 1440, 1830)])).toEqual(["2:1470:can", "2:1560:can", "2:1650:can"]);
  });

  it("a row the opening or the close cuts through is in play and judged by its own ends, not by the cut", () => {
    const late = { ...w, edition: { ...w.edition, first_day_from: 540, last_day_until: 1100 } }; // opens 09:00, closes 18:20
    expect(marks([0], [can(0, 540, 690)], null, late)).toEqual(["0:600:can"]); // from the opening on: 08:30–10:00 is only partly covered
    expect(marks([0], [can(0, 510, 690)], null, late)).toEqual(["0:510:can", "0:600:can"]);
    expect(marks([4], [can(4, 1050, 1100)], null, late)).toEqual([]); // until the close: 17:30–19:00 is only partly covered
    expect(marks([4], [cannot(4, 1099, 1100)], null, late)).toEqual(["4:1050:cannot"]);
    const noOpening = { ...w, edition: { ...w.edition, first_day_from: null } }; // Sunday not cut at all
    expect(marks([0], [can(0, 390, 435)], null, noOpening)).toEqual(["0:390:can"]);
  });

  it("a row is marked only on the days it runs", () => {
    const rows: GridRow[] = [
      { id: 71, start_min: 510, end_min: 600, kind: "lesson", label: "", days: [1, 2] },
      { id: 72, start_min: 600, end_min: 690, kind: "lesson", label: "", days: [2] },
      { id: 73, start_min: 690, end_min: 780, kind: "fixed", label: "ארוחה", days: [1, 2] },
    ];
    const out = rangesToSlots(rows, w.edition, [1, 2, 3], [can(1, 510, 780), cannot(2, 600, 601)], "can");
    expect(out).toEqual([
      { day: 1, row_id: 71, kind: "can" },
      { day: 2, row_id: 71, kind: "can" }, // the rest
      { day: 2, row_id: 72, kind: "cannot" },
    ]);
  });

  it("agrees with what the grid reads back: a lesson over rows the ranges marked «יכול/ה» fits, one a «לא» touches does not", () => {
    const ranges = [can(3, 1440, 1830), cannot(3, 1700, 1710)];
    const slots: SlotAvailability[] = rangesToSlots(w.rows, w.edition, [3], ranges, null).map((x, i) => ({ id: i + 1, speaker_id: 7, ...x, note: null, updated_by: null }));
    const mine = slotsBySpeaker(slots).get(7);
    expect(slotFit(mine, 3, coveredRows(w.rows, w.edition, 3, 1470, 1650))).toBe("can");
    expect(slotFit(mine, 3, coveredRows(w.rows, w.edition, 3, 1470, 1740))).toBe("cannot");
    expect(dayKind(mine, 3, activeLessonRows(w.rows, w.edition, 3))).toBe("some");
  });
});
