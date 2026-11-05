// «תורנויות» against the real database (docs/CONTRACT.md «תורנויות»): direct writes under RLS with guard triggers
// (supabase/schema.sql «תורנויות»), public.load_rota to read, and the heads' phones through get_rota_contacts /
// set_rota_contact. Every refusal comes back as a CommandError with a code from src/errors.ts.
//
// Every write is cleaned first with src/data/rota.ts's cleaners (≡ the guards), so a refusal from the server is its
// backstop. A write by id asks for the row back (`select("id")`): RLS filtering it away answers nothing → `forbidden`.
// Postgres codes, per table: 23505 its unique index's code (rota_letter_taken, rota_group_taken, rota_duty_exists,
// rota_group_busy); 23503 on a DELETE `in_use` (a cohort with groups), on an INSERT/UPDATE `stale` (the cohort, group or
// duty it points at is gone); «החלת ההצעה» maps both to `stale` (the screen computes the suggestion again).
//
// Two writes need the edition's row besides: «מתי בקמפוס» inserts only the shifts the week has (rotaSlots needs the
// edition's opening, close and cuts — read once, `editions` by id, then ONE insert), and a pasted list of preparations
// goes after the last (its `sort` read once, then ONE insert).
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { rotaSlots } from "../domain/rota";
import type { Edition } from "../domain/types";
import { CommandError } from "./commands";
import {
  cleanCohortName, cleanDay, cleanDescription, cleanDiets, cleanDutyName, cleanGroupNumber, cleanGroupSize, cleanHeadName, cleanHeadPhone, cleanLetter,
  cleanMinPeople, cleanNeed, cleanNote, cleanPrepText, cleanShift, cleanShifts, cleanStaffKind, cleanStaffName, cleanStaffTimes, cleanStaffWho, type CohortPatch, type Diet,
  type DutyPatch, type GroupPatch, type NewAssignment, type NewCohort, type NewDuty, type NewGroup, type NewStaffShift, type PrepPatch, type PresenceScope,
  type RotaContact, type RotaData, type RotaPort, type RotaShiftsSetting, type ShiftIndex, type StaffPatch,
} from "./rota";
import { callRpc } from "./supabaseCommands";
import { refusal } from "./supabaseSettings";
import type { Day } from "../domain/time";

type Q = PromiseLike<{ data: unknown; error: PostgrestError | null }>;

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** An integer column (sort): PostgreSQL's integer, else bad_value — never sent. */
const cleanSort = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 2_147_483_647 ? v : fail("bad_value"));
const cleanBool = (v: unknown): boolean => (typeof v === "boolean" ? v : fail("bad_value"));
/** One end of a staff shift alone: 06:30 … 06:30 next morning, a multiple of 5. */
const staffMinute = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 390 && v <= 1830 && v % 5 === 0 ? v : fail("bad_value"));

/** Postgres → the contract's codes for a rota write: `unique` its index's code; 23503 → `fk` (stale on a write, in_use on a delete). */
function rotaRefusal(error: PostgrestError, unique: string, fk: "stale" | "in_use"): Error {
  return error.code === "23503" ? new CommandError(fk) : refusal(error, unique);
}

/** A write RLS may filter: no row back → forbidden. */
async function one(q: Q, unique = "duplicate", fk: "stale" | "in_use" = "stale"): Promise<void> {
  const { data, error } = await q;
  if (error) throw rotaRefusal(error, unique, fk);
  if (!Array.isArray(data) || data.length === 0) throw new CommandError("forbidden");
}

const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

