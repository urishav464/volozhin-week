// «תורנויות» in the demo (docs/CONTRACT.md «תורנויות»): the same rules and refusals as the database, in memory. The
// tables are PoolShared's `rota` (every edition's, as the database keeps them, so start_edition carries an edition's
// duties over and the purge finds its heads' phones), the heads' phones `rotaContacts` beside them — never in a Week or
// in load(). Who writes is the demo's actor (the role DemoPort was made with, as the engine's commands): an admin of
// the edition, or logistics while the edition is neither an archive nor archived (app.may_write_rota); who sees a
// phone is app.may_see_rota_contacts (a global admin, or an admin or logistics member of a real edition not archived —
// the demo's own week is a demo: only its global admin). Every write is cleaned first with src/data/rota.ts's cleaners
// (≡ the guards), as SupabaseRota does, then the rule, then the table's constraints — so a refusal has the same code.
// v20: the duties a cohort helps in (`rota.cohortDuties`; the last one of a cohort with groups is kept: in_use), a
// group only in a cohort that helps (cohort_not_helping), «חלוקה לקבוצות» as one step (rota_split_cohort), and a
// cohort's staff contact's phone (`rotaCohortContacts`, the heads' phones' rule).
// The demo's cohorts, groups and heads are synthetic and say «לדוגמה» (seedDemoRota); its phones are «טלפון לדוגמה».
import { nameKey } from "../domain/nameKey";
import { rotaShiftActive, rotaSlots } from "../domain/rota";
import type { Day } from "../domain/time";
import type { Edition } from "../domain/types";
import { CommandError } from "./commands";
import type { Actor, Engine, PoolShared, RotaStore } from "./engine";
import {
  checkCohortCounts, cleanCohortFields, cleanCohortName, cleanContactName, cleanCount, cleanDay, cleanDescription, cleanDutyIds, cleanDutyName, cleanFlag,
  cleanGroupNumber, cleanGroupSize, cleanHeadName, cleanHeadPhone, cleanLetter, cleanMinPeople, cleanNeed, cleanNote, cleanPrepKind, cleanPrepRows, cleanPrepText,
  cleanQty, cleanShift, cleanShifts, cleanSplitSizes, cleanStaffTimes, cleanStaffWho, type CohortPatch, type DutyPatch, type GroupPatch, LAST_YEAR_DUTIES,
  type NewAssignment, type NewCohort, type NewDuty, type NewGroup, type NewPrepRow, type NewStaffShift, type PrepKind, type PrepPatch, type PresenceScope,
  type RotaCohort, type RotaContactRow, type RotaContactTarget, type RotaData, type RotaDuty, type RotaGroup, type RotaPort, type RotaPrepTask,
  type RotaShiftsSetting, type RotaStaffShift, type StaffPatch,
} from "./rota";
import type { MemberRow } from "./settings";

const fail = (code: string): never => {
  throw new CommandError(code);
};

const nextId = (rows: readonly { id: number }[]) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;

/** An integer column (sort): PostgreSQL's integer, else bad_value. */
const cleanSort = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 2_147_483_647 ? v : fail("bad_value"));
const cleanBool = (v: unknown): boolean => (typeof v === "boolean" ? v : fail("bad_value"));

/** What DemoPort shares with its rota: the editions' engines (their edition rows), the shared tables, the team. */
export interface DemoRotaStore {
  readonly shared: PoolShared;
  readonly engines: Map<number, Engine>;
  members: MemberRow[];
  /** app.can_see_edition, for the demo user. */
  canSee(editionId: number): boolean;
  /** Tells the open screens something changed. */
  notify(): void;
}

