// loadRange (Suggest.tsx): the «עומס X–Y» the board and the suggestion's status say — over the groups whose cohort is
// on campus at all, and (v19) of a cohort that helps.
import { describe, expect, it } from "vitest";
import type { GroupLoad } from "../../../domain/rota";
import { loadRange } from "./Suggest";

const load = (shifts: number, present: number): GroupLoad => ({ shifts, nights: 0, byDuty: new Map(), present, backToBack: 0 });

describe("loadRange", () => {
  const loads = new Map([
    [11, load(4, 14)],
    [12, load(6, 14)],
    [21, load(0, 14)], // «נ», which does not help
    [31, load(0, 0)], // never on campus
  ]);
  const data = { cohorts: [{ id: 1 }, { id: 2, helps_rota: false }, { id: 3 }], groups: [{ id: 11, cohort_id: 1 }, { id: 12, cohort_id: 1 }, { id: 21, cohort_id: 2 }, { id: 31, cohort_id: 3 }] };

  it("leaves out a group never on campus; with the rota, a group of a cohort that does not help too", () => {
    expect(loadRange(loads)).toEqual([0, 6]);
    expect(loadRange(loads, data)).toEqual([4, 6]);
    expect(loadRange(new Map([[21, load(0, 14)]]), data)).toBeNull();
  });
});
