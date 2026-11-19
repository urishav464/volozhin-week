import { describe, expect, it } from "vitest";
import { emptyWeek } from "../testing/week";
import { activeLessonRows, type AvailabilityRange, rangesToSlots } from "./availability";
import { daySpan, type DayForm, formMatchesSlots, gridMinute, MAX_PAIRS, pairRanges, previewOf, rangesCall, rangesFormOf, type RangesForm, shiftPresets, touchedDays } from "./rangesForm";
import type { Day } from "./time";

// The 2026 template; Sunday opens at 08:30 (first_day_from 510), Thursday closes at 19:00 (last_day_until 1140).
const w = emptyWeek();
const { rows, edition } = w;
const rowAt = (start: number) => rows.find((r) => r.kind === "lesson" && r.start_min === start)!;
const hours = (...pairs: [string, string][]): DayForm => ({ mode: "hours", pairs: pairs.map(([from, to]) => ({ from, to })) });
const slot = (day: Day, start: number, kind: "can" | "cannot") => ({ day, row_id: rowAt(start).id, kind });
const unknownWeek = (): RangesForm => rangesFormOf(rows, edition, []);

describe("the editor's clock", () => {
  it("a time as the grid's minutes: the night after the day, and 06:30 as an end is the next morning", () => {
    expect(gridMinute("08:30", false)).toBe(510);
    expect(gridMinute("8:30", false)).toBe(510);
    expect(gridMinute("00:30", false)).toBe(1470);
    expect(gridMinute("06:29", true)).toBe(1829);
    expect(gridMinute("06:30", false)).toBe(390);
    expect(gridMinute("06:30", true)).toBe(1830);
    expect(gridMinute("00:00", true)).toBe(1440);
    for (const bad of ["", "24:00", "12:60", "12", "ab:cd"]) expect(gridMinute(bad, false)).toBeNull();
  });

  it("a day's span: its first lesson row's start to its last one's end, cut by Sunday's opening and Thursday's close", () => {
    expect(daySpan(rows, edition, 1)).toEqual({ start: 390, end: 1740 });
    expect(daySpan(rows, edition, 0)).toEqual({ start: 510, end: 1740 });
    expect(daySpan(rows, edition, 4)).toEqual({ start: 390, end: 1140 });
    expect(daySpan(rows.filter((r) => r.kind !== "lesson"), edition, 1)).toBeNull();
  });
});