/** load_rota's order (CONTRACT «The port»): every list sorted as the database sorts it. */
function ordered(t: RotaStore, editionId: number): RotaData {
  const mine = <T extends { edition_id: number }>(rows: T[]) => rows.filter((r) => r.edition_id === editionId);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return structuredClone({
    // v19: the flag and the quantity always sent (a row the demo made before them reads as the columns' defaults)
    cohorts: mine(t.cohorts)
      .sort((a, b) => a.sort - b.sort || cmp(a.letter, b.letter) || a.id - b.id)
      .map((c) => ({ ...c, can_drive: c.can_drive === true })),
    // v20: the duties each cohort helps in, by cohort and duty
    cohortDuties: mine(t.cohortDuties ?? [])
      .sort((a, b) => a.cohort_id - b.cohort_id || a.duty_id - b.duty_id)
      .map(({ cohort_id, duty_id }) => ({ cohort_id, duty_id })),
    presence: mine(t.presence)
      .sort((a, b) => a.cohort_id - b.cohort_id || a.day - b.day || a.shift - b.shift)
      .map(({ cohort_id, day, shift }) => ({ cohort_id, day, shift })),
    groups: mine(t.groups).sort((a, b) => a.cohort_id - b.cohort_id || a.number - b.number || a.id - b.id),
    duties: mine(t.duties).sort((a, b) => a.sort - b.sort || a.id - b.id),
    assignments: mine(t.assignments).sort((a, b) => a.day - b.day || a.shift - b.shift || a.duty_id - b.duty_id || a.group_id - b.group_id || a.id - b.id),
    staff: mine(t.staff).sort((a, b) => a.day - b.day || a.start_min - b.start_min || a.id - b.id),
    prep: mine(t.prep)
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((p) => ({ ...p, kind: p.kind === "item" ? ("item" as const) : ("task" as const), qty: p.kind === "item" ? (p.qty ?? null) : null })),
  });
}

export class DemoRota implements RotaPort {
  constructor(
    private readonly s: DemoRotaStore,
    /** The demo user, as the engine's commands have them (DemoPort's actor). */
    private readonly actor: Actor,
  ) {}

  /** The tables — read afresh every time: an engine command's rollback replaces `shared.rota` with its snapshot. */
  private get t(): RotaStore {
    return this.s.shared.rota;
  }

  private done(): void {
    this.s.notify();
  }

  /** The edition row (the engine's week has it); one the demo user cannot see is not there. */
  private editionOf(editionId: number): Edition | null {
    const e = this.s.engines.get(editionId)?.week.edition;
    return e && this.s.canSee(editionId) ? e : null;
  }

  /** app.may_write_rota: an admin of the edition, or logistics while it is neither an archive nor archived. */
  private mayWrite(e: Edition | null): e is Edition {
    if (!e) return false;
    if (this.actor.role === "admin") return true;
    return this.actor.role === "logistics" && e.kind !== "archive" && e.status !== "archived";
  }

  /** RLS on a write: an edition not the caller's to write → the policy refuses (42501 → forbidden). */
  private writable(editionId: number): Edition {
    const e = this.editionOf(editionId);
    return this.mayWrite(e) ? e : fail("forbidden");
  }

  /** An UPDATE/DELETE by id: a row the caller may not write (or gone) matches nothing → forbidden. */
  private row<T extends { id: number; edition_id: number }>(rows: T[], id: number): T {
    const r = rows.find((x) => x.id === id);
    return r && this.mayWrite(this.editionOf(r.edition_id)) ? r : fail("forbidden");
  }

  /** app.may_see_rota_contacts (≡ v20's app.may_see_cohort_contacts): a global admin, or an admin or logistics member of a real edition not archived. */
  private maySeeContacts(e: Edition): boolean {
    if (this.actor.global) return true;
    return (this.actor.role === "admin" || this.actor.role === "logistics") && e.kind === "real" && e.status !== "archived";
  }

  /** A parent row of the same edition (the composite foreign keys): gone, or another edition's → 23503 on a write → stale. */
  private parent<T extends { id: number; edition_id: number }>(rows: T[], id: number | null | undefined, editionId: number): T {
    const r = rows.find((x) => x.id === id && x.edition_id === editionId);
    return r ?? fail("stale");
  }

  // ------------------------------------------------------------------ read

  async load(editionId: number): Promise<RotaData> {
    if (!this.editionOf(editionId)) fail("not_member");
    return ordered(this.t, editionId);
  }

  // ------------------------------------------------------------------ cohorts

  async addCohort(editionId: number, c: NewCohort): Promise<number> {
    const v = {
      letter: cleanLetter(c.letter), name: cleanCohortName(c.name),
      // v20: the contact's name, the four numbers and the rule between them — the guard's order
      ...cleanCohortFields(c),
      sort: c.sort === undefined ? 0 : cleanSort(c.sort),
      // v19: after the sort, as the guard checks it; absent → the column's default
      can_drive: c.can_drive === undefined ? false : cleanFlag(c.can_drive),
    };
    this.writable(editionId);
    if (this.t.cohorts.some((x) => x.edition_id === editionId && x.letter === v.letter)) fail("rota_letter_taken");
    const id = nextId(this.t.cohorts);
    this.t.cohorts.push({ id, edition_id: editionId, ...v });
    this.done();
    return id;
  }

