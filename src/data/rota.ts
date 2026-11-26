// «תורנויות» (schema v16) — the campus duty roster, reached as `port.rota`: the cohorts on campus («מכינות») and when
// each is there, their groups (a code, a size, a group head), the duties, who does which duty in each shift, the staff's
// shifts and the Saturday-night preparations («מוצ"ש–ראשון»). docs/CONTRACT.md «תורנויות» is the contract.
//
// v20: a cohort's trainees and its three diet numbers (the meals), its staff contact (a name the team reads; the phone
// is personal data, the heads' phones' rule), the duties each cohort helps in (`cohortDuties` — a cohort that helps in
// none has no groups: `cohort_not_helping`), a cohort split into groups in one call (`splitCohort`), and no «אחראי/ת
// משמרת» (a staff shift has no kind).
//
// Two implementations, as every port: SupabaseRota (src/data/supabaseRota.ts — direct writes under RLS with guard
// triggers, the knowledge notes' way; the heads' phones through two functions) and DemoRota (src/data/demoRota.ts — in
// memory, the same refusals). The edition's logistics team and its admins write; every member of the edition reads.
//
// A group head's phone — and (v20) a cohort's staff contact's — is personal data, the drivers' rule: its own table,
// read only by the edition's logistics and admins (a global admin, or of a real edition not archived), one call at a
// time, never in load_rota, a Week, Realtime, the offline copy or a file but behind «כולל טלפונים»;
// purge_edition_private deletes it after the week.
import { hasContact } from "../import/phone";
import type { Day } from "../domain/time";
import type { RotaShiftsSetting } from "../domain/types";
import { CommandError } from "./commands";
import { cleanBlock, cleanLine } from "./speakerRules";

export type { RotaShiftsSetting };

/** 0 = morning, 1 = afternoon, 2 = night (the edition's cuts: settings.rota_shifts; last year's by default). */
export type ShiftIndex = 0 | 1 | 2;

/** A cohort on campus that week («מכינה»): its letter starts its groups' codes («א» → א1, א2…). */
export interface RotaCohort {
  id: number;
  edition_id: number;
  letter: string;
  name: string;
  /** v20 «חניכים»: how many trainees the cohort brings (the meals count it — never the groups' sizes); null = TBD. */
  trainees: number | null;
  /**
   * v20 the diets, of the trainees: «צמחוני/טבעוני» (one dish), «ללא גלוטן», and «מהם גם וגם» — how many are both. So
   * veg-only = veg − both, gf-only = gf − both, regular = trainees − veg − gf + both (src/domain/rota.ts `dietSplit`).
   * null = TBD. both ≤ veg, both ≤ gf, veg + gf − both ≤ trainees (`rota_diets_exceed`).
   */
  diet_veg: number | null;
  diet_gf: number | null;
  diet_both: number | null;
  /** v20 «איש/אשת קשר מהצוות (משבץ/ת)»: a name the whole team reads; null = not yet. Its phone is a RotaCohortContact. */
  contact_name: string | null;
  sort: number;
  /** v19 «הצוות שלה יכול להסיע»: absent = false — the transport board names it (no phone, no driver). */
  can_drive?: boolean;
}

/** v20: a duty the cohort helps in (rota_cohort_duties). A cohort «helps» when it has one (src/domain/rota.ts `cohortHelps`). */
export interface RotaCohortDuty {
  cohort_id: number;
  duty_id: number;
}

/** The cohort is on campus in this shift (no row: not marked — never assumed). */
export interface RotaPresence {
  cohort_id: number;
  day: Day;
  shift: ShiftIndex;
}

/** A group: its cohort's letter + its number is its code. Its head's phone lives elsewhere (RotaContact). */
export interface RotaGroup {
  id: number;
  edition_id: number;
  cohort_id: number;
  number: number;
  /** How many trainees; null = TBD. */
  size: number | null;
  /** The group head's name, as typed; null = not yet. */
  head_name: string | null;
}

/** A duty («תורנות»): what it is, and how many groups each shift needs (null: not set). */
export interface RotaDuty {
  id: number;
  edition_id: number;
  name: string;
  description: string | null;
  need_morning: number | null;
  need_afternoon: number | null;
  need_night: number | null;
  /** At least this many people in the shift's groups together (null: no minimum). */
  min_people: number | null;
  sort: number;
}

