// What «קבוצות ומכינות» says and computes before it writes (cohorts.ts, v20): a cohort's numbers and duties, what deleting
// its groups takes with it, the split's preview and its limits, the sizes against the trainees, the form's live diet
// line (and that it stays silent where the guard would refuse), and which cohorts a new duty goes to. Synthetic only.
import { describe, expect, it } from "vitest";
import { EMPTY_ROTA, type RotaData } from "../../../data/rota";
import { splitSizes } from "../../../domain/rota";
import {
  codesText, cohortDutyNames, cohortNumbersText, dietSplitText, DUTY_ORDER_HINT, dutyHelpers, groupsLossText, newDutyTargets, sameIds, sizesAgainstTrainees, splitPreviewText, splitProblem,
} from "./cohorts";

const cohort = (id: number, letter: string, sort: number, extra: Partial<RotaData["cohorts"][number]> = {}) => ({
  id, edition_id: 1, letter, name: `מכינה לדוגמה ${letter}`, trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort, ...extra,
});
const duty = (id: number, name: string, sort: number) => ({ id, edition_id: 1, name, description: null, need_morning: 1, need_afternoon: 1, need_night: 1, min_people: null, sort });

function rota(): RotaData {
  return {
    ...EMPTY_ROTA,
    cohorts: [cohort(2, "ב", 2), cohort(1, "א", 1, { trainees: 23 }), cohort(3, "נ", 3)],
    duties: [duty(9, "נקיון", 3), duty(7, "בית מדרש", 1), duty(8, "מטבח", 2)],
    cohortDuties: [
      { cohort_id: 1, duty_id: 9 },
      { cohort_id: 1, duty_id: 7 },
      { cohort_id: 2, duty_id: 7 },
    ],
    groups: [
      { id: 11, edition_id: 1, cohort_id: 1, number: 1, size: 8, head_name: "ראש/ת קבוצה לדוגמה" },
      { id: 12, edition_id: 1, cohort_id: 1, number: 2, size: 8, head_name: null },
      { id: 13, edition_id: 1, cohort_id: 1, number: 3, size: 6, head_name: null },
      { id: 21, edition_id: 1, cohort_id: 2, number: 2, size: null, head_name: null },
    ],
    assignments: [
      { id: 1, edition_id: 1, day: 0, shift: 0, duty_id: 7, group_id: 11, source: "hand" },
      { id: 2, edition_id: 1, day: 0, shift: 1, duty_id: 9, group_id: 12, source: "suggested" },
      { id: 3, edition_id: 1, day: 1, shift: 0, duty_id: 7, group_id: 21, source: "hand" },
    ],
    prep: [
      { id: 1, edition_id: 1, text: "משימה לדוגמה", group_id: 13, done: false, sort: 1 },
      { id: 2, edition_id: 1, text: "משימה לדוגמה ב", group_id: null, done: false, sort: 2 },
    ],
  };
}

describe("a cohort's line", () => {
  it("its trainees and three diet numbers, TBD where not typed — «תזונה: TBD» when none of the three is", () => {
    expect(cohortNumbersText({ trainees: 48, diet_veg: 5, diet_gf: 2, diet_both: 1 })).toBe("48 חניכים · צמחוני/טבעוני 5 · ללא גלוטן 2 · מהם גם וגם 1");
    expect(cohortNumbersText({ trainees: null, diet_veg: null, diet_gf: null, diet_both: null })).toBe("חניכים: TBD · תזונה: TBD");
    expect(cohortNumbersText({ trainees: 1, diet_veg: 0, diet_gf: null, diet_both: null })).toBe("חניך/ה אחד/ת · צמחוני/טבעוני 0 · ללא גלוטן TBD · מהם גם וגם TBD");
  });

  it("the duties it helps in, in the duties' order; none for a cohort that helps in none", () => {
    expect(cohortDutyNames(rota(), 1)).toEqual(["בית מדרש", "נקיון"]);
    expect(cohortDutyNames(rota(), 2)).toEqual(["בית מדרש"]);
    expect(cohortDutyNames(rota(), 3)).toEqual([]);
  });

  it("the cohorts that help in a duty, in the cohorts' order", () => {
    expect(dutyHelpers(rota(), 7).map((c) => c.letter)).toEqual(["א", "ב"]);
    expect(dutyHelpers(rota(), 8)).toEqual([]);
  });
});

describe("what deleting a cohort's groups takes with it", () => {
  it("names the groups by code, counts their assignments and tasks, and says the heads go", () => {
    expect(groupsLossText(rota(), 1)).toBe("3 הקבוצות שלה (א1–א3) יימחקו, ואיתן 2 השיבוצים שלהן, השמות והטלפונים של ראשי הקבוצות; משימת מוצ״ש אחת שלהן תישאר בלי קבוצה");
    expect(groupsLossText(rota(), 2)).toBe("הקבוצה שלה (ב2) תימחק, ואיתה השיבוץ שלה, השם והטלפון של ראש/ת הקבוצה");
    expect(groupsLossText(rota(), 3)).toBe(""); // no groups: nothing goes
    const more = rota();
    more.prep.push({ id: 3, edition_id: 1, text: "משימה לדוגמה ג", group_id: 11, done: true, sort: 3 });
    more.assignments = [];
    expect(groupsLossText(more, 1)).toBe("3 הקבוצות שלה (א1–א3) יימחקו, ואיתן השמות והטלפונים של ראשי הקבוצות; 2 משימות מוצ״ש שלהן יישארו בלי קבוצה");
  });

  it("writes a run from 1 as a range, anything else as a list", () => {
    expect(codesText("א", [3, 1, 2, 4])).toBe("א1–א4");
    expect(codesText("א", [1, 2])).toBe("א1, א2");
    expect(codesText("נ", [1, 3, 4])).toBe("נ1, נ3, נ4");
    expect(codesText("ב", [2])).toBe("ב2");
  });
});