/** load_rota's answer as the port's types: exactly their keys, numbers as numbers (a bigint may arrive as a string). */
function readRota(d: Record<string, unknown[] | undefined>): RotaData {
  const rows = (k: string) => (Array.isArray(d[k]) ? (d[k] as Record<string, unknown>[]) : []);
  return {
    cohorts: rows("cohorts").map((c) => ({
      id: num(c.id), edition_id: num(c.edition_id), letter: String(c.letter), name: String(c.name),
      diets: (Array.isArray(c.diets) ? (c.diets as Diet[]) : []).map((x) => ({ label: String(x.label), count: Number(x.count) })), sort: num(c.sort ?? 0),
    })),
    presence: rows("presence").map((p) => ({ cohort_id: num(p.cohort_id), day: num(p.day) as Day, shift: num(p.shift) as ShiftIndex })),
    groups: rows("groups").map((g) => ({ id: num(g.id), edition_id: num(g.edition_id), cohort_id: num(g.cohort_id), number: num(g.number), size: numOrNull(g.size), head_name: strOrNull(g.head_name) })),
    duties: rows("duties").map((x) => ({
      id: num(x.id), edition_id: num(x.edition_id), name: String(x.name), description: strOrNull(x.description), need_morning: numOrNull(x.need_morning),
      need_afternoon: numOrNull(x.need_afternoon), need_night: numOrNull(x.need_night), min_people: numOrNull(x.min_people), sort: num(x.sort ?? 0),
    })),
    assignments: rows("assignments").map((a) => ({
      id: num(a.id), edition_id: num(a.edition_id), day: num(a.day) as Day, shift: num(a.shift) as ShiftIndex, duty_id: num(a.duty_id), group_id: num(a.group_id),
      source: a.source === "suggested" ? "suggested" : "hand",
    })),
    staff: rows("staff").map((s) => ({
      id: num(s.id), edition_id: num(s.edition_id), day: num(s.day) as Day, start_min: num(s.start_min), end_min: num(s.end_min), member_id: numOrNull(s.member_id),
      name: strOrNull(s.name), cohort_id: numOrNull(s.cohort_id), kind: s.kind === "lead" ? "lead" : "shift", note: strOrNull(s.note),
    })),
    prep: rows("prep").map((t) => ({ id: num(t.id), edition_id: num(t.edition_id), text: String(t.text), group_id: numOrNull(t.group_id), done: t.done === true, sort: num(t.sort ?? 0) })),
  };
}

export class SupabaseRota implements RotaPort {
  constructor(readonly sb: SupabaseClient) {}

  // ------------------------------------------------------------------ read

  async load(editionId: number): Promise<RotaData> {
    const d = (await callRpc(this.sb, "load_rota", { p_edition: editionId })) as Record<string, unknown[]> | null;
    if (d == null) fail("not_member");
    return readRota(d!);
  }

  // ------------------------------------------------------------------ cohorts

  async addCohort(editionId: number, c: NewCohort): Promise<void> {
    const row = { edition_id: editionId, letter: cleanLetter(c.letter), name: cleanCohortName(c.name), diets: cleanDiets(c.diets ?? []), ...(c.sort !== undefined ? { sort: cleanSort(c.sort) } : {}) };
    await one(this.sb.from("rota_cohorts").insert(row).select("id"), "rota_letter_taken");
  }

  async updateCohort(id: number, patch: CohortPatch): Promise<void> {
    const p: Record<string, unknown> = {};
    if (patch.letter !== undefined) p.letter = cleanLetter(patch.letter);
    if (patch.name !== undefined) p.name = cleanCohortName(patch.name);
    if (patch.diets !== undefined) p.diets = cleanDiets(patch.diets);
    if (patch.sort !== undefined) p.sort = cleanSort(patch.sort);
    await one(this.sb.from("rota_cohorts").update(p).eq("id", id).select("id"), "rota_letter_taken");
  }

  async deleteCohort(id: number): Promise<void> {
    await one(this.sb.from("rota_cohorts").delete().eq("id", id).select("id"), "duplicate", "in_use");
  }

  /** The shifts the week has (rotaSlots): the edition's row read once — none visible → not_member. */
  private async weekEdges(editionId: number): Promise<Pick<Edition, "first_day_from" | "last_day_until" | "settings">> {
    const { data, error } = await this.sb.from("editions").select("first_day_from,last_day_until,settings").eq("id", editionId).maybeSingle();
    if (error) throw refusal(error);
    if (!data) return fail("not_member");
    const e = data as { first_day_from: unknown; last_day_until: unknown; settings: Edition["settings"] | null };
    return { first_day_from: numOrNull(e.first_day_from), last_day_until: Number(e.last_day_until), settings: e.settings ?? {} };
  }

  async setPresence(editionId: number, cohortId: number, scope: PresenceScope, present: boolean): Promise<void> {
    const day = scope.day === undefined ? undefined : cleanDay(scope.day);
    const shift = scope.shift === undefined ? undefined : cleanShift(scope.shift);
    if (present) {
      const rows = rotaSlots(await this.weekEdges(editionId))
        .filter((s) => (day === undefined || s.day === day) && (shift === undefined || s.shift === shift))
        .map((s) => ({ edition_id: editionId, cohort_id: cohortId, day: s.day, shift: s.shift }));
      if (rows.length === 0) return;
      // one statement: the rows already there are skipped (ON CONFLICT DO NOTHING — no UPDATE grant on rota_presence)
      const { error } = await this.sb.from("rota_presence").upsert(rows, { onConflict: "cohort_id,day,shift", ignoreDuplicates: true });
      if (error) throw rotaRefusal(error, "duplicate", "stale");
      return;
    }
    let q = this.sb.from("rota_presence").delete().eq("edition_id", editionId).eq("cohort_id", cohortId);
    if (day !== undefined) q = q.eq("day", day);
    if (shift !== undefined) q = q.eq("shift", shift);
    const { error } = await q;
    if (error) throw rotaRefusal(error, "duplicate", "in_use");
  }