  async updateCohort(id: number, patch: CohortPatch): Promise<void> {
    const p: Partial<RotaCohort> = {};
    if (patch.letter !== undefined) p.letter = cleanLetter(patch.letter);
    if (patch.name !== undefined) p.name = cleanCohortName(patch.name);
    if (patch.contact_name !== undefined) p.contact_name = cleanContactName(patch.contact_name);
    for (const k of ["trainees", "diet_veg", "diet_gf", "diet_both"] as const) if (patch[k] !== undefined) p[k] = cleanCount(patch[k]);
    const c = this.row(this.t.cohorts, id);
    // v20: the rule between the four numbers, on the row as it would be (the guard sees NEW)
    checkCohortCounts({ trainees: c.trainees, diet_veg: c.diet_veg, diet_gf: c.diet_gf, diet_both: c.diet_both, ...p } as Parameters<typeof checkCohortCounts>[0]);
    if (patch.sort !== undefined) p.sort = cleanSort(patch.sort);
    if (patch.can_drive !== undefined) p.can_drive = cleanFlag(patch.can_drive);
    if (p.letter !== undefined && this.t.cohorts.some((x) => x.id !== id && x.edition_id === c.edition_id && x.letter === p.letter)) fail("rota_letter_taken");
    Object.assign(c, p);
    this.done();
  }

  async deleteCohort(id: number): Promise<void> {
    const c = this.row(this.t.cohorts, id);
    // rota_groups' foreign key is «no action»: a cohort with groups stays (23503)
    if (this.t.groups.some((g) => g.cohort_id === id)) fail("in_use");
    const t = this.t;
    t.cohorts = t.cohorts.filter((x) => x.id !== c.id);
    t.presence = t.presence.filter((x) => x.cohort_id !== c.id);
    t.staff = t.staff.filter((x) => x.cohort_id !== c.id); // a cohort's staff shift goes with it (cascade)
    t.cohortDuties = (t.cohortDuties ?? []).filter((x) => x.cohort_id !== c.id); // v20: cascade
    delete this.s.shared.rotaCohortContacts[c.id]; // v20: rota_cohort_contacts, cascade
    this.done();
  }

  /** v20: a cohort with groups keeps a duty (app.rota_cohort_duties_guard): its last row stays → in_use. */
  private keepsADuty(cohortId: number, remaining: readonly { cohort_id: number }[]): void {
    if (this.t.groups.some((g) => g.cohort_id === cohortId) && !remaining.some((x) => x.cohort_id === cohortId)) fail("in_use");
  }

  async setCohortDuties(editionId: number, cohortId: number, dutyIds: number[]): Promise<void> {
    const ids = cleanDutyIds(dutyIds);
    this.writable(editionId);
    // the insert first (its foreign keys: the cohort and every duty the edition's — else stale), then the delete
    if (ids.length > 0) {
      this.parent(this.t.cohorts, cohortId, editionId);
      for (const d of ids) this.parent(this.t.duties, d, editionId);
    }
    const t = this.t;
    const rest = (t.cohortDuties ?? []).filter((x) => !(x.edition_id === editionId && x.cohort_id === cohortId && !ids.includes(x.duty_id)));
    this.keepsADuty(cohortId, [...rest, ...ids.map(() => ({ cohort_id: cohortId }))]);
    const have = new Set(rest.filter((x) => x.cohort_id === cohortId).map((x) => x.duty_id));
    t.cohortDuties = [...rest, ...ids.filter((d) => !have.has(d)).map((duty_id) => ({ edition_id: editionId, cohort_id: cohortId, duty_id }))];
    this.done();
  }

