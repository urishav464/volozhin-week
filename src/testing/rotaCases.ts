// «תורנויות»: the rules both implementations hold (docs/CONTRACT.md «תורנויות»), as one table of cases run on the
// database (tests/sql/rota.test.ts — each op as the INSERT/UPDATE/RPC the Supabase port sends, as a logistics member
// of a live real edition) and on the demo (src/data/rotaPorts.test.ts — the DemoRota method). Synthetic values only.
//
// Every case starts from ROTA_FIXTURE in an empty edition: cohort «א» (A), its group 1 (G1) and group 2 (G2), cohort «נ»
// (N), the duty «מטבח» (D1) and «נקיון» (D2), and G2 on D2 on Monday morning. `expect` is "ok" or the refusal's code.
//
// v19: a cohort's two flags (`helps_rota`, `can_drive` — addCohort's and updateCohort's args, sent as the columns), and
// `addPrepRows` — one insert of rows of one `kind` («task» or «item», sent as it is: the guard checks it) with their
// quantities (`qty`, an item's); its `prep`, on an "ok", is the edition's whole list afterwards (the fixture has none),
// in order — what the guard wrote: a task's quantity is null. A quantity is cleaned whatever the kind (a phone in a
// task's refuses too). `updatePrep`: one row «פריט לדוגמה» of `kind` (quantity «1») is there before the case starts
// (written as the owner, through the guard); the case updates it with `args`.
//
// v20: the fixture's cohorts carry their numbers (A: 15 trainees, 3 «צמחוני/טבעוני», 2 «ללא גלוטן», 1 both; N and Z
// TBD) and the duties they help in (`cohortDuties`: A in D1 and D2, N in D1, Z — cohort «ז» — in none, and no groups);
// `setCohortDuties` replaces a cohort's set (`duties`: refs, «MISSING» an id no duty has), `splitCohort` replaces its
// groups (on an "ok", `groups` is the cohort's [number, size] afterwards), `setCohortContact` writes a cohort's staff
// contact's phone. `helps_rota`, the diets' labels and a staff shift's kind are gone.
import type { NewAssignment, NewCohort, NewDuty, NewGroup, NewStaffShift, PrepKind, RotaShiftsSetting } from "../data/rota";

/** The id no row has, for a ref «MISSING». */
export const MISSING_ID = 999_999;

