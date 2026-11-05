// «תורנויות»: the rules both implementations hold (docs/CONTRACT.md «תורנויות»), as one table of cases run on the
// database (tests/sql/rota.test.ts — each op as the INSERT/UPDATE/RPC the Supabase port sends, as a logistics member
// of a live real edition) and on the demo (src/data/rotaPorts.test.ts — the DemoRota method). Synthetic values only.
//
// Every case starts from ROTA_FIXTURE in an empty edition: cohort «א» (A), its group 1 (G1) and group 2 (G2), cohort «נ»
// (N), the duty «מטבח» (D1) and «נקיון» (D2), and G2 on D2 on Monday morning. `expect` is "ok" or the refusal's code.
import type { NewAssignment, NewCohort, NewDuty, NewGroup, NewStaffShift, RotaShiftsSetting } from "../data/rota";

export const ROTA_FIXTURE = {
  cohorts: [
    { ref: "A", letter: "א", name: "מכינה לדוגמה א", diets: [{ label: "צמחוני", count: 2 }], sort: 1 },
    { ref: "N", letter: "נ", name: "מכינה לדוגמה נ", diets: [], sort: 2 },
  ],
  groups: [
    { ref: "G1", cohort: "A", number: 1, size: 8, head_name: "ראש/ת קבוצה לדוגמה 1" },
    { ref: "G2", cohort: "A", number: 2, size: 7, head_name: null },
  ],
  duties: [
    { ref: "D1", name: "מטבח", description: null, need_morning: 1, need_afternoon: 1, need_night: 1, min_people: null, sort: 1 },
    { ref: "D2", name: "נקיון", description: null, need_morning: 1, need_afternoon: 1, need_night: null, min_people: null, sort: 2 },
  ],
  assignments: [{ day: 1, shift: 0, duty: "D2", group: "G2" }],
} as const;

/** A reference into the fixture («A», «G1», «D2»…) where an id goes. */
export type Ref = string;

export type RotaCase =
  | { name: string; op: "addCohort"; args: NewCohort; expect: string }
  | { name: string; op: "updateCohort"; ref: Ref; args: Record<string, unknown>; expect: string }
  | { name: string; op: "deleteCohort"; ref: Ref; expect: string }
  | { name: string; op: "addGroup"; args: Omit<NewGroup, "cohort_id"> & { cohort: Ref }; expect: string }
  | { name: string; op: "addDuty"; args: NewDuty; expect: string }
  | { name: string; op: "assign"; args: Omit<NewAssignment, "duty_id" | "group_id"> & { duty: Ref; group: Ref }; expect: string }
  | { name: string; op: "applySuggestion"; args: (Omit<NewAssignment, "duty_id" | "group_id"> & { duty: Ref; group: Ref })[]; expect: string }
  | { name: string; op: "addStaffShift"; args: Omit<NewStaffShift, "cohort_id"> & { cohort?: Ref | null }; expect: string }
  | { name: string; op: "addPrepTasks"; args: string[]; expect: string }
  | { name: string; op: "setShifts"; args: RotaShiftsSetting | null; expect: string }
  | { name: string; op: "setContact"; ref: Ref; args: string | null; expect: string };

const staff = (over: Partial<NewStaffShift> = {}): Omit<NewStaffShift, "cohort_id"> => ({
  day: 1, start_min: 510, end_min: 780, member_id: null, name: "איש/אשת צוות לדוגמה", kind: "shift", note: null, ...over,
});