  /** public.rota_split_cohort: the sizes, who writes, the cohort, then the cohort's groups replaced (the groups' guard: it must help). */
  async splitCohort(editionId: number, cohortId: number, sizes: number[]): Promise<RotaGroup[]> {
    const v = cleanSplitSizes(sizes);
    this.writable(editionId);
    this.parent(this.t.cohorts, cohortId, editionId);
    if (!(this.t.cohortDuties ?? []).some((x) => x.cohort_id === cohortId)) fail("cohort_not_helping");
    const t = this.t;
    const old = new Set(t.groups.filter((g) => g.cohort_id === cohortId).map((g) => g.id));
    t.groups = t.groups.filter((g) => !old.has(g.id));
    t.assignments = t.assignments.filter((a) => !old.has(a.group_id)); // cascade
    for (const id of old) delete this.s.shared.rotaContacts[id]; // rota_group_contacts: cascade
    for (const task of t.prep) if (task.group_id != null && old.has(task.group_id)) task.group_id = null; // on delete set null (group_id)
    let id = Math.max(nextId(t.groups), ...[...old].map((x) => x + 1));
    const made: RotaGroup[] = v.map((size, i) => ({ id: id++, edition_id: editionId, cohort_id: cohortId, number: i + 1, size, head_name: null }));
    t.groups.push(...made);
    this.done();
    return structuredClone(made);
  }

  async setPresence(editionId: number, cohortId: number, scope: PresenceScope, present: boolean): Promise<void> {
    const day = scope.day === undefined ? undefined : cleanDay(scope.day);
    const shift = scope.shift === undefined ? undefined : cleanShift(scope.shift);
    const e = this.writable(editionId);
    this.parent(this.t.cohorts, cohortId, editionId);
    const inScope = (d: number, s: number) => (day === undefined || d === day) && (shift === undefined || s === shift);
    if (present) {
      for (const slot of rotaSlots(e).filter((x) => inScope(x.day, x.shift))) {
        if (!this.t.presence.some((p) => p.cohort_id === cohortId && p.day === slot.day && p.shift === slot.shift)) {
          this.t.presence.push({ edition_id: editionId, cohort_id: cohortId, day: slot.day, shift: slot.shift });
        }
      }
    } else {
      this.t.presence = this.t.presence.filter((p) => !(p.cohort_id === cohortId && inScope(p.day, p.shift)));
    }
    this.done();
  }

  // ------------------------------------------------------------------ groups

  /** The groups' guard (v20): a group only in a cohort that helps in a duty — a cohort not the edition's is the foreign key's (stale). */
  private mustHelp(cohortId: number): void {
    if (!(this.t.cohortDuties ?? []).some((x) => x.cohort_id === cohortId)) fail("cohort_not_helping");
  }

  async addGroup(editionId: number, g: NewGroup): Promise<void> {
    const v = { number: cleanGroupNumber(g.number), size: cleanGroupSize(g.size ?? null), head_name: cleanHeadName(g.head_name ?? null) };
    // the database's order: the guard (its values, then cohort_not_helping for a cohort of the edition — a BEFORE
    // trigger runs before the policy's check), RLS, then the foreign key and the unique index
    if (this.t.cohorts.some((c) => c.id === g.cohort_id && c.edition_id === editionId)) this.mustHelp(g.cohort_id);
    this.writable(editionId);
    this.parent(this.t.cohorts, g.cohort_id, editionId);
    if (this.t.groups.some((x) => x.cohort_id === g.cohort_id && x.number === v.number)) fail("rota_group_taken");
    this.t.groups.push({ id: nextId(this.t.groups), edition_id: editionId, cohort_id: g.cohort_id, ...v });
    this.done();
  }

  async updateGroup(id: number, patch: GroupPatch): Promise<void> {
    const p: Partial<RotaGroup> = {};
    if (patch.number !== undefined) p.number = cleanGroupNumber(patch.number);
    if (patch.size !== undefined) p.size = cleanGroupSize(patch.size);
    if (patch.head_name !== undefined) p.head_name = cleanHeadName(patch.head_name);
    const g = this.row(this.t.groups, id);
    if (p.number !== undefined && this.t.groups.some((x) => x.id !== id && x.cohort_id === g.cohort_id && x.number === p.number)) fail("rota_group_taken");
    Object.assign(g, p);
    this.done();
  }

  async deleteGroup(id: number): Promise<void> {
    const g = this.row(this.t.groups, id);
    const t = this.t;
    t.groups = t.groups.filter((x) => x.id !== g.id);
    t.assignments = t.assignments.filter((a) => a.group_id !== g.id); // cascade
    delete this.s.shared.rotaContacts[g.id]; // rota_group_contacts: cascade
    for (const task of t.prep) if (task.group_id === g.id) task.group_id = null; // on delete set null (group_id)
    this.done();
  }

  // ------------------------------------------------------------------ duties

