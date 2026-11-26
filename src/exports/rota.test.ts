// «תורנויות»'s pages (src/exports/rota.ts), on a synthetic rota beside a week on the 2026 grid: a group's schedule —
// the bands, Sunday cut by the opening, Thursday without a night, a lesson at a shift's edge, side by side lessons,
// «זמן זיכרון» only where a memorial time is —, the board, the day sheet and the heads with and without phones (never a
// phone when they are off), the kitchen, the food sums (v20: a cohort's own trainees and its three diet numbers — «מהם גם
// וגם» counted once; TBD where unknown), on campus, the loads, the preparations,
// the workbook's sheet names, the formula guard on every cell of the files, and the same answer whatever the order.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { RotaData, RotaStaffShift } from "../data/rota";
import { SHIFTS } from "../domain/rota";
import { type Day, LRM } from "../domain/time";
import type { Week } from "../domain/types";
import { addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import { toCsv } from "./csv";
import { scheduleEntries } from "./designer";
import {
  BAND_FILL, campusTable, cohortTotal, DIET_HEADERS, dietsOf, daySheet, foodTable, groupSchedule, groupScheduleInputs, groupWeek, headsTable, kitchenDutyId, kitchenSheet,
  loadsTable, MEAL_HEADERS, mealCounts, mealDay, mealsTable, phonesOf, prepCounts, prepInOrder, prepTable, rotaBoardTable, rotaWorkbook, SHEET, shiftOfStart, shiftText, shoppingTable, stackTables, STAFF_LABEL, staffTable,
} from "./rota";
import type { Table } from "./table";
import { toXlsx, xlsxParts } from "./xlsx";

const PHONE_1 = "טלפון לדוגמה 1";
const PHONE_3 = "טלפון לדוגמה 3";

/**
 * Cohorts א (two groups, all week; 15 trainees, 2 «צמחוני/טבעוני»), ב (one group of unknown size, never marked; every
 * number TBD), נ (one group, Monday and Tuesday; 5 trainees, 2 vegetarian, 1 gluten-free, 1 of them both).
 */
function rota(): RotaData {
  const all = [0, 1, 2, 3, 4].flatMap((day) => [0, 1, 2].map((shift) => ({ cohort_id: 1, day, shift })));
  return {
    cohorts: [
      { id: 1, edition_id: 1, letter: "א", name: "מכינה לדוגמה א", trainees: 15, diet_veg: 2, diet_gf: 0, diet_both: 0, contact_name: null, sort: 1 },
      { id: 2, edition_id: 1, letter: "ב", name: "מכינה לדוגמה ב", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2 },
      { id: 3, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", trainees: 5, diet_veg: 2, diet_gf: 1, diet_both: 1, contact_name: null, sort: 3 },
    ],
    cohortDuties: [1, 2, 3].flatMap((cohort_id) => [1, 2].map((duty_id) => ({ cohort_id, duty_id }))),
    presence: [...all, ...[1, 2].flatMap((day) => [0, 1, 2].map((shift) => ({ cohort_id: 3, day, shift })))].filter((p) => !(p.day === 4 && p.shift === 2)) as RotaData["presence"],
    groups: [
      { id: 11, edition_id: 1, cohort_id: 1, number: 1, size: 8, head_name: "ראש/ת קבוצה לדוגמה 1" },
      { id: 12, edition_id: 1, cohort_id: 1, number: 2, size: 7, head_name: null },
      { id: 21, edition_id: 1, cohort_id: 2, number: 1, size: null, head_name: "ראש/ת קבוצה לדוגמה 3" },
      { id: 31, edition_id: 1, cohort_id: 3, number: 1, size: 5, head_name: "ראש/ת קבוצה לדוגמה 4" },
    ],
    duties: [
      { id: 1, edition_id: 1, name: "מטבח", description: null, need_morning: 1, need_afternoon: 1, need_night: 1, min_people: null, sort: 1 },
      { id: 2, edition_id: 1, name: "נקיון", description: null, need_morning: 1, need_afternoon: 1, need_night: null, min_people: null, sort: 2 },
    ],
    assignments: [
      { id: 1, edition_id: 1, day: 0, shift: 0, duty_id: 1, group_id: 11, source: "hand" },
      { id: 2, edition_id: 1, day: 0, shift: 0, duty_id: 2, group_id: 12, source: "suggested" },
      { id: 3, edition_id: 1, day: 0, shift: 2, duty_id: 2, group_id: 11, source: "suggested" },
      { id: 4, edition_id: 1, day: 1, shift: 0, duty_id: 1, group_id: 31, source: "hand" },
      { id: 5, edition_id: 1, day: 1, shift: 0, duty_id: 1, group_id: 12, source: "hand" },
      { id: 6, edition_id: 1, day: 4, shift: 1, duty_id: 1, group_id: 11, source: "hand" },
      // Thursday night: no such shift (the week closes at 19:00) — kept, said «מחוץ לשבוע»
      { id: 7, edition_id: 1, day: 4, shift: 2, duty_id: 2, group_id: 12, source: "hand" },
    ],
    staff: [
      { id: 1, edition_id: 1, day: 0, start_min: 510, end_min: 870, member_id: 5, name: "איש/אשת צוות לדוגמה", cohort_id: null, note: null },
      { id: 2, edition_id: 1, day: 0, start_min: 870, end_min: 1350, member_id: null, name: "שם לדוגמה", cohort_id: null, note: "הקפצת מרצה (לדוגמה)" },
      { id: 3, edition_id: 1, day: 1, start_min: 1350, end_min: 1830, member_id: null, name: null, cohort_id: 3, note: null },
    ],
    prep: [
      { id: 2, edition_id: 1, text: "משימת הכנה לדוגמה ב", group_id: 11, done: true, sort: 2 },
      { id: 1, edition_id: 1, text: "משימת הכנה לדוגמה א", group_id: null, done: false, sort: 1 },
    ],
  };
}

/** The week: Sunday opens 08:30, Thursday closes 19:00; a few closed lessons and one memorial time. */
function week(): Week {
  const w = emptyWeek();
  const a = addSpeaker(w, "f", "מרצה לדוגמה א");
  const b = addSpeaker(w, "m", "מרצה לדוגמה ב");
  closeWith(w, addLesson(w, 0, 510, 600, { title: "שיעור הפתיחה" }), a);
  closeWith(w, addLesson(w, 0, 870, 960, { title: "שיעור בקצה" }), b); // starts right at the cut: the afternoon's
  closeWith(w, addLesson(w, 0, 1470, 1560, { title: "שיעור לילה" }), a); // 00:30, the night after Sunday: Sunday's night
  closeWith(w, addLesson(w, 1, 510, 600, { title: "חדר אחד", room_id: 1 }), a);
  closeWith(w, addLesson(w, 1, 510, 600, { title: "חדר שני", room_id: 2 }), b); // side by side
  closeWith(w, addLesson(w, 3, 1200, 1440, { title: "שיעור ארוך", teach_min: 240 }), b); // 20:00–00:00 across the 22:30 cut: the afternoon's
  closeWith(w, addLesson(w, 3, 1470, 1740, { title: "שיעור ממוזג" }), a); // a merged cell 00:30–05:00, teaching 75 minutes: its rows are not TBD
  addLesson(w, 0, 600, 690, { title: "טיוטה" }); // a draft: not public, its row is TBD
  addLesson(w, 0, 780, 795, { kind: "memorial", title: "זמן זיכרון" }); // Sunday's memorial time; Monday has none
  return w;
}

const cells = (t: Table) => [t.headers, ...t.rows].flat();
const everyCell = (ts: Table[]) => ts.flatMap(cells);

describe("a group's schedule", () => {
  const w = week();
  const data = rota();
  const inputs = groupScheduleInputs(w, data);
  const first = inputs.find((g) => g.groupId === 11)!.input;

  it("is made of the public schedule, the rows, the group, the duties and its own assignments — no Week, no phone", () => {
    expect(inputs.map((g) => g.input.group.code)).toEqual(["א1", "א2", "ב1", "נ1"]);
    expect(Object.keys(first).sort()).toEqual(["assignments", "duties", "edition", "entries", "group", "rows", "spans"]);
    expect(first.group).toEqual({ code: "א1", cohort: "מכינה לדוגמה א", size: 8, head: "ראש/ת קבוצה לדוגמה 1" });
    expect(first.assignments).toEqual([{ day: 0, shift: 0, duty_id: 1 }, { day: 0, shift: 2, duty_id: 2 }, { day: 4, shift: 1, duty_id: 1 }]);
    expect(JSON.stringify(first)).not.toMatch(/טלפון|head_phone/);
  });

  it("bands every shift with the group's duty, «—» where it has none: Sunday from the opening, Thursday to the close and no night", () => {
    const g = groupWeek(first);
    const bands = g.days.map((d) => d.shifts.map((s) => [s.shift, s.start, s.end, s.duty]));
    expect(bands[0]).toEqual([[0, 510, 870, "מטבח"], [1, 870, 1350, null], [2, 1350, 1830, "נקיון"]]);
    expect(bands[2]).toEqual([[0, 390, 870, null], [1, 870, 1350, null], [2, 1350, 1830, null]]);
    expect(bands[4]).toEqual([[0, 390, 870, null], [1, 870, 1140, "מטבח"]]); // Thursday: 19:00, no night
    expect(g.days.map((d) => d.date)).toEqual(["14.2", "15.2", "16.2", "17.2", "18.2"]);
    const t = groupSchedule(first);
    expect(t.name).toBe("לו״ז א1");
    const sundayMorning = t.rows.findIndex((r) => r[0] === "ראשון 14.2" && r[2] === "משמרת בוקר");
    expect(t.rows[sundayMorning]).toEqual(["ראשון 14.2", `${LRM}08:30–14:30`, "משמרת בוקר", "מטבח"]);
    expect(t.fills![sundayMorning]).toBe(BAND_FILL);
    expect(t.rows.find((r) => r[0] === "ראשון 14.2" && r[2] === "משמרת אחר צהריים")![3]).toBe("—");
    expect(t.rows.filter((r) => r[0] === "חמישי 18.2" && r[2].startsWith("משמרת")).map((r) => r[2])).toEqual(["משמרת בוקר", "משמרת אחר צהריים"]);
  });

  it("puts a lesson in the shift its start falls in — one at the cut is the next shift's, the night after Sunday is Sunday's", () => {
    const sunday = groupWeek(first).days[0];
    const textsOf = (shift: number) => sunday.shifts.find((s) => s.shift === shift)!.items.map((i) => i.text);
    expect(textsOf(0)).toEqual(["שיעור הפתיחה · מרצה לדוגמה א", "TBD", "TBD", "זמן זיכרון", "ארוחת צהריים / חבורות"]);
    expect(textsOf(1)[0]).toBe("שיעור בקצה · מרצה לדוגמה ב");
    expect(textsOf(1)).toContain("מכריכה לכריכה");
    expect(textsOf(2)).toContain("שיעור לילה · מרצה לדוגמה א");
    expect(textsOf(2)).toContain("ארוחת חצות וניגונים / חבורות");
    // a lesson across a cut is the shift's it starts in, and the next one has none of it — nor a TBD for the row it runs into
    const wednesday = groupWeek(first).days[3];
    expect(wednesday.shifts[1].items.map((i) => i.text)).toContain("שיעור ארוך · מרצה לדוגמה ב");
    expect(wednesday.shifts[2].items.map((i) => [i.start, i.text])).not.toContainEqual([1350, "TBD"]);
    expect(wednesday.shifts[2].items.some((i) => i.text.startsWith("שיעור ארוך"))).toBe(false);
    const night = wednesday.shifts[2].items.map((i) => [i.start, i.end, i.text]);
    expect(night).toContainEqual([1470, 1545, "שיעור ממוזג · מרצה לדוגמה א"]); // its teaching time
    expect(night.filter(([start]) => (start as number) > 1470 && (start as number) < 1740).map(([, , t]) => t)).toEqual([]); // 02:00, 03:30: inside its cell
    // without the cells (a page given only the public schedule), those rows are TBD — never a guess
    const bare = groupWeek({ ...first, spans: undefined }).days[3].shifts[2].items.map((i) => [i.start, i.text]);
    expect(bare).toContainEqual([1560, "TBD"]);
    // Sunday opens at 08:30: the opening of the day, breakfast and דרך ארץ are not part of it
    expect(textsOf(0)).not.toContain("פתיחת יום");
    expect(textsOf(0)).not.toContain("ארוחת בוקר / חבורות");
  });

  it("joins side by side lessons, with their rooms; says «זמן זיכרון» only where a memorial time is", () => {
    const monday = groupWeek(first).days[1];
    const morning = monday.shifts[0].items;
    expect(morning.map((i) => i.text)).toContain("במקביל: חדר אחד · מרצה לדוגמה א (בית מדרש) / חדר שני · מרצה לדוגמה ב (כיתה)");
    expect(morning.map((i) => i.text)).toContain("פתיחת יום");
    expect(monday.shifts.flatMap((s) => s.items).some((i) => i.kind === "memorial")).toBe(false);
  });

  it("follows the edition's own cuts: a row that begins before Sunday's opening belongs to the first shift the week has", () => {
    const e = { ...w.edition, first_day_from: 930, settings: { rota_shifts: { cuts: [900, 1350] as [number, number], labels: ["א", "ב", "ג"] as [string, string, string] } } };
    expect(shiftOfStart(e, 0, 870)).toBe(1);
    expect(shiftOfStart(e, 1, 870)).toBe(0);
    const g = groupWeek({ ...first, edition: e });
    expect(g.days[0].shifts.map((s) => [s.label, s.start])).toEqual([["ב", 930], ["ג", 1350]]);
    expect(g.days[0].shifts[0].items[0].text).toBe("שיעור בקצה · מרצה לדוגמה ב");
    // a lesson left before the opening (08:30, the week now opening at 15:30) is not on the group's Sunday
    expect(g.days[0].shifts.flatMap((s) => s.items).map((i) => i.text)).not.toContain("שיעור הפתיחה · מרצה לדוגמה א");
  });

  it("reads TBD where the week's date, a group's size or its head is not known yet", () => {
    const tbd = groupScheduleInputs({ ...w, edition: { ...w.edition, start_date: null } }, data).find((g) => g.groupId === 21)!.input;
    const g = groupWeek(tbd);
    expect(g.days.every((d) => d.date == null)).toBe(true);
    expect(groupSchedule(tbd).rows[0][0]).toBe("ראשון");
    expect(g.group).toEqual({ code: "ב1", cohort: "מכינה לדוגמה ב", size: null, head: "ראש/ת קבוצה לדוגמה 3" });
  });
});

describe("the board, the day and the heads", () => {
  const w = week();
  const data = rota();
  const phones = phonesOf([{ group_id: 11, head_phone: PHONE_1 }, { group_id: 21, head_phone: PHONE_3 }]);

  it("lists the board by shift and duty, a column a day — «אין משמרת» where the week has none, a code left there «מחוץ לשבוע»", () => {
    const t = rotaBoardTable(data, w.edition);
    expect(t.headers).toEqual(["משמרת", "תורנות", "ראשון", "שני", "שלישי", "רביעי", "חמישי"]);
    expect(t.rows.map((r) => r.slice(0, 2))).toEqual([
      [`בוקר ${LRM}06:30–14:30`, "מטבח"], [`בוקר ${LRM}06:30–14:30`, "נקיון"],
      [`אחר צהריים ${LRM}14:30–22:30`, "מטבח"], [`אחר צהריים ${LRM}14:30–22:30`, "נקיון"],
      [`לילה ${LRM}22:30–06:30`, "מטבח"], [`לילה ${LRM}22:30–06:30`, "נקיון"],
    ]);
    expect(t.rows[0].slice(2)).toEqual(["א1", "א2, נ1", "", "", ""]);
    expect(t.rows[4][6]).toBe("אין משמרת");
    expect(t.rows[5][6]).toBe("א2 (מחוץ לשבוע)");
    expect(t.rows[5][2]).toBe("א1");
  });

  it("writes a day's staff and groups — and no phone, not a header nor a cell, when the phones are off", () => {
    const t = daySheet(data, w.edition, 0, null);
    expect(t.name).toBe("יום ראשון");
    expect(t.headers).toEqual(["משמרת", "תורנות / צוות", "קבוצה / מי", "גודל", "ראש/ת קבוצה"]);
    expect(t.rows.slice(0, 3)).toEqual([
      [`בוקר ${LRM}08:30–14:30`, STAFF_LABEL, `איש/אשת צוות לדוגמה ${LRM}08:30–14:30`, "", ""],
      [`בוקר ${LRM}08:30–14:30`, "מטבח", "א1", "8", "ראש/ת קבוצה לדוגמה 1"],
      [`בוקר ${LRM}08:30–14:30`, "נקיון", "א2", "7", ""],
    ]);
    expect(t.fills!.slice(0, 3)).toEqual([BAND_FILL, null, null]);
    // v20: no «אחראי/ת משמרת» — the afternoon's staff as they are, and no TBD row for a lead
    expect(t.rows.filter((r) => r[0].startsWith("אחר צהריים")).slice(0, 1)).toEqual([
      [`אחר צהריים ${LRM}14:30–22:30`, STAFF_LABEL, `שם לדוגמה ${LRM}14:30–22:30 · הקפצת מרצה (לדוגמה)`, "", ""],
    ]);
    expect(t.rows.some((r) => r[2] === "TBD")).toBe(false);
    const thursday = daySheet(data, w.edition, 4, null);
    expect(thursday.rows.filter((r) => r[0] === "לילה (מחוץ לשבוע)").map((r) => r.slice(1, 3))).toContainEqual(["נקיון", "א2"]);
    for (const off of [t, thursday, headsTable(data, null)]) {
      expect(cells(off).join("|")).not.toMatch(/טלפון/);
      for (const r of off.rows) expect(r).toHaveLength(off.headers.length);
    }
  });

  it("v20: lists every staff member in every shift their hours overlap (no «אחראי/ת», no TBD row) — one outside every shift in the shift it starts in", () => {
    const d = rota();
    const on = (id: number, day: Day, start_min: number, end_min: number, name: string): RotaStaffShift => ({ id, edition_id: 1, day, start_min, end_min, member_id: null, name, cohort_id: null, note: null });
    d.staff = [
      on(11, 1, 390, 860, "צוות בוקר לדוגמה"), // Monday 06:30–14:20
      on(12, 1, 840, 1350, "צוות ערב לדוגמה"), // Monday 14:00–22:30: the morning's end and the whole afternoon
      on(13, 2, 390, 1830, "צוות יום לדוגמה"), // Tuesday, the whole day
      on(14, 0, 390, 500, "צוות לפני הפתיחה לדוגמה"), // Sunday 06:30–08:20: before the 08:30 opening, overlapping no shift of the week
    ];
    const staffRows = (day: Day, shift: 0 | 1 | 2) => daySheet(d, w.edition, day, null).rows.filter((r) => r[0] === shiftText(w.edition, shift, day) && r[1] === STAFF_LABEL).map((r) => r[2]);
    expect(staffRows(1, 0)).toEqual([`צוות בוקר לדוגמה ${LRM}06:30–14:20`, `צוות ערב לדוגמה ${LRM}14:00–22:30`]);
    expect(staffRows(1, 1)).toEqual([`צוות ערב לדוגמה ${LRM}14:00–22:30`]);
    expect(staffRows(1, 2)).toEqual([]);
    for (const shift of SHIFTS) expect(staffRows(2, shift)).toEqual([`צוות יום לדוגמה ${LRM}06:30–06:30`]);
    expect(staffRows(0, 0)).toEqual([`צוות לפני הפתיחה לדוגמה ${LRM}06:30–08:20`]); // never lost
  });

  it("adds a טלפון column with the phones given, and only those — a left-to-right mark first", () => {
    const heads = headsTable(data, phones);
    expect(heads.headers).toEqual(["קבוצה", "מכינה", "גודל", "ראש/ת קבוצה", "טלפון"]);
    expect(heads.rows).toEqual([
      ["א1", "מכינה לדוגמה א", "8", "ראש/ת קבוצה לדוגמה 1", `${LRM}${PHONE_1}`],
      ["א2", "מכינה לדוגמה א", "7", "TBD", ""],
      ["ב1", "מכינה לדוגמה ב", "TBD", "ראש/ת קבוצה לדוגמה 3", `${LRM}${PHONE_3}`],
      ["נ1", "מכינה לדוגמה נ", "5", "ראש/ת קבוצה לדוגמה 4", ""],
    ]);
    const day = daySheet(data, w.edition, 0, phones);
    expect(day.headers.at(-1)).toBe("טלפון");
    for (const r of day.rows) expect(r).toHaveLength(day.headers.length);
    expect(day.rows.find((r) => r[2] === "א1")!.at(-1)).toBe(`${LRM}${PHONE_1}`);
    expect(day.rows.find((r) => r[2] === "א2")!.at(-1)).toBe("");
  });

  it("puts no phone anywhere in the workbook, its CSVs or its xlsx when the phones are off — and the given ones when on", () => {
    const off = rotaWorkbook({ week: w, data, phones: null });
    expect(everyCell(off).join("|")).not.toMatch(/טלפון/);
    const xml = Object.values(xlsxParts(off)).join("");
    expect(xml).not.toContain(PHONE_1);
    for (const t of off) expect(toCsv(t)).not.toContain(PHONE_1);
    const on = rotaWorkbook({ week: w, data, phones });
    const withPhones = on.filter((t) => cells(t).some((c) => c.includes(PHONE_1)));
    expect(withPhones.map((t) => t.name)).toEqual(["יום ראשון", "יום חמישי", SHEET.heads]); // א1's days, and the heads
    expect(on.filter((t) => t.headers.includes("טלפון")).map((t) => t.name)).toEqual([...["ראשון", "שני", "שלישי", "רביעי", "חמישי"].map((d) => `יום ${d}`), SHEET.heads]);
  });
});

describe("the kitchen, the food and the campus", () => {
  const w = week();
  const data = rota();

  it("finds the kitchen by its name as names are compared, and lists it in every shift of the week", () => {
    expect(kitchenDutyId(data)).toBe(1);
    expect(kitchenDutyId({ duties: [{ ...data.duties[1] }, { ...data.duties[0], id: 9, name: " מטבח  " }] })).toBe(9);
    expect(kitchenDutyId({ duties: [data.duties[1]] })).toBeNull();
    const t = kitchenSheet(data, w.edition, w.rows, 1);
    expect(t.name).toBe("מטבח");
    expect(t.rows).toHaveLength(14); // five days × three shifts, Thursday without its night
    expect(t.headers[6]).toBe("תזונה בקמפוס");
    expect(t.rows[0]).toEqual([
      "ראשון", `בוקר ${LRM}08:30–14:30`, "א1", "8", "ראש/ת קבוצה לדוגמה 1", "15", "צמחוני/טבעוני בלבד 2; ללא גלוטן בלבד 0; גם וגם 0; רגיל 13",
      `${LRM}13:15–14:15 ארוחת צהריים / חבורות`,
    ]);
    // two groups: their people added up; נ on campus on Monday — its trainees and its diets too (v20: both counted once)
    expect(t.rows[3].slice(2, 7)).toEqual(["א2, נ1", "12", "TBD, ראש/ת קבוצה לדוגמה 4", "20", "צמחוני/טבעוני בלבד 3; ללא גלוטן בלבד 0; גם וגם 1; רגיל 16"]);
    expect(t.rows[3][7]).toBe(`${LRM}07:00–08:00 ארוחת בוקר / חבורות; ${LRM}13:15–14:15 ארוחת צהריים / חבורות`);
    expect(t.rows[1].slice(2, 4)).toEqual(["—", ""]); // nobody yet
    expect(kitchenSheet(data, w.edition, w.rows, 2).name).toBe("לו״ז נקיון");
  });

  it("v20: counts the food for trainees only — a cohort's own trainees (never its groups' sizes), its meals by diet, TBD where unknown", () => {
    expect(cohortTotal(data, 1)).toBe(15);
    expect(cohortTotal(data, 2)).toBeNull();
    expect(cohortTotal({ cohorts: [{ ...data.cohorts[0], trainees: 40 }] }, 1)).toBe(40); // its own field, not 8 + 7
    expect(dietsOf([data.cohorts[0], data.cohorts[2]])).toEqual({ trainees: 20, veg_only: 3, gf_only: 0, both: 1, regular: 16 });
    expect(dietsOf(data.cohorts).regular).toBeNull(); // ב is TBD: so is every sum it is part of
    const t = foodTable(data);
    expect(t.name).toBe("תזונה לפי מכינה");
    expect(t.headers).toEqual(["מכינה (חניכים בלבד)", "חניכים", ...DIET_HEADERS]);
    expect(DIET_HEADERS).toEqual(["צמחוני/טבעוני בלבד", "ללא גלוטן בלבד", "גם וגם", "רגיל"]);
    expect(t.rows).toEqual([
      ["מכינה לדוגמה א", "15", "2", "0", "0", "13"],
      ["מכינה לדוגמה ב", "TBD", "TBD", "TBD", "TBD", "TBD"],
      ["מכינה לדוגמה נ", "5", "1", "0", "1", "3"],
      ["סה״כ", "TBD", "TBD", "TBD", "TBD", "TBD"],
    ]);
  });

  it("v20: the meals of each day — the grid's meal rows the week has, each in the shift it starts in, the cohorts on campus then", () => {
    // ב marked on Wednesday only (its numbers still TBD): every cohort is marked somewhere
    const d = { ...data, presence: [...data.presence, ...[0, 1, 2].map((shift) => ({ cohort_id: 2, day: 3, shift }) as RotaData["presence"][number])] };
    const meals = mealCounts(d, w.edition, w.rows);
    // Sunday opens 08:30 (no breakfast), Thursday closes 19:00 (no dinner, no midnight meal)
    expect(meals.map((m) => `${m.day}:${m.start}`)).toEqual([
      "0:795", "0:1140", "0:1440", ...[1, 2, 3].flatMap((day) => [420, 795, 1140, 1440].map((s) => `${day}:${s}`)), "4:420", "4:795",
    ]);
    expect(meals.map((m) => m.shift).slice(0, 7)).toEqual([0, 1, 2, 0, 0, 1, 2]);
    const at = (day: number, start: number) => meals.find((m) => m.day === day && m.start === start)!;
    expect(at(0, 795).cohorts.map((c) => c.letter)).toEqual(["א"]);
    expect(at(0, 795).counts).toEqual({ trainees: 15, veg_only: 2, gf_only: 0, both: 0, regular: 13 });
    // Monday: א and נ — «מהם גם וגם» counted once
    expect(at(1, 420).cohorts.map((c) => c.letter)).toEqual(["א", "נ"]);
    expect(at(1, 420).counts).toEqual({ trainees: 20, veg_only: 3, gf_only: 0, both: 1, regular: 16 });
    // Wednesday: ב is there and its numbers are TBD — so is every sum it is part of
    expect(at(3, 795).counts).toEqual({ trainees: null, veg_only: null, gf_only: null, both: null, regular: null });
    // Thursday's lunch: א only (נ is Monday and Tuesday)
    expect(at(4, 795).counts.trainees).toBe(15);

    const t = mealsTable(d, w.edition, w.rows);
    expect(t.name).toBe(SHEET.food);
    expect(t.headers).toEqual([...MEAL_HEADERS]);
    expect(MEAL_HEADERS).toEqual(["יום", "ארוחה", "מכינות בקמפוס", "חניכים", ...DIET_HEADERS]);
    expect(t.rows[0]).toEqual(["ראשון 14.2", `ארוחת צהריים / חבורות ${LRM}13:15–14:15`, "מכינה לדוגמה א", "15", "2", "0", "0", "13"]);
    expect(t.rows[2].slice(0, 2)).toEqual(["ליל ראשון–שני", `ארוחת חצות וניגונים / חבורות ${LRM}00:00–00:30`]); // the night's, of the day before
    expect(t.rows[3]).toEqual(["שני 15.2", `ארוחת בוקר / חבורות ${LRM}07:00–08:00`, "מכינה לדוגמה א, מכינה לדוגמה נ", "20", "3", "0", "1", "16"]);
    expect(t.rows.find((r) => r[0] === "רביעי 17.2")!.slice(2)).toEqual(["מכינה לדוגמה א, מכינה לדוגמה ב", "TBD", "TBD", "TBD", "TBD", "TBD"]);
    expect(mealDay({ start_date: null }, { day: 2, start: 795 })).toBe("שלישי"); // the week's date TBD: the day alone
  });

  it("v20: a meal never assumes — a cohort marked nowhere makes every meal TBD and is named; none on campus is a known nought", () => {
    const meals = mealCounts(data, w.edition, w.rows); // ב is not marked on campus anywhere
    expect(meals.every((m) => m.unmarked.map((c) => c.letter).join() === "ב")).toBe(true);
    expect(meals.every((m) => Object.values(m.counts).every((v) => v == null))).toBe(true);
    const t = mealsTable(data, w.edition, w.rows);
    expect(t.rows[0][2]).toBe("מכינה לדוגמה א · לא סומן מתי בקמפוס: מכינה לדוגמה ב");
    expect(t.rows[0].slice(3)).toEqual(["TBD", "TBD", "TBD", "TBD", "TBD"]);
    // every cohort marked, nobody on campus at that meal: «אין מכינות בקמפוס», and 0 — a fact, not a guess
    const one = { cohorts: [data.cohorts[2]], presence: data.presence.filter((p) => p.cohort_id === 3) };
    const sunday = mealsTable(one, w.edition, w.rows).rows[0];
    expect(sunday.slice(2)).toEqual(["אין מכינות בקמפוס", "0", "0", "0", "0", "0"]);
    // a cohort marked nowhere and nobody else: named alone
    expect(mealsTable({ cohorts: [data.cohorts[1]], presence: [] }, w.edition, w.rows).rows[0][2]).toBe("לא סומן מתי בקמפוס: מכינה לדוגמה ב");
    // a grid with no meal row: no row
    expect(mealCounts(data, w.edition, w.rows.filter((r) => !/ארוח/.test(r.label)))).toEqual([]);
  });

  it("says who is on campus in each shift — the cohorts, their trainees, the staff whose shift overlaps it", () => {
    const t = campusTable(data, w.edition);
    expect(t.rows).toHaveLength(14);
    expect(t.rows[0]).toEqual(["ראשון", `בוקר ${LRM}08:30–14:30`, "מכינה לדוגמה א", "15", `איש/אשת צוות לדוגמה ${LRM}08:30–14:30`]);
    expect(t.rows[5].slice(2)).toEqual(["מכינה לדוגמה א, מכינה לדוגמה נ", "20", `צוות מכינה לדוגמה נ ${LRM}22:30–06:30`]);
    const none = campusTable({ ...data, presence: [] }, w.edition);
    expect(none.rows[0].slice(2, 4)).toEqual(["לא סומן", ""]);
  });

  it("lists the loads, the staff and the preparations", () => {
    const loads = loadsTable(data, w.edition);
    expect(loads.headers).toEqual(["קבוצה", "מכינה", "גודל", "משמרות", "לילות", "מטבח", "נקיון", "משמרות בקמפוס", "צמודות"]);
    expect(loads.rows[0]).toEqual(["א1", "מכינה לדוגמה א", "8", "3", "1", "2", "1", "14", "0"]);
    expect(loads.rows[3]).toEqual(["נ1", "מכינה לדוגמה נ", "5", "1", "0", "1", "0", "6", "0"]);
    expect(staffTable(data).headers).toEqual(["יום", "שעות", "מי", "הערה"]); // v20: no «סוג»
    expect(staffTable(data).rows).toEqual([
      ["ראשון", `${LRM}08:30–14:30`, "איש/אשת צוות לדוגמה", ""],
      ["ראשון", `${LRM}14:30–22:30`, "שם לדוגמה", "הקפצת מרצה (לדוגמה)"],
      ["שני", `${LRM}22:30–06:30`, "צוות מכינה לדוגמה נ", ""],
    ]);
    expect(prepTable(data)).toMatchObject({ name: "מוצ״ש", rows: [["1", "משימת הכנה לדוגמה א", "", ""], ["2", "משימת הכנה לדוגמה ב", "א1", "בוצע"]] });
  });

  it("v19: the tasks and the shopping list apart — each numbered by its own place, the shared numbering never shown", () => {
    const d = rota();
    d.prep.push(
      { id: 5, edition_id: 1, text: "פריט לדוגמה ב", group_id: null, done: true, sort: 5, kind: "item", qty: "2 (לדוגמה)" },
      { id: 3, edition_id: 1, text: "פריט לדוגמה א", group_id: null, done: false, sort: 3, kind: "item", qty: null },
      { id: 4, edition_id: 1, text: "משימת הכנה לדוגמה ג", group_id: null, done: false, sort: 4, kind: "task", qty: null },
    );
    expect(prepInOrder(d, "task").map((t) => t.id)).toEqual([1, 2, 4]); // a row from before v19 (no kind) is a task
    expect(prepInOrder(d, "item").map((t) => t.id)).toEqual([3, 5]);
    expect(prepTable(d).rows.map((r) => r.slice(0, 2))).toEqual([["1", "משימת הכנה לדוגמה א"], ["2", "משימת הכנה לדוגמה ב"], ["3", "משימת הכנה לדוגמה ג"]]);
    expect(shoppingTable(d)).toMatchObject({
      name: "קניות מוצ״ש",
      headers: ["#", "פריט", "כמות", "נקנה"],
      rows: [["1", "פריט לדוגמה א", "", ""], ["2", "פריט לדוגמה ב", "2 (לדוגמה)", "נקנה"]],
    });
    expect(prepCounts(d)).toEqual({ tasks: 3, tasksDone: 1, items: 2, itemsBought: 1 });
    expect(prepCounts({ prep: [] })).toEqual({ tasks: 0, tasksDone: 0, items: 0, itemsBought: 0 });
    expect(shoppingTable(rota()).rows).toEqual([]);
  });
});

describe("the files", () => {
  const w = week();
  const data = rota();

  it("names every sheet in Hebrew — gershayim, never an ASCII quote — each once", () => {
    const tables = rotaWorkbook({ week: w, data, phones: null });
    const names = tables.map((t) => t.name);
    expect(names).toEqual([
      "לוח התורנויות", "לו״ז א1", "לו״ז א2", "לו״ז ב1", "לו״ז נ1", "יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "מטבח", "ראשי קבוצות", "משמרות צוות",
      "מוצ״ש", "קניות מוצ״ש", "אוכל", "תזונה לפי מכינה", "מי בקמפוס", "עומס",
    ]);
    expect(names.join("")).not.toContain('"');
    expect(names.find((n) => n.startsWith("מוצ"))).toBe("מוצ״ש");
    const workbook = xlsxParts(tables)["xl/workbook.xml"];
    for (const n of names) expect(workbook).toContain(`name="${n}"`);
    // no kitchen duty: no kitchen sheet
    expect(rotaWorkbook({ week: w, data: { ...data, duties: [data.duties[1]] }, phones: null }).map((t) => t.name)).not.toContain("מטבח");
  });

  it("guards every cell against formulas in the CSV and the xlsx — a head's name, a cohort's, a task's", () => {
    const evil = rota();
    evil.groups[0].head_name = "=HYPERLINK(1)";
    evil.cohorts[0].name = "+מכינה";
    evil.prep[0].text = "-משימה";
    const tables = rotaWorkbook({ week: w, data: evil, phones: null });
    const csv = tables.map((t) => toCsv(t)).join("");
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("'+מכינה");
    expect(csv).toContain("'-משימה");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    const zip = unzipSync(toXlsx(tables, new Date("2026-11-05T10:00:00Z")));
    const sheets = Object.keys(zip).filter((k) => k.startsWith("xl/worksheets/")).map((k) => strFromU8(zip[k])).join("");
    expect(sheets).toContain("'=HYPERLINK(1)");
    expect(sheets).not.toMatch(/<f>|>=HYPERLINK/);
  });

  it("gives the same tables whatever order the rota and the week came in", () => {
    const shuffled = rota();
    for (const k of ["cohorts", "cohortDuties", "presence", "groups", "duties", "assignments", "staff", "prep"] as const) (shuffled[k] as unknown[]).reverse();
    const w2 = week();
    w2.rows = [...w2.rows].reverse();
    w2.lessons.reverse();
    const a = rotaWorkbook({ week: w, data: rota(), phones: phonesOf([{ group_id: 11, head_phone: PHONE_1 }]) });
    const b = rotaWorkbook({ week: w2, data: shuffled, phones: phonesOf([{ group_id: 11, head_phone: PHONE_1 }]) });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // and the group's schedule from a reversed public schedule too
    const input = groupScheduleInputs(w, rota())[0].input;
    expect(groupSchedule({ ...input, entries: [...scheduleEntries(w)].reverse(), rows: [...input.rows].reverse() })).toEqual(groupSchedule(input));
  });

  it("stacks several tables into one CSV: a title, then each table's name, headers and rows", () => {
    const t = stackTables("כל הקבוצות", [headsTable(data, null), prepTable(data)]);
    expect(t.headers).toEqual(["כל הקבוצות"]);
    expect(t.rows[0]).toEqual(["ראשי קבוצות"]);
    expect(t.rows[1]).toEqual(["קבוצה", "מכינה", "גודל", "ראש/ת קבוצה"]);
    expect(t.rows.filter((r) => r.length === 0)).toHaveLength(2);
    expect(toCsv(t).split("\r\n")[0]).toBe("﻿כל הקבוצות");
  });
});