/** The edition is a real one, live, with `first_day_from` 510 (Sunday opens 08:30) and `last_day_until` 1140 (Thursday 19:00). */
export const ROTA_CASES: RotaCase[] = [
  // cohorts
  { name: "a cohort", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב" }, expect: "ok" },
  { name: "the same letter twice", op: "addCohort", args: { letter: "א", name: "עוד מכינה" }, expect: "rota_letter_taken" },
  { name: "a letter with a digit", op: "addCohort", args: { letter: "א1", name: "מכינה" }, expect: "bad_value" },
  { name: "a letter too long", op: "addCohort", args: { letter: "אבגד", name: "מכינה" }, expect: "bad_value" },
  { name: "no name", op: "addCohort", args: { letter: "ג", name: "   " }, expect: "name_required" },
  { name: "a phone in a cohort's name", op: "addCohort", args: { letter: "ג", name: "מכינה 000-000-0055" }, expect: "rota_contact_in_text" },
  { name: "seven diets", op: "addCohort", args: { letter: "ג", name: "מכינה", diets: Array.from({ length: 7 }, (_, i) => ({ label: `דיאטה ${i}`, count: 1 })) }, expect: "bad_value" },
  { name: "a diet's count out of range", op: "addCohort", args: { letter: "ג", name: "מכינה", diets: [{ label: "צמחוני", count: 1001 }] }, expect: "bad_value" },
  { name: "a cohort with groups is not deleted", op: "deleteCohort", ref: "A", expect: "in_use" },
  { name: "a cohort without groups is", op: "deleteCohort", ref: "N", expect: "ok" },
  // groups
  { name: "a group", op: "addGroup", args: { cohort: "A", number: 3, size: 9, head_name: null }, expect: "ok" },
  { name: "a group's number twice in a cohort", op: "addGroup", args: { cohort: "A", number: 1 }, expect: "rota_group_taken" },
  { name: "the same number in another cohort", op: "addGroup", args: { cohort: "N", number: 1 }, expect: "ok" },
  { name: "number 0", op: "addGroup", args: { cohort: "A", number: 0 }, expect: "bad_value" },
  { name: "a size over 200", op: "addGroup", args: { cohort: "A", number: 4, size: 201 }, expect: "bad_value" },
  { name: "a phone in a head's name", op: "addGroup", args: { cohort: "A", number: 4, head_name: "ראש/ת קבוצה 0000000055" }, expect: "rota_contact_in_text" },
  // duties
  { name: "a duty", op: "addDuty", args: { name: "פינת קפה", need_morning: 1 }, expect: "ok" },
  { name: "a duty's name again, spelled otherwise", op: "addDuty", args: { name: "  מטבח " }, expect: "rota_duty_exists" },
  { name: "a need over 20", op: "addDuty", args: { name: "בית מדרש", need_morning: 21 }, expect: "bad_value" },
  { name: "a minimum of 0", op: "addDuty", args: { name: "בית מדרש", min_people: 0 }, expect: "bad_value" },
  { name: "an e-mail in a description", op: "addDuty", args: { name: "בית מדרש", description: "לכתוב ל-someone@example.org" }, expect: "rota_contact_in_text" },
  // assignments
  { name: "a group on a duty", op: "assign", args: { day: 1, shift: 0, duty: "D1", group: "G1" }, expect: "ok" },
  { name: "a group in two duties in one shift", op: "assign", args: { day: 1, shift: 0, duty: "D1", group: "G2" }, expect: "rota_group_busy" },
  { name: "Thursday night (the week closes at 19:00)", op: "assign", args: { day: 4, shift: 2, duty: "D1", group: "G1" }, expect: "outside_week" },
  { name: "Thursday afternoon (it begins before the close)", op: "assign", args: { day: 4, shift: 1, duty: "D1", group: "G1" }, expect: "ok" },
  { name: "Sunday morning (it ends after the 08:30 opening)", op: "assign", args: { day: 0, shift: 0, duty: "D1", group: "G1" }, expect: "ok" },
  { name: "a day out of the week", op: "assign", args: { day: 5 as 4, shift: 0, duty: "D1", group: "G1" }, expect: "bad_value" },
  { name: "a suggestion of two", op: "applySuggestion", args: [{ day: 2, shift: 0, duty: "D1", group: "G1" }, { day: 2, shift: 1, duty: "D1", group: "G2" }], expect: "ok" },
  { name: "a suggestion with a row taken meanwhile: none goes in", op: "applySuggestion", args: [{ day: 2, shift: 0, duty: "D1", group: "G1" }, { day: 1, shift: 0, duty: "D1", group: "G2" }], expect: "stale" },
  // staff shifts
  { name: "a staff shift", op: "addStaffShift", args: staff(), expect: "ok" },
  { name: "a cohort's whole staff", op: "addStaffShift", args: { ...staff({ name: null }), cohort: "N" }, expect: "ok" },
  { name: "neither a name nor a cohort", op: "addStaffShift", args: staff({ name: null }), expect: "name_required" },
  { name: "both a name and a cohort", op: "addStaffShift", args: { ...staff(), cohort: "N" }, expect: "bad_value" },
  { name: "an end before the start", op: "addStaffShift", args: staff({ start_min: 780, end_min: 510 }), expect: "bad_value" },
  { name: "a time not a multiple of 5", op: "addStaffShift", args: staff({ start_min: 512 }), expect: "bad_value" },
  { name: "a phone in a note", op: "addStaffShift", args: staff({ note: "הקפצת מרצה, טל' 1234567" }), expect: "rota_contact_in_text" },
  // preparations
  { name: "a pasted list", op: "addPrepTasks", args: ["חדר צוות לדוגמה", "פינת קפה לדוגמה לסדר"], expect: "ok" },
  { name: "a phone in a task", op: "addPrepTasks", args: ["להתקשר ל-000-000-0055"], expect: "rota_contact_in_text" },
  // the shifts
  { name: "other cuts and names", op: "setShifts", args: { cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] }, expect: "forbidden" },
  { name: "back to last year's", op: "setShifts", args: null, expect: "forbidden" },
  // the heads' phones
  { name: "a head's phone", op: "setContact", ref: "G1", args: "000-000-0001", expect: "ok" },
  { name: "a phone of five digits", op: "setContact", ref: "G1", args: "12-345", expect: "bad_phone" },
  { name: "a phone removed", op: "setContact", ref: "G1", args: null, expect: "ok" },
];

/** The same shifts' cases as an edition's admin (a logistics member may not set them: «forbidden» above). */
export const ROTA_ADMIN_CASES: RotaCase[] = [
  { name: "other cuts and names", op: "setShifts", args: { cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] }, expect: "ok" },
  { name: "cuts out of order", op: "setShifts", args: { cuts: [1320, 840], labels: ["בוקר", "צהריים", "לילה"] }, expect: "bad_value" },
  { name: "a cut not a multiple of 5", op: "setShifts", args: { cuts: [842, 1320], labels: ["בוקר", "צהריים", "לילה"] }, expect: "bad_value" },
  { name: "an empty name", op: "setShifts", args: { cuts: [840, 1320], labels: ["בוקר", " ", "לילה"] }, expect: "name_required" },
  { name: "back to last year's", op: "setShifts", args: null, expect: "ok" },
];