  private cleanDutyFields(d: Partial<NewDuty>): Partial<RotaDuty> {
    const p: Partial<RotaDuty> = {};
    if (d.name !== undefined) p.name = cleanDutyName(d.name);
    if (d.description !== undefined) p.description = cleanDescription(d.description);
    if (d.need_morning !== undefined) p.need_morning = cleanNeed(d.need_morning);
    if (d.need_afternoon !== undefined) p.need_afternoon = cleanNeed(d.need_afternoon);
    if (d.need_night !== undefined) p.need_night = cleanNeed(d.need_night);
    if (d.min_people !== undefined) p.min_people = cleanMinPeople(d.min_people);
    if (d.sort !== undefined) p.sort = cleanSort(d.sort);
    return p;
  }

  private dutyNameTaken(editionId: number, name: string, except: number | null): boolean {
    const key = nameKey(name);
    return this.t.duties.some((x) => x.id !== except && x.edition_id === editionId && nameKey(x.name) === key);
  }

  async addDuty(editionId: number, d: NewDuty): Promise<void> {
    const v = { description: null, need_morning: null, need_afternoon: null, need_night: null, min_people: null, sort: 0, ...this.cleanDutyFields(d), name: cleanDutyName(d.name) };
    this.writable(editionId);
    if (this.dutyNameTaken(editionId, v.name, null)) fail("rota_duty_exists");
    this.t.duties.push({ id: nextId(this.t.duties), edition_id: editionId, ...v });
    this.done();
  }

  async updateDuty(id: number, patch: DutyPatch): Promise<void> {
    const p = this.cleanDutyFields(patch);
    const d = this.row(this.t.duties, id);
    if (p.name !== undefined && this.dutyNameTaken(d.edition_id, p.name, id)) fail("rota_duty_exists");
    Object.assign(d, p);
    this.done();
  }

  async deleteDuty(id: number): Promise<void> {
    const d = this.row(this.t.duties, id);
    // v20: its rows of rota_cohort_duties go with it (cascade) — but a cohort with groups keeps one (in_use)
    const rest = (this.t.cohortDuties ?? []).filter((x) => x.duty_id !== d.id);
    for (const x of (this.t.cohortDuties ?? []).filter((y) => y.duty_id === d.id)) this.keepsADuty(x.cohort_id, rest);
    this.t.cohortDuties = rest;
    this.t.duties = this.t.duties.filter((x) => x.id !== d.id);
    this.t.assignments = this.t.assignments.filter((a) => a.duty_id !== d.id); // cascade
    this.done();
  }

  // ------------------------------------------------------------------ assignments

  private cleanAssignment(a: NewAssignment): NewAssignment {
    return { day: cleanDay(a.day), shift: cleanShift(a.shift), duty_id: a.duty_id, group_id: a.group_id };
  }

  /** The guard (outside_week) and the foreign keys (stale) for one new row; the unique index is the caller's. */
  private checkNew(e: Edition, a: NewAssignment): void {
    if (!rotaShiftActive(e, a.day, a.shift)) fail("outside_week");
    this.parent(this.t.duties, a.duty_id, e.id);
    this.parent(this.t.groups, a.group_id, e.id);
  }

  private busy(editionId: number, day: Day, shift: number, groupId: number): boolean {
    return this.t.assignments.some((x) => x.edition_id === editionId && x.day === day && x.shift === shift && x.group_id === groupId);
  }

  async assign(editionId: number, a: NewAssignment): Promise<void> {
    const v = this.cleanAssignment(a);
    const e = this.writable(editionId);
    // the database's order: the guard (outside_week), then the unique index (busy), then the foreign keys (stale)
    if (!rotaShiftActive(e, v.day, v.shift)) fail("outside_week");
    if (this.busy(editionId, v.day, v.shift, v.group_id)) fail("rota_group_busy");
    this.checkNew(e, v);
    this.t.assignments.push({ id: nextId(this.t.assignments), edition_id: editionId, ...v, source: "hand" });
    this.done();
  }

  async moveAssignment(id: number, dutyId: number): Promise<void> {
    const a = this.row(this.t.assignments, id);
    this.parent(this.t.duties, dutyId, a.edition_id);
    // the same group and shift: the unique index cannot be hit; the guard makes an edited row «hand»
    Object.assign(a, { duty_id: dutyId, source: "hand" as const });
    this.done();
  }

