// src/data/rota.ts's cleaners — the browser's twins of the guards (supabase/schema.sql «תורנויות»): what a write sends
// is cleaned here first, so the server's refusal is only a backstop. Synthetic values only.
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import {
  cleanCohortName, cleanDay, cleanDescription, cleanDiets, cleanDutyName, cleanGroupNumber, cleanGroupSize, cleanHeadName, cleanHeadPhone, cleanLetter, cleanMinPeople,
  cleanNeed, cleanNote, cleanPrepText, cleanShift, cleanShifts, cleanStaffKind, cleanStaffName, cleanStaffTimes, cleanStaffWho, LAST_YEAR_DUTIES, parsePrepList, ROTA_LIMITS,
} from "./rota";

const code = (f: () => unknown) => {
  try {
    f();
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

describe("the cohorts' and groups' fields", () => {
  it("a letter: one line of up to three, no digit or space", () => {
    expect(cleanLetter("  א ")).toBe("א");
    expect(cleanLetter("אב")).toBe("אב");
    expect(code(() => cleanLetter("א1"))).toBe("bad_value");
    expect(code(() => cleanLetter("א ב"))).toBe("bad_value");
    expect(code(() => cleanLetter("אבגד"))).toBe("bad_value");
    expect(code(() => cleanLetter("  "))).toBe("name_required");
    expect(code(() => cleanLetter(null))).toBe("name_required");
  });

  it("a cohort's name: required, one line, no contact", () => {
    expect(cleanCohortName("  מכינה   לדוגמה ")).toBe("מכינה לדוגמה");
    expect(code(() => cleanCohortName(""))).toBe("name_required");
    expect(code(() => cleanCohortName("א".repeat(ROTA_LIMITS.cohortName + 1)))).toBe("bad_value");
    expect(code(() => cleanCohortName("מכינה 000-000-0055"))).toBe("rota_contact_in_text");
    expect(code(() => cleanCohortName("מכינה x@example.org"))).toBe("rota_contact_in_text");
  });

  it("diets: up to six, each a label and a count 0–1000", () => {
    expect(cleanDiets([{ label: " צמחוני ", count: 3 }])).toEqual([{ label: "צמחוני", count: 3 }]);
    expect(cleanDiets([])).toEqual([]);
    expect(code(() => cleanDiets(Array.from({ length: 7 }, (_, i) => ({ label: `ד${i}`, count: 1 }))))).toBe("bad_value");
    expect(code(() => cleanDiets([{ label: "צמחוני", count: 1001 }]))).toBe("bad_value");
    expect(code(() => cleanDiets([{ label: "צמחוני", count: -1 }]))).toBe("bad_value");
    expect(code(() => cleanDiets([{ label: "צמחוני", count: 1.5 }]))).toBe("bad_value");
    expect(code(() => cleanDiets([{ label: " ", count: 1 }]))).toBe("bad_value");
    expect(code(() => cleanDiets([{ label: "טל' 1234567", count: 1 }]))).toBe("rota_contact_in_text");
    expect(code(() => cleanDiets("צמחוני"))).toBe("bad_value");
    expect(code(() => cleanDiets([null]))).toBe("bad_value");
  });

  it("a group's number 1–99, its size 0–200 or TBD, its head's name a line or none", () => {
    expect(cleanGroupNumber(1)).toBe(1);
    expect(cleanGroupNumber(99)).toBe(99);
    expect(code(() => cleanGroupNumber(0))).toBe("bad_value");
    expect(code(() => cleanGroupNumber(100))).toBe("bad_value");
    expect(code(() => cleanGroupNumber(2.5))).toBe("bad_value");
    expect(code(() => cleanGroupNumber("3"))).toBe("bad_value");
    expect(cleanGroupSize(null)).toBeNull();
    expect(cleanGroupSize(undefined)).toBeNull();
    expect(cleanGroupSize(0)).toBe(0);
    expect(code(() => cleanGroupSize(201))).toBe("bad_value");
    expect(cleanHeadName("  ראש/ת קבוצה לדוגמה ")).toBe("ראש/ת קבוצה לדוגמה");
    expect(cleanHeadName(" ")).toBeNull();
    expect(code(() => cleanHeadName("ראש/ת קבוצה 0000000055"))).toBe("rota_contact_in_text");
  });

  it("a head's phone: a line of up to 40 with at least six digits; blank removes", () => {
    expect(cleanHeadPhone(" 000-000-0001 ")).toBe("000-000-0001");
    expect(cleanHeadPhone("12-3456")).toBe("12-3456");
    expect(cleanHeadPhone("  ")).toBeNull();
    expect(cleanHeadPhone(null)).toBeNull();
    expect(code(() => cleanHeadPhone("12-345"))).toBe("bad_phone");
    expect(code(() => cleanHeadPhone("טלפון לדוגמה"))).toBe("bad_phone"); // the demo's placeholder never goes through here
    expect(code(() => cleanHeadPhone("0".repeat(41)))).toBe("bad_value");
  });
});

describe("the duties' fields", () => {
  it("a name required, a description a block, needs 0–20 or not set, a minimum 1–500 or none", () => {
    expect(cleanDutyName("  פינת   קפה ")).toBe("פינת קפה");
    expect(code(() => cleanDutyName(""))).toBe("name_required");
    expect(code(() => cleanDutyName("א".repeat(41)))).toBe("bad_value");
    expect(cleanDescription("  שורה אחת\r\nושורה שנייה  ")).toBe("שורה אחת\nושורה שנייה");
    expect(cleanDescription("")).toBeNull();
    expect(code(() => cleanDescription("לכתוב ל-someone@example.org"))).toBe("rota_contact_in_text");
    expect(code(() => cleanDescription("א".repeat(501)))).toBe("bad_value");
    expect([cleanNeed(null), cleanNeed(0), cleanNeed(20)]).toEqual([null, 0, 20]);
    expect(code(() => cleanNeed(21))).toBe("bad_value");
    expect(code(() => cleanNeed(-1))).toBe("bad_value");
    expect([cleanMinPeople(null), cleanMinPeople(1), cleanMinPeople(500)]).toEqual([null, 1, 500]);
    expect(code(() => cleanMinPeople(0))).toBe("bad_value");
    expect(code(() => cleanMinPeople(501))).toBe("bad_value");
  });

  it("last year's four duties pass their own cleaners, and name no one", () => {
    expect(LAST_YEAR_DUTIES.map((d) => d.name)).toEqual(["בית מדרש", "פינת קפה", "מטבח", "נקיון"]);
    for (const d of LAST_YEAR_DUTIES) {
      expect(cleanDutyName(d.name)).toBe(d.name);
      expect(cleanDescription(d.description)).toBe(d.description);
      for (const n of [d.need_morning, d.need_afternoon, d.need_night]) expect(cleanNeed(n)).toBe(n);
    }
    expect(LAST_YEAR_DUTIES.map((d) => [d.need_morning, d.need_afternoon, d.need_night])).toEqual([[4, 4, 4], [1, 1, 1], [1, 1, 1], [1, 1, 1]]);
  });
});

describe("assignments and staff shifts", () => {
  it("a day 0–4 and a shift 0–2", () => {
    expect([cleanDay(0), cleanDay(4), cleanShift(0), cleanShift(2)]).toEqual([0, 4, 0, 2]);
    expect(code(() => cleanDay(5))).toBe("bad_value");
    expect(code(() => cleanShift(3))).toBe("bad_value");
    expect(code(() => cleanShift(-1))).toBe("bad_value");
  });

  it("a staff shift's times: 06:30 to 06:30, start before end, multiples of 5", () => {
    expect(cleanStaffTimes(390, 1830)).toEqual({ start_min: 390, end_min: 1830 });
    expect(code(() => cleanStaffTimes(780, 510))).toBe("bad_value");
    expect(code(() => cleanStaffTimes(510, 510))).toBe("bad_value");
    expect(code(() => cleanStaffTimes(385, 510))).toBe("bad_value");
    expect(code(() => cleanStaffTimes(510, 1835))).toBe("bad_value");
    expect(code(() => cleanStaffTimes(512, 780))).toBe("bad_value");
  });

  it("who: exactly one of a name and a cohort; a member only with a name", () => {
    expect(cleanStaffWho({ member_id: 3, name: " חבר/ת צוות לדוגמה ", cohort_id: null })).toEqual({ member_id: 3, name: "חבר/ת צוות לדוגמה", cohort_id: null });
    expect(cleanStaffWho({ member_id: null, name: null, cohort_id: 4 })).toEqual({ member_id: null, name: null, cohort_id: 4 });
    expect(code(() => cleanStaffWho({ member_id: null, name: " ", cohort_id: null }))).toBe("name_required");
    expect(code(() => cleanStaffWho({ member_id: null, name: "x", cohort_id: 4 }))).toBe("bad_value");
    expect(code(() => cleanStaffWho({ member_id: 3, name: null, cohort_id: 4 }))).toBe("bad_value");
    expect(code(() => cleanStaffName("איש/אשת צוות 000-000-0055"))).toBe("rota_contact_in_text");
    expect(cleanStaffKind("lead")).toBe("lead");
    expect(code(() => cleanStaffKind("boss"))).toBe("bad_value");
    expect(cleanNote("  הקפצת מרצה ")).toBe("הקפצת מרצה");
    expect(code(() => cleanNote("הקפצת מרצה, טל' 1234567"))).toBe("rota_contact_in_text");
  });
});

describe("the preparations", () => {
  it("a task: a required line, no contact", () => {
    expect(cleanPrepText(" לסדר את החדר ")).toBe("לסדר את החדר");
    expect(code(() => cleanPrepText(""))).toBe("name_required");
    expect(code(() => cleanPrepText("א".repeat(201)))).toBe("bad_value");
  });

  it("a pasted list: its numbering taken off («16.», «16)», «16 -», «16:»), empty lines dropped", () => {
    expect(parsePrepList("16. לסדר כיסאות\r\n17) לפתוח את המחסן\n\n18 - משימה לדוגמה\n  19: עוד משימה  \nבלי מספר\n3.לצמוד")).toEqual([
      "לסדר כיסאות",
      "לפתוח את המחסן",
      "משימה לדוגמה",
      "עוד משימה",
      "בלי מספר",
      "לצמוד",
    ]);
    expect(parsePrepList("1–משימה")).toEqual(["משימה"]);
    // a number that is the task's own stays («2 שולחנות»); a spreadsheet's numbering cell (a tab) goes
    expect(parsePrepList("2 שולחנות לחדר האוכל\n3) 40 כוסות\n12\tלסדר את המחסן")).toEqual(["2 שולחנות לחדר האוכל", "40 כוסות", "לסדר את המחסן"]);
    expect(parsePrepList("\n \n")).toEqual([]);
  });

  it("refuses the whole paste for a phone or an e-mail in any line, or a list too long", () => {
    expect(code(() => parsePrepList("1. משימה\n2. להתקשר ל-000-000-0055"))).toBe("rota_contact_in_text");
    expect(code(() => parsePrepList("1. משימה\n2. לכתוב ל-x@example.org"))).toBe("rota_contact_in_text");
    expect(code(() => parsePrepList(Array.from({ length: ROTA_LIMITS.prepPaste + 1 }, (_, i) => `${i + 1}. משימה`).join("\n")))).toBe("bad_value");
    expect(parsePrepList(Array.from({ length: ROTA_LIMITS.prepPaste }, (_, i) => `${i + 1}. משימה`).join("\n"))).toHaveLength(ROTA_LIMITS.prepPaste);
  });
});

describe("the shifts' setting", () => {
  const labels: [string, string, string] = ["בוקר", "צהריים", "לילה"];
  it("two cuts strictly inside the day, in order, multiples of 5; three names", () => {
    expect(cleanShifts({ cuts: [840, 1320], labels: [" בוקר ", "צהריים", "לילה"] })).toEqual({ cuts: [840, 1320], labels });
    expect(code(() => cleanShifts({ cuts: [1320, 840], labels }))).toBe("bad_value");
    expect(code(() => cleanShifts({ cuts: [840, 840], labels }))).toBe("bad_value");
    expect(code(() => cleanShifts({ cuts: [390, 840], labels }))).toBe("bad_value");
    expect(code(() => cleanShifts({ cuts: [840, 1830], labels }))).toBe("bad_value");
    expect(code(() => cleanShifts({ cuts: [842, 1320], labels }))).toBe("bad_value");
    expect(code(() => cleanShifts({ cuts: [840] as never, labels }))).toBe("bad_value");
    expect(code(() => cleanShifts({ cuts: [840, 1320], labels: ["א", "ב"] as never }))).toBe("bad_value");
    expect(code(() => cleanShifts(null as never))).toBe("bad_value");
    expect(code(() => cleanShifts({ cuts: [840, 1320], labels: ["בוקר", " ", "לילה"] }))).toBe("name_required");
    expect(code(() => cleanShifts({ cuts: [840, 1320], labels: ["בוקר", "א".repeat(21), "לילה"] }))).toBe("bad_value");
    expect(code(() => cleanShifts({ cuts: [840, 1320], labels: ["בוקר", "טל' 1234567", "לילה"] }))).toBe("rota_contact_in_text");
  });
});