describe("«חלוקה לקבוצות»", () => {
  it("previews the split as the groups' codes and sizes (as equal as possible, the larger first; their sum the trainees)", () => {
    const sizes = splitSizes(23, 8);
    expect(sizes).toEqual([8, 8, 7]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(23);
    expect(splitPreviewText("א", sizes)).toBe("3 קבוצות: א1 — 8, א2 — 8, א3 — 7");
    expect(splitPreviewText("א", [5])).toBe("קבוצה אחת: א1 — 5");
    expect(splitPreviewText("א", [])).toBe("");
    // many sizes: still equal within one, summing to the trainees
    for (const [t, p] of [[48, 8], [47, 6], [40, 7], [1, 8], [1000, 11]] as const) {
      const s = splitSizes(t, p);
      expect(s.reduce((a, b) => a + b, 0)).toBe(t);
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
      expect(s).toEqual([...s].sort((a, b) => b - a));
      expect(s.length).toBe(Math.ceil(t / p));
    }
  });

  it("says before sending what rota_split_cohort refuses: no group, more than 99, one over 200", () => {
    expect(splitProblem([])).not.toBeNull();
    expect(splitSizes(1000, 10)).toHaveLength(100); // one group too many
    expect(splitProblem(splitSizes(1000, 10))).toBe("יותר מ-99 קבוצות: מגדילים את הקבוצה.");
    expect(splitProblem(splitSizes(990, 10))).toBeNull(); // 99 groups
    expect(splitProblem(splitSizes(1000, 500))).toBe("קבוצה של יותר מ-200: מקטינים את הקבוצה.");
    expect(splitProblem([201])).toBe("קבוצה של יותר מ-200: מקטינים את הקבוצה.");
    expect(splitProblem([200, 199])).toBeNull();
  });

  it("tells when the groups' sizes do not add up to the trainees (both known)", () => {
    expect(sizesAgainstTrainees({ trainees: 23 }, [8, 8, 6])).toBe("בקבוצות 22 מתוך 23 החניכים");
    expect(sizesAgainstTrainees({ trainees: 23 }, [8, 8, 7])).toBeNull();
    expect(sizesAgainstTrainees({ trainees: null }, [8])).toBeNull();
    expect(sizesAgainstTrainees({ trainees: 23 }, [8, null])).toBeNull();
    expect(sizesAgainstTrainees({ trainees: 23 }, [])).toBeNull();
  });
});

describe("the cohort form's live diet line", () => {
  it("once all four are known and agree: the meals, «מהם גם וגם» counted once", () => {
    expect(dietSplitText({ trainees: 30, diet_veg: 4, diet_gf: 2, diet_both: 1 })).toBe("כלומר: צמחוני/טבעוני בלבד 3 · ללא גלוטן בלבד 1 · גם וגם 1 · רגיל 25");
    expect(dietSplitText({ trainees: 6, diet_veg: 4, diet_gf: 2, diet_both: 0 })).toBe("כלומר: צמחוני/טבעוני בלבד 4 · ללא גלוטן בלבד 2 · גם וגם 0 · רגיל 0");
  });

  it("silent while one is TBD or not a number, and where the guard refuses (rota_diets_exceed)", () => {
    expect(dietSplitText({ trainees: null, diet_veg: 4, diet_gf: 2, diet_both: 1 })).toBeNull();
    expect(dietSplitText({ trainees: 30, diet_veg: Number.NaN, diet_gf: 2, diet_both: 1 })).toBeNull();
    expect(dietSplitText({ trainees: 30, diet_veg: 1, diet_gf: 2, diet_both: 2 })).toBeNull(); // both > veg
    expect(dietSplitText({ trainees: 5, diet_veg: 4, diet_gf: 3, diet_both: 1 })).toBeNull(); // 4 + 3 − 1 > 5
    expect(dietSplitText({ trainees: 2000, diet_veg: 4, diet_gf: 3, diet_both: 1 })).toBeNull(); // over 1000: bad_value
  });
});

describe("a new duty's «כל המכינות העוזרות עוזרות בה»", () => {
  it("goes to the cohorts that help in some duty — and, before the edition has any duty, to every cohort", () => {
    expect(newDutyTargets(rota()).map((c) => c.letter)).toEqual(["א", "ב"]);
    expect(newDutyTargets({ ...rota(), duties: [], cohortDuties: [] }).map((c) => c.letter)).toEqual(["א", "ב", "נ"]);
    expect(newDutyTargets({ ...EMPTY_ROTA })).toEqual([]);
  });

  it("the order's hint is the owner's sentence", () => {
    expect(DUTY_ORDER_HINT).toBe("הסדר כאן הוא הסדר בלוח ובדפים. כשאין מספיק קבוצות, התורנות שלמעלה מתמלאת קודם.");
  });

  it("compares the duties as sets", () => {
    expect(sameIds([1, 2], [2, 1])).toBe(true);
    expect(sameIds([1, 2, 2], [2, 1])).toBe(true);
    expect(sameIds([1], [1, 2])).toBe(false);
    expect(sameIds([], [])).toBe(true);
  });
});