/** A group on a duty in one shift. One duty per group per shift (a unique index). */
export interface RotaAssignment {
  id: number;
  edition_id: number;
  day: Day;
  shift: ShiftIndex;
  duty_id: number;
  group_id: number;
  /** «suggested» until anyone touches it (the guard makes an edited one «hand»); «ניקוי השיבוצים המוצעים» removes those. */
  source: "hand" | "suggested";
}

/**
 * A staff shift («משמרות צוות»): a person — a team member (member_id, and `name` their name when picked) or a name as
 * typed — or a whole cohort's staff (cohort_id: «צוות מכינת נ»); exactly one of `name` and `cohort_id`. No phone. (v20:
 * no kind — there is no «אחראי/ת משמרת».)
 */
export interface RotaStaffShift {
  id: number;
  edition_id: number;
  day: Day;
  start_min: number;
  end_min: number;
  member_id: number | null;
  name: string | null;
  cohort_id: number | null;
  note: string | null;
}

/** v19: a Saturday-night row is a task («משימות») or an item to buy («רשימת קניות»). */
export type PrepKind = "task" | "item";

/** A Saturday-night preparation («מוצ"ש–ראשון»): its number is its place in the list. */
export interface RotaPrepTask {
  id: number;
  edition_id: number;
  text: string;
  group_id: number | null;
  /** A task: done; an item: «נקנה». */
  done: boolean;
  sort: number;
  /** v19: absent = "task". */
  kind?: PrepKind;
  /** v19: an item's quantity as typed (≤ 40, no contact); always null on a task. Absent = null. */
  qty?: string | null;
}

/** What `addPrepTasks` takes: a text, or (an item) a text and its quantity. */
export type NewPrepRow = string | { text: string; qty?: string | null };

/** Everything the rota screens read (public.load_rota) — never a phone. */
export interface RotaData {
  cohorts: RotaCohort[];
  /** v20: the duties each cohort helps in, by cohort and duty. */
  cohortDuties: RotaCohortDuty[];
  presence: RotaPresence[];
  groups: RotaGroup[];
  duties: RotaDuty[];
  assignments: RotaAssignment[];
  staff: RotaStaffShift[];
  prep: RotaPrepTask[];
}

export const EMPTY_ROTA: RotaData = { cohorts: [], cohortDuties: [], presence: [], groups: [], duties: [], assignments: [], staff: [], prep: [] };

/** A group head's phone (public.get_rota_contacts) — only for those who may see it. */
export interface RotaContact {
  group_id: number;
  head_phone: string;
}

/** v20: a cohort's staff contact's phone (public.get_rota_contacts, after the heads') — only for those who may see it. */
export interface RotaCohortContact {
  cohort_id: number;
  phone: string;
}

/** One row of public.get_rota_contacts: a head's phone, or a cohort's contact's (`isHeadContact` / `isCohortContact`). */
export type RotaContactRow = RotaContact | RotaCohortContact;

export const isHeadContact = (c: RotaContactRow): c is RotaContact => "group_id" in c;
export const isCohortContact = (c: RotaContactRow): c is RotaCohortContact => "cohort_id" in c;

/** Whose phone `setContact` writes: a group's head, or a cohort's staff contact. */
export type RotaContactTarget = { group: number } | { cohort: number };

/** The cohort's own fields a form writes (v20: the numbers and the contact's name). */
type CohortFields = "trainees" | "diet_veg" | "diet_gf" | "diet_both" | "contact_name" | "sort" | "can_drive";
export type NewCohort = Pick<RotaCohort, "letter" | "name"> & Partial<Pick<RotaCohort, CohortFields>>;
export type CohortPatch = Partial<Pick<RotaCohort, "letter" | "name" | CohortFields>>;
export type NewGroup = Pick<RotaGroup, "cohort_id" | "number"> & Partial<Pick<RotaGroup, "size" | "head_name">>;
export type GroupPatch = Partial<Pick<RotaGroup, "number" | "size" | "head_name">>;
export type NewDuty = Pick<RotaDuty, "name"> & Partial<Omit<RotaDuty, "id" | "edition_id" | "name">>;
export type DutyPatch = Partial<Omit<RotaDuty, "id" | "edition_id">>;
export type NewAssignment = Pick<RotaAssignment, "day" | "shift" | "duty_id" | "group_id">;
export type NewStaffShift = Omit<RotaStaffShift, "id" | "edition_id">;
export type StaffPatch = Partial<NewStaffShift>;
export type PrepPatch = Partial<Pick<RotaPrepTask, "text" | "group_id" | "done" | "sort" | "kind" | "qty">>;
/** Which presence cells a «כל השבוע» / «כל היום» / one cell button sets: a day and a shift narrow it. */
export interface PresenceScope {
  day?: Day;
  shift?: ShiftIndex;
}

