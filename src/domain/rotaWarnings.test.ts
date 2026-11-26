// src/domain/rotaWarnings.ts: each warning fires where it should and stays quiet otherwise — from a quiet rota (one
// cohort on campus all week helping in its one duty, four groups each with a head, one duty a group a shift), one
// change at a time. v20: no «אחראי/ת משמרת» (no_lead) and no diets_exceed (the guard holds the diets); a hand-made row on
// a duty the group's cohort does not help in is `not_eligible`. Synthetic only.
import { describe, expect, it } from "vitest";
import type { RotaData, ShiftIndex } from "../data/rota";
import { rotaSlots, slotIndex } from "./rota";
import { cellWarnings, groupWarnings, rotaWarnings, type RotaWarning, unevenLoad } from "./rotaWarnings";
import type { Day } from "./time";

const WEEK = { first_day_from: 510, last_day_until: 1140, settings: {} };

/** א1–א4 (11–14) take the week's 14 shifts of «מטבח» (duty 1) in turn: four groups, never two shifts in a row. */
function quiet(): RotaData {
  const slots = rotaSlots(WEEK);
  const groups = [11, 12, 13, 14];
  return {
    cohorts: [{ id: 1, edition_id: 1, letter: "א", name: "מכינה לדוגמה א", trainees: 34, diet_veg: 3, diet_gf: 0, diet_both: 0, contact_name: null, sort: 1 }],
    cohortDuties: [{ cohort_id: 1, duty_id: 1 }],
    presence: slots.map((s) => ({ cohort_id: 1, ...s })),
    groups: groups.map((id, i) => ({ id, edition_id: 1, cohort_id: 1, number: i + 1, size: [8, 9, 10, 7][i], head_name: `ראש/ת קבוצה לדוגמה ${i + 1}` })),
    duties: [{ id: 1, edition_id: 1, name: "מטבח", description: null, need_morning: 1, need_afternoon: 1, need_night: 1, min_people: null, sort: 1 }],
    assignments: slots.map((s, i) => ({ id: i + 1, edition_id: 1, day: s.day, shift: s.shift, duty_id: 1, group_id: groups[i % 4], source: "hand" as const })),
    staff: [0, 1, 2, 3, 4].map((day) => ({ id: day + 1, edition_id: 1, day: day as Day, start_min: 390, end_min: 1830, member_id: null, name: "איש/אשת צוות לדוגמה", cohort_id: null, note: null })),
    prep: [],
  };
}

const kinds = (ws: RotaWarning[]) => [...new Set(ws.map((w) => w.kind))].sort();
const at = (d: RotaData, day: number, shift: number) => d.assignments.find((a) => a.day === day && a.shift === shift)!;

describe("a quiet rota", () => {
  it("has no warning", () => {
    expect(rotaWarnings(quiet(), WEEK)).toEqual([]);
  });
});

