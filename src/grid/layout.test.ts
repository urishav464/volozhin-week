import { describe, expect, it } from "vitest";
import { TEMPLATE_2026 } from "../domain/template2026";
import { LESSON_STAGE_DEFAULTS, type Lesson } from "../domain/types";
import { buildLayout, freeCells, placeDay, rowActive } from "./layout";

const layout = buildLayout(TEMPLATE_2026);
const band = (start: number) => layout.bands.find((b) => b.row.start_min === start)!;

let nextId = 1;
function lesson(day: 0 | 1 | 2 | 3 | 4, start: number, end: number, room = 1, state: Lesson["state"] = "closed"): Lesson {
  return {
    id: nextId++, kind: "lesson", state, day, start_min: start, end_min: end, room_id: room,
    title: null, category_id: null, audience: null, teach_min: null, parallel_reason: null, ...LESSON_STAGE_DEFAULTS, version: 1, updated_by: null,
  };
}

const window = { first_day_from: 510, last_day_until: 1140 };

describe("buildLayout", () => {
  it("stacks the 2026 rows in time order without gaps", () => {
    expect(layout.bands).toHaveLength(TEMPLATE_2026.length);
    for (let i = 1; i < layout.bands.length; i++) {
      expect(layout.bands[i].top).toBe(layout.bands[i - 1].top + layout.bands[i - 1].height);
    }
  });

  it("clips the poster's own overlap (opening 06:30–07:15 vs breakfast 07:00–08:00)", () => {
    const breakfast = band(420);
    expect(breakfast.t0).toBe(435);
    expect(breakfast.t1).toBe(480);
  });

  it("maps a row's start and end to its band's edges", () => {
    const b = band(870);
    expect(layout.yOf(870)).toBe(b.top);
    expect(layout.yOf(960)).toBe(b.top + b.height);
    expect(layout.yOf(915)).toBe(b.top + b.height / 2);
  });
});

describe("placeDay", () => {
  it("draws a single lesson as its row", () => {
    const [p] = placeDay(layout, [lesson(0, 510, 600)]);
    expect(p.top).toBe(band(510).top);
    expect(p.height).toBe(band(510).height);
    expect([p.lane, p.lanes]).toEqual([0, 1]);
  });

  it("splits a row in time: 60+30, one lane, stacked", () => {
    const placed = placeDay(layout, [lesson(1, 870, 930), lesson(1, 930, 960)]);
    const b = band(870);
    expect(placed.map((p) => [p.lane, p.lanes])).toEqual([[0, 1], [0, 1]]);
    expect(placed[0].height).toBeCloseTo((b.height * 2) / 3);
    expect(placed[1].top).toBeCloseTo(b.top + (b.height * 2) / 3);
  });

  it("gives parallel lessons lanes, only where they overlap", () => {
    const placed = placeDay(layout, [lesson(2, 960, 1050, 1), lesson(2, 960, 1050, 2), lesson(2, 1050, 1140, 1)]);
    expect(placed.slice(0, 2).map((p) => [p.lane, p.lanes])).toEqual([[0, 2], [1, 2]]);
    expect([placed[2].lane, placed[2].lanes]).toEqual([0, 1]); // the 17:30 lesson keeps the full width
  });

  it("merges 00:30–05:00 into one box over three night rows", () => {
    const [p] = placeDay(layout, [lesson(1, 1470, 1740)]);
    expect(p.top).toBe(band(1470).top);
    expect(p.top + p.height).toBe(band(1650).top + band(1650).height);
  });

  it("drops cancelled lessons", () => {
    expect(placeDay(layout, [lesson(0, 510, 600, 1, "cancelled")])).toEqual([]);
  });
});

describe("freeCells and the edition's window", () => {
  it("lists lesson rows nobody touches; drafts count as taken", () => {
    const lessons = [lesson(3, 510, 600), lesson(3, 600, 690, 1, "draft"), lesson(3, 1470, 1740)];
    const free = freeCells(layout, 3, lessons, window).map((c) => c.row.start_min);
    expect(free).not.toContain(510);
    expect(free).not.toContain(600);
    expect(free).not.toContain(1560); // inside the merged night lesson
    expect(free).toContain(690);
    expect(free).toContain(390);
  });

  it("closes Sunday before the opening and Thursday from 19:00", () => {
    const opening = TEMPLATE_2026.find((r) => r.start_min === 390)!;
    const evening = TEMPLATE_2026.find((r) => r.start_min === 1200)!;
    expect(rowActive(opening, 0, window)).toBe(false);
    expect(rowActive(opening, 1, window)).toBe(true);
    expect(rowActive(evening, 4, window)).toBe(false);
    expect(rowActive(evening, 3, window)).toBe(true);
    expect(freeCells(layout, 4, [], window).every((c) => c.row.start_min < 1140)).toBe(true);
  });

  it("treats a TBD Sunday opening as the whole day open", () => {
    const opening = TEMPLATE_2026.find((r) => r.start_min === 390)!;
    expect(rowActive(opening, 0, { first_day_from: null, last_day_until: 1140 })).toBe(true);
  });
});
