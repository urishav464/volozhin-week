import { describe, expect, it } from "vitest";
import { chipsOf, DAY_PARTS, dayPart } from "./dayParts";
import type { Availability } from "./types";

const row = (day: 0 | 1 | 2 | 3 | 4, from: number, to: number, kind: "can" | "cannot", note: string | null = null, id = from): Availability => ({ id, approach_id: 1, day, from_min: from, to_min: to, kind, note });

describe("day parts", () => {
  it("cover the grid's day from 06:30 to 06:30, back to back", () => {
    expect(DAY_PARTS[0].from).toBe(390);
    expect(DAY_PARTS.at(-1)!.to).toBe(1830);
    for (let i = 1; i < DAY_PARTS.length; i++) expect(DAY_PARTS[i].from).toBe(DAY_PARTS[i - 1].to);
    expect(dayPart("evening")).toMatchObject({ from: 1140, to: 1440 });
    expect(dayPart("toString")).toBeUndefined();
  });

  it("make 5 × 4 chips; «לא» wins; a row covering part of a part is marked partial", () => {
    const chips = chipsOf([row(0, 390, 780, "cannot", "לא בבקרים"), row(2, 1200, 1830, "can"), row(2, 1140, 1440, "cannot", null, 9)]);
    expect(chips).toHaveLength(20);
    const at = (day: number, part: string) => chips.find((c) => c.day === day && c.part === part)!;
    expect(at(0, "morning")).toMatchObject({ kind: "cannot", note: "לא בבקרים", partial: false });
    expect(at(0, "afternoon")).toMatchObject({ kind: null, partial: false });
    expect(at(2, "evening")).toMatchObject({ kind: "cannot", partial: false });
    expect(at(2, "night")).toMatchObject({ kind: "can", partial: false });
    expect(chipsOf([row(3, 600, 900, "can")]).filter((c) => c.kind).map((c) => `${c.part}:${c.partial}`)).toEqual(["morning:true", "afternoon:true"]);
  });
});