export interface RotaPort {
  /** One edition's rota (public.load_rota); an edition the member cannot see → not_member. */
  load(editionId: number): Promise<RotaData>;

  /** v20: answers the new cohort's id (for its duties: setCohortDuties). */
  addCohort(editionId: number, c: NewCohort): Promise<number>;
  updateCohort(id: number, patch: CohortPatch): Promise<void>;
  /** A cohort with groups → in_use. */
  deleteCohort(id: number): Promise<void>;
  /**
   * v20: the duties the cohort helps in, replaced by this set (duplicates ignored) — the missing rows inserted first,
   * then the others deleted, so a cohort with groups never passes through none. An empty set while it has groups →
   * in_use (delete its groups first: the screen asks); a duty or cohort not the edition's → stale.
   */
  setCohortDuties(editionId: number, cohortId: number, dutyIds: number[]): Promise<void>;
  /**
   * v20 «חלוקה לקבוצות» (public.rota_split_cohort): the cohort's groups replaced — in one transaction — by groups 1…n
   * of these sizes (their assignments and heads' phones go with the old ones; their tasks keep their text). The new
   * groups, by number. No sizes, more than 99 or one outside 0–200 → bad_value; a cohort that helps in no duty →
   * cohort_not_helping.
   */
  splitCohort(editionId: number, cohortId: number, sizes: number[]): Promise<RotaGroup[]>;
  /**
   * Marks the cohort on campus (or not) in every shift of the scope that the week has (rotaSlots): one statement —
   * present inserts the missing rows, absent deletes the scope's rows.
   */
  setPresence(editionId: number, cohortId: number, scope: PresenceScope, present: boolean): Promise<void>;

  /** v20: a cohort that helps in no duty → cohort_not_helping (also when a group is moved into one). */
  addGroup(editionId: number, g: NewGroup): Promise<void>;
  updateGroup(id: number, patch: GroupPatch): Promise<void>;
  /** Its assignments and its head's phone go with it; its preparations keep their text, without a group. */
  deleteGroup(id: number): Promise<void>;

  addDuty(editionId: number, d: NewDuty): Promise<void>;
  updateDuty(id: number, patch: DutyPatch): Promise<void>;
  /** Its assignments go with it. */
  deleteDuty(id: number): Promise<void>;

  /** By hand: the group is busy in that shift → rota_group_busy; a shift the week has not → outside_week. */
  assign(editionId: number, a: NewAssignment): Promise<void>;
  /** «העברה לכאן»: the same group and shift, another duty (made «hand»). */
  moveAssignment(id: number, dutyId: number): Promise<void>;
  unassign(id: number): Promise<void>;
  /** «החלת ההצעה»: ONE insert of every row, «suggested» — all or nothing; a row taken meanwhile → stale. */
  applySuggestion(editionId: number, rows: NewAssignment[]): Promise<void>;
  /** «ניקוי השיבוצים המוצעים»: ONE delete of the edition's «suggested» rows; how many went. */
  clearSuggested(editionId: number): Promise<number>;

  addStaffShift(editionId: number, s: NewStaffShift): Promise<void>;
  updateStaffShift(id: number, patch: StaffPatch): Promise<void>;
  deleteStaffShift(id: number): Promise<void>;

  /**
   * One or more (a pasted list) of one kind — ONE insert, appended after the last of the edition (both kinds share the
   * numbering), in order. A task's quantity is dropped (null); `kind` absent = "task".
   */
  addPrepTasks(editionId: number, rows: NewPrepRow[], kind?: PrepKind): Promise<void>;
  updatePrepTask(id: number, patch: PrepPatch): Promise<void>;
  deletePrepTask(id: number): Promise<void>;

  /** The shifts' cuts and names (an edition's admin; public.set_rota_shifts); null → last year's. */
  setShifts(editionId: number, s: RotaShiftsSetting | null): Promise<void>;

  /**
   * The phones the member may see (public.get_rota_contacts): the heads', by group, then (v20) the cohorts' staff
   * contacts', by cohort — none for the others, never a refusal.
   */
  contacts(editionId: number): Promise<RotaContactRow[]>;
  /** A head's phone, or (v20) a cohort's contact's (public.set_rota_contact); null or blank removes it. Not allowed → rota_contact_hidden. */
  setContact(target: RotaContactTarget, phone: string | null): Promise<void>;
}

