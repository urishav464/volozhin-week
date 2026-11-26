// Schema v20 — the owner's logistics and presentations feedback (26.11) — in the database, as the roles a browser gets:
//   * a cohort's trainees, its three diet numbers and its staff contact's name: the columns, the guard's ranges and its
//     rule between them (rota_diets_exceed — the browser's checkCohortCounts is the same: the shared cases), the column
//     grants, never a phone in the name;
//   * the duties a cohort helps in (rota_cohort_duties): its policies (the team reads; the writers insert and delete;
//     nobody updates), a row kept in its edition, a cohort with groups keeping its last duty (in_use — deleting the row
//     or the duty), deleting the cohort or the edition taking them, never in Realtime;
//   * a group only in a cohort that helps (cohort_not_helping: inserted or moved there; never for staying) — and (the
//     review) on two connections at once, the last duty taken away against a group given, in either order: the second
//     waits for the first, then in_use or cohort_not_helping, never a cohort with groups and no duty;
//   * «חלוקה לקבוצות» — rota_split_cohort: invoker (the caller's RLS and the guards), one transaction (a refusal leaves the
//     old groups as they were), its refusals in order, the cascades of the groups it replaces;
//   * a cohort's staff contact's phone — rota_cohort_contacts: read only through app.may_see_cohort_contacts (a role ×
//     edition-kind matrix, ≡ the heads' rule), written only by set_rota_contact('cohort', …), never in load_rota, deleted
//     with the cohort and by purge_edition_private (counted with the heads' in `rota_contacts`);
//   * no «אחראי/ת משמרת»: rota_staff_shifts has no kind;
//   * start_edition carrying the cohorts and their duties (tests/sql/rota.test.ts has the whole of it) — never a phone.
// (escort_view's `presentation` is tests/sql/links.test.ts and tests/parity; the upgrade from v19 tests/sql/upgrade.test.ts.)
// Synthetic only: no scanner takes these phones for real ones.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { SCHEMA, adminUrl, dropDatabase, freshDatabase, google } from "./db";

const ADMIN = "admin@example.org"; // every edition
const KINDS = ["live", "practice", "demo", "archived", "archive"] as const;
type Kind = (typeof KINDS)[number];
const ROLES = ["content", "logistics", "admin"] as const;
const member = (kind: Kind, role: (typeof ROLES)[number]) => `${role}.${kind}@example.org`;
const L = member("live", "logistics");
const C = member("live", "content");
const STRANGER = "stranger@example.org";
const LABEL = "תשפ\"ז";
const PHONE = "555 0100 71";
const PHONE_2 = "555 0100 72";

type Run = (who: string, sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

/** "ok", the contract's refusal code, or PostgreSQL's own SQLSTATE. */
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message: string };
    return err.code === "P0001" ? err.message : (err.code ?? "error");
  }
}

