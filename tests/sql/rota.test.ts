// «תורנויות» (v16) in the database, as the roles a browser gets (docs/CONTRACT.md «תורנויות»): every shared case of
// src/testing/rotaCases.ts, each sent as the Supabase port sends it (an INSERT/UPDATE/DELETE under RLS, or the RPC) and
// read back by the port's rule (23505 → the table's code, 23503 → in_use, 23514/22P02 → bad_value, P0001 → its
// message, 42501 or no row → forbidden) — DemoRota runs the same table (src/data/rotaPorts.test.ts); who writes (an
// edition's admins, its logistics members while it is live) and who reads (the edition's team; nobody else); the
// fair suggestion's apply, all or nothing; the shifts the week has (app.rota_shift_active ≡ rotaShiftActive, value for
// value); the group heads' phones (a role × edition-kind matrix, get_rota_contacts ≡ the per-group rule, never in
// load_rota); the browser's cleaners ≡ the guards; the purge, the move to next year, and deleting an edition.
// Synthetic values only: no scanner takes these phones for real ones.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { cleanDiets, cleanHeadPhone, cleanLetter, cleanShifts, cleanStaffWho, EMPTY_ROTA, LAST_YEAR_DUTIES, type ShiftIndex } from "../../src/data/rota";
import { rotaShiftActive, rotaSlots } from "../../src/domain/rota";
import type { Day } from "../../src/domain/time";
import type { RotaShiftsSetting } from "../../src/domain/types";
import { PERSONAL_KEYS } from "../../src/offline/snapshot";
import { ROTA_ADMIN_CASES, ROTA_CASES, ROTA_FIXTURE, type RotaCase } from "../../src/testing/rotaCases";
import { SCHEMA, dropDatabase, freshDatabase, google } from "./db";

const ADMIN = "admin@example.org"; // every edition
const KINDS = ["live", "practice", "demo", "archived", "archive"] as const;
type Kind = (typeof KINDS)[number];
const ROLES = ["content", "logistics", "admin"] as const;
type Role = (typeof ROLES)[number];
/** The member of one edition in one role. */
const member = (kind: Kind, role: Role) => `${role}.${kind}@example.org`;
const L = member("live", "logistics");
const C = member("live", "content");
const ED_ADMIN = member("live", "admin");
const OTHER = "other@example.org"; // content in another live real edition
const OTHER_LOGISTICS = "other.logistics@example.org";
const INACTIVE = "inactive@example.org"; // a deactivated logistics member of the live edition
const STRANGER = "stranger@example.org";
const LABEL = "תשפ\"ז";
const PHONE = "555 0100 61";
const PHONE_2 = "555 0100 62";
const SEVEN = ["cohorts", "presence", "groups", "duties", "assignments", "staff_shifts", "prep_tasks"].map((t) => `rota_${t}`);
/** The port's code for a unique violation, by table (CONTRACT «תורנויות», the port). */
const UNIQUE: Record<string, string> = { rota_cohorts: "rota_letter_taken", rota_groups: "rota_group_taken", rota_duties: "rota_duty_exists", rota_assignments: "rota_group_busy" };

type Run = (who: string, sql: string, params?: unknown[]) => Promise<pg.QueryResult>;
type Ids = Record<string, number>;

/** What the Supabase port makes of a database error (src/data/supabaseRota.ts). In an apply, a row taken meanwhile is `stale`. */
function portCode(e: unknown, table: string, apply = false): string {
  const err = e as { code?: string; message: string };
  switch (err.code) {
    case "23505":
      return apply ? "stale" : (UNIQUE[table] ?? `unmapped 23505 on ${table}`);
    case "23503":
      return apply ? "stale" : "in_use";
    case "23514":
    case "22P02":
      return "bad_value";
    case "P0001":
      return err.message;
    case "42501":
      return "forbidden";
    default:
      return `error ${err.code}: ${err.message}`;
  }
}

/** One write as the port reads its answer: an UPDATE or DELETE that matched no row it may write is `forbidden`. */
async function attempt(table: string, p: Promise<pg.QueryResult>, opts: { apply?: boolean; row?: boolean } = {}): Promise<string> {
  try {
    const r = await p;
    return opts.row && r.rowCount === 0 ? "forbidden" : "ok";
  } catch (e) {
    return portCode(e, table, opts.apply);
  }
}

/** A cleaner of src/data/rota.ts: its value, or its refusal's code. */
function ts<T>(f: () => T): { ok: T } | { code: string } {
  try {
    return { ok: f() };
  } catch (e) {
    return { code: (e as { code?: string }).code ?? String(e) };
  }
}