export const ROTA_FIXTURE = {
  cohorts: [
    { ref: "A", letter: "א", name: "מכינה לדוגמה א", trainees: 15, diet_veg: 3, diet_gf: 2, diet_both: 1, contact_name: "איש/אשת קשר לדוגמה", sort: 1 },
    { ref: "N", letter: "נ", name: "מכינה לדוגמה נ", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2 },
    { ref: "Z", letter: "ז", name: "מכינה לדוגמה ז", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 3 },
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
  /** v20: the duties each cohort helps in (Z none). Written before the groups: a group needs a cohort that helps. */
  cohortDuties: [
    { cohort: "A", duty: "D1" },
    { cohort: "A", duty: "D2" },
    { cohort: "N", duty: "D1" },
  ],
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
  | {
      name: string;
      op: "addPrepRows";
      kind: unknown;
      args: { text: string; qty?: string | null }[];
      expect: string;
      prep?: { text: string; kind: PrepKind; qty: string | null }[];
    }
  | { name: string; op: "updatePrep"; kind: PrepKind; args: { qty: string | null }; expect: string; prep?: { text: string; kind: PrepKind; qty: string | null }[] }
  | { name: string; op: "setShifts"; args: RotaShiftsSetting | null; expect: string }
  | { name: string; op: "setContact"; ref: Ref; args: string | null; expect: string }
  // v20
  | { name: string; op: "setCohortDuties"; ref: Ref; duties: Ref[]; expect: string; after?: Ref[] }
  | { name: string; op: "splitCohort"; ref: Ref; args: number[]; expect: string; groups?: [number, number | null][] }
  | { name: string; op: "setCohortContact"; ref: Ref; args: string | null; expect: string };

const staff = (over: Partial<NewStaffShift> = {}): Omit<NewStaffShift, "cohort_id"> => ({
  day: 1, start_min: 510, end_min: 780, member_id: null, name: "איש/אשת צוות לדוגמה", note: null, ...over,
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
  { name: "a cohort with groups is not deleted", op: "deleteCohort", ref: "A", expect: "in_use" },
  { name: "a cohort without groups is (its duties go with it)", op: "deleteCohort", ref: "N", expect: "ok" },
  // v19: «הצוות שלה יכול להסיע»
  { name: "a cohort whose staff can drive", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", can_drive: true }, expect: "ok" },
  { name: "the flag null", op: "addCohort", args: { letter: "ג", name: "מכינה לדוגמה ג", can_drive: null as unknown as boolean }, expect: "bad_value" },
  { name: "the flag turned on", op: "updateCohort", ref: "A", args: { can_drive: true }, expect: "ok" },
  { name: "the flag set to null", op: "updateCohort", ref: "A", args: { can_drive: null }, expect: "bad_value" },
  // v20: the trainees, the three diet numbers and the staff contact's name
  {
    name: "a cohort with its numbers and contact", op: "addCohort",
    args: { letter: "ב", name: "מכינה לדוגמה ב", trainees: 23, diet_veg: 4, diet_gf: 3, diet_both: 2, contact_name: " איש/אשת קשר לדוגמה ב " }, expect: "ok",
  },
  { name: "every number TBD", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", trainees: null, diet_veg: null, diet_gf: null, diet_both: null }, expect: "ok" },
  { name: "the diets known, the trainees TBD", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", diet_veg: 400, diet_gf: 400, diet_both: 0 }, expect: "ok" },
  { name: "the trainees over 1000", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", trainees: 1001 }, expect: "bad_value" },
  { name: "a diet number below 0", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", diet_gf: -1 }, expect: "bad_value" },
  { name: "a diet number not whole", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", diet_veg: 1.5 }, expect: "bad_value" },
  { name: "both more than the vegetarians", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", diet_veg: 1, diet_both: 2 }, expect: "rota_diets_exceed" },
  { name: "both more than the gluten-free", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", diet_gf: 1, diet_both: 2 }, expect: "rota_diets_exceed" },
  {
    name: "the diets more than the trainees", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", trainees: 5, diet_veg: 4, diet_gf: 3, diet_both: 1 },
    expect: "rota_diets_exceed",
  },
  { name: "the diets exactly the trainees", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", trainees: 6, diet_veg: 4, diet_gf: 3, diet_both: 1 }, expect: "ok" },
  { name: "a phone in the contact's name", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", contact_name: "איש קשר 000-000-0055" }, expect: "rota_contact_in_text" },
  { name: "the contact's name too long", op: "addCohort", args: { letter: "ב", name: "מכינה לדוגמה ב", contact_name: "א".repeat(81) }, expect: "bad_value" },
  { name: "the trainees lowered under the diets", op: "updateCohort", ref: "A", args: { trainees: 3 }, expect: "rota_diets_exceed" },
  { name: "both raised over the vegetarians", op: "updateCohort", ref: "A", args: { diet_both: 4 }, expect: "rota_diets_exceed" },
  { name: "all four, together", op: "updateCohort", ref: "A", args: { trainees: 20, diet_veg: 6, diet_gf: 5, diet_both: 2 }, expect: "ok" },
  { name: "the trainees back to TBD", op: "updateCohort", ref: "A", args: { trainees: null }, expect: "ok" },
  { name: "the contact's name cleared", op: "updateCohort", ref: "A", args: { contact_name: "  " }, expect: "ok" },
  // v20: the duties a cohort helps in
  { name: "one duty fewer", op: "setCohortDuties", ref: "A", duties: ["D1"], expect: "ok", after: ["D1"] },
  { name: "another set", op: "setCohortDuties", ref: "N", duties: ["D2", "D1", "D2"], expect: "ok", after: ["D1", "D2"] },
  { name: "none, for a cohort without groups", op: "setCohortDuties", ref: "N", duties: [], expect: "ok", after: [] },
  { name: "none, for a cohort with groups", op: "setCohortDuties", ref: "A", duties: [], expect: "in_use" },
  { name: "a cohort that helped in none, now in one", op: "setCohortDuties", ref: "Z", duties: ["D2"], expect: "ok", after: ["D2"] },
  { name: "a duty that is not there", op: "setCohortDuties", ref: "A", duties: ["D1", "MISSING"], expect: "stale" },
  { name: "a cohort that is not there", op: "setCohortDuties", ref: "MISSING", duties: ["D1"], expect: "stale" },
  // v20: «חלוקה לקבוצות»
  { name: "a cohort split into three", op: "splitCohort", ref: "A", args: [8, 8, 7], expect: "ok", groups: [[1, 8], [2, 8], [3, 7]] },
  { name: "a split into one", op: "splitCohort", ref: "N", args: [12], expect: "ok", groups: [[1, 12]] },
  { name: "no sizes", op: "splitCohort", ref: "A", args: [], expect: "bad_value" },
  { name: "a size over 200", op: "splitCohort", ref: "A", args: [8, 201], expect: "bad_value" },
  { name: "a size below 0", op: "splitCohort", ref: "A", args: [-1], expect: "bad_value" },
  { name: "a hundred groups", op: "splitCohort", ref: "A", args: Array.from({ length: 100 }, () => 1), expect: "bad_value" },
  { name: "a cohort that helps in no duty", op: "splitCohort", ref: "Z", args: [5, 5], expect: "cohort_not_helping" },
  { name: "a cohort that is not there", op: "splitCohort", ref: "MISSING", args: [5], expect: "stale" },
  // groups
  { name: "a group", op: "addGroup", args: { cohort: "A", number: 3, size: 9, head_name: null }, expect: "ok" },
  { name: "a group of a cohort that helps in no duty (v20)", op: "addGroup", args: { cohort: "Z", number: 1, size: 9 }, expect: "cohort_not_helping" },
  { name: "a bad number comes first", op: "addGroup", args: { cohort: "Z", number: 0 }, expect: "bad_value" },
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
  // v19: tasks and a shopping list
  {
    name: "a shopping list with quantities", op: "addPrepRows", kind: "item", args: [{ text: "פריט לדוגמה 1", qty: "2 (לדוגמה)" }, { text: "פריט לדוגמה 2" }], expect: "ok",
    prep: [{ text: "פריט לדוגמה 1", kind: "item", qty: "2 (לדוגמה)" }, { text: "פריט לדוגמה 2", kind: "item", qty: null }],
  },
  {
    name: "a task's quantity is dropped", op: "addPrepRows", kind: "task", args: [{ text: "משימה לדוגמה", qty: "3" }], expect: "ok",
    prep: [{ text: "משימה לדוגמה", kind: "task", qty: null }],
  },
  { name: "a phone in a task's quantity", op: "addPrepRows", kind: "task", args: [{ text: "משימה לדוגמה", qty: "הקפצת מרצה, טל' 1234567" }], expect: "rota_contact_in_text" },
  { name: "an item's quantity, updated", op: "updatePrep", kind: "item", args: { qty: " 4 " }, expect: "ok", prep: [{ text: "פריט לדוגמה", kind: "item", qty: "4" }] },
  { name: "a task's quantity, updated: dropped", op: "updatePrep", kind: "task", args: { qty: "3" }, expect: "ok", prep: [{ text: "פריט לדוגמה", kind: "task", qty: null }] },
  { name: "a phone in a task's quantity, updated", op: "updatePrep", kind: "task", args: { qty: "טל' 1234567" }, expect: "rota_contact_in_text" },
  { name: "an unknown kind", op: "addPrepRows", kind: "thing", args: [{ text: "פריט לדוגמה" }], expect: "bad_value" },
  { name: "no kind", op: "addPrepRows", kind: null, args: [{ text: "פריט לדוגמה" }], expect: "bad_value" },
  { name: "an empty row before an unknown kind (the text first)", op: "addPrepRows", kind: "thing", args: [{ text: "   " }], expect: "name_required" },
  { name: "a quantity too long", op: "addPrepRows", kind: "item", args: [{ text: "פריט לדוגמה", qty: "א".repeat(41) }], expect: "bad_value" },
  { name: "a phone in a quantity", op: "addPrepRows", kind: "item", args: [{ text: "פריט לדוגמה", qty: "טל' 1234567" }], expect: "rota_contact_in_text" },
  { name: "a phone in an item", op: "addPrepRows", kind: "item", args: [{ text: "להתקשר ל-000-000-0055", qty: "1" }], expect: "rota_contact_in_text" },
  // the shifts
  { name: "other cuts and names", op: "setShifts", args: { cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] }, expect: "forbidden" },
  { name: "back to last year's", op: "setShifts", args: null, expect: "forbidden" },
  // the heads' phones
  { name: "a head's phone", op: "setContact", ref: "G1", args: "000-000-0001", expect: "ok" },
  { name: "a phone of five digits", op: "setContact", ref: "G1", args: "12-345", expect: "bad_phone" },
  { name: "a phone removed", op: "setContact", ref: "G1", args: null, expect: "ok" },
  // v20: a cohort's staff contact's phone
  { name: "a cohort contact's phone", op: "setCohortContact", ref: "A", args: " 000-000-0002 ", expect: "ok" },
  { name: "a cohort contact's phone of five digits", op: "setCohortContact", ref: "A", args: "12-345", expect: "bad_phone" },
  { name: "a cohort contact's phone removed", op: "setCohortContact", ref: "A", args: null, expect: "ok" },
  { name: "a cohort that is not there", op: "setCohortContact", ref: "MISSING", args: "000-000-0002", expect: "stale" },
];

/** The same shifts' cases as an edition's admin (a logistics member may not set them: «forbidden» above). */
export const ROTA_ADMIN_CASES: RotaCase[] = [
  { name: "other cuts and names", op: "setShifts", args: { cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] }, expect: "ok" },
  { name: "cuts out of order", op: "setShifts", args: { cuts: [1320, 840], labels: ["בוקר", "צהריים", "לילה"] }, expect: "bad_value" },
  { name: "a cut not a multiple of 5", op: "setShifts", args: { cuts: [842, 1320], labels: ["בוקר", "צהריים", "לילה"] }, expect: "bad_value" },
  { name: "an empty name", op: "setShifts", args: { cuts: [840, 1320], labels: ["בוקר", " ", "לילה"] }, expect: "name_required" },
  { name: "back to last year's", op: "setShifts", args: null, expect: "ok" },
];