describe("v20", () => {
  const dbName = `vw_v20_${process.pid}`;
  let db: pg.Client;
  const ed = {} as Record<Kind, number>;

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
  const num = async (run: Run, who: string, sql: string, params: unknown[] = []) => Number(Object.values((await run(who, sql, params)).rows[0])[0]);
  const val = async (run: Run, who: string, sql: string, params: unknown[] = []) => Object.values((await run(who, sql, params)).rows[0] ?? {})[0];

  /** A cohort «א» with two duties it helps in and one group; a cohort «נ» that helps in none. */
  async function rota(run: Run, edition: number) {
    const a = await num(run, "owner", "insert into public.rota_cohorts (edition_id, letter, name, sort) values ($1, 'א', 'מכינה לבדיקה א', 1) returning id", [edition]);
    const n = await num(run, "owner", "insert into public.rota_cohorts (edition_id, letter, name, sort) values ($1, 'נ', 'מכינה לבדיקה נ', 2) returning id", [edition]);
    const d1 = await num(run, "owner", "insert into public.rota_duties (edition_id, name, need_morning, sort) values ($1, 'בית מדרש', 1, 1) returning id", [edition]);
    const d2 = await num(run, "owner", "insert into public.rota_duties (edition_id, name, need_morning, sort) values ($1, 'מטבח', 1, 2) returning id", [edition]);
    await run("owner", "insert into public.rota_cohort_duties (edition_id, cohort_id, duty_id) values ($1, $2, $3), ($1, $2, $4)", [edition, a, d1, d2]);
    const g = await num(run, "owner", "insert into public.rota_groups (edition_id, cohort_id, number, size) values ($1, $2, 1, 8) returning id", [edition, a]);
    await run("owner", "insert into public.rota_assignments (edition_id, day, shift, duty_id, group_id) values ($1, 1, 0, $2, $3)", [edition, d1, g]);
    return { a, n, d1, d2, g };
  }

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(ADMIN))]);
    ed.live = Number((await db.query("select public.start_edition($1, '2027-02-14', 510) as id", [LABEL])).rows[0].id);
    await db.query("commit");
    const insert = async (label: string, kind: string, status: string) =>
      Number((await db.query("insert into public.editions (label, kind, status, start_date, first_day_from) values ($1, $2, $3, '2027-02-14', 510) returning id", [label, kind, status])).rows[0].id);
    ed.practice = await insert("תרגול", "practice", "planning");
    ed.demo = await insert("הדגמה", "demo", "planning");
    ed.archived = await insert("שנה קודמת", "real", "archived");
    ed.archive = await insert("ארכיון מיובא", "archive", "planning");
    for (const kind of KINDS) for (const role of ROLES) await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3)", [member(kind, role), role, ed[kind]]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  describe("the catalog", () => {
    it("rota_cohorts: the four numbers and the contact's name, nullable, their checks; diets, helps_rota and the staff's kind gone", async () => {
      const cols = (await db.query(
        `select table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable as c from information_schema.columns
          where table_schema = 'public' and table_name in ('rota_cohorts', 'rota_staff_shifts', 'rota_cohort_duties', 'rota_cohort_contacts') order by 1`,
      )).rows.map((r) => r.c as string);
      for (const c of ["rota_cohorts.trainees integer YES", "rota_cohorts.diet_veg integer YES", "rota_cohorts.diet_gf integer YES", "rota_cohorts.diet_both integer YES", "rota_cohorts.contact_name text YES"]) {
        expect(cols).toContain(c);
      }
      for (const gone of ["rota_cohorts.diets", "rota_cohorts.helps_rota", "rota_staff_shifts.kind"]) expect(cols.some((c) => c.startsWith(`${gone} `)), gone).toBe(false);
      expect(cols.filter((c) => c.startsWith("rota_cohort_duties.")).sort()).toEqual(["rota_cohort_duties.cohort_id bigint NO", "rota_cohort_duties.duty_id bigint NO", "rota_cohort_duties.edition_id bigint NO"]);
      expect(cols.filter((c) => c.startsWith("rota_cohort_contacts.")).sort()).toEqual(["rota_cohort_contacts.cohort_id bigint NO", "rota_cohort_contacts.edition_id bigint NO", "rota_cohort_contacts.phone text NO"]);
      const checks = (await db.query("select conname, pg_get_constraintdef(oid) as c from pg_constraint where conrelid = 'public.rota_cohorts'::regclass and contype = 'c' and conname ~ '(trainees|diet|contact)' order by 1")).rows;
      expect(checks.map((r) => r.conname)).toEqual(["rota_cohorts_contact_name_check", "rota_cohorts_diet_both_check", "rota_cohorts_diet_gf_check", "rota_cohorts_diet_veg_check", "rota_cohorts_trainees_check"]);
      // the composite keys keep a row in its edition, the cohort's and the duty's deletes take it
      const fks = (await db.query("select pg_get_constraintdef(oid) as c from pg_constraint where conrelid = 'public.rota_cohort_duties'::regclass and contype = 'f' order by 1")).rows.map((r) => r.c);
      expect(fks).toEqual([
        "FOREIGN KEY (cohort_id, edition_id) REFERENCES rota_cohorts(id, edition_id) ON DELETE CASCADE",
        "FOREIGN KEY (duty_id, edition_id) REFERENCES rota_duties(id, edition_id) ON DELETE CASCADE",
      ]);
    });

    it("the policies: the cohorts' duties read by the team, inserted and deleted by the writers, never updated; the contacts' phones read under their rule, written by no policy", async () => {
      const pol = (await db.query("select tablename, policyname, cmd, coalesce(qual, '') as q, coalesce(with_check, '') as w from pg_policies where tablename in ('rota_cohort_duties', 'rota_cohort_contacts') order by 1, 2")).rows;
      expect(pol).toEqual([
        { tablename: "rota_cohort_contacts", policyname: "rota_cohort_contacts_read", cmd: "SELECT", q: "app.may_see_cohort_contacts(cohort_id)", w: "" },
        { tablename: "rota_cohort_duties", policyname: "rota_cohort_duties_delete", cmd: "DELETE", q: "app.may_write_rota(edition_id)", w: "" },
        { tablename: "rota_cohort_duties", policyname: "rota_cohort_duties_insert", cmd: "INSERT", q: "", w: "app.may_write_rota(edition_id)" },
        { tablename: "rota_cohort_duties", policyname: "rota_cohort_duties_read", cmd: "SELECT", q: "app.can_see_edition(edition_id)", w: "" },
      ]);
      for (const role of ["anon", "authenticated"]) {
        expect((await db.query("select has_table_privilege($1, 'public.rota_cohort_duties', 'UPDATE, TRUNCATE, REFERENCES, TRIGGER') as p", [role])).rows[0].p, role).toBe(false);
        expect((await db.query("select has_table_privilege($1, 'public.rota_cohort_contacts', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as p", [role])).rows[0].p, role).toBe(false);
      }
      expect((await db.query("select has_table_privilege('anon', 'public.rota_cohort_duties', 'SELECT') as a, has_table_privilege('anon', 'public.rota_cohort_contacts', 'SELECT') as b")).rows[0]).toEqual({ a: false, b: false });
    });
  });

  describe("a cohort's numbers and contact's name", () => {
    it("ranges and the rule between them, on insert and on an update of one number (the guard sees the row)", async () => {
      await inTx(async (run) => {
        const ins = (cols: Record<string, unknown>) =>
          code(run(L, `insert into public.rota_cohorts (edition_id, letter, name, ${Object.keys(cols).join(", ")}) values ($1, 'ב', 'מכינה לבדיקה'${Object.keys(cols).map((_, i) => `, $${i + 2}`).join("")})`,
            [ed.live, ...Object.values(cols)]));
        expect(await ins({ trainees: 23, diet_veg: 4, diet_gf: 3, diet_both: 2 })).toBe("ok");
        await run("owner", "delete from public.rota_cohorts where letter = 'ב'");
        expect(await ins({ trainees: 1001 })).toBe("bad_value");
        expect(await ins({ diet_both: -1 })).toBe("bad_value");
        expect(await ins({ diet_veg: 1, diet_both: 2 })).toBe("rota_diets_exceed");
        expect(await ins({ trainees: 5, diet_veg: 4, diet_gf: 3, diet_both: 1 })).toBe("rota_diets_exceed");
        expect(await ins({ contact_name: "קשר 000-000-0071" })).toBe("rota_contact_in_text");
        const c = await num(run, L, "insert into public.rota_cohorts (edition_id, letter, name, trainees, diet_veg, diet_gf, diet_both, contact_name) values ($1, 'ג', 'מכינה לבדיקה ג', 20, 6, 5, 2, '  איש/אשת קשר  לבדיקה ') returning id", [ed.live]);
        expect((await run("owner", "select contact_name from public.rota_cohorts where id = $1", [c])).rows[0].contact_name).toBe("איש/אשת קשר לבדיקה");
        expect(await code(run(L, "update public.rota_cohorts set trainees = 8 where id = $1", [c]))).toBe("rota_diets_exceed"); // 6 + 5 − 2 > 8
        expect(await code(run(L, "update public.rota_cohorts set trainees = null where id = $1", [c]))).toBe("ok"); // TBD holds nothing
        expect(await code(run(L, "update public.rota_cohorts set diet_both = 7 where id = $1", [c]))).toBe("rota_diets_exceed"); // > veg
        expect(await code(run(C, "update public.rota_cohorts set trainees = 30 where id = $1 returning id", [c]))).toBe("ok"); // content: RLS filters it away
        expect((await run("owner", "select trainees from public.rota_cohorts where id = $1", [c])).rows[0].trainees).toBeNull();
      });
    });
  });

  describe("the duties a cohort helps in", () => {
    it("a cohort with groups keeps its last duty — deleting the row, or the duty — while one without groups may help in none", async () => {
      await inTx(async (run) => {
        const r = await rota(run, ed.live);
        expect(await code(run(L, "delete from public.rota_cohort_duties where cohort_id = $1 and duty_id = $2", [r.a, r.d2]))).toBe("ok");
        expect(await code(run(L, "delete from public.rota_cohort_duties where cohort_id = $1 and duty_id = $2", [r.a, r.d1]))).toBe("in_use");
        expect(await code(run(L, "delete from public.rota_duties where id = $1", [r.d1]))).toBe("in_use"); // the duty takes the row with it
        expect(await num(run, "owner", "select count(*) from public.rota_duties where id = $1", [r.d1])).toBe(1);
        // every row in one statement: refused at the last
        await run(L, "insert into public.rota_cohort_duties (edition_id, cohort_id, duty_id) values ($1, $2, $3)", [ed.live, r.a, r.d2]);
        expect(await code(run(L, "delete from public.rota_cohort_duties where cohort_id = $1", [r.a]))).toBe("in_use");
        expect(await num(run, "owner", "select count(*) from public.rota_cohort_duties where cohort_id = $1", [r.a])).toBe(2);
        // its groups gone: it may help in none, and a duty may go
        await run(L, "delete from public.rota_groups where cohort_id = $1", [r.a]);
        expect(await code(run(L, "delete from public.rota_cohort_duties where cohort_id = $1", [r.a]))).toBe("ok");
        expect(await code(run(L, "delete from public.rota_duties where id = $1", [r.d1]))).toBe("ok");
        // never updated
        expect(await code(run(L, "update public.rota_cohort_duties set duty_id = $2 where cohort_id = $1", [r.n, r.d2]))).toBe("42501");
      });
    });

    it("deleting the cohort (no groups) or the whole edition takes its rows — the guard asks nothing then", async () => {
      await inTx(async (run) => {
        const r = await rota(run, ed.demo);
        await run("owner", "insert into public.rota_cohort_duties (edition_id, cohort_id, duty_id) values ($1, $2, $3)", [ed.demo, r.n, r.d1]);
        expect(await code(run(member("demo", "admin"), "delete from public.rota_cohorts where id = $1", [r.n]))).toBe("ok");
        expect(await num(run, "owner", "select count(*) from public.rota_cohort_duties where cohort_id = $1", [r.n])).toBe(0);
        await run("owner", "delete from public.editions where id = $1", [ed.demo]); // unseed_gate.sql's way — «א» still has its group then
        expect(await num(run, "owner", "select count(*) from public.rota_cohort_duties where edition_id = $1", [ed.demo])).toBe(0);
      });
      await inTx(async (run) => {
        await rota(run, ed.practice);
        expect(await code(run(ADMIN, "delete from public.editions where id = $1", [ed.practice]))).toBe("ok"); // a global admin's
      });
    });

    it("a group only in a cohort that helps — inserted or moved there; one already there may change its size", async () => {
      await inTx(async (run) => {
        const r = await rota(run, ed.live);
        expect(await code(run(L, "insert into public.rota_groups (edition_id, cohort_id, number) values ($1, $2, 1)", [ed.live, r.n]))).toBe("cohort_not_helping");
        expect(await code(run(L, "update public.rota_groups set cohort_id = $2 where id = $1", [r.g, r.n]))).toBe("cohort_not_helping");
        expect(await code(run(L, "update public.rota_groups set size = 9 where id = $1", [r.g]))).toBe("ok");
        // a cohort not of this edition: the key's refusal (stale), not this one
        const there = await rota(run, ed.archived);
        expect(await code(run(ADMIN, "insert into public.rota_groups (edition_id, cohort_id, number) values ($1, $2, 5)", [ed.live, there.n]))).toBe("23503");
        await run(L, "insert into public.rota_cohort_duties (edition_id, cohort_id, duty_id) values ($1, $2, $3)", [ed.live, r.n, r.d2]);
        expect(await code(run(L, "insert into public.rota_groups (edition_id, cohort_id, number) values ($1, $2, 1)", [ed.live, r.n]))).toBe("ok");
      });
    });

    it("load_rota carries them, by cohort and duty — the team reads them; another edition's member none", async () => {
      await inTx(async (run) => {
        const r = await rota(run, ed.live);
        for (const who of [C, L]) {
          const v = (await val(run, who, "select public.load_rota($1)", [ed.live])) as { cohortDuties: unknown[] };
          expect(v.cohortDuties, who).toEqual([{ cohort_id: r.a, duty_id: r.d1 }, { cohort_id: r.a, duty_id: r.d2 }]);
        }
        expect((await run(member("practice", "admin"), "select * from public.rota_cohort_duties")).rows).toEqual([]);
        expect((await run(STRANGER, "select * from public.rota_cohort_duties")).rows).toEqual([]);
      });
    });
  });

  // The review: two connections, as two logistics members' browsers at once (READ COMMITTED, as PostgREST runs) — one
  // takes a cohort's last duty away while the other gives it a group (one insert, or «חלוקה לקבוצות»). The group's guard
  // reads the cohort's duties FOR KEY SHARE, so whichever writes second waits for the first to commit and then sees what
  // it did: never a cohort with groups and no duty (before, neither saw the other's row, and both committed).
  describe("a cohort's last duty and a new group at the same moment (two connections — the review)", () => {
    const outcome = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : (e.code ?? "error")));
    const asMember = (c: pg.Client, email: string) =>
      c.query("begin; set local role authenticated; select set_config('request.jwt.claims', $$" + JSON.stringify(google(email)) + "$$, true)");
    /** Whether the connection `pid` waits on a lock (within a second), or the statement `done` settled first. */
    const waitsOnLock = async (pid: number, done: () => boolean) => {
      for (let i = 0; i < 100 && !done(); i++) {
        const w = (await db.query("select wait_event_type as w from pg_stat_activity where pid = $1", [pid])).rows[0]?.w;
        if (w === "Lock") return true;
        await new Promise((res) => setTimeout(res, 10));
      }
      return false;
    };
    type Write = "delete" | "insert" | "split";
    const SQL: Record<Write, string> = {
      delete: "delete from public.rota_cohort_duties where cohort_id = $1",
      insert: "insert into public.rota_groups (edition_id, cohort_id, number, size) select edition_id, id, 1, 8 from public.rota_cohorts where id = $1",
      split: "select public.rota_split_cohort((select edition_id from public.rota_cohorts where id = $1), $1, array[8, 8, 7])",
    };
    /** `first` written and left open on one connection, then `second` on the other; the first commits; what the second got, and what stays. */
    async function race(first: Write, second: Write) {
      const cohort = Number((await db.query("insert into public.rota_cohorts (edition_id, letter, name, trainees) values ($1, 'ר', 'מכינה לבדיקת מרוץ', 23) returning id", [ed.live])).rows[0].id);
      const duty = Number((await db.query("insert into public.rota_duties (edition_id, name, need_morning, sort) values ($1, 'תורנות לבדיקת מרוץ', 1, 9) returning id", [ed.live])).rows[0].id);
      await db.query("insert into public.rota_cohort_duties (edition_id, cohort_id, duty_id) values ($1, $2, $3)", [ed.live, cohort, duty]);
      const url = new URL(adminUrl());
      url.pathname = `/${dbName}`;
      const [c1, c2] = [new pg.Client({ connectionString: url.toString() }), new pg.Client({ connectionString: url.toString() })];
      await c1.connect();
      await c2.connect();
      try {
        await asMember(c1, L);
        await asMember(c2, L);
        await c1.query(SQL[first], [cohort]); // not committed yet
        const pid = Number((await c2.query("select pg_backend_pid() as p")).rows[0].p);
        let settled = false;
        const got = outcome(c2.query(SQL[second], [cohort])).finally(() => (settled = true));
        const waited = await waitsOnLock(pid, () => settled);
        await c1.query("commit");
        const answer = await got;
        await c2.query(answer === "ok" ? "commit" : "rollback");
        const count = async (table: string) => Number((await db.query(`select count(*) as n from public.${table} where cohort_id = $1`, [cohort])).rows[0].n);
        return { waited, answer, groups: await count("rota_groups"), duties: await count("rota_cohort_duties") };
      } finally {
        await c1.end();
        await c2.end();
        await db.query("delete from public.rota_groups where cohort_id = $1", [cohort]);
        await db.query("delete from public.rota_cohorts where id = $1", [cohort]);
        await db.query("delete from public.rota_duties where id = $1", [duty]);
      }
    }

    it("the last duty taken away first: the group waits, then is refused cohort_not_helping — one insert, or «חלוקה לקבוצות»", async () => {
      expect(await race("delete", "insert")).toEqual({ waited: true, answer: "cohort_not_helping", groups: 0, duties: 0 });
      expect(await race("delete", "split")).toEqual({ waited: true, answer: "cohort_not_helping", groups: 0, duties: 0 });
    });

    it("the group given first: taking the last duty away waits, then is refused in_use — one insert, or «חלוקה לקבוצות»", async () => {
      expect(await race("insert", "delete")).toEqual({ waited: true, answer: "in_use", groups: 1, duties: 1 });
      expect(await race("split", "delete")).toEqual({ waited: true, answer: "in_use", groups: 3, duties: 1 });
    });
  });

  describe("«חלוקה לקבוצות» (rota_split_cohort)", () => {
    const split = (run: Run, who: string, edition: number, cohort: number, sizes: unknown) => run(who, "select public.rota_split_cohort($1, $2, $3::integer[]) as v", [edition, cohort, sizes]);

    it("replaces the cohort's groups in one call: numbered 1…n, those sizes, no heads — their assignments and heads' phones gone, their tasks kept without a group", async () => {
      await inTx(async (run) => {
        const r = await rota(run, ed.live);
        await run(L, "select public.set_rota_contact('group', $1, $2)", [r.g, PHONE]);
        const t = await num(run, L, "insert into public.rota_prep_tasks (edition_id, text, group_id) values ($1, 'משימה לבדיקה', $2) returning id", [ed.live, r.g]);
        const v = (await split(run, L, ed.live, r.a, [8, 8, 7])).rows[0].v as Record<string, unknown>[];
        expect(v.map((g) => [g.number, g.size, g.head_name, g.cohort_id])).toEqual([[1, 8, null, r.a], [2, 8, null, r.a], [3, 7, null, r.a]]);
        expect(v.every((g) => Number(g.id) !== r.g)).toBe(true);
        expect((await run("owner", "select number, size from public.rota_groups where cohort_id = $1 order by number", [r.a])).rows).toEqual([{ number: 1, size: 8 }, { number: 2, size: 8 }, { number: 3, size: 7 }]);
        expect(await num(run, "owner", "select count(*) from public.rota_assignments where edition_id = $1", [ed.live])).toBe(0);
        expect(await num(run, "owner", "select count(*) from public.rota_group_contacts")).toBe(0);
        expect((await run("owner", "select text, group_id from public.rota_prep_tasks where id = $1", [t])).rows).toEqual([{ text: "משימה לבדיקה", group_id: null }]);
      });
    });

    it("its refusals in order — the sizes, who writes, the cohort, a cohort that helps — and a refusal leaves the old groups as they were", async () => {
      await inTx(async (run) => {
        const r = await rota(run, ed.live);
        const groups = () => run("owner", "select id, number, size from public.rota_groups where edition_id = $1 order by id", [ed.live]).then((x) => x.rows);
        const before = await groups();
        for (const [sizes, want] of [[[], "bad_value"], [null, "bad_value"], [[201], "bad_value"], [[-1], "bad_value"], [[5, null], "bad_value"], [Array.from({ length: 100 }, () => 1), "bad_value"]] as const) {
          expect(await code(split(run, L, ed.live, r.a, sizes)), JSON.stringify(sizes)).toBe(want);
        }
        expect(await code(split(run, C, ed.live, r.a, [5]))).toBe("forbidden");
        expect(await code(split(run, STRANGER, ed.live, r.a, [5]))).toBe("forbidden");
        expect(await code(split(run, C, ed.live, r.a, []))).toBe("bad_value"); // the sizes first
        expect(await code(split(run, L, ed.live, 999999, [5]))).toBe("stale");
        expect(await code(split(run, L, ed.practice, r.a, [5]))).toBe("forbidden"); // not hers to write
        expect(await code(split(run, L, ed.live, r.n, [5]))).toBe("cohort_not_helping");
        expect(await groups()).toEqual(before);
        // archived: logistics may not, its admin may
        const old = await rota(run, ed.archived);
        expect(await code(split(run, member("archived", "logistics"), ed.archived, old.a, [5]))).toBe("forbidden");
        expect(await code(split(run, member("archived", "admin"), ed.archived, old.a, [5]))).toBe("ok");
        expect(await code(split(run, ADMIN, ed.live, r.a, [4, 4]))).toBe("ok");
      });
    });
  });

  describe("a cohort's staff contact's phone (rota_cohort_contacts)", () => {
    it("a role × edition-kind matrix — the heads' rule: a global admin everywhere; an edition's admin and logistics in a live real edition only; never content", async () => {
      await inTx(async (run) => {
        const cohort = {} as Record<Kind, number>;
        for (const kind of KINDS) {
          cohort[kind] = await num(run, "owner", "insert into public.rota_cohorts (edition_id, letter, name) values ($1, 'ק', 'מכינה לבדיקה') returning id", [ed[kind]]);
          await run("owner", "insert into public.rota_cohort_contacts (cohort_id, edition_id, phone) values ($1, $2, $3)", [cohort[kind], ed[kind], PHONE]);
        }
        for (const kind of KINDS) {
          for (const who of [...ROLES.map((r) => member(kind, r)), ADMIN]) {
            const may = who === ADMIN || (kind === "live" && (who === member(kind, "admin") || who === member(kind, "logistics")));
            const rows = (await val(run, who, "select public.get_rota_contacts($1)", [ed[kind]])) as unknown[];
            expect(rows, `${who} in ${kind}`).toEqual(may ? [{ cohort_id: cohort[kind], phone: PHONE }] : []);
            expect(await val(run, who, "select app.may_see_cohort_contacts($1)", [cohort[kind]]), `${who} in ${kind}: the rule`).toBe(may);
            expect((await run(who, "select phone from public.rota_cohort_contacts")).rows.length, `${who} in ${kind}: the table`).toBe(may ? (who === ADMIN ? KINDS.length : 1) : 0);
            expect(await code(run(who, "select public.set_rota_contact('cohort', $1, $2)", [cohort[kind], PHONE_2])), `${who} writes in ${kind}`).toBe(may ? "ok" : "rota_contact_hidden");
            await run("owner", "update public.rota_cohort_contacts set phone = $2 where cohort_id = $1", [cohort[kind], PHONE]);
          }
        }
        expect(await code(run(STRANGER, "select public.set_rota_contact('cohort', $1, $2)", [cohort.live, PHONE_2]))).toBe("not_member");
        expect(await code(run(L, "select public.set_rota_contact('cohort', 999999, $1)", [PHONE_2]))).toBe("stale");
        expect(await code(run(L, "select public.set_rota_contact('nobody', $1, $2)", [cohort.live, PHONE_2]))).toBe("bad_value");
        expect(await code(run(L, "select public.set_rota_contact(null, $1, $2)", [cohort.live, PHONE_2]))).toBe("bad_value");
        // the old signature is gone
        expect(await code(run(L, "select public.set_rota_contact($1::bigint, $2::text)", [cohort.live, PHONE_2]))).toBe("42883");
      });
    });

    it("written only by the function — the edition from the cohort, blank deletes, six digits — never in load_rota; the cohort's delete takes it", async () => {
      await inTx(async (run) => {
        const r = await rota(run, ed.live);
        await run(L, "select public.set_rota_contact('cohort', $1, $2)", [r.n, `  ${PHONE} `]);
        expect((await run("owner", "select edition_id, phone from public.rota_cohort_contacts where cohort_id = $1", [r.n])).rows).toEqual([{ edition_id: String(ed.live), phone: PHONE }]);
        expect(await code(run(L, "select public.set_rota_contact('cohort', $1, '12-345')", [r.n]))).toBe("bad_phone");
        for (const sql of ["insert into public.rota_cohort_contacts (cohort_id, edition_id, phone) values ($1, $2, '555 0100 79')", "update public.rota_cohort_contacts set phone = '555 0100 79' where cohort_id = $1", "delete from public.rota_cohort_contacts where cohort_id = $1"]) {
          expect(await code(run(L, sql, sql.startsWith("insert") ? [r.n, ed.live] : [r.n])), sql).toBe("42501");
        }
        for (const who of [C, L]) expect(JSON.stringify(await val(run, who, "select public.load_rota($1)", [ed.live])), who).not.toContain(PHONE);
        await run(L, "select public.set_rota_contact('cohort', $1, '  ')", [r.n]);
        expect(await num(run, "owner", "select count(*) from public.rota_cohort_contacts")).toBe(0);
        await run(L, "select public.set_rota_contact('cohort', $1, $2)", [r.n, PHONE]);
        await run(L, "delete from public.rota_cohorts where id = $1", [r.n]);
        expect(await num(run, "owner", "select count(*) from public.rota_cohort_contacts")).toBe(0);
      });
    });

    it("purge_edition_private deletes them — counted with the heads' in rota_contacts, logged without a digit — and never another edition's", async () => {
      await inTx(async (run) => {
        const r = await rota(run, ed.live);
        const there = await num(run, "owner", "insert into public.rota_cohorts (edition_id, letter, name) values ($1, 'ק', 'מכינה לבדיקה') returning id", [ed.archived]);
        await run(L, "select public.set_rota_contact('group', $1, $2)", [r.g, PHONE]);
        await run(L, "select public.set_rota_contact('cohort', $1, $2)", [r.a, PHONE]);
        await run(L, "select public.set_rota_contact('cohort', $1, $2)", [r.n, PHONE]);
        await run(ADMIN, "select public.set_rota_contact('cohort', $1, $2)", [there, PHONE_2]);
        await run("owner", "update public.editions set start_date = (now() at time zone 'Asia/Jerusalem')::date - 7 where id = $1", [ed.live]);
        const report = (await val(run, ADMIN, "select public.purge_edition_private($1, $2)", [ed.live, LABEL])) as Record<string, unknown>;
        expect(report.rota_contacts).toBe(3);
        expect((await run("owner", "select cohort_id from public.rota_cohort_contacts")).rows.map((x) => Number(x.cohort_id))).toEqual([there]);
        const log = (await run("owner", "select detail from public.activity where kind = 'purge' and edition_id = $1", [ed.live])).rows.map((x) => x.detail);
        expect(log).toEqual([expect.objectContaining({ rota_contacts: 3 })]);
        expect(JSON.stringify(log)).not.toContain(PHONE);
        // the names stay: the contact's name is the team's
        expect(await num(run, "owner", "select count(*) from public.rota_cohorts where edition_id = $1", [ed.live])).toBe(2);
        expect(((await val(run, ADMIN, "select public.purge_edition_private($1, $2)", [ed.live, LABEL])) as Record<string, unknown>).rota_contacts).toBe(0);
      });
    });
  });

  describe("the next year", () => {
    it("start_edition carries the cohorts and their duties — never a cohort's phone, numbers or groups; the dry run counts them", async () => {
      await inTx(async (run) => {
        const r = await rota(run, ed.live);
        await run(L, "update public.rota_cohorts set trainees = 20, diet_veg = 2, diet_gf = 1, diet_both = 0, contact_name = 'איש/אשת קשר לבדיקה', can_drive = true where id = $1", [r.a]);
        await run(L, "select public.set_rota_contact('cohort', $1, $2)", [r.a, PHONE]);
        expect((await val(run, ADMIN, "select public.start_edition_preview(false)")) as Record<string, unknown>).toMatchObject({ carry_from: { id: ed.live }, rota_cohorts: 2, rota_cohort_duties: 2 });
        const next = await num(run, ADMIN, "select public.start_edition('תשפ\"ח', null)");
        expect((await run("owner", "select letter, name, sort, can_drive, trainees, diet_veg, diet_gf, diet_both, contact_name from public.rota_cohorts where edition_id = $1 order by sort", [next])).rows).toEqual([
          { letter: "א", name: "מכינה לבדיקה א", sort: 1, can_drive: true, trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null },
          { letter: "נ", name: "מכינה לבדיקה נ", sort: 2, can_drive: false, trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null },
        ]);
        const helps = "select c.letter || ':' || d.name as x from public.rota_cohort_duties x join public.rota_cohorts c on c.id = x.cohort_id join public.rota_duties d on d.id = x.duty_id where x.edition_id = $1 order by 1";
        expect((await run("owner", helps, [next])).rows.map((x) => x.x)).toEqual(["א:בית מדרש", "א:מטבח"]);
        // every carried row the new edition's own
        expect(await num(run, "owner", "select count(*) from public.rota_cohort_duties x join public.rota_duties d on d.id = x.duty_id where x.edition_id = $1 and d.edition_id <> $1", [next])).toBe(0);
        expect(await num(run, "owner", "select count(*) from public.rota_cohort_contacts where edition_id = $1", [next])).toBe(0);
        expect(await num(run, "owner", "select count(*) from public.rota_groups where edition_id = $1", [next])).toBe(0);
      });
    });
  });

  describe("the file run again", () => {
    it("keeps what v20 wrote — the numbers, the duties a cohort helps in, a contact's phone — and changes nothing", async () => {
      const r = await (async () => {
        await db.query("begin");
        const asOwner: Run = (_who, sql, params = []) => db.query(sql, params); // committed, as the owner: the file runs on it
        const ids = await rota(asOwner, ed.live);
        await db.query("update public.rota_cohorts set trainees = 20, diet_veg = 2, diet_gf = 1, diet_both = 1, contact_name = 'איש/אשת קשר לבדיקה' where id = $1", [ids.a]);
        await db.query("insert into public.rota_cohort_contacts (cohort_id, edition_id, phone) values ($1, $2, $3)", [ids.a, ed.live, PHONE]);
        await db.query("commit");
        return ids;
      })();
      const snap = async () => ({
        cohorts: (await db.query("select id, trainees, diet_veg, diet_gf, diet_both, contact_name from public.rota_cohorts where edition_id = $1 order by id", [ed.live])).rows,
        duties: (await db.query("select cohort_id, duty_id from public.rota_cohort_duties where edition_id = $1 order by 1, 2", [ed.live])).rows,
        contacts: (await db.query("select cohort_id, phone from public.rota_cohort_contacts order by 1")).rows,
      });
      const before = await snap();
      expect(before.duties).toHaveLength(2);
      await db.query(SCHEMA);
      expect(await snap()).toEqual(before);
      expect(r.a).toBeGreaterThan(0);
    });
  });
});