describe("תורנויות (v16)", () => {
  const dbName = `vw_rota_${process.pid}`;
  let db: pg.Client;
  const ed = {} as Record<Kind, number>;
  let other: number;
  const memberId: Record<string, number> = {};

  /** One transaction, always rolled back: each statement as the owner or a Google member, under its own savepoint. */
  async function inTx<T>(fn: (run: Run) => Promise<T>): Promise<T> {
    await db.query("begin");
    try {
      const run: Run = async (who, sql, params = []) => {
        await db.query("savepoint s");
        try {
          if (who === "owner") await db.query("reset role");
          else {
            await db.query("set local role authenticated");
            await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(who))]);
          }
          const r = await db.query(sql, params);
          await db.query("release savepoint s");
          return r;
        } catch (e) {
          await db.query("rollback to savepoint s");
          throw e;
        } finally {
          await db.query("reset role");
        }
      };
      return await fn(run);
    } finally {
      await db.query("rollback");
      await db.query("reset role");
    }
  }
  const val = async (run: Run, who: string, sql: string, params: unknown[] = []) => Object.values((await run(who, sql, params)).rows[0] ?? {})[0];
  const num = async (run: Run, who: string, sql: string, params: unknown[] = []) => Number(await val(run, who, sql, params));

  /** ROTA_FIXTURE in an edition, as the owner (through the guards): ref → id; `A1` is the fixture's assignment. */
  async function fixture(run: Run, edition: number): Promise<Ids> {
    const ids: Ids = {};
    for (const c of ROTA_FIXTURE.cohorts) {
      ids[c.ref] = await num(run, "owner", "insert into public.rota_cohorts (edition_id, letter, name, diets, sort) values ($1, $2, $3, $4::jsonb, $5) returning id",
        [edition, c.letter, c.name, JSON.stringify(c.diets), c.sort]);
    }
    for (const g of ROTA_FIXTURE.groups) {
      ids[g.ref] = await num(run, "owner", "insert into public.rota_groups (edition_id, cohort_id, number, size, head_name) values ($1, $2, $3, $4, $5) returning id",
        [edition, ids[g.cohort], g.number, g.size, g.head_name]);
    }
    for (const d of ROTA_FIXTURE.duties) {
      ids[d.ref] = await num(run, "owner",
        "insert into public.rota_duties (edition_id, name, description, need_morning, need_afternoon, need_night, min_people, sort) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
        [edition, d.name, d.description, d.need_morning, d.need_afternoon, d.need_night, d.min_people, d.sort]);
    }
    for (const a of ROTA_FIXTURE.assignments) {
      ids.A1 = await num(run, "owner", "insert into public.rota_assignments (edition_id, day, shift, duty_id, group_id) values ($1, $2, $3, $4, $5) returning id",
        [edition, a.day, a.shift, ids[a.duty], ids[a.group]]);
    }
    return ids;
  }

  /** The fixture and one row of each other table: A on campus Monday morning, a staff shift, a preparation. */
  async function fuller(run: Run, edition: number): Promise<Ids> {
    const ids = await fixture(run, edition);
    await run("owner", "insert into public.rota_presence (edition_id, cohort_id, day, shift) values ($1, $2, 1, 0)", [edition, ids.A]);
    ids.S = await num(run, "owner", "insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, name, kind) values ($1, 1, 510, 780, 'איש/אשת צוות לדוגמה', 'shift') returning id", [edition]);
    ids.P = await num(run, "owner", "insert into public.rota_prep_tasks (edition_id, text, group_id, sort) values ($1, 'הכנה לדוגמה', $2, 1) returning id", [edition, ids.G1]);
    return ids;
  }

  /** Everything of an edition's rota (and its settings), to prove a refusal changed nothing. */
  async function state(run: Run, edition: number): Promise<string[]> {
    const out: string[] = [];
    for (const t of SEVEN) out.push(String(await val(run, "owner", `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.${t} x where x.edition_id = $1`, [edition])));
    out.push(String(await val(run, "owner",
      "select md5(coalesce(string_agg(c::text, '|' order by c::text), '')) from public.rota_group_contacts c join public.rota_groups g on g.id = c.group_id where g.edition_id = $1", [edition])));
    out.push(String(await val(run, "owner", "select settings::text from public.editions where id = $1", [edition])));
    return out;
  }

  /** One shared case, sent as SupabaseRota sends it — the raw values, not cleaned first: the guards are the backstop. */
  async function perform(run: Run, who: string, edition: number, ids: Ids, c: RotaCase): Promise<string> {
    switch (c.op) {
      case "addCohort":
        return attempt("rota_cohorts", run(who, "insert into public.rota_cohorts (edition_id, letter, name, diets, sort) values ($1, $2, $3, $4::jsonb, $5) returning id",
          [edition, c.args.letter, c.args.name, JSON.stringify(c.args.diets ?? []), c.args.sort ?? 0]));
      case "updateCohort": {
        const keys = Object.keys(c.args);
        const sets = keys.map((k, i) => `${k} = $${i + 2}${k === "diets" ? "::jsonb" : ""}`).join(", ");
        const values = keys.map((k) => (k === "diets" ? JSON.stringify(c.args[k]) : c.args[k]));
        return attempt("rota_cohorts", run(who, `update public.rota_cohorts set ${sets} where id = $1 returning id`, [ids[c.ref], ...values]), { row: true });
      }
      case "deleteCohort":
        return attempt("rota_cohorts", run(who, "delete from public.rota_cohorts where id = $1 returning id", [ids[c.ref]]), { row: true });
      case "addGroup":
        return attempt("rota_groups", run(who, "insert into public.rota_groups (edition_id, cohort_id, number, size, head_name) values ($1, $2, $3, $4, $5) returning id",
          [edition, ids[c.args.cohort], c.args.number, c.args.size ?? null, c.args.head_name ?? null]));
      case "addDuty":
        return attempt("rota_duties", run(who,
          "insert into public.rota_duties (edition_id, name, description, need_morning, need_afternoon, need_night, min_people, sort) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
          [edition, c.args.name, c.args.description ?? null, c.args.need_morning ?? null, c.args.need_afternoon ?? null, c.args.need_night ?? null, c.args.min_people ?? null, c.args.sort ?? 0]));
      case "assign":
        return attempt("rota_assignments", run(who, "insert into public.rota_assignments (edition_id, day, shift, duty_id, group_id, source) values ($1, $2, $3, $4, $5, 'hand') returning id",
          [edition, c.args.day, c.args.shift, ids[c.args.duty], ids[c.args.group]]));
      case "applySuggestion":
        return attempt("rota_assignments", run(who,
          `insert into public.rota_assignments (edition_id, day, shift, duty_id, group_id, source)
           select $1, r.day, r.shift, r.duty_id, r.group_id, 'suggested' from jsonb_to_recordset($2::jsonb) as r(day integer, shift integer, duty_id bigint, group_id bigint) returning id`,
          [edition, JSON.stringify(c.args.map((a) => ({ day: a.day, shift: a.shift, duty_id: ids[a.duty], group_id: ids[a.group] })))]), { apply: true });
      case "addStaffShift":
        return attempt("rota_staff_shifts", run(who,
          "insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, member_id, name, cohort_id, kind, note) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id",
          [edition, c.args.day, c.args.start_min, c.args.end_min, c.args.member_id, c.args.name, c.args.cohort ? ids[c.args.cohort] : null, c.args.kind, c.args.note]));
      case "addPrepTasks": {
        const last = await num(run, who, "select coalesce(max(sort), 0) from public.rota_prep_tasks where edition_id = $1", [edition]);
        return attempt("rota_prep_tasks", run(who,
          "insert into public.rota_prep_tasks (edition_id, text, sort) select $1, t.text, $3 + t.o from unnest($2::text[]) with ordinality as t(text, o) returning id",
          [edition, c.args, last]));
      }
      case "setShifts":
        return attempt("editions", run(who, "select public.set_rota_shifts($1, $2::jsonb)", [edition, c.args == null ? null : JSON.stringify(c.args)]));
      case "setContact":
        return attempt("rota_group_contacts", run(who, "select public.set_rota_contact($1, $2)", [ids[c.ref], c.args]));
    }
  }

  /** A write of every kind on every table (inserts, updates, then deletes), as `who`: each its own port code. */
  async function probe(run: Run, who: string, edition: number, ids: Ids): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    out.cohort_insert = await attempt("rota_cohorts", run(who, "insert into public.rota_cohorts (edition_id, letter, name) values ($1, 'ג', 'מכינה לבדיקה') returning id", [edition]));
    out.cohort_update = await attempt("rota_cohorts", run(who, "update public.rota_cohorts set name = 'שם אחר לבדיקה' where id = $1 returning id", [ids.N]), { row: true });
    out.presence_insert = await attempt("rota_presence", run(who, "insert into public.rota_presence (edition_id, cohort_id, day, shift) values ($1, $2, 2, 1) returning cohort_id", [edition, ids.N]));
    out.group_insert = await attempt("rota_groups", run(who, "insert into public.rota_groups (edition_id, cohort_id, number) values ($1, $2, 9) returning id", [edition, ids.A]));
    out.group_update = await attempt("rota_groups", run(who, "update public.rota_groups set size = 10 where id = $1 returning id", [ids.G1]), { row: true });
    out.duty_insert = await attempt("rota_duties", run(who, "insert into public.rota_duties (edition_id, name) values ($1, 'תורנות לבדיקה') returning id", [edition]));
    out.duty_update = await attempt("rota_duties", run(who, "update public.rota_duties set need_night = 1 where id = $1 returning id", [ids.D2]), { row: true });
    out.assign_insert = await attempt("rota_assignments", run(who, "insert into public.rota_assignments (edition_id, day, shift, duty_id, group_id) values ($1, 1, 1, $2, $3) returning id", [edition, ids.D1, ids.G1]));
    out.assign_update = await attempt("rota_assignments", run(who, "update public.rota_assignments set duty_id = $2 where id = $1 returning id", [ids.A1, ids.D1]), { row: true });
    out.staff_insert = await attempt("rota_staff_shifts", run(who, "insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, name, kind) values ($1, 2, 600, 700, 'שם לבדיקה', 'lead') returning id", [edition]));
    out.staff_update = await attempt("rota_staff_shifts", run(who, "update public.rota_staff_shifts set note = 'הערה לבדיקה' where id = $1 returning id", [ids.S]), { row: true });
    out.prep_insert = await attempt("rota_prep_tasks", run(who, "insert into public.rota_prep_tasks (edition_id, text, sort) values ($1, 'משימה לבדיקה', 5) returning id", [edition]));
    out.prep_update = await attempt("rota_prep_tasks", run(who, "update public.rota_prep_tasks set done = true where id = $1 returning id", [ids.P]), { row: true });
    out.presence_delete = await attempt("rota_presence", run(who, "delete from public.rota_presence where cohort_id = $1 and day = 1 returning cohort_id", [ids.A]), { row: true });
    out.assign_delete = await attempt("rota_assignments", run(who, "delete from public.rota_assignments where id = $1 returning id", [ids.A1]), { row: true });
    out.staff_delete = await attempt("rota_staff_shifts", run(who, "delete from public.rota_staff_shifts where id = $1 returning id", [ids.S]), { row: true });
    out.prep_delete = await attempt("rota_prep_tasks", run(who, "delete from public.rota_prep_tasks where id = $1 returning id", [ids.P]), { row: true });
    out.duty_delete = await attempt("rota_duties", run(who, "delete from public.rota_duties where id = $1 returning id", [ids.D2]), { row: true });
    out.group_delete = await attempt("rota_groups", run(who, "delete from public.rota_groups where id = $1 returning id", [ids.G2]), { row: true });
    out.cohort_delete = await attempt("rota_cohorts", run(who, "delete from public.rota_cohorts where id = $1 returning id", [ids.N]), { row: true });
    return out;
  }
  const all = (code: string, p: Record<string, string>) => Object.fromEntries(Object.keys(p).map((k) => [k, code]));

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    // the live real edition, as start_edition makes it: Sunday opens 08:30, Thursday closes 19:00
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(ADMIN))]);
    ed.live = Number((await db.query("select public.start_edition($1, '2027-02-14', 510) as id", [LABEL])).rows[0].id);
    await db.query("commit");
    const insert = async (label: string, kind: string, status: string) =>
      Number((await db.query("insert into public.editions (label, kind, status, start_date, first_day_from) values ($1, $2, $3, '2027-02-14', 510) returning id", [label, kind, status])).rows[0].id);
    ed.practice = await insert("תרגול", "practice", "planning");
    ed.demo = await insert("הדגמה", "demo", "planning"); // unseed_gate.sql's label and kind
    ed.archived = await insert("שנה קודמת", "real", "archived");
    ed.archive = await insert("ארכיון מיובא", "archive", "planning"); // the kind alone closes it to logistics
    other = await insert("מחזור אחר", "real", "planning");
    for (const kind of KINDS) {
      for (const role of ROLES) {
        await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3)", [member(kind, role), role, ed[kind]]);
      }
    }
    await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, 'content', $2), ($3, $3, 'logistics', $2)", [OTHER, other, OTHER_LOGISTICS]);
    await db.query("insert into public.members (email, display_name, role, edition_id, active) values ($1, $1, 'logistics', $2, false)", [INACTIVE, ed.live]);
    for (const r of (await db.query("select id, email, edition_id from public.members")).rows) memberId[r.edition_id == null ? `${r.email}*` : r.email] = Number(r.id);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  describe("the shared cases (src/testing/rotaCases.ts), as the Supabase port sends them", () => {
    for (const c of ROTA_CASES) {
      it(`as logistics in a live real edition: ${c.name} → ${c.expect}`, async () => {
        await inTx(async (run) => {
          const ids = await fixture(run, ed.live);
          const before = await state(run, ed.live);
          expect(await perform(run, L, ed.live, ids, c)).toBe(c.expect);
          if (c.expect !== "ok") expect(await state(run, ed.live), "a refusal changes nothing").toEqual(before);
        });
      });
    }
    for (const c of ROTA_ADMIN_CASES) {
      it(`as the edition's admin: ${c.name} → ${c.expect}`, async () => {
        await inTx(async (run) => {
          const ids = await fixture(run, ed.live);
          const before = await state(run, ed.live);
          expect(await perform(run, ED_ADMIN, ed.live, ids, c)).toBe(c.expect);
          if (c.expect !== "ok") expect(await state(run, ed.live), "a refusal changes nothing").toEqual(before);
        });
      });
    }
  });

  describe("who writes and who reads", () => {
    it("the content team reads it all and writes nothing", async () => {
      await inTx(async (run) => {
        const ids = await fuller(run, ed.live);
        const rota = (await val(run, C, "select public.load_rota($1)", [ed.live])) as Record<string, unknown[]>;
        expect([rota.cohorts.length, rota.presence.length, rota.groups.length, rota.duties.length, rota.assignments.length, rota.staff.length, rota.prep.length]).toEqual([2, 1, 2, 2, 1, 1, 1]);
        for (const t of SEVEN) expect(Number(await val(run, C, `select count(*) from public.${t}`)), t).toBeGreaterThan(0);
        const p = await probe(run, C, ed.live, ids);
        expect(p).toEqual(all("forbidden", p));
        expect(await attempt("", run(C, "select public.set_rota_shifts($1, null)", [ed.live]))).toBe("forbidden");
      });
    });

    it("logistics writes every table in a live edition — and nothing in an archived one or an imported archive", async () => {
      await inTx(async (run) => {
        const p = await probe(run, L, ed.live, await fuller(run, ed.live));
        expect(p).toEqual(all("ok", p));
        for (const kind of ["archived", "archive"] as const) {
          const q = await probe(run, member(kind, "logistics"), ed[kind], await fuller(run, ed[kind]));
          expect(q, kind).toEqual(all("forbidden", q));
          // and still reads it
          expect(await val(run, member(kind, "logistics"), "select public.load_rota($1) is not null", [ed[kind]]), kind).toBe(true);
        }
      });
    });

    it("an admin writes in an archive too — the edition's own and a global admin; logistics of a practice week writes there", async () => {
      for (const [who, kind] of [[member("archived", "admin"), "archived"], [member("archive", "admin"), "archive"], [ADMIN, "archived"], [member("practice", "logistics"), "practice"]] as const) {
        await inTx(async (run) => {
          const p = await probe(run, who, ed[kind], await fuller(run, ed[kind]));
          expect(p, `${who} in ${kind}`).toEqual(all("ok", p));
        });
      }
    });

    it("a member of another edition and a stranger see nothing of it and write nothing", async () => {
      await inTx(async (run) => {
        const ids = await fuller(run, ed.live);
        await run(L, "select public.set_rota_contact($1, $2)", [ids.G1, PHONE]);
        for (const who of [OTHER, OTHER_LOGISTICS, STRANGER, INACTIVE]) {
          expect(await val(run, who, "select public.load_rota($1)", [ed.live]), who).toBeNull();
          expect(await val(run, who, "select public.get_rota_contacts($1)", [ed.live]), who).toEqual([]);
          for (const t of [...SEVEN, "rota_group_contacts"]) expect((await run(who, `select * from public.${t}`)).rows, `${who} ${t}`).toEqual([]);
          const p = await probe(run, who, ed.live, ids);
          expect(p, who).toEqual(all("forbidden", p));
          expect(await attempt("", run(who, "select public.set_rota_contact($1, $2)", [ids.G1, PHONE_2])), who).toBe("not_member");
        }
      });
    });

    it("by column only: never an id, a row's edition, a presence row's update, an assignment's source on an update, or the heads' phones", async () => {
      await inTx(async (run) => {
        const ids = await fuller(run, ed.live);
        for (const sql of [
          ["update public.rota_cohorts set edition_id = $2 where id = $1", ids.A, ed.practice],
          ["update public.rota_groups set edition_id = $2 where id = $1", ids.G1, ed.practice],
          ["update public.rota_assignments set source = 'suggested' where id = $1", ids.A1],
          ["update public.rota_presence set day = 2 where cohort_id = $1", ids.A],
          ["update public.rota_prep_tasks set edition_id = $2 where id = $1", ids.P, ed.practice],
          ["insert into public.rota_group_contacts (group_id, head_phone) values ($1, '555 0100 63')", ids.G1],
          ["update public.rota_group_contacts set head_phone = '555 0100 63' where group_id = $1", ids.G1],
          ["delete from public.rota_group_contacts where group_id = $1", ids.G1],
        ] as const) {
          const [q, ...params] = sql;
          expect(await attempt("", run(L, q, params)), q).toBe("forbidden");
        }
        // an id or a duty's name key: generated, never a browser's (refused before any privilege is looked at)
        for (const q of ["insert into public.rota_cohorts (id, edition_id, letter, name) overriding system value values (999999, $1, 'ג', 'מכינה')",
                         "insert into public.rota_duties (edition_id, name, name_key) values ($1, 'תורנות', 'x')"]) {
          expect(await attempt("", run(L, q, [ed.live])), q).not.toBe("ok");
        }
        // and the guards keep a row in its edition whoever writes (the owner, a definer function)
        for (const [t, id] of [["rota_cohorts", ids.A], ["rota_groups", ids.G1], ["rota_duties", ids.D1], ["rota_assignments", ids.A1], ["rota_staff_shifts", ids.S], ["rota_prep_tasks", ids.P]] as const) {
          expect(await attempt(t, run("owner", `update public.${t} set edition_id = $2 where id = $1`, [id, ed.practice])), t).toBe("bad_value");
        }
      });
    });
  });

  describe("the assignments", () => {
    it("the suggestion's apply is one insert of 50 rows — all or nothing: one taken (or gone) refuses every row as `stale`", async () => {
      await inTx(async (run) => {
        const ids = await fixture(run, ed.live);
        for (const n of [3, 4, 5]) ids[`G${n}`] = await num(run, "owner", "insert into public.rota_groups (edition_id, cohort_id, number) values ($1, $2, $3) returning id", [ed.live, ids.A, n]);
        ids.GONE = ids.G5;
        await run("owner", "delete from public.rota_groups where id = $1", [ids.GONE]); // deleted under the screen
        const slots = rotaSlots({ first_day_from: 510, last_day_until: 1140, settings: {} });
        expect(slots).toHaveLength(14); // Thursday has no night
        const free = slots.flatMap((s) => ["G1", "G2", "G3", "G4"].map((g) => ({ ...s, group: g })))
          .filter((x) => !(x.day === 1 && x.shift === 0 && x.group === "G2"))
          .map((x, i) => ({ day: x.day as number, shift: x.shift as number, duty: i % 2 ? "D1" : "D2", group: x.group }));
        const apply = (rows: { day: number; shift: number; duty: string; group: string }[]) =>
          perform(run, L, ed.live, ids, { name: "apply", op: "applySuggestion", args: rows as never, expect: "" });
        const count = () => num(run, "owner", "select count(*) from public.rota_assignments where edition_id = $1", [ed.live]);
        // 49 free rows and one the fixture's G2 holds (Monday morning)
        expect(await apply([...free.slice(0, 49), { day: 1, shift: 0, duty: "D1", group: "G2" }])).toBe("stale");
        expect(await count()).toBe(1);
        // 50 rows, two of them the same group in one shift
        expect(await apply([...free.slice(0, 49), { ...free[0], duty: "D1" }])).toBe("stale");
        // a group deleted meanwhile
        expect(await apply([...free.slice(0, 49), { day: 3, shift: 2, duty: "D1", group: "GONE" }])).toBe("stale");
        // one on Thursday night, a shift the week has not
        expect(await apply([...free.slice(0, 49), { day: 4, shift: 2, duty: "D1", group: "G3" }])).toBe("outside_week");
        expect(await count()).toBe(1);
        expect(await apply(free.slice(0, 50))).toBe("ok");
        expect(await count()).toBe(51);
        expect(await num(run, "owner", "select count(*) from public.rota_assignments where edition_id = $1 and source = 'suggested'", [ed.live])).toBe(50);
        // an edit makes a suggested row a hand's; «ניקוי השיבוצים המוצעים» is one delete and leaves the hands' rows
        const moved = await num(run, "owner", "select id from public.rota_assignments where edition_id = $1 and source = 'suggested' order by id limit 1", [ed.live]);
        await run(L, "update public.rota_assignments set duty_id = case when duty_id = $2 then $3 else $2 end where id = $1", [moved, ids.D1, ids.D2]);
        expect(await val(run, "owner", "select source from public.rota_assignments where id = $1", [moved])).toBe("hand");
        const cleared = await run(L, "delete from public.rota_assignments where edition_id = $1 and source = 'suggested' returning id", [ed.live]);
        expect(cleared.rowCount).toBe(49);
        expect((await run("owner", "select id from public.rota_assignments where edition_id = $1 order by id", [ed.live])).rows.map((r) => Number(r.id))).toEqual([ids.A1, moved]);
      });
    });

    it("a shift the week no longer has: a new row there is refused, one already there stays and may change duty, never move into it", async () => {
      await inTx(async (run) => {
        const ids = await fixture(run, ed.live);
        const sunday = await num(run, L, "insert into public.rota_assignments (edition_id, day, shift, duty_id, group_id) values ($1, 0, 0, $2, $3) returning id", [ed.live, ids.D1, ids.G1]);
        await run("owner", "update public.editions set first_day_from = 870 where id = $1", [ed.live]); // Sunday now opens at 14:30
        const assign = (day: number, shift: number, group = "G1") =>
          perform(run, L, ed.live, ids, { name: "", op: "assign", args: { day: day as Day, shift: shift as ShiftIndex, duty: "D2", group }, expect: "" });
        expect(await assign(0, 0, "G2")).toBe("outside_week");
        expect(await assign(0, 1, "G2")).toBe("ok");
        expect(await attempt("rota_assignments", run(L, "update public.rota_assignments set duty_id = $2 where id = $1 returning id", [sunday, ids.D2]), { row: true })).toBe("ok");
        expect(await val(run, "owner", "select source from public.rota_assignments where id = $1", [sunday])).toBe("hand");
        expect(await attempt("rota_assignments", run(L, "update public.rota_assignments set day = 1, shift = 0 where id = $1 returning id", [ids.A1]))).toBe("ok"); // the same shift: no move
        expect(await attempt("rota_assignments", run(L, "update public.rota_assignments set shift = 1 where id = $1 returning id", [ids.A1]))).toBe("ok");
        expect(await attempt("rota_assignments", run(L, "update public.rota_assignments set day = 0, shift = 0 where id = $1 returning id", [ids.A1]))).toBe("outside_week");
        expect(await attempt("rota_assignments", run(L, "update public.rota_assignments set day = 4, shift = 2 where id = $1 returning id", [ids.A1]))).toBe("outside_week");
        // the cuts moved: Thursday afternoon now starts at the close
        await run(ED_ADMIN, "select public.set_rota_shifts($1, $2::jsonb)", [ed.live, JSON.stringify({ cuts: [1140, 1320], labels: ["בוקר", "צהריים", "לילה"] })]);
        expect(await assign(4, 1)).toBe("outside_week");
        expect(await assign(4, 0)).toBe("ok");
        expect(await num(run, "owner", "select count(*) from public.rota_assignments where id = $1", [sunday])).toBe(1); // never deleted
      });
    });

    it("presence: «כל השבוע» is one insert that skips what is marked; «לא בקמפוס» one delete of the scope", async () => {
      await inTx(async (run) => {
        const ids = await fixture(run, ed.live);
        const slots = rotaSlots({ first_day_from: 510, last_day_until: 1140, settings: {} });
        const mark = (rows: { day: number; shift: number }[]) =>
          run(L, `insert into public.rota_presence (edition_id, cohort_id, day, shift)
                  select $1, $2, r.day, r.shift from jsonb_to_recordset($3::jsonb) as r(day integer, shift integer)
                  on conflict (cohort_id, day, shift) do nothing returning day`, [ed.live, ids.A, JSON.stringify(rows)]);
        expect((await mark(slots.filter((s) => s.day === 1))).rowCount).toBe(3);
        expect((await mark(slots)).rowCount).toBe(11);
        expect((await mark(slots)).rowCount).toBe(0);
        expect((await run(L, "delete from public.rota_presence where cohort_id = $1 and day = 2 returning day", [ids.A])).rowCount).toBe(3);
        expect((await run(L, "delete from public.rota_presence where cohort_id = $1 and day = 3 and shift = 2 returning day", [ids.A])).rowCount).toBe(1);
        expect((await run(L, "delete from public.rota_presence where cohort_id = $1 returning day", [ids.A])).rowCount).toBe(10);
        // and in an archived edition, nothing
        const archived = await fixture(run, ed.archived);
        expect(await attempt("rota_presence", run(member("archived", "logistics"), "insert into public.rota_presence (edition_id, cohort_id, day, shift) values ($1, $2, 1, 0) on conflict do nothing", [ed.archived, archived.A]))).toBe("forbidden");
      });
    });
  });

  describe("the guards", () => {
    it("a staff shift's member: an active member of the edition or of every edition, only with a name — checked when picked, not on every edit", async () => {
      await inTx(async (run) => {
        const ids = await fixture(run, ed.live);
        const add = (member_id: number | null, name: string | null, cohort: number | null = null) =>
          attempt("rota_staff_shifts", run(L, "insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, member_id, name, cohort_id, kind) values ($1, 2, 510, 600, $2, $3, $4, 'lead') returning id",
            [ed.live, member_id, name, cohort]));
        expect(await add(memberId[ED_ADMIN], "מנהל/ת לדוגמה")).toBe("ok");
        expect(await add(memberId[`${ADMIN}*`], "מנהל/ת כללי/ת לדוגמה")).toBe("ok");
        expect(await add(memberId[OTHER], "צוות של מחזור אחר")).toBe("bad_value");
        expect(await add(memberId[INACTIVE], "צוות שלא פעיל/ה")).toBe("bad_value");
        expect(await add(999999, "צוות שלא קיים/ת")).toBe("bad_value");
        expect(await add(memberId[ED_ADMIN], null, ids.N)).toBe("bad_value");
        expect(await add(memberId[ED_ADMIN], null)).toBe("name_required");
        // the member leaves the team: the shift keeps its name and its note may still change; picking them again is refused
        const s = await num(run, L, "insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, member_id, name, kind) values ($1, 3, 510, 600, $2, 'מדריך/ה לדוגמה', 'shift') returning id", [ed.live, memberId[C]]);
        await run("owner", "update public.members set active = false where id = $1", [memberId[C]]);
        expect(await attempt("rota_staff_shifts", run(L, "update public.rota_staff_shifts set note = 'הערה' where id = $1 returning id", [s]), { row: true })).toBe("ok");
        expect(await attempt("rota_staff_shifts", run(L, "update public.rota_staff_shifts set member_id = $2 where id = $1 returning id", [s, memberId[C]]), { row: true })).toBe("ok"); // unchanged
        await run("owner", "update public.rota_staff_shifts set member_id = null where id = $1", [s]);
        expect(await attempt("rota_staff_shifts", run(L, "update public.rota_staff_shifts set member_id = $2 where id = $1 returning id", [s, memberId[C]]), { row: true })).toBe("bad_value");
        // a member's row deleted: the shift stays, by name
        await run("owner", "update public.rota_staff_shifts set member_id = $2 where id = $1", [s, memberId[ED_ADMIN]]);
        await run("owner", "delete from public.members where id = $1", [memberId[ED_ADMIN]]);
        expect((await run("owner", "select member_id, name from public.rota_staff_shifts where id = $1", [s])).rows).toEqual([{ member_id: null, name: "מדריך/ה לדוגמה" }]);
      });
    });

    it("the browser's cleaners hold the guards' rules: a letter, the diets, a head's phone, the shifts, a staff shift's who", async () => {
      await inTx(async (run) => {
        const ids = await fixture(run, ed.live);
        let n = 0;
        // a cohort's letter (each in a cohort of its own name)
        for (const letter of [" ב ", "ב1", "בג", "בגד", "בגדה", "ב ג", "ב ", "  ", "ב　", "ב٣", "ב_"]) {
          const sql = await (async () => {
            const r = await run(L, "insert into public.rota_cohorts (edition_id, letter, name) values ($1, $2, $3) returning letter", [ed.live, letter, `מכינה ${++n}`]).catch((e) => e);
            return r instanceof Error ? { code: portCode(r, "rota_cohorts") } : { ok: r.rows[0].letter };
          })();
          expect(sql, JSON.stringify(letter)).toEqual(ts(() => cleanLetter(letter)));
          if ("ok" in sql) await run("owner", "delete from public.rota_cohorts where letter = $1", [sql.ok]);
        }
        // the diets
        for (const diets of [
          [], [{ label: "  צמחוני ", count: 2 }], [{ label: "טבעוני", count: 0, extra: true }], [{ label: "", count: 1 }], [{ label: "x", count: 1.5 }],
          [{ label: "x", count: -1 }], [{ label: "x", count: 1001 }], [{ label: "x" }], [{ label: "x", count: "2" }], ["צמחוני"], Array.from({ length: 7 }, () => ({ label: "x", count: 1 })),
          Array.from({ length: 6 }, (_, i) => ({ label: `דיאטה ${i}`, count: i })), [{ label: "א".repeat(41), count: 1 }], [{ label: "א".repeat(40), count: 1 }], [{ label: "טל' 1234567", count: 1 }],
        ]) {
          const r = await run(L, "update public.rota_cohorts set diets = $2::jsonb where id = $1 returning diets", [ids.A, JSON.stringify(diets)]).catch((e) => e);
          const sql = r instanceof Error ? { code: portCode(r, "rota_cohorts") } : { ok: r.rows[0].diets };
          expect(sql, JSON.stringify(diets)).toEqual(ts(() => cleanDiets(diets)));
        }
        // a head's phone
        for (const phone of ["555 0100 64", "  555 0100 65 ", "12-345", "", "   ", null, `+972 ${"5".repeat(36)}`, `+972 ${"5".repeat(35)}`, "טלפון 123456"]) {
          const r = await run(L, "select public.set_rota_contact($1, $2)", [ids.G1, phone]).catch((e) => e);
          const stored = (await run("owner", "select head_phone from public.rota_group_contacts where group_id = $1", [ids.G1])).rows[0]?.head_phone ?? null;
          const sql = r instanceof Error ? { code: portCode(r, "") } : { ok: stored };
          expect(sql, JSON.stringify(phone)).toEqual(ts(() => cleanHeadPhone(phone)));
        }
        // the shifts' cuts and names
        const labels = ["בוקר", "אחר צהריים", "לילה"];
        for (const s of [
          { cuts: [840, 1320], labels: ["  בוקר ", "צהריים", "לילה"] }, { cuts: [395, 1825], labels }, { cuts: [390, 1320], labels }, { cuts: [840, 1830], labels },
          { cuts: [840, 840], labels }, { cuts: [841, 1320], labels }, { cuts: [840], labels }, { cuts: [840, 1320, 1400], labels }, { cuts: [840, 1320], labels: ["א", "ב"] },
          { cuts: [840, 1320], labels: ["א", "ב", null] }, { cuts: [840, 1320], labels: ["א", "ב", "ג".repeat(21)] }, { cuts: [840, 1320], labels: ["א", "ב", "טל' 5550100"] },
          { cuts: ["840", 1320], labels }, { cuts: [840.5, 1320], labels }, { labels }, { cuts: [840, 1320] }, { cuts: [840, 1320], labels, extra: 1 },
        ]) {
          await run("owner", "update public.editions set settings = settings - 'rota_shifts' where id = $1", [ed.live]);
          const r = await run(ED_ADMIN, "select public.set_rota_shifts($1, $2::jsonb)", [ed.live, JSON.stringify(s)]).catch((e) => e);
          const stored = await val(run, "owner", "select settings -> 'rota_shifts' from public.editions where id = $1", [ed.live]);
          const sql = r instanceof Error ? { code: portCode(r, "") } : { ok: stored };
          expect(sql, JSON.stringify(s)).toEqual(ts(() => cleanShifts(s as RotaShiftsSetting)));
        }
        // a staff shift's who: a name, a cohort, a member
        for (const who of [
          { member_id: null, name: "שם לדוגמה", cohort_id: null }, { member_id: null, name: "  ", cohort_id: null }, { member_id: null, name: null, cohort_id: ids.N },
          { member_id: null, name: "שם", cohort_id: ids.N }, { member_id: memberId[L], name: "שם", cohort_id: null }, { member_id: memberId[L], name: null, cohort_id: ids.N },
          { member_id: memberId[L], name: null, cohort_id: null }, { member_id: null, name: "נייד 5550100", cohort_id: null },
        ]) {
          const r = await run(L, "insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, member_id, name, cohort_id, kind) values ($1, 1, 600, 700, $2, $3, $4, 'shift') returning member_id, name, cohort_id",
            [ed.live, who.member_id, who.name, who.cohort_id]).catch((e) => e);
          const sql = r instanceof Error ? { code: portCode(r, "rota_staff_shifts") } : { ok: { member_id: r.rows[0].member_id == null ? null : Number(r.rows[0].member_id), name: r.rows[0].name, cohort_id: r.rows[0].cohort_id == null ? null : Number(r.rows[0].cohort_id) } };
          expect(sql, JSON.stringify(who)).toEqual(ts(() => cleanStaffWho(who)));
        }
      });
    });

    it("«התורנויות של אשתקד» go in as they are: one insert of the four, by a logistics member, stored unchanged", async () => {
      await inTx(async (run) => {
        const r = await run(L,
          `insert into public.rota_duties (edition_id, name, description, need_morning, need_afternoon, need_night, min_people, sort)
           select $1, d.name, d.description, d.need_morning, d.need_afternoon, d.need_night, d.min_people, d.sort
             from jsonb_to_recordset($2::jsonb) as d(name text, description text, need_morning integer, need_afternoon integer, need_night integer, min_people integer, sort integer)
           returning name, description, need_morning, need_afternoon, need_night, min_people, sort`, [ed.live, JSON.stringify(LAST_YEAR_DUTIES)]);
        expect(r.rows).toEqual(LAST_YEAR_DUTIES.map((d) => ({ ...d })));
      });
    });

    it("a duty's name is one per edition as names are compared; text is cleaned as the pool cleans it", async () => {
      await inTx(async (run) => {
        const ids = await fixture(run, ed.live);
        expect(await attempt("rota_duties", run(L, "insert into public.rota_duties (edition_id, name) values ($1, 'מִטְבָּח')", [ed.live]))).toBe("rota_duty_exists"); // niqqud
        expect(await attempt("rota_duties", run(L, "insert into public.rota_duties (edition_id, name) values ($1, 'מטבח')", [ed.practice]))).toBe("forbidden"); // not hers
        expect(await attempt("rota_duties", run(member("practice", "logistics"), "insert into public.rota_duties (edition_id, name) values ($1, 'מטבח')", [ed.practice]))).toBe("ok"); // another edition
        const d = await num(run, L, "insert into public.rota_duties (edition_id, name, description) values ($1, '  פינת   קפה ', $2) returning id", [ed.live, "\r\n שורה ראשונה\r\nשורה שנייה \n"]);
        expect((await run("owner", "select name, description from public.rota_duties where id = $1", [d])).rows[0]).toEqual({ name: "פינת קפה", description: "שורה ראשונה\nשורה שנייה" });
        expect(await attempt("rota_duties", run(L, "update public.rota_duties set name = 'נקיון' where id = $1 returning id", [ids.D1]))).toBe("rota_duty_exists");
        expect(await attempt("rota_groups", run(L, "update public.rota_groups set number = 2 where id = $1 returning id", [ids.G1]))).toBe("rota_group_taken");
        expect(await attempt("rota_cohorts", run(L, "update public.rota_cohorts set letter = 'א' where id = $1 returning id", [ids.N]))).toBe("rota_letter_taken");
        const t = await num(run, L, "insert into public.rota_prep_tasks (edition_id, text) values ($1, '  לסדר   את החדר ') returning id", [ed.live]);
        expect((await run("owner", "select text, done, sort, group_id from public.rota_prep_tasks where id = $1", [t])).rows[0]).toEqual({ text: "לסדר את החדר", done: false, sort: 0, group_id: null });
        expect(await attempt("rota_prep_tasks", run(L, "update public.rota_prep_tasks set text = '  ' where id = $1 returning id", [t]))).toBe("name_required");
      });
    });

    it("deleting: a cohort with groups is kept (in_use); without, it takes its presence and staff shifts; a group takes its assignments and head's phone, and leaves its tasks; a duty its assignments", async () => {
      await inTx(async (run) => {
        const ids = await fuller(run, ed.live);
        await run("owner", "insert into public.rota_presence (edition_id, cohort_id, day, shift) values ($1, $2, 1, 0), ($1, $2, 1, 1)", [ed.live, ids.N]);
        await run("owner", "insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, cohort_id, kind) values ($1, 1, 510, 780, $2, 'shift')", [ed.live, ids.N]);
        await run(L, "select public.set_rota_contact($1, $2)", [ids.G1, PHONE]);
        await run("owner", "insert into public.rota_assignments (edition_id, day, shift, duty_id, group_id) values ($1, 2, 0, $2, $3)", [ed.live, ids.D1, ids.G1]);
        expect(await attempt("rota_cohorts", run(L, "delete from public.rota_cohorts where id = $1 returning id", [ids.A]), { row: true })).toBe("in_use");
        expect(await attempt("rota_cohorts", run(L, "delete from public.rota_cohorts where id = $1 returning id", [ids.N]), { row: true })).toBe("ok");
        expect(await num(run, "owner", "select count(*) from public.rota_presence where cohort_id = $1", [ids.N])).toBe(0);
        expect(await num(run, "owner", "select count(*) from public.rota_staff_shifts where cohort_id is not null")).toBe(0);
        expect(await attempt("rota_groups", run(L, "delete from public.rota_groups where id = $1 returning id", [ids.G1]), { row: true })).toBe("ok");
        expect(await num(run, "owner", "select count(*) from public.rota_assignments where group_id = $1", [ids.G1])).toBe(0);
        expect(await num(run, "owner", "select count(*) from public.rota_group_contacts where group_id = $1", [ids.G1])).toBe(0);
        expect((await run("owner", "select text, group_id from public.rota_prep_tasks where id = $1", [ids.P])).rows).toEqual([{ text: "הכנה לדוגמה", group_id: null }]);
        expect(await attempt("rota_duties", run(L, "delete from public.rota_duties where id = $1 returning id", [ids.D2]), { row: true })).toBe("ok");
        expect(await num(run, "owner", "select count(*) from public.rota_assignments where edition_id = $1", [ed.live])).toBe(0);
        expect(await attempt("rota_cohorts", run(L, "delete from public.rota_cohorts where id = $1 returning id", [ids.A]), { row: true })).toBe("in_use"); // G2 still
      });
    });

    it("deleting an edition takes its whole rota — unseed_gate.sql's way (the owner), and a global admin's", async () => {
      for (const who of ["owner", ADMIN]) {
        await inTx(async (run) => {
          const ids = await fuller(run, ed.demo);
          await run("owner", "insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, cohort_id, kind) values ($1, 1, 510, 780, $2, 'lead')", [ed.demo, ids.N]);
          await run("owner", "insert into public.rota_presence (edition_id, cohort_id, day, shift) values ($1, $2, 2, 2)", [ed.demo, ids.N]);
          await run("owner", "insert into public.rota_group_contacts (group_id, head_phone) values ($1, $2)", [ids.G2, PHONE]);
          await run(who, "delete from public.editions where label = 'הדגמה' and kind = 'demo'");
          for (const t of SEVEN) expect(await num(run, "owner", `select count(*) from public.${t} where edition_id = $1`, [ed.demo]), `${who} ${t}`).toBe(0);
          expect(await num(run, "owner", "select count(*) from public.rota_group_contacts"), who).toBe(0);
        });
      }
    });
  });

  describe("load_rota", () => {
    it("is the edition's whole rota in the contract's shape and order — never a phone, nothing of the device's personal keys — and NULL for an edition the caller cannot see", async () => {
      await inTx(async (run) => {
        // written in scrambled order
        const c3 = await num(run, "owner", "insert into public.rota_cohorts (edition_id, letter, name, sort) values ($1, 'ב', 'מכינה לדוגמה ב', 2) returning id", [ed.live]);
        const c2 = await num(run, "owner", "insert into public.rota_cohorts (edition_id, letter, name, sort) values ($1, 'נ', 'מכינה לדוגמה נ', 1) returning id", [ed.live]);
        const c1 = await num(run, "owner", "insert into public.rota_cohorts (edition_id, letter, name, diets, sort) values ($1, 'א', 'מכינה לדוגמה א', '[{\"label\": \"צמחוני\", \"count\": 2}]', 1) returning id", [ed.live]);
        const g = [] as number[];
        for (const [c, n] of [[c3, 2], [c1, 2], [c1, 1], [c2, 1]] as const) {
          g.push(await num(run, "owner", "insert into public.rota_groups (edition_id, cohort_id, number, size, head_name) values ($1, $2, $3, 8, 'ראש/ת קבוצה לדוגמה') returning id", [ed.live, c, n]));
        }
        const d2 = await num(run, "owner", "insert into public.rota_duties (edition_id, name, sort) values ($1, 'נקיון', 2) returning id", [ed.live]);
        const d1 = await num(run, "owner", "insert into public.rota_duties (edition_id, name, description, need_morning, min_people, sort) values ($1, 'מטבח', 'תיאור לדוגמה', 1, 10, 1) returning id", [ed.live]);
        for (const [day, shift, duty, grp] of [[2, 0, d1, g[0]], [1, 1, d2, g[1]], [1, 1, d1, g[2]], [1, 0, d2, g[3]]] as const) {
          await run("owner", "insert into public.rota_assignments (edition_id, day, shift, duty_id, group_id, source) values ($1, $2, $3, $4, $5, 'suggested')", [ed.live, day, shift, duty, grp]);
        }
        await run("owner", "insert into public.rota_presence (edition_id, cohort_id, day, shift) values ($1, $2, 2, 0), ($1, $3, 1, 2), ($1, $3, 1, 0)", [ed.live, c3, c1]);
        await run("owner", "insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, name, kind, note) values ($1, 2, 600, 700, 'צוות ב', 'shift', null), ($1, 1, 700, 800, 'צוות א', 'lead', 'הקפצת מרצה')", [ed.live]);
        await run("owner", "insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, cohort_id, kind) values ($1, 1, 510, 600, $2, 'shift')", [ed.live, c2]);
        await run("owner", "insert into public.rota_prep_tasks (edition_id, text, sort) values ($1, 'הכנה 2', 2), ($1, 'הכנה 1', 1)", [ed.live]);
        for (const grp of g) await run(L, "select public.set_rota_contact($1, $2)", [grp, PHONE]);

        for (const who of [C, L, ED_ADMIN, ADMIN]) {
          const rota = (await val(run, who, "select public.load_rota($1)", [ed.live])) as Record<string, Record<string, unknown>[]>;
          expect(Object.keys(rota).sort(), who).toEqual(Object.keys(EMPTY_ROTA).sort());
          const text = JSON.stringify(rota);
          expect(text, who).not.toContain(PHONE);
          const keys = new Set<string>();
          const walk = (v: unknown): void => {
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
          };
          walk(rota);
          for (const k of [...PERSONAL_KEYS, "head_phone", "phone"]) expect(keys.has(k), `${who}: ${k}`).toBe(false);
          // the shape, record by record (src/data/rota.ts)
          expect(Object.keys(rota.cohorts[0]).sort()).toEqual(["diets", "edition_id", "id", "letter", "name", "sort"]);
          expect(Object.keys(rota.presence[0]).sort()).toEqual(["cohort_id", "day", "shift"]);
          expect(Object.keys(rota.groups[0]).sort()).toEqual(["cohort_id", "edition_id", "head_name", "id", "number", "size"]);
          expect(Object.keys(rota.duties[0]).sort()).toEqual(["description", "edition_id", "id", "min_people", "name", "need_afternoon", "need_morning", "need_night", "sort"]);
          expect(Object.keys(rota.assignments[0]).sort()).toEqual(["day", "duty_id", "edition_id", "group_id", "id", "shift", "source"]);
          expect(Object.keys(rota.staff[0]).sort()).toEqual(["cohort_id", "day", "edition_id", "end_min", "id", "kind", "member_id", "name", "note", "start_min"]);
          expect(Object.keys(rota.prep[0]).sort()).toEqual(["done", "edition_id", "group_id", "id", "sort", "text"]);
          // the order: cohorts by sort, letter; groups by cohort, number; duties by sort; assignments by day, shift, duty, group; staff by day, start; prep by sort
          expect(rota.cohorts.map((c) => c.letter)).toEqual(["א", "נ", "ב"]);
          expect(rota.cohorts[0].diets).toEqual([{ label: "צמחוני", count: 2 }]);
          expect(rota.presence.map((p) => [p.cohort_id, p.day, p.shift])).toEqual([[c3, 2, 0], [c1, 1, 0], [c1, 1, 2]].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]));
          expect(rota.groups.map((x) => [x.cohort_id, x.number])).toEqual([[c3, 2], [c2, 1], [c1, 1], [c1, 2]].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
          expect(rota.duties.map((x) => x.name)).toEqual(["מטבח", "נקיון"]);
          expect(rota.duties[0]).toMatchObject({ description: "תיאור לדוגמה", need_morning: 1, need_afternoon: null, need_night: null, min_people: 10 });
          const order = (a: Record<string, unknown>) => [a.day, a.shift, a.duty_id, a.group_id] as number[];
          expect(rota.assignments.map(order)).toEqual(rota.assignments.map(order).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]));
          expect(rota.assignments.every((a) => a.source === "suggested")).toBe(true);
          expect(rota.staff.map((s) => [s.day, s.start_min, s.name, s.cohort_id])).toEqual([[1, 510, null, c2], [1, 700, "צוות א", null], [2, 600, "צוות ב", null]]);
          expect(rota.prep.map((t) => t.text)).toEqual(["הכנה 1", "הכנה 2"]);
        }
        for (const who of [OTHER, STRANGER, member("practice", "admin")]) expect(await val(run, who, "select public.load_rota($1)", [ed.live]), who).toBeNull();
        expect(await val(run, L, "select public.load_rota($1)", [ed.practice])).toBeNull();
        expect(await val(run, ADMIN, "select public.load_rota(999999)")).toEqual(EMPTY_ROTA); // a global admin «sees» every id; nothing there
      });
    });
  });

  describe("the group heads' phones", () => {
    it("a role × edition-kind matrix: a global admin everywhere; an edition's admin and logistics in a live real edition only; never content", async () => {
      await inTx(async (run) => {
        const group = {} as Record<Kind, number>;
        for (const kind of KINDS) {
          const ids = await fixture(run, ed[kind]);
          group[kind] = ids.G1;
          await run("owner", "insert into public.rota_group_contacts (group_id, head_phone) values ($1, $2)", [ids.G1, PHONE]);
        }
        const seen: string[] = [];
        for (const kind of KINDS) {
          for (const who of [...ROLES.map((r) => member(kind, r)), ADMIN]) {
            const may = who === ADMIN || (kind === "live" && (who === member(kind, "admin") || who === member(kind, "logistics")));
            const contacts = (await val(run, who, "select public.get_rota_contacts($1)", [ed[kind]])) as unknown[];
            expect(contacts, `${who} in ${kind}`).toEqual(may ? [{ group_id: group[kind], head_phone: PHONE }] : []);
            expect((await run(who, "select head_phone from public.rota_group_contacts")).rows.length, `${who} in ${kind}: the table`).toBe(may ? (who === ADMIN ? KINDS.length : 1) : 0);
            expect(await val(run, who, "select app.may_see_rota_contacts($1)", [group[kind]]), `${who} in ${kind}: the rule`).toBe(may);
            expect(await attempt("", run(who, "select public.set_rota_contact($1, $2)", [group[kind], PHONE_2])), `${who} writes in ${kind}`).toBe(may ? "ok" : "rota_contact_hidden");
            if (may) seen.push(`${kind}:${who.split("@")[0]}`);
            await run("owner", "update public.rota_group_contacts set head_phone = $2 where group_id = $1", [group[kind], PHONE]);
          }
        }
        expect(seen.sort()).toEqual(["archive:admin", "archived:admin", "demo:admin", "live:admin", "live:admin.live", "live:logistics.live", "practice:admin"]);
        // nobody of the edition, and no such group
        for (const who of [OTHER, STRANGER]) expect(await attempt("", run(who, "select public.set_rota_contact($1, $2)", [group.live, PHONE_2])), who).toBe("not_member");
        expect(await attempt("", run(L, "select public.set_rota_contact(999999, $1)", [PHONE_2]))).toBe("stale");
      });
    });

    it("get_rota_contacts is the per-group rule, row by row, for everyone — never wider, never another edition's", async () => {
      await inTx(async (run) => {
        const groups: number[] = [];
        for (const e of [...KINDS.map((k) => ed[k]), other]) {
          const ids = await fixture(run, e);
          ids.G3 = await num(run, "owner", "insert into public.rota_groups (edition_id, cohort_id, number) values ($1, $2, 3) returning id", [e, ids.N]);
          await run("owner", "insert into public.rota_group_contacts (group_id, head_phone) values ($1, $3), ($2, $3)", [ids.G1, ids.G3, PHONE]); // G2 has none
          groups.push(ids.G1, ids.G2, ids.G3);
        }
        const everyone = [...KINDS.flatMap((k) => ROLES.map((r) => member(k, r))), ADMIN, OTHER, OTHER_LOGISTICS, STRANGER, INACTIVE];
        for (const who of everyone) {
          const rule = new Set<number>();
          for (const gid of groups) {
            if ((await val(run, who, "select app.may_see_rota_contacts($1)", [gid])) && (await num(run, "owner", "select count(*) from public.rota_group_contacts where group_id = $1", [gid]))) rule.add(gid);
          }
          const got: number[] = [];
          for (const e of [...KINDS.map((k) => ed[k]), other]) {
            const rows = (await val(run, who, "select public.get_rota_contacts($1)", [e])) as { group_id: number; head_phone: string }[];
            const of = (await run("owner", "select id from public.rota_groups where edition_id = $1", [e])).rows.map((r) => Number(r.id));
            for (const r of rows) {
              expect(of, `${who}: a group of another edition`).toContain(r.group_id);
              expect(r.head_phone).toBe(PHONE);
              got.push(r.group_id);
            }
            expect(rows.map((r) => r.group_id), "by group id").toEqual([...rows.map((r) => r.group_id)].sort((a, b) => a - b));
          }
          expect(got.sort((a, b) => a - b), who).toEqual([...rule].sort((a, b) => a - b));
          const direct = (await run(who, "select group_id from public.rota_group_contacts order by group_id")).rows.map((r) => Number(r.group_id));
          expect(direct, `${who}: the policy`).toEqual([...rule].sort((a, b) => a - b));
        }
      });
    });
  });

  describe("the shifts the week has", () => {
    it("app.rota_shift_active ≡ rotaShiftActive (src/domain/rota.ts), value for value, with last year's cuts and moved ones", async () => {
      await inTx(async (run) => {
        const labels = ["בוקר", "אחר צהריים", "לילה"];
        const misses: string[] = [];
        let compared = 0;
        for (const shifts of [null, { cuts: [840, 1320], labels }, { cuts: [395, 1825], labels }, { cuts: [1000, 1140], labels }, { cuts: [510, 870], labels }]) {
          for (const first of [null, 390, 510, 870, 1000, 1350, 1830]) {
            for (const last of [390, 870, 1140, 1350, 1830]) {
              await run("owner", `update public.editions set first_day_from = $2, last_day_until = $3,
                                  settings = case when $4::jsonb is null then settings - 'rota_shifts' else jsonb_set(settings, '{rota_shifts}', $4::jsonb) end where id = $1`,
                [ed.practice, first, last, shifts == null ? null : JSON.stringify(shifts)]);
              const rows = (await run("owner", "select d, s, app.rota_shift_active($1, d, s) as a from generate_series(0, 4) d, generate_series(0, 2) s", [ed.practice])).rows;
              for (const r of rows) {
                const edition = { first_day_from: first, last_day_until: last, settings: shifts == null ? {} : { rota_shifts: shifts as RotaShiftsSetting } };
                const want = rotaShiftActive(edition, r.d as Day, r.s as ShiftIndex);
                compared++;
                if (r.a !== want) misses.push(`cuts ${shifts?.cuts ?? "default"} first ${first} last ${last} day ${r.d} shift ${r.s}: sql ${r.a}, ts ${want}`);
              }
            }
          }
        }
        expect(compared).toBe(5 * 7 * 5 * 15);
        expect(misses).toEqual([]);
        expect(await val(run, "owner", "select app.rota_shift_active(999999, 0, 0)")).toBeNull();
      });
    });
  });

  describe("after the week, and the next year", () => {
    it("purge_edition_private deletes the edition's heads' phones — only its own, counted and logged — and keeps the groups, their heads' names and the rota; a second run deletes nothing", async () => {
      await inTx(async (run) => {
        const ids = await fuller(run, ed.live);
        const there = await fixture(run, other);
        for (const g of [ids.G1, ids.G2]) await run(L, "select public.set_rota_contact($1, $2)", [g, PHONE]);
        await run(ADMIN, "select public.set_rota_contact($1, $2)", [there.G1, PHONE_2]);
        await run("owner", "update public.editions set start_date = (now() at time zone 'Asia/Jerusalem')::date - 7 where id = $1", [ed.live]);
        const before = await state(run, ed.live);
        const report = (await val(run, ADMIN, "select public.purge_edition_private($1, $2)", [ed.live, LABEL])) as Record<string, unknown>;
        expect(report.rota_contacts).toBe(2);
        expect(await num(run, "owner", "select count(*) from public.rota_group_contacts c join public.rota_groups g on g.id = c.group_id where g.edition_id = $1", [ed.live])).toBe(0);
        expect((await run("owner", "select head_phone from public.rota_group_contacts where group_id = $1", [there.G1])).rows).toEqual([{ head_phone: PHONE_2 }]);
        const after = await state(run, ed.live);
        expect(after.slice(0, SEVEN.length), "the rota itself is kept").toEqual(before.slice(0, SEVEN.length));
        expect((await run("owner", "select head_name from public.rota_groups where id = $1", [ids.G1])).rows).toEqual([{ head_name: ROTA_FIXTURE.groups[0].head_name }]);
        const log = (await run("owner", "select detail from public.activity where kind = 'purge' and edition_id = $1", [ed.live])).rows.map((r) => r.detail);
        expect(log).toEqual([expect.objectContaining({ rota_contacts: 2 })]);
        expect(JSON.stringify(log)).not.toContain(PHONE);
        const again = (await val(run, ADMIN, "select public.purge_edition_private($1, $2)", [ed.live, LABEL])) as Record<string, unknown>;
        expect(again.rota_contacts).toBe(0);
        // the heads' phones are gone for good: logistics sees none
        expect(await val(run, L, "select public.get_rota_contacts($1)", [ed.live])).toEqual([]);
      });
    });

    it("start_edition carries exactly the duties, the preparations (no group, not done) and the shifts — and its dry run counts them", async () => {
      await inTx(async (run) => {
        await run("owner", "update public.editions set status = 'archived' where id = $1", [other]); // the live edition is the one carried from
        const ids = await fuller(run, ed.live);
        await run(L, "insert into public.rota_duties (edition_id, name, description, need_morning, need_afternoon, need_night, min_people, sort) values ($1, 'בית מדרש', 'תיאור לדוגמה', 4, 4, 4, 20, 0)", [ed.live]);
        await run(L, "update public.rota_prep_tasks set done = true where id = $1", [ids.P]);
        await run(L, "insert into public.rota_prep_tasks (edition_id, text, sort) values ($1, 'הכנה לדוגמה אחרונה', 9), ($1, 'הכנה לדוגמה ראשונה', 0)", [ed.live]);
        await run(L, "select public.set_rota_contact($1, $2)", [ids.G1, PHONE]);
        const shifts = { cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] };
        await run(ED_ADMIN, "select public.set_rota_shifts($1, $2::jsonb)", [ed.live, JSON.stringify(shifts)]);
        const preview = (await val(run, ADMIN, "select public.start_edition_preview(false)")) as Record<string, unknown>;
        expect(preview).toMatchObject({ carry_from: { id: ed.live }, rota_duties: 3, rota_prep_tasks: 3, rota_shifts: true });
        const duties = "select name, description, need_morning, need_afternoon, need_night, min_people, sort from public.rota_duties where edition_id = $1 order by sort, id";
        const prep = "select text, sort, group_id, done from public.rota_prep_tasks where edition_id = $1 order by sort, id";
        const was = { duties: (await run("owner", duties, [ed.live])).rows, prep: (await run("owner", prep, [ed.live])).rows };
        const next = await num(run, ADMIN, "select public.start_edition('תשפ\"ח', null)");
        expect((await run("owner", duties, [next])).rows).toEqual(was.duties);
        expect((await run("owner", prep, [next])).rows).toEqual(was.prep.map((t) => ({ ...t, group_id: null, done: false })));
        expect(await val(run, "owner", "select settings -> 'rota_shifts' from public.editions where id = $1", [next])).toEqual(shifts);
        for (const t of ["rota_cohorts", "rota_presence", "rota_groups", "rota_assignments", "rota_staff_shifts"]) {
          expect(await num(run, "owner", `select count(*) from public.${t} where edition_id = $1`, [next]), t).toBe(0);
        }
        expect(await num(run, "owner", "select count(*) from public.rota_group_contacts c join public.rota_groups g on g.id = c.group_id where g.edition_id = $1", [next])).toBe(0);
        // last year's rota is as it was
        expect((await run("owner", duties, [ed.live])).rows).toEqual(was.duties);
        // nothing to carry: zero, false, and no key
        await run("owner", "update public.editions set status = 'archived' where id = $1", [next]);
        await run("owner", "update public.editions set status = 'planning' where id = $1", [ed.practice]);
        await run("owner", "update public.editions set kind = 'real' where id = $1", [ed.practice]);
        const empty = (await val(run, ADMIN, "select public.start_edition_preview(false)")) as Record<string, unknown>;
        expect(empty).toMatchObject({ carry_from: { id: ed.practice }, rota_duties: 0, rota_prep_tasks: 0, rota_shifts: false });
        const plain = await num(run, ADMIN, "select public.start_edition('תשפ\"ט', null)");
        expect(await val(run, "owner", "select settings ? 'rota_shifts' from public.editions where id = $1", [plain])).toBe(false);
      });
    });
  });
});