describe("each warning fires, and only it", () => {
  it("absent: a group on duty in a shift its cohort is not marked on campus in", () => {
    const d = quiet();
    d.presence = d.presence.filter((p) => !(p.day === 1 && p.shift === 0));
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["absent"]);
    expect(ws[0]).toMatchObject({ severity: "warn", day: 1, shift: 0, dutyId: 1, groupIds: [at(d, 1, 0).group_id] });
    expect(ws[0].message).toBe("א4 שובצה ל«מטבח» ביום שני · משמרת בוקר, ומכינה לדוגמה א לא סומנה בקמפוס במשמרת הזו");
  });

  it("presence_unknown: a cohort never marked on campus", () => {
    const d = quiet();
    d.cohorts.push({ id: 2, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2 });
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["presence_unknown"]);
    expect(ws[0]).toMatchObject({ severity: "warn", groupIds: [] });
    expect(ws[0].message).toContain("מכינה לדוגמה נ");
  });

  it("under: a duty short of groups in a shift", () => {
    const d = quiet();
    d.assignments = d.assignments.filter((a) => !(a.day === 0 && a.shift === 0)); // א1's — the loads stay even
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["under"]);
    expect(ws[0]).toMatchObject({ severity: "warn", day: 0, shift: 0, dutyId: 1, message: "חסרה קבוצה אחת ב«מטבח» (יום ראשון · משמרת בוקר)" });
    d.duties[0].need_morning = 3;
    expect(rotaWarnings(d, WEEK).find((w) => w.key === "under:0:0:1")?.message).toBe("חסרות 3 קבוצות ב«מטבח» (יום ראשון · משמרת בוקר)");
  });

  it("over: more groups than the need", () => {
    const d = quiet();
    // א3 also on Sunday morning (its own shifts are 2, 6, 10: not next to it)
    d.assignments.push({ id: 99, edition_id: 1, day: 0, shift: 0, duty_id: 1, group_id: 13, source: "hand" });
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["over"]);
    expect(ws[0]).toMatchObject({ severity: "warn", day: 0, shift: 0, groupIds: [11, 13], message: "2 קבוצות ב«מטבח» (יום ראשון · משמרת בוקר), וצריך 1" });
  });

  it("over is quiet for the groups a minimum of people needs (at most two beyond), and speaks for a surplus", () => {
    const d = quiet();
    d.duties[0].min_people = 15;
    d.groups.forEach((g) => (g.size = 20)); // one group meets the minimum alone
    d.assignments.push({ id: 99, edition_id: 1, day: 0, shift: 0, duty_id: 1, group_id: 13, source: "hand" });
    expect(kinds(rotaWarnings(d, WEEK))).toEqual(["over"]);
    d.groups.forEach((g) => (g.size = 8)); // 8 + 8 = 16: the second is needed — and alone, 8 is short
    const ws = rotaWarnings(d, WEEK);
    expect(ws.some((w) => w.kind === "over")).toBe(false);
    expect(ws.filter((w) => w.kind === "short_people")).toHaveLength(13);
  });

  it("over when a shift needs no group (0), with or without a minimum of people — never «short_people» there", () => {
    const d = quiet();
    d.duties[0].need_night = 0;
    d.duties[0].min_people = 10;
    d.groups.forEach((g) => (g.size = 5));
    d.assignments = d.assignments.filter((a) => a.shift !== 2); // the nights' groups taken away…
    d.assignments.push({ id: 99, edition_id: 1, day: 1, shift: 2, duty_id: 1, group_id: 13, source: "hand" }); // …and one put back by hand
    const night = (ws: RotaWarning[]) => cellWarnings(ws, 1, 2, 1).map((w) => w.kind);
    expect(night(rotaWarnings(d, WEEK))).toEqual(["over"]);
    expect(cellWarnings(rotaWarnings(d, WEEK), 1, 2, 1)[0].message).toBe("1 קבוצות ב«מטבח» (יום שני · משמרת לילה), וצריך 0");
    // two groups there: 5 + 5 reach the minimum, still none are needed
    d.assignments.push({ id: 100, edition_id: 1, day: 1, shift: 2, duty_id: 1, group_id: 11, source: "hand" });
    expect(night(rotaWarnings(d, WEEK))).toEqual(["over"]);
    // a size TBD: not «size_unknown» either
    d.assignments = d.assignments.filter((a) => a.id !== 100);
    d.groups[2].size = null;
    expect(night(rotaWarnings(d, WEEK))).toEqual(["over"]);
    // and without a minimum, the same
    d.duties[0].min_people = null;
    expect(night(rotaWarnings(d, WEEK))).toEqual(["over"]);
  });

  it("short_people: the groups on a duty together fewer than its minimum; size_unknown when a size is TBD", () => {
    const d = quiet();
    d.duties[0].min_people = 9; // sizes 8, 9, 10, 7: א1 and א4 are short
    let ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["short_people"]);
    expect(ws.map((w) => w.groupIds[0]).sort()).toEqual([11, 11, 11, 11, 14, 14, 14]);
    expect(ws[0].message).toBe("ב«מטבח» (יום ראשון · משמרת בוקר) 8 אנשים, והמינימום 9");
    d.groups[0].size = null;
    ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["short_people", "size_unknown"]);
    expect(ws.filter((w) => w.kind === "size_unknown").every((w) => w.severity === "info" && w.groupIds[0] === 11)).toBe(true);
    expect(ws.find((w) => w.kind === "size_unknown")?.message).toContain("חסר הגודל של א1");
  });

  it("back_to_back: a group in two shifts one after the other — a night and the next morning too", () => {
    const d = quiet();
    // א1 takes Sunday night and Monday morning, and gives its Sunday morning and Monday afternoon away — the loads stay
    at(d, 0, 2).group_id = 11;
    at(d, 1, 0).group_id = 11;
    at(d, 0, 0).group_id = 13;
    at(d, 1, 1).group_id = 14;
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["back_to_back"]);
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ severity: "warn", day: 1, shift: 0, message: "א1 בשתי משמרות ברצף: יום ראשון · משמרת לילה, ואז יום שני · משמרת בוקר" });
  });

  it("outside_week: an assignment on a shift the week no longer has (the opening moved) — kept, warned about", () => {
    const d = quiet();
    const later = { ...WEEK, first_day_from: 870 };
    const ws = rotaWarnings(d, later);
    expect(kinds(ws)).toEqual(["outside_week"]);
    expect(ws[0]).toMatchObject({ severity: "warn", day: 0, shift: 0, groupIds: [11], message: "א1 ב«מטבח» ביום ראשון · משמרת בוקר — המשמרת הזו כבר לא חלק מהשבוע" });
    // and Thursday night, the week closing at 19:00
    const e = quiet();
    e.assignments.push({ id: 99, edition_id: 1, day: 4, shift: 2, duty_id: 1, group_id: 13, source: "hand" });
    expect(kinds(rotaWarnings(e, WEEK))).toEqual(["outside_week"]);
  });

  it("uneven: loads further apart than one shift from their shares", () => {
    const d = quiet();
    at(d, 2, 0).group_id = 11; // א3's Tuesday morning to א1 (its own: Sunday morning, Monday afternoon, Tuesday night…)
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["uneven"]);
    expect(ws[0]).toMatchObject({ severity: "info", groupIds: [11, 13] });
    expect(ws[0].message).toBe("העומס לא שווה: א1 ב-5 משמרות מתוך 14 בקמפוס, א3 ב-2 מתוך 14");
  });

  it("uneven is per shift on campus: a cohort there two days doing less is even", () => {
    const d = quiet();
    d.cohorts.push({ id: 2, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2 });
    d.cohortDuties.push({ cohort_id: 2, duty_id: 1 });
    d.groups.push({ id: 21, edition_id: 1, cohort_id: 2, number: 1, size: 8, head_name: "ראש/ת קבוצה לדוגמה 5" });
    // on campus Monday only, one duty there
    for (const shift of [0, 1, 2] as ShiftIndex[]) d.presence.push({ cohort_id: 2, day: 1, shift });
    expect(rotaWarnings(d, WEEK)).toEqual([expect.objectContaining({ kind: "uneven" })]); // נ1 does nothing
    // one duty on its fourth shift on campus is its share (that shift is then over its need: the only other warning)
    d.assignments.push({ id: 99, edition_id: 1, day: 2, shift: 2, duty_id: 1, group_id: 21, source: "hand" });
    d.presence.push({ cohort_id: 2, day: 2, shift: 2 });
    expect(kinds(rotaWarnings(d, WEEK))).toEqual(["over"]);
  });

  it("no_target: a duty whose need is not set in a shift", () => {
    const d = quiet();
    d.duties[0].need_night = null;
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["no_target"]);
    expect(ws[0]).toMatchObject({ severity: "info", shift: 2, dutyId: 1, message: "לא נקבע כמה קבוצות צריך ב«מטבח»: משמרת לילה" });
    d.duties[0].need_morning = null;
    const ws2 = rotaWarnings(d, WEEK);
    expect(ws2).toHaveLength(1);
    expect(ws2[0].shift).toBeUndefined();
    expect(ws2[0].message).toBe("לא נקבע כמה קבוצות צריך ב«מטבח»: משמרת בוקר, משמרת לילה");
    // the edition's own names for the shifts
    const named = { ...WEEK, settings: { rota_shifts: { cuts: [870, 1350] as [number, number], labels: ["שחרית", "צהריים", "ערבית"] as [string, string, string] } } };
    expect(rotaWarnings(d, named)[0].message).toBe("לא נקבע כמה קבוצות צריך ב«מטבח»: משמרת שחרית, משמרת ערבית");
  });

  it("v20: no staff at all, or every shift's — nothing is warned about the staff (there is no «אחראי/ת משמרת»)", () => {
    const d = quiet();
    d.staff = [];
    expect(rotaWarnings(d, WEEK)).toEqual([]);
  });

  it("no_head: the groups without a head, in one warning", () => {
    const d = quiet();
    d.groups[1].head_name = null;
    d.groups[3].head_name = null;
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["no_head"]);
    expect(ws[0]).toMatchObject({ severity: "info", groupIds: [12, 14], message: "אין ראשי קבוצות ל-א2, א4" });
    d.groups[3].head_name = "ראש/ת קבוצה לדוגמה";
    expect(rotaWarnings(d, WEEK)[0].message).toBe("אין ראש/ת קבוצה ל-א2");
  });

  it("v20: the diets are no warning — the guard holds them to the trainees (rota_diets_exceed)", () => {
    const d = quiet();
    d.cohorts[0] = { ...d.cohorts[0], trainees: null, diet_veg: 40, diet_gf: 40, diet_both: null };
    expect(rotaWarnings(d, WEEK)).toEqual([]);
  });
});