/** Characters and ranges, as the database's CHECKs and guard triggers count them (schema.sql «תורנויות»). */
export const ROTA_LIMITS = {
  letter: 3,
  cohortName: 80,
  /** v20: a cohort's trainees and each of its diet numbers. */
  count: 1000,
  contactName: 80,
  groupNumber: 99,
  groupSize: 200,
  headName: 80,
  dutyName: 40,
  description: 500,
  need: 20,
  minPeople: 500,
  staffName: 80,
  note: 200,
  prepText: 200,
  prepPaste: 200,
  qty: 40,
  shiftLabel: 20,
  phone: 40,
} as const;

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** No phone or e-mail in a text everyone reads (app.has_contact): a head's phone has its own field. */
function noContact(v: string | null): string | null {
  if (v != null && hasContact(v)) fail("rota_contact_in_text");
  return v;
}

const intIn = (v: unknown, min: number, max: number): number => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fail("bad_value"));
const intOrNull = (v: unknown, min: number, max: number): number | null => (v == null ? null : intIn(v, min, max));

/** A cohort's letter: 1–3 letters, no digit or space (a digit would run into the group's number). */
export function cleanLetter(v: string | null | undefined): string {
  const s = cleanLine(v, ROTA_LIMITS.letter) ?? fail("name_required");
  return /[\s\d]/.test(s) ? fail("bad_value") : s;
}

export function cleanCohortName(v: string | null | undefined): string {
  return noContact(cleanLine(v, ROTA_LIMITS.cohortName)) ?? fail("name_required");
}

/** v20: a cohort's trainees or one of its diet numbers — a whole number 0–1000, or null (TBD). */
export const cleanCount = (v: unknown): number | null => intOrNull(v, 0, ROTA_LIMITS.count);

/** v20: the cohort's staff contact's name — one line ≤ 80, no phone or e-mail (its phone has its own table); blank → null. */
export function cleanContactName(v: string | null | undefined): string | null {
  return noContact(cleanLine(v, ROTA_LIMITS.contactName));
}

/** v20: the four numbers of a cohort, together (the guard's rule between them): each side known, else nothing to hold. */
export interface CohortCounts {
  trainees: number | null;
  diet_veg: number | null;
  diet_gf: number | null;
  diet_both: number | null;
}

/**
 * v20 (app.rota_cohorts_guard): «מהם גם וגם» ≤ «צמחוני/טבעוני» and ≤ «ללא גלוטן», each of those two ≤ the trainees, and —
 * all four known — «צמחוני/טבעוני» + «ללא גלוטן» − «גם וגם» ≤ the trainees; else rota_diets_exceed. A comparison with a
 * side TBD (null) holds nothing. The review: one diet number above the trainees can never fit, whatever is typed later
 * (both ≤ each, so veg + gf − both ≥ either) — refused at once, not on the last number typed.
 */
export function checkCohortCounts(c: CohortCounts): CohortCounts {
  const { trainees: t, diet_veg: v, diet_gf: g, diet_both: b } = c;
  if (b != null && ((v != null && b > v) || (g != null && b > g))) return fail("rota_diets_exceed");
  if (t != null && ((v != null && v > t) || (g != null && g > t))) return fail("rota_diets_exceed");
  if (t != null && v != null && g != null && b != null && v + g - b > t) return fail("rota_diets_exceed");
  return c;
}

/**
 * v20: a new cohort's or a whole row's own fields, cleaned in the guard's order — the contact's name, the four numbers
 * (each 0–1000 or null), the rule between them; absent numbers are null (TBD).
 */
export function cleanCohortFields(c: Partial<Pick<RotaCohort, "trainees" | "diet_veg" | "diet_gf" | "diet_both" | "contact_name">>): CohortCounts & { contact_name: string | null } {
  const contact_name = cleanContactName(c.contact_name ?? null);
  const counts = {
    trainees: cleanCount(c.trainees ?? null), diet_veg: cleanCount(c.diet_veg ?? null), diet_gf: cleanCount(c.diet_gf ?? null), diet_both: cleanCount(c.diet_both ?? null),
  };
  return { contact_name, ...checkCohortCounts(counts) };
}

