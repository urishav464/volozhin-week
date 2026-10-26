import { describe, expect, it } from "vitest";
import { demoWeek } from "../data/demoWeek";
import type { Day } from "../domain/time";
import { type AxisPiece, topicAxis } from "./axis";

const week = demoWeek();
const pieces = (day: Day): AxisPiece[] => topicAxis(week, day).flatMap((b) => b.pieces);
const at = (day: Day, start: number) => pieces(day).find((p) => p.start === start);

describe("topicAxis", () => {
  it("cuts a day into blocks at its meals and «מכריכה לכריכה» (Sunday)", () => {
    const blocks = topicAxis(week, 0);
    expect(blocks.map((b) => b.start)).toEqual([510, 870, 1200, 1350, 1470]);
    expect(blocks[0].pieces.map((p) => p.lessons.map((l) => l.categoryId))).toEqual([[3], [3], [3]]);
  });

  it("keeps the pieces of a block in time order, edge to edge", () => {
    for (const day of [0, 1, 2, 3, 4] as Day[]) {
      for (const b of topicAxis(week, day)) {
        expect(b.pieces[0].start).toBe(b.start);
        for (let i = 1; i < b.pieces.length; i++) expect(b.pieces[i].start).toBe(b.pieces[i - 1].end);
      }
    }
  });

  it("makes parallel lessons one piece (Tuesday 16:00)", () => {
    const p = at(2, 960)!;
    expect(p.end).toBe(1050);
    expect(p.lessons).toHaveLength(2);
    expect(p.lessons.every((l) => l.state === "closed")).toBe(true);
  });

  it("keeps a time split two pieces with nothing free between (Monday 14:30)", () => {
    const row = pieces(1).filter((p) => p.start >= 870 && p.end <= 960);
    expect(row.map((p) => [p.start, p.end, p.lessons.length])).toEqual([
      [870, 930, 1],
      [930, 960, 1],
    ]);
  });

  it("makes the night's merge one piece (Monday 00:30–05:00)", () => {
    const p = at(1, 1470)!;
    expect(p.end).toBe(1740);
    expect(p.lessons).toHaveLength(1);
    expect(pieces(1).some((x) => x.start > 1470 && x.start < 1740)).toBe(false);
  });

  it("frees a cancelled lesson's time", () => {
    const sunday = week.lessons.find((l) => l.day === 0 && l.start_min === 870 && l.kind === "lesson")!;
    const cancelled = { ...week, lessons: week.lessons.map((l) => (l.id === sunday.id ? { ...l, state: "cancelled" as const } : l)) };
    expect(topicAxis(cancelled, 0).flatMap((b) => b.pieces).find((p) => p.start === 870)?.lessons).toEqual([]);
  });

  it("leaves out rows not in play that day (Sunday before it opens, Thursday after it ends) and memorial rows", () => {
    expect(pieces(0).some((p) => p.start === 390)).toBe(false);
    expect(pieces(4).every((p) => p.end <= week.edition.last_day_until)).toBe(true);
    for (const day of [0, 1, 2, 3, 4] as Day[]) expect(pieces(day).some((p) => p.start < 870 && p.end > 780)).toBe(false);
  });

  it("gives a draft no topic", () => {
    const p = at(0, 960)!;
    expect(p.lessons).toEqual([expect.objectContaining({ state: "draft", categoryId: null })]);
  });
});