  // ------------------------------------------------------------------ groups

  async addGroup(editionId: number, g: NewGroup): Promise<void> {
    const row = { edition_id: editionId, cohort_id: g.cohort_id, number: cleanGroupNumber(g.number), size: cleanGroupSize(g.size ?? null), head_name: cleanHeadName(g.head_name ?? null) };
    await one(this.sb.from("rota_groups").insert(row).select("id"), "rota_group_taken");
  }

  async updateGroup(id: number, patch: GroupPatch): Promise<void> {
    const p: Record<string, unknown> = {};
    if (patch.number !== undefined) p.number = cleanGroupNumber(patch.number);
    if (patch.size !== undefined) p.size = cleanGroupSize(patch.size);
    if (patch.head_name !== undefined) p.head_name = cleanHeadName(patch.head_name);
    await one(this.sb.from("rota_groups").update(p).eq("id", id).select("id"), "rota_group_taken");
  }

  async deleteGroup(id: number): Promise<void> {
    await one(this.sb.from("rota_groups").delete().eq("id", id).select("id"), "duplicate", "in_use");
  }

  // ------------------------------------------------------------------ duties

  private dutyFields(d: Partial<NewDuty>): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    if (d.name !== undefined) p.name = cleanDutyName(d.name);
    if (d.description !== undefined) p.description = cleanDescription(d.description);
    if (d.need_morning !== undefined) p.need_morning = cleanNeed(d.need_morning);
    if (d.need_afternoon !== undefined) p.need_afternoon = cleanNeed(d.need_afternoon);
    if (d.need_night !== undefined) p.need_night = cleanNeed(d.need_night);
    if (d.min_people !== undefined) p.min_people = cleanMinPeople(d.min_people);
    if (d.sort !== undefined) p.sort = cleanSort(d.sort);
    return p;
  }

  async addDuty(editionId: number, d: NewDuty): Promise<void> {
    const row = { edition_id: editionId, ...this.dutyFields(d), name: cleanDutyName(d.name) };
    await one(this.sb.from("rota_duties").insert(row).select("id"), "rota_duty_exists");
  }

  async updateDuty(id: number, patch: DutyPatch): Promise<void> {
    await one(this.sb.from("rota_duties").update(this.dutyFields(patch)).eq("id", id).select("id"), "rota_duty_exists");
  }

  async deleteDuty(id: number): Promise<void> {
    await one(this.sb.from("rota_duties").delete().eq("id", id).select("id"), "duplicate", "in_use");
  }

  // ------------------------------------------------------------------ assignments

  private assignmentRow(editionId: number, a: NewAssignment, source: "hand" | "suggested") {
    return { edition_id: editionId, day: cleanDay(a.day), shift: cleanShift(a.shift), duty_id: a.duty_id, group_id: a.group_id, source };
  }

  async assign(editionId: number, a: NewAssignment): Promise<void> {
    await one(this.sb.from("rota_assignments").insert(this.assignmentRow(editionId, a, "hand")).select("id"), "rota_group_busy");
  }

  async moveAssignment(id: number, dutyId: number): Promise<void> {
    // the guard makes the row «hand» (source has no UPDATE grant)
    await one(this.sb.from("rota_assignments").update({ duty_id: dutyId }).eq("id", id).select("id"), "rota_group_busy");
  }

  async unassign(id: number): Promise<void> {
    await one(this.sb.from("rota_assignments").delete().eq("id", id).select("id"), "duplicate", "in_use");
  }

  async applySuggestion(editionId: number, rows: NewAssignment[]): Promise<void> {
    const body = rows.map((r) => this.assignmentRow(editionId, r, "suggested"));
    if (body.length === 0) return;
    // ONE insert: all or nothing — a row taken meanwhile (23505) or a group or duty gone (23503) is `stale`
    const { error } = await this.sb.from("rota_assignments").insert(body).select("id");
    if (error) throw error.code === "23505" || error.code === "23503" ? new CommandError("stale") : refusal(error);
  }

  async clearSuggested(editionId: number): Promise<number> {
    const { data, error } = await this.sb.from("rota_assignments").delete().eq("edition_id", editionId).eq("source", "suggested").select("id");
    if (error) throw refusal(error);
    return (data ?? []).length;
  }

  // ------------------------------------------------------------------ staff shifts

  private staffRow(s: NewStaffShift) {
    return { day: cleanDay(s.day), ...cleanStaffTimes(s.start_min, s.end_min), ...cleanStaffWho(s), kind: cleanStaffKind(s.kind), note: cleanNote(s.note) };
  }

  async addStaffShift(editionId: number, s: NewStaffShift): Promise<void> {
    await one(this.sb.from("rota_staff_shifts").insert({ edition_id: editionId, ...this.staffRow(s) }).select("id"));
  }

  /**
   * A patch is cleaned field by field; the rules between fields (start before end, exactly one of a name and a cohort)
   * on the patch when it has all of their fields (the screen's form sends the whole row) — else the guard holds them.
   */
  async updateStaffShift(id: number, patch: StaffPatch): Promise<void> {
    const p: Record<string, unknown> = {};
    if (patch.day !== undefined) p.day = cleanDay(patch.day);
    if (patch.start_min !== undefined && patch.end_min !== undefined) Object.assign(p, cleanStaffTimes(patch.start_min, patch.end_min));
    else {
      if (patch.start_min !== undefined) p.start_min = staffMinute(patch.start_min);
      if (patch.end_min !== undefined) p.end_min = staffMinute(patch.end_min);
    }
    if (patch.name !== undefined && patch.cohort_id !== undefined && patch.member_id !== undefined) Object.assign(p, cleanStaffWho(patch as Required<Pick<StaffPatch, "name" | "cohort_id" | "member_id">>));
    else {
      if (patch.name !== undefined) p.name = cleanStaffName(patch.name);
      if (patch.cohort_id !== undefined) p.cohort_id = patch.cohort_id;
      if (patch.member_id !== undefined) p.member_id = patch.member_id;
    }
    if (patch.kind !== undefined) p.kind = cleanStaffKind(patch.kind);
    if (patch.note !== undefined) p.note = cleanNote(patch.note);
    await one(this.sb.from("rota_staff_shifts").update(p).eq("id", id).select("id"));
  }

  async deleteStaffShift(id: number): Promise<void> {
    await one(this.sb.from("rota_staff_shifts").delete().eq("id", id).select("id"), "duplicate", "in_use");
  }

  // ------------------------------------------------------------------ preparations

  async addPrepTasks(editionId: number, texts: string[]): Promise<void> {
    const vs = texts.map(cleanPrepText);
    if (vs.length === 0) return;
    const { data, error } = await this.sb.from("rota_prep_tasks").select("sort").eq("edition_id", editionId).order("sort", { ascending: false }).limit(1);
    if (error) throw refusal(error);
    const last = Number((data as { sort: unknown }[] | null)?.[0]?.sort ?? 0);
    const rows = vs.map((text, i) => ({ edition_id: editionId, text, group_id: null, done: false, sort: last + 1 + i }));
    const { error: e2 } = await this.sb.from("rota_prep_tasks").insert(rows).select("id");
    if (e2) throw rotaRefusal(e2, "duplicate", "stale");
  }

  async updatePrepTask(id: number, patch: PrepPatch): Promise<void> {
    const p: Record<string, unknown> = {};
    if (patch.text !== undefined) p.text = cleanPrepText(patch.text);
    if (patch.group_id !== undefined) p.group_id = patch.group_id;
    if (patch.done !== undefined) p.done = cleanBool(patch.done);
    if (patch.sort !== undefined) p.sort = cleanSort(patch.sort);
    await one(this.sb.from("rota_prep_tasks").update(p).eq("id", id).select("id"));
  }

  async deletePrepTask(id: number): Promise<void> {
    await one(this.sb.from("rota_prep_tasks").delete().eq("id", id).select("id"), "duplicate", "in_use");
  }

  // ------------------------------------------------------------------ the shifts and the heads' phones

  async setShifts(editionId: number, s: RotaShiftsSetting | null): Promise<void> {
    await callRpc(this.sb, "set_rota_shifts", { p_edition: editionId, p_shifts: s == null ? null : cleanShifts(s) });
  }

  async contacts(editionId: number): Promise<RotaContact[]> {
    const d = (await callRpc(this.sb, "get_rota_contacts", { p_edition: editionId })) as { group_id: unknown; head_phone: unknown }[] | null;
    return (d ?? []).map((c) => ({ group_id: Number(c.group_id), head_phone: String(c.head_phone) }));
  }

  async setContact(groupId: number, phone: string | null): Promise<void> {
    await callRpc(this.sb, "set_rota_contact", { p_group: groupId, p_phone: cleanHeadPhone(phone) });
  }
}