  async unassign(id: number): Promise<void> {
    const a = this.row(this.t.assignments, id);
    this.t.assignments = this.t.assignments.filter((x) => x.id !== a.id);
    this.done();
  }

  async applySuggestion(editionId: number, rows: NewAssignment[]): Promise<void> {
    const vs = rows.map((r) => this.cleanAssignment(r));
    if (vs.length === 0) return;
    const e = this.writable(editionId);
    // one statement: every row checked before any goes in — a row taken meanwhile (the unique index, here or earlier in
    // the same list) or a duty or group gone (the foreign keys) is `stale`, and nothing is added
    const taken = new Set(this.t.assignments.filter((x) => x.edition_id === editionId).map((x) => `${x.day}:${x.shift}:${x.group_id}`));
    for (const v of vs) {
      if (!rotaShiftActive(e, v.day, v.shift)) fail("outside_week");
      if (!this.t.duties.some((d) => d.id === v.duty_id && d.edition_id === editionId)) fail("stale");
      if (!this.t.groups.some((g) => g.id === v.group_id && g.edition_id === editionId)) fail("stale");
      const key = `${v.day}:${v.shift}:${v.group_id}`;
      if (taken.has(key)) fail("stale");
      taken.add(key);
    }
    let id = nextId(this.t.assignments);
    for (const v of vs) this.t.assignments.push({ id: id++, edition_id: editionId, ...v, source: "suggested" });
    this.done();
  }

  async clearSuggested(editionId: number): Promise<number> {
    this.writable(editionId);
    const before = this.t.assignments.length;
    this.t.assignments = this.t.assignments.filter((a) => !(a.edition_id === editionId && a.source === "suggested"));
    const n = before - this.t.assignments.length;
    this.done();
    return n;
  }

  // ------------------------------------------------------------------ staff shifts

  /** The whole row as the guard sees it (NEW): times, who, note (v20: no kind). */
  private cleanStaff(s: NewStaffShift): NewStaffShift {
    return {
      day: cleanDay(s.day),
      ...cleanStaffTimes(s.start_min, s.end_min),
      ...cleanStaffWho(s),
      note: cleanNote(s.note),
    };
  }

  /** The guard: a member must be an active member of the edition or of every edition (bad_value); a cohort the edition's. */
  private checkStaff(editionId: number, v: NewStaffShift, before: RotaStaffShift | null): void {
    if (v.member_id != null && v.member_id !== before?.member_id) {
      const ok = this.s.members.some((m) => m.id === v.member_id && m.active && (m.edition_id == null || m.edition_id === editionId));
      if (!ok) fail("bad_value");
    }
    if (v.cohort_id != null) this.parent(this.t.cohorts, v.cohort_id, editionId);
  }

  async addStaffShift(editionId: number, s: NewStaffShift): Promise<void> {
    const v = this.cleanStaff(s);
    this.writable(editionId);
    this.checkStaff(editionId, v, null);
    this.t.staff.push({ id: nextId(this.t.staff), edition_id: editionId, ...v });
    this.done();
  }

  async updateStaffShift(id: number, patch: StaffPatch): Promise<void> {
    const r = this.row(this.t.staff, id);
    const { id: _id, edition_id: _e, ...current } = r;
    const v = this.cleanStaff({ ...current, ...patch });
    this.checkStaff(r.edition_id, v, r);
    Object.assign(r, v);
    this.done();
  }

  async deleteStaffShift(id: number): Promise<void> {
    const r = this.row(this.t.staff, id);
    this.t.staff = this.t.staff.filter((x) => x.id !== r.id);
    this.done();
  }

  // ------------------------------------------------------------------ preparations

  async addPrepTasks(editionId: number, items: NewPrepRow[], kind: PrepKind = "task"): Promise<void> {
    const vs = cleanPrepRows(items, kind);
    if (vs.length === 0) return;
    this.writable(editionId);
    // the edition's last, whatever its kind: the two lists share the numbering
    const last = this.t.prep.filter((x) => x.edition_id === editionId).reduce((m, x) => Math.max(m, x.sort), 0);
    let id = nextId(this.t.prep);
    vs.forEach((v, i) => this.t.prep.push({ id: id++, edition_id: editionId, text: v.text, group_id: null, done: false, sort: last + 1 + i, kind: v.kind, qty: v.qty }));
    this.done();
  }