describe("a cohort that does not help in the duty (v20: cohortDuties)", () => {
  /** The quiet rota and «נ» — helping in no duty (an old row: since v20 such a cohort has no groups) — on campus all week with one group, נ1 (21). */
  function withNun(): RotaData {
    const d = quiet();
    d.cohorts.push({ id: 2, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2 });
    d.groups.push({ id: 21, edition_id: 1, cohort_id: 2, number: 1, size: 8, head_name: "ראש/ת קבוצה לדוגמה 5" });
    for (const s of rotaSlots(WEEK)) d.presence.push({ cohort_id: 2, ...s });
    return d;
  }

  it("its idle groups are not «uneven»: the fairness weighs only the groups that help", () => {
    const d = withNun();
    expect(rotaWarnings(d, WEEK)).toEqual([]); // the same rota with «נ» helping would be uneven (נ1 does nothing)
    d.cohortDuties.push({ cohort_id: 2, duty_id: 1 });
    expect(kinds(rotaWarnings(d, WEEK))).toEqual(["uneven"]);
    d.cohortDuties.pop();
    expect(unevenLoad(d, WEEK)).toBeNull();
  });

  it("not_eligible: a duty given by hand to a group whose cohort does not help in it — each such row, in the cell it is in", () => {
    const d = withNun();
    at(d, 1, 1).group_id = 21; // א1's Monday afternoon (one of its four) to נ1: the helping groups 3/4/3/3, even
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["not_eligible"]);
    expect(ws[0]).toMatchObject({ kind: "not_eligible", severity: "warn", day: 1, shift: 1, dutyId: 1, groupIds: [21] });
    expect(ws[0].message).toBe("נ1 שובצה ב«מטבח» (יום שני · משמרת אחר צהריים), אבל מכינה לדוגמה נ לא עוזרת ב«מטבח»");
    expect(cellWarnings(ws, 1, 1, 1).map((w) => w.kind)).toEqual(["not_eligible"]);
    expect(groupWarnings(ws, { day: 1, shift: 1, group_id: 21 }).map((w) => w.kind)).toEqual(["not_eligible"]);
    // the assignment fills its duty: no «under»; a second one is a second warning
    at(d, 2, 0).group_id = 21;
    expect(rotaWarnings(d, WEEK).filter((w) => w.kind === "not_eligible").map((w) => w.day)).toEqual([1, 2]);
  });

  it("not_eligible is per duty: a cohort that helps in another duty only is warned about this one alone", () => {
    const d = withNun();
    d.duties.push({ id: 2, edition_id: 1, name: "נקיון", description: null, need_morning: 0, need_afternoon: 0, need_night: 0, min_people: null, sort: 2 });
    d.cohortDuties.push({ cohort_id: 2, duty_id: 2 }); // «נ» helps in «נקיון» only
    at(d, 1, 1).group_id = 21;
    expect(rotaWarnings(d, WEEK).filter((w) => w.kind === "not_eligible").map((w) => [w.groupIds, w.dutyId])).toEqual([[[21], 1]]);
  });

  it("presence_unknown stays (its presence feeds the meal counts), without «ההצעה לא משבצת…»", () => {
    const d = withNun();
    d.presence = d.presence.filter((p) => p.cohort_id !== 2);
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["presence_unknown"]);
    expect(ws[0]).toMatchObject({ severity: "warn", groupIds: [21], message: "לא סומן מתי מכינה לדוגמה נ בקמפוס" });
    // a cohort that helps keeps the whole sentence
    d.cohortDuties.push({ cohort_id: 2, duty_id: 1 });
    expect(rotaWarnings(d, WEEK).find((w) => w.kind === "presence_unknown")!.message).toBe("לא סומן מתי מכינה לדוגמה נ בקמפוס — ההצעה לא משבצת את הקבוצות שלה");
  });

});

describe("for the board", () => {
  it("a cell's warnings and a group's", () => {
    const d = quiet();
    d.presence = d.presence.filter((p) => !(p.day === 1 && p.shift === 0));
    d.assignments = d.assignments.filter((a) => !(a.day === 0 && a.shift === 0));
    const ws = rotaWarnings(d, WEEK);
    expect(cellWarnings(ws, 0, 0, 1).map((w) => w.kind)).toEqual(["under"]);
    expect(cellWarnings(ws, 1, 0, 1).map((w) => w.kind)).toEqual(["absent"]);
    expect(groupWarnings(ws, { day: 1, shift: 0, group_id: at(d, 1, 0).group_id }).map((w) => w.kind)).toEqual(["absent"]);
    expect(groupWarnings(ws, { day: 1, shift: 0, group_id: 99 })).toEqual([]);
    // every key is distinct
    expect(new Set(ws.map((w) => w.key)).size).toBe(ws.length);
    expect(slotIndex(1, 0)).toBe(3);
  });
});
