// The «הגדרות» screens' storage operations — reached as `port.settings`, with
// the same two implementations as the grid: SupabasePort (direct writes under
// RLS, two small functions) and DemoPort (in memory, the same refusals). A
// refusal is a CommandError whose code src/errors.ts turns into Hebrew. What
// each write may touch, and why, is in supabase/schema.sql's «Settings» section.
import type { Category, Edition, Gender, Room, TeamMember } from "../domain/types";
import type { Role } from "./types";

/** A row of public.members as an admin sees it (RLS shows only the editions they administer). */
export interface MemberRow {
  id: number;
  email: string;
  display_name: string;
  gender: Gender | null;
  role: Role;
  edition_id: number | null; // null = every edition
  active: boolean;
}

export interface NewMember {
  email: string;
  display_name: string;
  gender: Gender | null;
  role: Role;
  edition_id: number;
}

export type MemberPatch = Partial<Pick<MemberRow, "display_name" | "gender" | "role" | "active">>;

/** One of the year's trainees — a name only, never a contact detail. */
export interface RosterEntry {
  id: number;
  full_name: string;
  name_key: string;
  gender: Gender | null;
}

export interface NewEdition {
  label: string;
  start_date: string | null; // the opening Sunday, yyyy-mm-dd; null = TBD
  first_day_from: number | null; // Sunday's opening minute; null = TBD
}

export type EditionPatch = Partial<Pick<Edition, "start_date" | "first_day_from">>;

export interface SettingsPort {
  // מחזור
  startEdition(e: NewEdition): Promise<number>;
  updateEdition(id: number, patch: EditionPatch): Promise<void>;
  // צוות
  /** The members of one edition, or (null) the all-editions rows. */
  members(editionId: number | null): Promise<MemberRow[]>;
  /** Names and roles of everyone who works on an edition, all-editions admins included — no e-mails. */
  team(editionId: number): Promise<TeamMember[]>;
  addMember(m: NewMember): Promise<MemberRow>;
  updateMember(id: number, patch: MemberPatch): Promise<void>;
  /** Refused with `member_has_history` once the member has done anything — deactivate instead. */
  deleteMember(id: number): Promise<void>;
  /** The caller's own name and gender, on every row of theirs. */
  setMyProfile(p: { display_name: string; gender: Gender | null }): Promise<void>;
  // חניכים
  roster(editionId: number): Promise<RosterEntry[]>;
  /** Adds the names not already there (by name key); returns how many were added. */
  addRoster(editionId: number, names: { full_name: string; gender: Gender | null }[]): Promise<number>;
  updateRoster(id: number, patch: { full_name?: string; gender?: Gender | null }): Promise<void>;
  deleteRoster(id: number): Promise<void>;
  // חדרים
  rooms(editionId: number): Promise<Room[]>;
  addRoom(editionId: number, name: string): Promise<void>;
  renameRoom(id: number, name: string): Promise<void>;
  setDefaultRoom(id: number): Promise<void>;
  /** `ids` in their new order; only rows whose place changed are written. */
  reorderRooms(editionId: number, ids: number[]): Promise<void>;
  deleteRoom(id: number): Promise<void>;
  // קטגוריות (cross-year)
  categories(): Promise<Category[]>;
  addCategory(c: { name: string; color: string }): Promise<void>;
  updateCategory(id: number, patch: Partial<Pick<Category, "name" | "color" | "active">>): Promise<void>;
  reorderCategories(ids: number[]): Promise<void>;
  deleteCategory(id: number): Promise<void>;
}

/** New sort values (1…n) for `ids` in order — only those that change. */
export function resort<T extends { id: number; sort: number }>(rows: T[], ids: number[]): { id: number; sort: number }[] {
  return ids.flatMap((id, i) => {
    const r = rows.find((x) => x.id === id);
    return r && r.sort !== i + 1 ? [{ id, sort: i + 1 }] : [];
  });
}