  async updatePrepTask(id: number, patch: PrepPatch): Promise<void> {
    const p: Partial<RotaPrepTask> = {};
    if (patch.text !== undefined) p.text = cleanPrepText(patch.text);
    // v19: the kind, then the quantity — cleaned whatever the kind; the guard then writes a task's as null
    if (patch.kind !== undefined) p.kind = cleanPrepKind(patch.kind);
    if (patch.qty !== undefined) p.qty = cleanQty(patch.qty);
    if (patch.done !== undefined) p.done = cleanBool(patch.done);
    if (patch.sort !== undefined) p.sort = cleanSort(patch.sort);
    if (patch.group_id !== undefined) p.group_id = patch.group_id;
    const r = this.row(this.t.prep, id);
    if (p.group_id != null) this.parent(this.t.groups, p.group_id, r.edition_id);
    Object.assign(r, p);
    if ((r.kind ?? "task") === "task") r.qty = null;
    this.done();
  }

  async deletePrepTask(id: number): Promise<void> {
    const r = this.row(this.t.prep, id);
    this.t.prep = this.t.prep.filter((x) => x.id !== r.id);
    this.done();
  }

  // ------------------------------------------------------------------ the shifts

  /** public.set_rota_shifts: an admin of the edition; stored in the edition's settings (the Week shows it). */
  async setShifts(editionId: number, s: RotaShiftsSetting | null): Promise<void> {
    const v = s == null ? null : cleanShifts(s);
    const e = this.editionOf(editionId) ?? fail("not_member");
    if (this.actor.role !== "admin") fail("forbidden");
    if (v == null) delete e.settings.rota_shifts;
    else e.settings.rota_shifts = structuredClone(v);
    this.done();
  }

  // ------------------------------------------------------------------ the phones: the heads', and (v20) the cohorts' contacts'

  /** public.get_rota_contacts: the edition's heads' phones the caller may see, by group, then its cohorts' contacts', by cohort. */
  async contacts(editionId: number): Promise<RotaContactRow[]> {
    const e = this.editionOf(editionId);
    if (!e || !this.maySeeContacts(e)) return [];
    const cohortPhones = this.s.shared.rotaCohortContacts ?? {};
    return [
      ...this.t.groups
        .filter((g) => g.edition_id === editionId && g.id in this.s.shared.rotaContacts)
        .sort((a, b) => a.id - b.id)
        .map((g): RotaContactRow => ({ group_id: g.id, head_phone: this.s.shared.rotaContacts[g.id] })),
      ...this.t.cohorts
        .filter((c) => c.edition_id === editionId && c.id in cohortPhones)
        .sort((a, b) => a.id - b.id)
        .map((c): RotaContactRow => ({ cohort_id: c.id, phone: cohortPhones[c.id] })),
    ];
  }

  /** public.set_rota_contact: the group or cohort (gone → stale), a member (not_member), the phone rule (rota_contact_hidden); blank deletes. */
  async setContact(target: RotaContactTarget, phone: string | null): Promise<void> {
    const v = cleanHeadPhone(phone);
    if ("group" in target) {
      const g = this.t.groups.find((x) => x.id === target.group) ?? fail("stale");
      const e = this.editionOf(g.edition_id) ?? fail("not_member");
      if (!this.maySeeContacts(e)) fail("rota_contact_hidden");
      if (v == null) delete this.s.shared.rotaContacts[g.id];
      else this.s.shared.rotaContacts[g.id] = v;
    } else {
      const c = this.t.cohorts.find((x) => x.id === target.cohort) ?? fail("stale");
      const e = this.editionOf(c.edition_id) ?? fail("not_member");
      if (!this.maySeeContacts(e)) fail("rota_contact_hidden");
      this.s.shared.rotaCohortContacts ??= {};
      if (v == null) delete this.s.shared.rotaCohortContacts[c.id];
      else this.s.shared.rotaCohortContacts[c.id] = v;
    }
    this.done();
  }
}

/**
 * The demo's rota, written straight into the store as the demo's instructor would have set it up: three cohorts
 * («מכינה לדוגמה א/ב/נ»), each with its trainees (the sum of its groups' sizes), its diet numbers and a staff contact
 * («איש/אשת קשר לדוגמה …», «טלפון לדוגמה»), groups 6/6/5 with synthetic sizes and heads, «טלפון לדוגמה» for each head
 * (the drivers' placeholder — never digits; never through cleanHeadPhone, which wants six), «א» and «ב» on campus all
 * week and «נ» on Monday and Tuesday only, last year's four duties — «א» and «ב» help in all four, «נ» (v20) only in
 * «בית מדרש» —, a few staff shifts and preparations, and NO assignments, so the demo opens on «הצעה הוגנת». The staff
 * member is a team member's id and name (the demo's logistics member). Synthetic only: no real name, phone or place.
 */