describe("the form from the slots (rangesFormOf)", () => {
  it("nothing → «לא ידוע»; every row «יכול/ה» → «כל היום»; every row «לא» → «לא יכול/ה»; else the runs of «יכול/ה»", () => {
    const all = activeLessonRows(rows, edition, 2).map((r) => ({ day: 2 as Day, row_id: r.id, kind: "can" as const }));
    const none = activeLessonRows(rows, edition, 3).map((r) => ({ day: 3 as Day, row_id: r.id, kind: "cannot" as const }));
    const mixed = [slot(1, 960, "can"), slot(1, 1050, "can"), slot(1, 1200, "cannot"), slot(1, 1350, "can"), slot(1, 1470, "can"), slot(1, 510, "cannot")];
    const f = rangesFormOf(rows, edition, [...all, ...none, ...mixed]);
    expect(f[0]).toEqual({ mode: "unknown", pairs: [] });
    expect(f[2]).toEqual({ mode: "all", pairs: [] });
    expect(f[3]).toEqual({ mode: "cannot", pairs: [] });
    // 16:00–19:00 is one run; 22:30–00:00 and 00:30–02:00 are neighbours in the list of lesson rows: one run
    expect(f[1]).toEqual(hours(["16:00", "19:00"], ["22:30", "02:00"]));
    expect(Object.keys(f).sort()).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("a slot of a row the day no longer holds is not read", () => {
    expect(rangesFormOf(rows, edition, [slot(0, 390, "can")])[0]).toEqual({ mode: "unknown", pairs: [] });
  });
});

describe("the save (rangesCall)", () => {
  it("only the days that changed; «לא ידוע» clears a day, «כל היום» and «לא יכול/ה» cover its span", () => {
    const initial = rangesFormOf(rows, edition, [slot(2, 510, "can")]);
    const current: RangesForm = { ...initial, 0: { mode: "all", pairs: [] }, 2: { mode: "unknown", pairs: [] }, 4: { mode: "cannot", pairs: [] } };
    // a pair typed under another mode is not a change
    current[3] = { mode: "unknown", pairs: [{ from: "08:30", to: "10:00" }] };
    expect(touchedDays(initial, current)).toEqual([0, 2, 4]);
    const call = rangesCall(rows, edition, initial, current);
    expect(call.problems).toEqual({});
    expect(call.days).toEqual([0, 2, 4]);
    expect(call.ranges).toEqual([
      { day: 0, start: 510, end: 1740, kind: "can" },
      { day: 4, start: 390, end: 1140, kind: "cannot" },
    ]);
  });

  it("«רק בשעות…»: the pairs as «יכול/ה», «לא» over every gap — 17:00–19:00 marks 17:30–19:00 and nothing else «יכול/ה»", () => {
    const initial = unknownWeek();
    const call = rangesCall(rows, edition, initial, { ...initial, 1: hours(["17:00", "19:00"]) });
    expect(call.days).toEqual([1]);
    expect(call.ranges).toEqual([
      { day: 1, start: 390, end: 1020, kind: "cannot" },
      { day: 1, start: 1020, end: 1140, kind: "can" },
      { day: 1, start: 1140, end: 1740, kind: "cannot" },
    ]);
    const marked = rangesToSlots(rows, edition, call.days, call.ranges, null);
    expect(marked.filter((x) => x.kind === "can").map((x) => x.row_id)).toEqual([rowAt(1050).id]);
    expect(marked).toHaveLength(activeLessonRows(rows, edition, 1).length); // every other row «לא»
  });

  it("pairs are clamped to the day and merged where they touch; the night is the day's", () => {
    expect(pairRanges([{ from: "06:45", to: "08:00" }], { start: 510, end: 1740 })).toEqual({ problem: "טווח מחוץ לשעות היום." });
    expect(pairRanges([{ from: "07:00", to: "10:00" }], { start: 510, end: 1740 })).toEqual({ can: [{ start: 510, end: 600 }] });
    expect(pairRanges([{ from: "16:00", to: "17:30" }, { from: "17:30", to: "19:00" }, { from: "12:00", to: "13:00" }], { start: 390, end: 1740 })).toEqual({
      can: [
        { start: 720, end: 780 },
        { start: 960, end: 1140 },
      ],
    });
    expect(pairRanges([{ from: "23:00", to: "02:00" }], { start: 390, end: 1740 })).toEqual({ can: [{ start: 1380, end: 1560 }] });
    expect(pairRanges([{ from: "22:00", to: "06:30" }], { start: 390, end: 1740 })).toEqual({ can: [{ start: 1320, end: 1740 }] });
    // «from six in the morning»: before the day opens, clamped to its start — not the night after (then «עד» before «מ־»)
    expect(pairRanges([{ from: "06:00", to: "10:00" }], { start: 390, end: 1740 })).toEqual({ can: [{ start: 390, end: 600 }] });
    expect(pairRanges([{ from: "05:00", to: "07:00" }], { start: 510, end: 1740 })).toEqual({ problem: "טווח מחוץ לשעות היום." });
    // a night that wraps, or one wholly after midnight, is still the night
    expect(pairRanges([{ from: "02:00", to: "04:00" }], { start: 390, end: 1740 })).toEqual({ can: [{ start: 1560, end: 1680 }] });
    expect(pairRanges([{ from: "04:00", to: "02:00" }], { start: 390, end: 1740 })).toEqual({ problem: "«עד» צריך להיות אחרי «מ־»." });
  });

  it("a «רק בשעות…» day is row for row what its pairs say with every other row «לא» (seeded random pairs)", () => {
    let seed = 5787;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const clock = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    for (let i = 0; i < 300; i++) {
      const day = rand(5) as Day;
      const span = daySpan(rows, edition, day)!;
      const pairs: [string, string][] = [];
      for (let k = 0; k <= rand(MAX_PAIRS); k++) {
        const a = span.start + rand(Math.floor((span.end - span.start) / 5)) * 5;
        const b = Math.min(span.end, a + 5 + rand(60) * 5);
        pairs.push([clock(a), clock(b)]);
      }
      const initial = unknownWeek();
      const call = rangesCall(rows, edition, initial, { ...initial, [day]: hours(...pairs) });
      expect(call.problems).toEqual({});
      const canOnly: AvailabilityRange[] = call.ranges.filter((r) => r.kind === "can");
      expect(rangesToSlots(rows, edition, call.days, call.ranges, null)).toEqual(rangesToSlots(rows, edition, call.days, canOnly, "cannot"));
    }
  });

  it("what is wrong with a day holds the save, said on that day", () => {
    const initial = unknownWeek();
    const current: RangesForm = { ...initial, 1: hours(), 2: hours(["10:00", ""]), 3: hours(["12:00", "11:00"]), 0: hours(["06:45", "08:00"]) };
    expect(rangesCall(rows, edition, initial, current).problems).toEqual({
      0: "טווח מחוץ לשעות היום.",
      1: "צריך לפחות טווח אחד.",
      2: "צריך שעה בכל «מ־» ו«עד».",
      3: "«עד» צריך להיות אחרי «מ־».",
    });
  });

  it("more than the call's 40 ranges is said on the last day saved", () => {
    const initial = unknownWeek();
    const many = hours(["08:30", "10:00"], ["11:30", "13:00"], ["16:00", "17:30"], ["20:00", "21:30"], ["00:30", "02:00"], ["03:30", "05:00"], ["14:30", "15:00"], ["10:30", "11:00"]);
    const call = rangesCall(rows, edition, initial, { ...initial, 1: many, 2: many, 3: many });
    expect(call.ranges.length).toBeGreaterThan(40);
    expect(Object.keys(call.problems)).toEqual(["3"]);
  });

  it("the form read back from what a save marks says the same (rows' own edges)", () => {
    const initial = unknownWeek();
    const current: RangesForm = { ...initial, 0: { mode: "all", pairs: [] }, 1: hours(["08:30", "11:30"], ["17:30", "21:30"]), 3: { mode: "cannot", pairs: [] } };
    const call = rangesCall(rows, edition, initial, current);
    const slots = rangesToSlots(rows, edition, call.days, call.ranges, null);
    expect(rangesFormOf(rows, edition, slots)).toEqual(current);
    for (const d of [0, 1, 2, 3, 4] as Day[]) expect(formMatchesSlots(rows, edition, d, current[d]!, slots)).toBe(true);
  });

  it("a day marked finer than the four modes says so (formMatchesSlots)", () => {
    const slots = [slot(1, 960, "cannot")]; // one «לא», the rest unknown
    const f = rangesFormOf(rows, edition, slots);
    // not «רק בשעות…» with no hours («can at no hour»): unknown, and the editor says the day is marked finer
    expect(f[1]).toEqual({ mode: "unknown", pairs: [] });
    expect(formMatchesSlots(rows, edition, 1, f[1]!, slots)).toBe(false);
    const run = [slot(2, 960, "can")]; // a «יכול/ה» run with unknown rows around it: saved, they would be «לא»
    expect(formMatchesSlots(rows, edition, 2, rangesFormOf(rows, edition, run)[2]!, run)).toBe(false);
  });
});

describe("the preview and the presets", () => {
  it("every row of each day saved, with its verdict (none: «לא ידוע»)", () => {
    const initial = unknownWeek();
    const call = rangesCall(rows, edition, initial, { ...initial, 4: hours(["16:00", "19:00"]), 2: { mode: "unknown", pairs: [] } });
    const p = previewOf(rows, edition, call.days, call.ranges);
    expect(new Set(p.map((x) => x.day))).toEqual(new Set([4]));
    expect(p.filter((x) => x.kind === "can").map((x) => x.row.start_min)).toEqual([960, 1050]);
    expect(p.find((x) => x.row.start_min === 870)?.kind).toBe("cannot");
    expect(previewOf(rows, edition, [2], []).every((x) => x.kind === null)).toBe(true);
  });

  it("quick pairs from the edition's shifts, clipped to the day", () => {
    expect(shiftPresets(edition, daySpan(rows, edition, 1)!)).toEqual([
      { label: "בוקר", from: "06:30", to: "14:30" },
      { label: "אחר צהריים", from: "14:30", to: "22:30" },
      { label: "לילה", from: "22:30", to: "05:00" },
    ]);
    expect(shiftPresets(edition, daySpan(rows, edition, 4)!).map((p) => p.label)).toEqual(["בוקר", "אחר צהריים"]);
    const own = { settings: { rota_shifts: { cuts: [780, 1200] as [number, number], labels: ["א", "ב", "ג"] as [string, string, string] } } };
    expect(shiftPresets(own, { start: 510, end: 1740 })[0]).toEqual({ label: "א", from: "08:30", to: "13:00" });
  });
});
