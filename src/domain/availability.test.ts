import { describe, expect, it } from "vitest";
import { emptyWeek } from "../testing/week";
import { activeLessonRows, coveredRows, dayKind, nextKind, slotFit, slotKey, slotsBySpeaker } from "./availability";
import type { SlotAvailability } from "./types";

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
    expect(dayKind(mine, 1, activeLessonRows(w.rows, w.edition, 1))).toBe("cannot");
    expect(dayKind(mine, 2, activeLessonRows(w.rows, w.edition, 2))).toBeNull();
    expect([nextKind(null), nextKind("can"), nextKind("cannot")]).toEqual(["can", "cannot", null]);
    expect(slotKey(2, 14)).toBe("2:14");
  });
});