/** v20: the duties a cohort helps in, as a set — whole numbers, each once (in the order first given); not an array → bad_value. */
export function cleanDutyIds(v: unknown): number[] {
  if (!Array.isArray(v)) return fail("bad_value");
  const out: number[] = [];
  for (const x of v) {
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 1) return fail("bad_value");
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

/** v20 «חלוקה לקבוצות»'s sizes (public.rota_split_cohort): 1–99 groups, each a size 0–200; else bad_value. */
export function cleanSplitSizes(v: unknown): number[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > ROTA_LIMITS.groupNumber) return fail("bad_value");
  return v.map((x) => intIn(x, 0, ROTA_LIMITS.groupSize));
}

export const cleanGroupNumber = (v: unknown) => intIn(v, 1, ROTA_LIMITS.groupNumber);
export const cleanGroupSize = (v: unknown) => intOrNull(v, 0, ROTA_LIMITS.groupSize);

export function cleanHeadName(v: string | null | undefined): string | null {
  return noContact(cleanLine(v, ROTA_LIMITS.headName));
}

export function cleanDutyName(v: string | null | undefined): string {
  return noContact(cleanLine(v, ROTA_LIMITS.dutyName)) ?? fail("name_required");
}

export function cleanDescription(v: string | null | undefined): string | null {
  return noContact(cleanBlock(v, ROTA_LIMITS.description));
}

export const cleanNeed = (v: unknown) => intOrNull(v, 0, ROTA_LIMITS.need);
export const cleanMinPeople = (v: unknown) => intOrNull(v, 1, ROTA_LIMITS.minPeople);

export const cleanDay = (v: unknown) => intIn(v, 0, 4) as Day;
export const cleanShift = (v: unknown) => intIn(v, 0, 2) as ShiftIndex;

/** A staff shift's times: in the day's minutes, 06:30 … 06:30 next morning, start before end, multiples of 5. */
export function cleanStaffTimes(start: unknown, end: unknown): { start_min: number; end_min: number } {
  const s = intIn(start, 390, 1830);
  const e = intIn(end, 390, 1830);
  return s < e && s % 5 === 0 && e % 5 === 0 ? { start_min: s, end_min: e } : fail("bad_value");
}

export function cleanStaffName(v: string | null | undefined): string | null {
  return noContact(cleanLine(v, ROTA_LIMITS.staffName));
}

export function cleanNote(v: string | null | undefined): string | null {
  return noContact(cleanLine(v, ROTA_LIMITS.note));
}

/** Exactly one of a name (a person — a team member's or typed) and a cohort (its whole staff). */
export function cleanStaffWho(s: Pick<NewStaffShift, "member_id" | "name" | "cohort_id">): Pick<NewStaffShift, "member_id" | "name" | "cohort_id"> {
  const name = cleanStaffName(s.name);
  const cohort = s.cohort_id ?? null;
  if ((name == null) === (cohort == null)) return fail(name == null ? "name_required" : "bad_value");
  if (cohort != null && s.member_id != null) return fail("bad_value");
  return { member_id: s.member_id ?? null, name, cohort_id: cohort };
}

export function cleanPrepText(v: string | null | undefined): string {
  return noContact(cleanLine(v, ROTA_LIMITS.prepText)) ?? fail("name_required");
}

/** v19: a cohort's flag (can_drive) — a boolean; anything else, null included → bad_value (the column is NOT NULL). */
export const cleanFlag = (v: unknown): boolean => (typeof v === "boolean" ? v : fail("bad_value"));

/** v19: a Saturday-night row's kind; anything else, null included → bad_value. */
export const cleanPrepKind = (v: unknown): PrepKind => (v === "task" || v === "item" ? v : fail("bad_value"));

/** v19: a row's quantity — one line ≤ 40, no phone or e-mail; blank → null. Cleaned whatever the kind (a task keeps none). */
export function cleanQty(v: string | null | undefined): string | null {
  return noContact(cleanLine(v, ROTA_LIMITS.qty));
}

/** A row's kind as stored (absent: a task — a row from before v19). */
export const prepKindOf = (t: Pick<RotaPrepTask, "kind">): PrepKind => (t.kind === "item" ? "item" : "task");

/**
 * addPrepTasks' rows as the guard writes them, each in the guard's order: the text, the kind, the quantity — cleaned
 * whatever the kind (a phone in a task's refuses too), then kept for an item only.
 */
export function cleanPrepRows(rows: readonly NewPrepRow[], kind: unknown): { text: string; kind: PrepKind; qty: string | null }[] {
  return rows.map((r) => {
    const text = cleanPrepText(typeof r === "string" ? r : r?.text);
    const k = cleanPrepKind(kind);
    const qty = typeof r === "string" ? null : cleanQty(r?.qty ?? null);
    return { text, kind: k, qty: k === "item" ? qty : null };
  });
}

