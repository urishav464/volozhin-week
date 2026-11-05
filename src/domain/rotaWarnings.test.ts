// src/domain/rotaWarnings.ts: each warning fires where it should and stays quiet otherwise — from a quiet rota (one
// cohort on campus all week, four groups each with a head, one duty a group a shift, every shift with its lead), one
// change at a time. Synthetic only.
import { describe, expect, it } from "vitest";
import type { RotaData, ShiftIndex } from "../data/rota";
import { rotaSlots, slotIndex } from "./rota";
import { cellWarnings, groupWarnings, rotaWarnings, type RotaWarning } from "./rotaWarnings";
import type { Day } from "./time";

const WEEK = { first_day_from: 510, last_day_until: 1140, settings: {} };

/** א1–א4 (11–14) take the week's 14 shifts of «מטבח» (duty 1) in turn: four groups, never two shifts in a row. */
function quiet(): RotaData {
  const slots = rotaSlots(WEEK);
  const groups = [11, 12, 13, 14];
  return {
    cohorts: [{ id: 1, edition_id: 1, letter: "א", name: "מכינה לדוגמה א", diets: [{ label: "צמחוני", count: 3 }], sort: 1 }],
    presence: slots.map((s) => ({ cohort_id: 1, ...s })),
    groups: groups.map((id, i) => ({ id, edition_id: 1, cohort_id: 1, number: i + 1, size: [8, 9, 10, 7][i], head_name: `ראש/ת קבוצה לדוגמה ${i + 1}` })),
    duties: [{ id: 1, edition_id: 1, name: "מטבח", description: null, need_morning: 1, need_afternoon: 1, need_night: 1, min_people: null, sort: 1 }],
    assignments: slots.map((s, i) => ({ id: i + 1, edition_id: 1, day: s.day, shift: s.shift, duty_id: 1, group_id: groups[i % 4], source: "hand" as const })),
    staff: [0, 1, 2, 3, 4].map((day) => ({ id: day + 1, edition_id: 1, day: day as Day, start_min: 390, end_min: 1830, member_id: null, name: "אחראי/ת לדוגמה", cohort_id: null, kind: "lead" as const, note: null })),
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
    d.cohorts.push({ id: 2, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", diets: [], sort: 2 });
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
    d.cohorts.push({ id: 2, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", diets: [], sort: 2 });
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

  it("no_lead: a shift with no «אחראי/ת משמרת» — a staff shift that is not a lead does not count; without the staff, not checked", () => {
    const d = quiet();
    d.staff[2].kind = "shift"; // Tuesday
    d.staff[3].start_min = 870; // Wednesday's lead from 14:30: its morning has none
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["no_lead"]);
    expect(ws.map((w) => `${w.day}:${w.shift}`)).toEqual(["2:0", "2:1", "2:2", "3:0"]);
    expect(ws[0]).toMatchObject({ severity: "warn", message: "אין אחראי/ת משמרת ביום שלישי · משמרת בוקר" });
    const { staff: _s, ...noStaff } = d;
    expect(rotaWarnings(noStaff, WEEK)).toEqual([]);
    // Sunday's lead from the opening covers the morning as the week has it (08:30–14:30)
    const e = quiet();
    e.staff[0].start_min = 510;
    e.staff[0].end_min = 600;
    expect(rotaWarnings(e, WEEK).map((w) => w.key)).toEqual(["no_lead:0:1", "no_lead:0:2"]);
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

  it("diets_exceed: a cohort's diets more than its groups' people — quiet while a size is TBD", () => {
    const d = quiet();
    d.cohorts[0].diets = [{ label: "צמחוני", count: 20 }, { label: "טבעוני", count: 15 }]; // 35 > 8 + 9 + 10 + 7
    const ws = rotaWarnings(d, WEEK);
    expect(kinds(ws)).toEqual(["diets_exceed"]);
    expect(ws[0]).toMatchObject({ severity: "warn", groupIds: [11, 12, 13, 14], message: "במכינה לדוגמה א 35 בדיאטות, יותר מ-34 האנשים בקבוצות שלה" });
    d.cohorts[0].diets = [{ label: "צמחוני", count: 34 }];
    expect(rotaWarnings(d, WEEK)).toEqual([]);
    d.cohorts[0].diets = [{ label: "צמחוני", count: 40 }];
    d.groups[0].size = null;
    expect(rotaWarnings(d, WEEK)).toEqual([]);
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
