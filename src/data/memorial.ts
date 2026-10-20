// Memorial times (milestone 5ב-2): the fallen, their families' contact person,
// and what both implementations accept. The fallen are one cross-year list (a
// global admin writes it; the names are entered in the app only, never in git);
// a family's contact is personal data of a bereaved family — read one fallen
// at a time, by admins only (app.may_see_fallen_contacts), never in a Week,
// Realtime, a link, or an export but the admin's archive. The edition's plans
// and slots are WeekCommands (src/data/commands.ts). Two implementations:
// SupabaseMemorial (the v11 functions) and DemoMemorial (the engine).
// Semantics: docs/CONTRACT.md «Memorial times and logistics».
import type { FamilyStatus, Gender, MemorialPlan, MemorialPolicy } from "../domain/types";
import { CommandError } from "./commands";
import { cleanBlock, cleanContactEmail, cleanLine, cleanPhone, pickGender } from "./speakerRules";

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** One of the fallen, as an admin reads the list (a member of an edition with a plan for them reads the same row). */
export interface Fallen {
  id: number;
  name: string;
  /** What someone chose — never guessed from the name. */
  gender: Gender | null;
  /** The admin's own note («גלוי לצוות המחזור שיש בו תוכנית»). */
  note: string | null;
  active: boolean;
}

export interface FallenFields {
  name: string;
  gender: Gender | null;
  note: string | null;
  active: boolean;
}

/** The family's contact person — personal data of a bereaved family: admins only, one fallen at a time. */
export interface FallenContacts {
  contact_name: string | null;
  /** «אמא», «אח», as the admin writes it. */
  relation: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
}

export const EMPTY_FALLEN_CONTACTS: FallenContacts = { contact_name: null, relation: null, phone: null, email: null, note: null };

/** The keys a plan's update may carry; absent keys stay. */
export type PlanPatch = Partial<Pick<MemorialPlan, "family_status" | "speaker_text" | "planned_minutes" | "hard_stop" | "materials_note">>;

/** Characters (code points), as the database counts them. */
export const MEMORIAL_LIMITS = {
  name: 120,
  note: 500,
  speaker_text: 200,
  materials_note: 500,
  /** planned minutes and the policy's most minutes: 1–180 — a typo guard, «הצעה» */
  minutes: 180,
  contact_name: 120,
  relation: 60,
  contact_note: 500,
  placement: 500,
} as const;

export const FAMILY_STATUSES: readonly FamilyStatus[] = ["not_contacted", "invited", "confirmed", "cannot_come", "other_speaker"];

/** The family's status, in the screen's words. */
export const FAMILY_STATUS_LABEL: Record<FamilyStatus, string> = {
  not_contacted: "עוד לא נוצר קשר",
  invited: "המשפחה הוזמנה",
  confirmed: "המשפחה אישרה",
  cannot_come: "המשפחה לא תגיע",
  other_speaker: "דובר/ת אחר/ת",
};

/** public.save_fallen's checks: a name (one line ≤ 120, required), a gender, a note (≤ 500), active. */
export function cleanFallen(f: FallenFields): FallenFields {
  const name = cleanLine(f.name, MEMORIAL_LIMITS.name);
  if (name == null) fail("name_required");
  const gender = pickGender(f.gender);
  const note = cleanBlock(f.note, MEMORIAL_LIMITS.note);
  if (typeof f.active !== "boolean") fail("bad_value");
  return { name: name!, gender, note, active: f.active };
}

/** public.set_fallen_contacts's checks, in its order. */
export function cleanFallenContacts(c: FallenContacts): FallenContacts {
  const contact_name = cleanLine(c.contact_name, MEMORIAL_LIMITS.contact_name);
  const relation = cleanLine(c.relation, MEMORIAL_LIMITS.relation);
  const phone = cleanPhone(c.phone);
  const email = cleanContactEmail(c.email);
  const note = cleanBlock(c.note, MEMORIAL_LIMITS.contact_note);
  return { contact_name, relation, phone, email, note };
}

/** A whole number in [lo, hi], or null — as app.json_int takes a JSON value. */
function wholeOrNull(v: unknown, lo: number, hi: number): number | null {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) fail("bad_value");
  return v as number;
}

/** public.update_memorial_plan's checks: the keys present, in this order; anything else ignored. */
export function cleanPlanPatch(p: unknown): PlanPatch {
  if (p == null || typeof p !== "object" || Array.isArray(p)) fail("bad_value");
  const patch = p as Record<string, unknown>;
  const out: PlanPatch = {};
  if ("family_status" in patch) {
    if (!FAMILY_STATUSES.includes(patch.family_status as FamilyStatus)) fail("bad_value");
    out.family_status = patch.family_status as FamilyStatus;
  }
  if ("speaker_text" in patch) {
    if (patch.speaker_text != null && typeof patch.speaker_text !== "string") fail("bad_value");
    out.speaker_text = cleanLine(patch.speaker_text as string | null, MEMORIAL_LIMITS.speaker_text);
  }
  if ("planned_minutes" in patch) out.planned_minutes = wholeOrNull(patch.planned_minutes, 1, MEMORIAL_LIMITS.minutes);
  if ("hard_stop" in patch) {
    if (typeof patch.hard_stop !== "boolean") fail("bad_value");
    out.hard_stop = patch.hard_stop as boolean;
  }
  if ("materials_note" in patch) {
    if (patch.materials_note != null && typeof patch.materials_note !== "string") fail("bad_value");
    out.materials_note = cleanBlock(patch.materials_note as string | null, MEMORIAL_LIMITS.materials_note);
  }
  return out;
}

/** public.set_memorial_policy's checks: the most minutes 1–180 or none, the placement a block ≤ 500; only the parts given are kept. */
export function cleanPolicy(p: MemorialPolicy): MemorialPolicy {
  const max = p.max_minutes == null ? null : p.max_minutes;
  if (max != null && (!Number.isInteger(max) || max < 1 || max > MEMORIAL_LIMITS.minutes)) fail("bad_value");
  const placement = cleanBlock(p.placement ?? null, MEMORIAL_LIMITS.placement);
  const out: MemorialPolicy = {};
  if (placement != null) out.placement = placement;
  if (max != null) out.max_minutes = max;
  if (p.warn_adjacent_meal != null) out.warn_adjacent_meal = p.warn_adjacent_meal;
  return out;
}

export interface MemorialPort {
  /** The fallen the caller sees: every admin all of them; the team of an edition those it has plans for. Ordered by id. */
  fallen(): Promise<Fallen[]>;
  /** A global admin: add one (id null) or rewrite one. Returns its id. */
  saveFallen(id: number | null, f: FallenFields): Promise<number>;
  /** A global admin: one no edition planned for (`in_use` otherwise — deactivate instead). */
  deleteFallen(id: number): Promise<void>;
  /** The family's contact person — null when it is not the caller's to see (admins only). Never part of a Week. */
  contacts(fallenId: number): Promise<FallenContacts | null>;
  /** The same people only; all five replaced (null clears one). */
  setContacts(fallenId: number, c: FallenContacts): Promise<void>;
}
