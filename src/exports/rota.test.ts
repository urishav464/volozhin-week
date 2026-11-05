// «תורנויות»'s pages (src/exports/rota.ts), on a synthetic rota beside a week on the 2026 grid: a group's schedule —
// the bands, Sunday cut by the opening, Thursday without a night, a lesson at a shift's edge, side by side lessons,
// «זמן זיכרון» only where a memorial time is —, the board, the day sheet and the heads with and without phones (never a
// phone when they are off), the kitchen, the food sums (TBD, a negative «רגיל»), on campus, the loads, the preparations,
// the workbook's sheet names, the formula guard on every cell of the files, and the same answer whatever the order.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { RotaData, RotaStaffShift } from "../data/rota";
import { SHIFTS } from "../domain/rota";
import { rotaWarnings } from "../domain/rotaWarnings";
import { type Day, LRM } from "../domain/time";
import type { Week } from "../domain/types";
import { addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import { toCsv } from "./csv";
import { scheduleEntries } from "./designer";
import {
  BAND_FILL, campusTable, cohortTotal, daySheet, foodTable, groupSchedule, groupScheduleInputs, groupWeek, headsTable, kitchenDutyId, kitchenSheet, loadsTable,
  phonesOf, prepTable, regularCell, rotaBoardTable, rotaWorkbook, SHEET, shiftOfStart, shiftText, stackTables, STAFF_KIND_LABEL, staffTable,
} from "./rota";
import type { Table } from "./table";
import { toXlsx, xlsxParts } from "./xlsx";

const PHONE_1 = "טלפון לדוגמה 1";
const PHONE_3 = "טלפון לדוגמה 3";

/** Cohorts א (two groups, all week), ב (one group of unknown size, never marked), נ (one group, Monday and Tuesday). */
function rota(): RotaData {
  const all = [0, 1, 2, 3, 4].flatMap((day) => [0, 1, 2].map((shift) => ({ cohort_id: 1, day, shift })));
  return {
    cohorts: [
      { id: 1, edition_id: 1, letter: "א", name: "מכינה לדוגמה א", diets: [{ label: "צמחוני", count: 2 }], sort: 1 },
      { id: 2, edition_id: 1, letter: "ב", name: "מכינה לדוגמה ב", diets: [], sort: 2 },
      { id: 3, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", diets: [{ label: "טבעוני", count: 9 }], sort: 3 },
    ],
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
      { id: 1, edition_id: 1, day: 0, start_min: 510, end_min: 870, member_id: 5, name: "איש/אשת צוות לדוגמה", cohort_id: null, kind: "lead", note: null },
      { id: 2, edition_id: 1, day: 0, start_min: 870, end_min: 1350, member_id: null, name: "שם לדוגמה", cohort_id: null, kind: "shift", note: "הקפצת מרצה (לדוגמה)" },
      { id: 3, edition_id: 1, day: 1, start_min: 1350, end_min: 1830, member_id: null, name: null, cohort_id: 3, kind: "shift", note: null },
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
      [`בוקר ${LRM}08:30–14:30`, "אחראי/ת משמרת", `איש/אשת צוות לדוגמה ${LRM}08:30–14:30`, "", ""],
      [`בוקר ${LRM}08:30–14:30`, "מטבח", "א1", "8", "ראש/ת קבוצה לדוגמה 1"],
      [`בוקר ${LRM}08:30–14:30`, "נקיון", "א2", "7", ""],
    ]);
    expect(t.fills!.slice(0, 3)).toEqual([BAND_FILL, null, null]);
    // the afternoon has a shift and no lead: the lead is TBD, said
    expect(t.rows.filter((r) => r[0].startsWith("אחר צהריים")).slice(0, 2)).toEqual([
      [`אחר צהריים ${LRM}14:30–22:30`, "אחראי/ת משמרת", "TBD", "", ""],
      [`אחר צהריים ${LRM}14:30–22:30`, "משמרת", `שם לדוגמה ${LRM}14:30–22:30 · הקפצת מרצה (לדוגמה)`, "", ""],
    ]);
    const thursday = daySheet(data, w.edition, 4, null);
    expect(thursday.rows.filter((r) => r[0] === "לילה (מחוץ לשבוע)").map((r) => r.slice(1, 3))).toContainEqual(["נקיון", "א2"]);
    for (const off of [t, thursday, headsTable(data, null)]) {
      expect(cells(off).join("|")).not.toMatch(/טלפון/);
      for (const r of off.rows) expect(r).toHaveLength(off.headers.length);
    }
  });

  it("lists a lead in every shift their hours overlap, and TBD exactly where the board warns «no_lead»", () => {
    const d = rota();
    const lead = (id: number, day: Day, start_min: number, end_min: number, name: string): RotaStaffShift => ({ id, edition_id: 1, day, start_min, end_min, member_id: null, name, cohort_id: null, kind: "lead", note: null });
    d.staff = [
      ...d.staff,
      lead(11, 1, 390, 860, "אחראי/ת בוקר לדוגמה"), // Monday 06:30–14:20
      lead(12, 1, 840, 1350, "אחראי/ת ערב לדוגמה"), // Monday 14:00–22:30: the morning's end and the whole afternoon
      lead(13, 2, 390, 1830, "אחראי/ת יום לדוגמה"), // Tuesday, the whole day
    ];
    const leadRows = (day: Day, shift: 0 | 1 | 2) => daySheet(d, w.edition, day, null).rows.filter((r) => r[0] === shiftText(w.edition, shift, day) && r[1] === STAFF_KIND_LABEL.lead).map((r) => r[2]);
    expect(leadRows(1, 0)).toEqual([`אחראי/ת בוקר לדוגמה ${LRM}06:30–14:20`, `אחראי/ת ערב לדוגמה ${LRM}14:00–22:30`]);
    expect(leadRows(1, 1)).toEqual([`אחראי/ת ערב לדוגמה ${LRM}14:00–22:30`]);
    expect(leadRows(1, 2)).toEqual(["TBD"]);
    for (const shift of SHIFTS) expect(leadRows(2, shift)).toEqual([`אחראי/ת יום לדוגמה ${LRM}06:30–06:30`]);
    // one rule with the board: a shift's TBD on the page is its «no_lead» there, day by day
    const warned = rotaWarnings(d, w.edition).filter((x) => x.kind === "no_lead").map((x) => `${x.day}:${x.shift}`);
    const tbd = ([0, 1, 2, 3, 4] as Day[]).flatMap((day) => SHIFTS.filter((shift) => leadRows(day, shift).includes("TBD")).map((shift) => `${day}:${shift}`));
    expect(tbd).toEqual(warned);
    expect(tbd).toContain("1:2");
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
    expect(t.rows[0]).toEqual(["ראשון", `בוקר ${LRM}08:30–14:30`, "א1", "8", "ראש/ת קבוצה לדוגמה 1", "15", "צמחוני 2", `${LRM}13:15–14:15 ארוחת צהריים / חבורות`]);
    // two groups: their people added up; נ on campus on Monday — its trainees and its diet too
    expect(t.rows[3].slice(2, 7)).toEqual(["א2, נ1", "12", "TBD, ראש/ת קבוצה לדוגמה 4", "20", "צמחוני 2; טבעוני 9"]);
    expect(t.rows[3][7]).toBe(`${LRM}07:00–08:00 ארוחת בוקר / חבורות; ${LRM}13:15–14:15 ארוחת צהריים / חבורות`);
    expect(t.rows[1].slice(2, 4)).toEqual(["—", ""]); // nobody yet
    expect(kitchenSheet(data, w.edition, w.rows, 2).name).toBe("לו״ז נקיון");
  });

  it("counts the food for trainees only: Σ sizes, TBD when one is unknown, the diets, the rest — and warns when the diets are more", () => {
    expect(cohortTotal(data, 1)).toBe(15);
    expect(cohortTotal(data, 2)).toBeNull();
    expect(regularCell(5, [{ label: "טבעוני", count: 9 }])).toBe("לבדוק: הדיאטות (9) יותר מהחניכים (5)");
    expect(regularCell(null, [])).toBe("TBD");
    const t = foodTable(data, w.edition);
    expect(t.headers.slice(0, 5)).toEqual(["מכינה (חניכים בלבד)", "חניכים", "צמחוני", "טבעוני", "רגיל"]);
    expect(t.headers.slice(5, 8)).toEqual(["ראשון בוקר", "ראשון אחר צהריים", "ראשון לילה"]);
    expect(t.headers).toHaveLength(5 + 14);
    const [a, b, n, total] = t.rows;
    expect(a.slice(0, 5)).toEqual(["מכינה לדוגמה א", "15", "2", "", "13"]);
    expect(b.slice(0, 5)).toEqual(["מכינה לדוגמה ב", "TBD", "", "", "TBD"]);
    expect(n.slice(0, 5)).toEqual(["מכינה לדוגמה נ", "5", "", "9", "לבדוק: הדיאטות (9) יותר מהחניכים (5)"]);
    expect(total.slice(0, 5)).toEqual(["סה״כ", "TBD", "2", "9", "TBD"]);
    // per shift: א all week, נ on Monday and Tuesday, ב never marked
    expect(a.slice(5, 8)).toEqual(["15", "15", "15"]);
    expect(n.slice(5, 11)).toEqual(["", "", "", "5", "5", "5"]);
    expect(total.slice(5, 11)).toEqual(["15", "15", "15", "20", "20", "20"]);
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
    expect(staffTable(data).rows).toEqual([
      ["ראשון", `${LRM}08:30–14:30`, "איש/אשת צוות לדוגמה", "אחראי/ת משמרת", ""],
      ["ראשון", `${LRM}14:30–22:30`, "שם לדוגמה", "משמרת", "הקפצת מרצה (לדוגמה)"],
      ["שני", `${LRM}22:30–06:30`, "צוות מכינה לדוגמה נ", "משמרת", ""],
    ]);
    expect(prepTable(data)).toMatchObject({ name: "מוצ״ש", rows: [["1", "משימת הכנה לדוגמה א", "", ""], ["2", "משימת הכנה לדוגמה ב", "א1", "בוצע"]] });
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
      "מוצ״ש", "אוכל", "מי בקמפוס", "עומס",
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
    for (const k of ["cohorts", "presence", "groups", "duties", "assignments", "staff", "prep"] as const) (shuffled[k] as unknown[]).reverse();
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