/**
 * A pasted list of preparations («הדבקת רשימה»): a line a task, its numbering taken off — a number followed by «.», «)»,
 * «-», «–», «:» or a tab (a spreadsheet's own cell) — and empty lines dropped. A number without one stays: it is the
 * task's («2 שולחנות לחדר האוכל»). A line with a phone or an e-mail refuses the whole paste (rota_contact_in_text).
 */
export function parsePrepList(text: string): string[] {
  return pastedLines(text).map(cleanPrepText);
}

/** A paste's lines, each without its numbering, empty ones dropped — at most ROTA_LIMITS.prepPaste (else bad_value). */
function pastedLines(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\s*\d{1,3}(?:\s*[.)\-–:]|\t)\s*/, "").trim())
    .filter(Boolean);
  return lines.length > ROTA_LIMITS.prepPaste ? fail("bad_value") : lines;
}

/**
 * v19: a pasted shopping list — parsePrepList's numbering rule, then each line split at its first tab: the item, and
 * its quantity (a spreadsheet's second column; blank → null). A phone or an e-mail in either refuses the whole paste.
 */
export function parsePrepItems(text: string): { text: string; qty: string | null }[] {
  return pastedLines(text).map((l) => {
    const tab = l.indexOf("\t");
    return tab < 0 ? { text: cleanPrepText(l), qty: null } : { text: cleanPrepText(l.slice(0, tab)), qty: cleanQty(l.slice(tab + 1)) };
  });
}

/** settings.rota_shifts: 390 < first cut < second cut < 1830, multiples of 5; three names, one line each. */
export function cleanShifts(s: RotaShiftsSetting): RotaShiftsSetting {
  if (!s || !Array.isArray(s.cuts) || s.cuts.length !== 2 || !Array.isArray(s.labels) || s.labels.length !== 3) return fail("bad_value");
  const [a, b] = s.cuts;
  if (!(Number.isInteger(a) && Number.isInteger(b) && a > 390 && a < b && b < 1830 && a % 5 === 0 && b % 5 === 0)) return fail("bad_value");
  const labels = s.labels.map((l) => noContact(cleanLine(l, ROTA_LIMITS.shiftLabel)) ?? fail("name_required")) as [string, string, string];
  return { cuts: [a, b], labels };
}

/** A head's phone — and (v20) a cohort's contact's (set_rota_contact): one line ≤ 40 with at least 6 digits; blank → null (removes it). */
export function cleanHeadPhone(v: string | null | undefined): string | null {
  const s = cleanLine(v, ROTA_LIMITS.phone);
  if (s == null) return null;
  return (s.match(/[0-9]/g) ?? []).length >= 6 ? s : fail("bad_phone");
}

/**
 * Last year's four duties (the logistics workbook of 5786), described in the instructor's own words (5.11.2026) — what
 * «התורנויות של אשתקד» adds to an empty list. The needs are what last year's sheet shows («הצעה»): one group a shift,
 * the beit midrash four.
 */
export const LAST_YEAR_DUTIES: readonly NewDuty[] = [
  {
    name: "בית מדרש",
    description: "האחריות שלהם ללמוד, כדי לוודא שתמיד יש חניכים בשיעורים ולא יוצא מצב שיש שיעורים ריקים.",
    need_morning: 4,
    need_afternoon: 4,
    need_night: 4,
    min_people: null,
    sort: 1,
  },
  {
    name: "פינת קפה",
    description: "אחריות לנקיון, סדר, ומילוי מלאים של עוגיות, עוגות וקפה.",
    need_morning: 1,
    need_afternoon: 1,
    need_night: 1,
    min_people: null,
    sort: 2,
  },
  {
    name: "מטבח",
    description: "הכנת האוכל בבוקר ובערב, פתיחת גסטרונומים מהקייטרינג בצהריים, וניקוי חדר האוכל על כל המשתמע מכך. עובדים עם הטבח/ית.",
    need_morning: 1,
    need_afternoon: 1,
    need_night: 1,
    min_people: null,
    sort: 3,
  },
  {
    name: "נקיון",
    description: "נקיון בית המדרש, השירותים והרחבה בחוץ.",
    need_morning: 1,
    need_afternoon: 1,
    need_night: 1,
    min_people: null,
    sort: 4,
  },
];