export function seedDemoRota(shared: PoolShared, edition: Edition, staffMember: Pick<MemberRow, "id" | "display_name"> | null): void {
  const t = shared.rota;
  t.cohortDuties ??= [];
  shared.rotaCohortContacts ??= {};
  // letter, groups, then the diets («צמחוני/טבעוני», «ללא גלוטן», «מהם גם וגם») — synthetic numbers
  const cohorts: [string, number, number, number, number][] = [
    ["א", 6, 5, 2, 1],
    ["ב", 6, 3, 1, 0],
    ["נ", 5, 4, 3, 1],
  ];
  const sizes = [8, 7, 9, 6, 10, 8, 7, 9, 8, 6, 10, 7, 9, 8, 6, 7, 10];
  let n = 0;
  const slots = rotaSlots(edition);
  for (const d of LAST_YEAR_DUTIES) {
    t.duties.push({
      id: nextId(t.duties), edition_id: edition.id, name: d.name, description: d.description ?? null, need_morning: d.need_morning ?? null,
      need_afternoon: d.need_afternoon ?? null, need_night: d.need_night ?? null, min_people: d.min_people ?? null, sort: d.sort ?? 0,
    });
  }
  const duties = t.duties.filter((d) => d.edition_id === edition.id);
  cohorts.forEach(([letter, groups, veg, gf, both], i) => {
    const mine = sizes.slice(n, n + groups);
    const cohort: RotaCohort = {
      id: nextId(t.cohorts), edition_id: edition.id, letter, name: `מכינה לדוגמה ${letter}`, trainees: mine.reduce((a, b) => a + b, 0),
      diet_veg: veg, diet_gf: gf, diet_both: both, contact_name: `איש/אשת קשר לדוגמה ${letter}`, sort: i + 1, can_drive: false,
    };
    t.cohorts.push(cohort);
    shared.rotaCohortContacts[cohort.id] = "טלפון לדוגמה";
    // «נ» helps in «בית מדרש» alone (v20); the others in every duty
    for (const d of duties.filter((x) => letter !== "נ" || x.name === "בית מדרש")) t.cohortDuties.push({ edition_id: edition.id, cohort_id: cohort.id, duty_id: d.id });
    const here = letter === "נ" ? slots.filter((s) => s.day === 1 || s.day === 2) : slots;
    for (const s of here) t.presence.push({ edition_id: edition.id, cohort_id: cohort.id, day: s.day, shift: s.shift });
    for (let g = 1; g <= groups; g++) {
      n++;
      const id = nextId(t.groups);
      t.groups.push({ id, edition_id: edition.id, cohort_id: cohort.id, number: g, size: sizes[n - 1], head_name: `ראש/ת קבוצה לדוגמה ${n}` });
      shared.rotaContacts[id] = "טלפון לדוגמה";
    }
  });
  const nun = t.cohorts.find((c) => c.edition_id === edition.id && c.letter === "נ")!;
  const staff = (day: Day, start: number, end: number, who: Pick<RotaStaffShift, "member_id" | "name" | "cohort_id">, note: string | null) =>
    t.staff.push({ id: nextId(t.staff), edition_id: edition.id, day, start_min: start, end_min: end, ...who, note });
  // a team member, a name as typed, a cohort's whole staff
  if (staffMember) staff(0, 510, 870, { member_id: staffMember.id, name: staffMember.display_name, cohort_id: null }, null);
  staff(0, 870, 1350, { member_id: null, name: "איש/אשת צוות לדוגמה", cohort_id: null }, "הקפצת מרצה (לדוגמה)");
  staff(1, 1350, 1830, { member_id: null, name: null, cohort_id: nun.id }, null);
  for (let i = 1; i <= 4; i++) {
    t.prep.push({ id: nextId(t.prep), edition_id: edition.id, text: `משימת הכנה לדוגמה ${i}`, group_id: null, done: false, sort: i, kind: "task", qty: null });
  }
}
