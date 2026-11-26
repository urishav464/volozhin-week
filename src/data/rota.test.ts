// src/data/rota.ts's cleaners — the browser's twins of the guards (supabase/schema.sql «תורנויות»): what a write sends
// is cleaned here first, so the server's refusal is only a backstop. Synthetic values only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import {
  checkCohortCounts, cleanCohortFields, cleanCohortName, cleanContactName, cleanCount, cleanDay, cleanDescription, cleanDutyIds, cleanDutyName, cleanGroupNumber,
  cleanGroupSize, cleanHeadName, cleanHeadPhone, cleanLetter, cleanMinPeople, cleanNeed, cleanNote, cleanPrepText, cleanShift, cleanShifts, cleanSplitSizes, cleanStaffName,
  cleanStaffTimes, cleanStaffWho, isCohortContact, isHeadContact, LAST_YEAR_DUTIES, parsePrepList, ROTA_LIMITS, cleanFlag, cleanPrepKind, cleanPrepRows, cleanQty,
  parsePrepItems, prepKindOf,
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

  it("v20: the trainees and the three diet numbers — each 0–1000 or null (TBD), and the rule between them", () => {
    expect(cleanCount(null)).toBeNull();
    expect(cleanCount(undefined)).toBeNull();
    expect(cleanCount(0)).toBe(0);
    expect(cleanCount(ROTA_LIMITS.count)).toBe(1000);
    for (const bad of [1001, -1, 1.5, "2", Number.NaN]) expect(code(() => cleanCount(bad)), String(bad)).toBe("bad_value");
    expect(checkCohortCounts({ trainees: 23, diet_veg: 4, diet_gf: 3, diet_both: 2 })).toEqual({ trainees: 23, diet_veg: 4, diet_gf: 3, diet_both: 2 });
    expect(code(() => checkCohortCounts({ trainees: null, diet_veg: 1, diet_gf: null, diet_both: 2 }))).toBe("rota_diets_exceed"); // both > veg
    expect(code(() => checkCohortCounts({ trainees: null, diet_veg: null, diet_gf: 1, diet_both: 2 }))).toBe("rota_diets_exceed"); // both > gf
    expect(code(() => checkCohortCounts({ trainees: 5, diet_veg: 4, diet_gf: 3, diet_both: 1 }))).toBe("rota_diets_exceed"); // 4 + 3 − 1 > 5
    expect(code(() => checkCohortCounts({ trainees: 6, diet_veg: 4, diet_gf: 3, diet_both: 1 }))).toBe("ok"); // exactly
    // the review: one diet number above the trainees is refused already — «גם וגם» ≤ the other, so no number typed later
    // could make the sum fit (veg + gf − both ≥ the larger of the two)
    expect(code(() => checkCohortCounts({ trainees: 1, diet_veg: 400, diet_gf: 400, diet_both: null }))).toBe("rota_diets_exceed");
    expect(code(() => checkCohortCounts({ trainees: 40, diet_veg: 80, diet_gf: null, diet_both: 0 }))).toBe("rota_diets_exceed");
    expect(code(() => checkCohortCounts({ trainees: 40, diet_veg: null, diet_gf: 41, diet_both: null }))).toBe("rota_diets_exceed");
    expect(code(() => checkCohortCounts({ trainees: 40, diet_veg: 40, diet_gf: null, diet_both: null }))).toBe("ok"); // all of them, and gf may still be 0–40
    // a side TBD holds nothing else: the trainees TBD, any diets; the sum itself needs all four
    expect(code(() => checkCohortCounts({ trainees: null, diet_veg: 400, diet_gf: 400, diet_both: 0 }))).toBe("ok");
    expect(code(() => checkCohortCounts({ trainees: 40, diet_veg: 30, diet_gf: 30, diet_both: null }))).toBe("ok"); // «גם וגם» 20 or more would fit
    // the whole row, in the guard's order: the contact's name first, then the numbers, then the rule
    expect(cleanCohortFields({})).toEqual({ contact_name: null, trainees: null, diet_veg: null, diet_gf: null, diet_both: null });
    expect(cleanCohortFields({ contact_name: "  איש/אשת קשר  לדוגמה ", trainees: 8 })).toMatchObject({ contact_name: "איש/אשת קשר לדוגמה", trainees: 8 });
    expect(code(() => cleanCohortFields({ contact_name: "טל' 1234567", trainees: 2000 }))).toBe("rota_contact_in_text");
    expect(code(() => cleanCohortFields({ trainees: 2000, diet_veg: 1, diet_both: 5 }))).toBe("bad_value");
    expect(code(() => cleanContactName("א".repeat(81)))).toBe("bad_value");
    expect(cleanContactName("   ")).toBeNull();
  });

  it("v20: the duties a cohort helps in — a set of ids; the split's sizes — 1–99 groups of 0–200", () => {
    expect(cleanDutyIds([3, 1, 3])).toEqual([3, 1]);
    expect(cleanDutyIds([])).toEqual([]);
    for (const bad of [null, "1", [0], [1.5], ["2"]]) expect(code(() => cleanDutyIds(bad)), JSON.stringify(bad)).toBe("bad_value");
    expect(cleanSplitSizes([8, 8, 7])).toEqual([8, 8, 7]);
    expect(cleanSplitSizes([0])).toEqual([0]);
    for (const bad of [[], [201], [-1], [1.5], [null], Array.from({ length: 100 }, () => 1), "8"]) expect(code(() => cleanSplitSizes(bad)), JSON.stringify(bad)).toBe("bad_value");
    expect(cleanSplitSizes(Array.from({ length: 99 }, () => 1))).toHaveLength(99);
  });

  it("v20: a contacts row is a head's or a cohort contact's", () => {
    expect([isHeadContact({ group_id: 1, head_phone: "x" }), isCohortContact({ group_id: 1, head_phone: "x" })]).toEqual([true, false]);
    expect([isHeadContact({ cohort_id: 1, phone: "x" }), isCohortContact({ cohort_id: 1, phone: "x" })]).toEqual([false, true]);
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

describe("v19: a cohort's two flags, and Saturday night's two lists", () => {
  it("a flag is a boolean — null and anything else are bad_value (the columns are NOT NULL)", () => {
    expect(cleanFlag(true)).toBe(true);
    expect(cleanFlag(false)).toBe(false);
    for (const v of [null, undefined, "true", 1, 0]) expect(code(() => cleanFlag(v)), String(v)).toBe("bad_value");
  });

  it("a row's kind: a task or an item; as stored, an absent kind is a task", () => {
    expect(cleanPrepKind("task")).toBe("task");
    expect(cleanPrepKind("item")).toBe("item");
    for (const v of [null, undefined, "", "Item", "thing"]) expect(code(() => cleanPrepKind(v)), String(v)).toBe("bad_value");
    expect(prepKindOf({})).toBe("task");
    expect(prepKindOf({ kind: "item" })).toBe("item");
  });

  it("a quantity: one line of up to 40, no contact; blank → null", () => {
    expect(ROTA_LIMITS.qty).toBe(40);
    expect(cleanQty("  2   (לדוגמה) ")).toBe("2 (לדוגמה)");
    expect(cleanQty("  ")).toBeNull();
    expect(cleanQty(null)).toBeNull();
    expect(cleanQty("א".repeat(40))).toBe("א".repeat(40));
    expect(code(() => cleanQty("א".repeat(41)))).toBe("bad_value");
    expect(code(() => cleanQty("טל' 1234567"))).toBe("rota_contact_in_text");
  });

  it("the rows of one insert, each in the guard's order — the text, the kind, the quantity; a task's quantity is null whatever was sent", () => {
    expect(cleanPrepRows([" פריט לדוגמה ", { text: "פריט לדוגמה 2", qty: " 3 " }], "item")).toEqual([
      { text: "פריט לדוגמה", kind: "item", qty: null },
      { text: "פריט לדוגמה 2", kind: "item", qty: "3" },
    ]);
    // a task keeps no quantity, but a phone sent in one refuses all the same (≡ the guard)
    expect(cleanPrepRows([{ text: "משימה לדוגמה", qty: " 3 " }], "task")).toEqual([{ text: "משימה לדוגמה", kind: "task", qty: null }]);
    expect(code(() => cleanPrepRows([{ text: "משימה לדוגמה", qty: "טל' 1234567" }], "task"))).toBe("rota_contact_in_text");
    expect(code(() => cleanPrepRows([{ text: "  " }], "thing"))).toBe("name_required"); // the text first
    expect(code(() => cleanPrepRows([{ text: "פריט" }], "thing"))).toBe("bad_value");
    expect(code(() => cleanPrepRows([{ text: "פריט", qty: "טל' 1234567" }], "item"))).toBe("rota_contact_in_text");
    expect(cleanPrepRows([], "item")).toEqual([]);
  });

  it("a pasted shopping list: the numbering off as in a task list, then the quantity after the first tab (a spreadsheet's second column)", () => {
    expect(parsePrepItems("1. פריט לדוגמה\t2 (לדוגמה)\r\n2) פריט בלי כמות\n\n3\tפריט ממספור של גיליון\t5\nפריט\t  \n")).toEqual([
      { text: "פריט לדוגמה", qty: "2 (לדוגמה)" },
      { text: "פריט בלי כמות", qty: null },
      { text: "פריט ממספור של גיליון", qty: "5" },
      { text: "פריט", qty: null },
    ]);
    // a number that is the item's own stays; so does a second tab's text, in the quantity
    expect(parsePrepItems("40 כוסות\t2 שקיות\tהערה")).toEqual([{ text: "40 כוסות", qty: "2 שקיות הערה" }]);
    expect(parsePrepItems("\n \n")).toEqual([]);
    expect(code(() => parsePrepItems("פריט\tטל' 1234567"))).toBe("rota_contact_in_text");
    expect(code(() => parsePrepItems(`פריט\t${"א".repeat(41)}`))).toBe("bad_value");
    expect(code(() => parsePrepItems(Array.from({ length: 201 }, (_, i) => `פריט ${i}`).join("\n")))).toBe("bad_value");
  });
});

// The review: the privacy page said a cohort contact's phone was behind the heads' «כולל טלפונים…» and never in a link
// without an account. The screens do otherwise, as the owner's plan asks (§ו): the cohort's form reads it with no toggle,
// it is never printed, and a pick of the cohort as a transport's driver copies it into «טלפון הנהג/ת» — from there a
// driver's phone, shown on the escort's link once «סודר». And a staff shift has no kind since v20, but a note.
describe("the privacy page's «תורנויות» says what the screens do (the review)", () => {
  const html = readFileSync(new URL("../../public/privacy.html", import.meta.url), "utf8");
  const section = html.slice(html.indexOf("<h2>תורנויות</h2>"), html.indexOf("<h2>תוצרים וייצוא</h2>"));
  const items = section.split("<li>").slice(1);
  const item = (w: string) => items.find((l) => l.includes(w)) ?? "";

  it("the heads' switch is the heads' phones alone; a cohort contact's phone has its own line — its form with no switch, never printed, and as a driver's phone the transport's rules and the escort's link once «סודר»", () => {
    const heads = item("כולל טלפונים של ראשי הקבוצות");
    expect(heads).toContain("הטלפון של ראש/ת קבוצה");
    expect(heads).not.toContain("איש/אשת הקשר");
    const cohort = item("הטלפון של איש/אשת הקשר של מכינה");
    expect(cohort).not.toContain("כולל טלפונים של ראשי הקבוצות");
    for (const w of ["בטופס של המכינה", "לא מודפס", "טופס הנהג/ת", "«טלפון הנהג/ת»", "פרטי הנהג/ת של ההסעה", "שמלווה את השיעור", "סודרה"]) expect(cohort, w).toContain(w);
  });

  // The last review: the line said the saved driver's NAME too shows in «הסעות וצוות» only with «כולל כתובות וטלפונים».
  // The board and transportStaffTable (screen, print, files) show every approved transport's driver name; only the
  // address and the phone wait for the switch — as the page's own «לוגיסטיקה» line says.
  it("as a driver: the name in «הסעות וצוות» like any driver's, the phone alone behind «כולל כתובות וטלפונים»", () => {
    const cohort = item("הטלפון של איש/אשת הקשר של מכינה");
    expect(cohort).not.toMatch(/הם מופיעים ב«הסעות וצוות» רק עם/);
    expect(cohort).toContain("השם מופיע ב«הסעות וצוות» (במסך, בהדפסה ובקבצים) כמו השם של כל נהג/ת");
    expect(cohort).toContain("והטלפון רק עם «כולל כתובות וטלפונים»");
    // the page's «לוגיסטיקה» line says the same of every driver
    expect(html).toContain("מופיעות ההסעות שאושרו, עם השם של הנהג/ת");
  });

  it("a staff shift keeps its hours and a note the edition's team reads — no kind of shift (v20)", () => {
    expect(html).not.toContain("סוג המשמרת");
    const staff = item("<strong>משמרות הצוות</strong>");
    for (const w of ["את השעות", "הערה", "כל הצוות של המחזור", "בלי טלפונים"]) expect(staff, w).toContain(w);
  });
});
