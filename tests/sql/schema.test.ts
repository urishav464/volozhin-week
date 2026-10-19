// supabase/schema.sql against a real PostgreSQL 16, as the roles a browser
// gets. Runs twice: under the old Supabase defaults (public roles granted
// everything) and the new ones (nothing) — the schema's own REVOKE/GRANT list
// must produce the same result under both.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SCHEMA, as, dropDatabase, emailPassword, freshDatabase, google, linkedPassword, sqlstate, type Regime } from "./db";

const ADMIN = "Admin.Person@Example.org"; // mixed case on purpose: stored and matched lower-case
const CONTENT = "content.person@example.org";
const STRANGER = "stranger@example.org";
const OTHER_YEAR = "other.year@example.org";
const EDITION_ADMIN = "edition.admin@example.org";
const PEER_ADMIN = "peer.admin@example.org";

// What each API role may execute — the complete list. A new browser-callable
// function means updating this on purpose.
const ANON_FUNCTIONS = ["ping"];
const AUTH_PUBLIC_FUNCTIONS = [
  "close_lesson", "load_week", "move_lesson", "ping", "propose", "reopen_lesson", "reshape",
  "schema_version", "set_pitch", "start_edition", "team", "unpropose", "update_lesson", "whoami",
];
const AUTH_APP_FUNCTIONS = ["can_see_edition", "is_global_admin", "is_member", "my_email", "my_member_id", "my_role"];

describe.each<Regime>(["old", "new"])("schema under %s Supabase defaults", (regime) => {
  const dbName = `vw_schema_${regime}_${process.pid}`;
  let db: pg.Client;
  let edition: number;
  let otherEdition: number;

  beforeAll(async () => {
    db = await freshDatabase(dbName, regime);
    await db.query(SCHEMA);
    await db.query(SCHEMA); // idempotent: a second run must not fail
    await db.query("select app.add_admin($1)", [ADMIN]);
    await db.query("select app.add_admin($1)", [ADMIN]); // and neither must a second add
    const r = await db.query("insert into public.editions (label) values ('תשפ\"ז') returning id");
    edition = Number(r.rows[0].id);
    await db.query(
      "insert into public.members (email, display_name, role, edition_id) values ($1, 'חניך בדיקה', 'content', $2)",
      [CONTENT, edition],
    );
    otherEdition = Number((await db.query("insert into public.editions (label) values ('תשפ\"ו') returning id")).rows[0].id);
    await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, 'שנה אחרת', 'content', $2)", [OTHER_YEAR, otherEdition]);
    await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, 'מנהל/ת מחזור', 'admin', $2)", [EDITION_ADMIN, edition]);
    await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, 'מנהל/ת נוסף/ת', 'admin', $2)", [PEER_ADMIN, edition]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  describe("catalog", () => {
    it("has RLS enabled on every table in public", async () => {
      const r = await db.query(`
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
      expect(r.rows.map((x) => x.relname)).toEqual([]);
    });

    it("gives anon no privilege on any table, view or sequence", async () => {
      const r = await db.query(`
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
           and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                or (c.relkind = 'S' and has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE')))`);
      expect(r.rows).toEqual([]);
    });

    it("lets each API role execute exactly the listed functions", async () => {
      const exec = async (role: string, schema: string) =>
        (
          await db.query(
            `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = $2 and has_function_privilege($1, p.oid, 'EXECUTE') order by 1`,
            [role, schema],
          )
        ).rows.map((x) => x.proname);
      expect(await exec("anon", "public")).toEqual(ANON_FUNCTIONS);
      expect(await exec("anon", "app")).toEqual([]);
      expect(await exec("authenticated", "public")).toEqual(AUTH_PUBLIC_FUNCTIONS);
      expect(await exec("authenticated", "app")).toEqual(AUTH_APP_FUNCTIONS);
    });

    it("pins search_path on every SECURITY DEFINER function", async () => {
      const r = await db.query(`
        select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'app') and p.prosecdef
           and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
      expect(r.rows).toEqual([]);
    });
  });

  describe("anon (the publishable key, no sign-in)", () => {
    it("can ping and nothing else", async () => {
      await as(db, "anon", null, async (q) => {
        expect((await q("select public.ping() as v")).rows[0].v).toBe("ok");
        expect(await sqlstate(q("select * from public.members"))).toBe("42501");
        expect(await sqlstate(q("select * from public.editions"))).toBe("42501");
        expect(await sqlstate(q("select public.whoami()"))).toBe("42501");
        expect(await sqlstate(q("select app.add_admin('x@example.org')"))).toBe("42501");
      });
    });
  });

  describe("a Google account that is not on the list", () => {
    it("sees zero rows and is told so", async () => {
      await as(db, "authenticated", google(STRANGER), async (q) => {
        expect((await q("select public.whoami() as w")).rows[0].w.status).toBe("not_member");
        expect((await q("select * from public.members")).rows).toEqual([]);
        expect((await q("select * from public.editions")).rows).toEqual([]);
        expect(await sqlstate(q("select * from public.team($1)", [edition]))).toBe("42501");
        expect(await sqlstate(q("insert into public.editions (label) values ('x')"))).toBe("42501");
        expect(await sqlstate(q("select app.add_admin('x@example.org')"))).toBe("42501");
      });
    });
  });

  describe("a listed address signed in WITHOUT Google", () => {
    it("is refused", async () => {
      await as(db, "authenticated", emailPassword(ADMIN.toLowerCase()), async (q) => {
        expect((await q("select public.whoami() as w")).rows[0].w.status).toBe("wrong_provider");
        expect((await q("select * from public.members")).rows).toEqual([]);
      });
    });
  });

  describe("the admin", () => {
    it("is recognised case-insensitively and manages members", async () => {
      await as(db, "authenticated", google(ADMIN), async (q) => {
        const w = (await q("select public.whoami() as w")).rows[0].w;
        expect(w.status).toBe("ok");
        expect(w.global_admin).toBe(true);
        expect(w.email).toBe(ADMIN.toLowerCase());
        expect(w.schema_version).toBe(3);
        expect((await q("select email from public.members order by email")).rows.map((r) => r.email)).toEqual(
          [ADMIN.toLowerCase(), CONTENT, EDITION_ADMIN, OTHER_YEAR, PEER_ADMIN].sort(),
        );
        expect((await q("select label from public.editions")).rows).toHaveLength(2);
        await q("insert into public.members (email, role, edition_id) values ('new.one@example.org', 'logistics', $1)", [edition]);
        expect(
          await sqlstate(q("insert into public.members (email, role) values ('Upper@Example.org', 'content')")),
        ).toBe("23514"); // stored lower-case only
      });
    });
  });

  describe("a content member", () => {
    it("sees only their own row, the team without e-mails, and cannot manage", async () => {
      await as(db, "authenticated", google(CONTENT), async (q) => {
        const w = (await q("select public.whoami() as w")).rows[0].w;
        expect(w.status).toBe("ok");
        expect(w.global_admin).toBe(false);
        expect(w.memberships).toMatchObject([{ edition_id: edition, role: "content" }]);
        expect(typeof w.memberships[0].member_id).toBe("number");
        expect((await q("select email from public.members")).rows.map((r) => r.email)).toEqual([CONTENT]);
        const team = await q("select * from public.team($1)", [edition]);
        expect(team.rows).toHaveLength(4); // the global admin, this member, the two edition admins
        expect(Object.keys(team.rows[0]).sort()).toEqual(["display_name", "gender", "id", "role"]);
        expect((await q("select id from public.editions")).rows.map((r) => Number(r.id))).toEqual([edition]);
        expect(
          await sqlstate(q("insert into public.members (email, role, edition_id) values ('x@example.org', 'content', $1)", [edition])),
        ).toBe("42501");
        expect(await sqlstate(q("update public.members set role = 'admin' where email = $1", [CONTENT]))).toBe("ok");
        expect((await q("select role from public.members where email = $1", [CONTENT])).rows[0].role).toBe("content");
        expect(await sqlstate(q("insert into public.editions (label) values ('x')"))).toBe("42501");
      });
    });
  });

  describe("a password session on an account that also has Google linked", () => {
    it("is refused like any non-Google sign-in", async () => {
      await as(db, "authenticated", linkedPassword(ADMIN.toLowerCase()), async (q) => {
        expect((await q("select public.whoami() as w")).rows[0].w.status).toBe("wrong_provider");
        expect((await q("select * from public.members")).rows).toEqual([]);
      });
    });
  });

  describe("editions are walled off from each other", () => {
    it("shows last year's member nothing of this year", async () => {
      await as(db, "authenticated", google(OTHER_YEAR), async (q) => {
        expect((await q("select id from public.editions")).rows.map((r) => Number(r.id))).toEqual([otherEdition]);
        expect((await q("select email from public.members")).rows.map((r) => r.email)).toEqual([OTHER_YEAR]);
        expect(await sqlstate(q("select * from public.team($1)", [edition]))).toBe("42501");
        expect((await q("select public.whoami() as w")).rows[0].w.memberships).toMatchObject([{ edition_id: otherEdition, role: "content" }]);
      });
    });
  });

  describe("an edition's admin", () => {
    it("manages that edition's team, but cannot mint, demote or delete an admin, or reach another edition", async () => {
      await as(db, "authenticated", google(EDITION_ADMIN), async (q) => {
        expect((await q("select email from public.members where edition_id = $1 order by email", [otherEdition])).rows).toEqual([]);
        expect(await sqlstate(q("insert into public.members (email, role, edition_id) values ('n@example.org', 'logistics', $1)", [edition]))).toBe("ok");
        expect(await sqlstate(q("insert into public.members (email, role, edition_id) values ('x@example.org', 'admin', $1)", [edition]))).toBe("42501");
        expect(await sqlstate(q("insert into public.members (email, role) values ('y@example.org', 'content')"))).toBe("42501");
        expect(await sqlstate(q("insert into public.members (email, role, edition_id) values ('z@example.org', 'content', $1)", [otherEdition]))).toBe("42501");
        expect(await sqlstate(q("update public.members set role = 'admin' where email = $1", [CONTENT]))).toBe("42501");
        expect((await q("update public.members set role = 'content' where email = $1 returning id", [PEER_ADMIN])).rows).toEqual([]);
        expect((await q("delete from public.members where email = $1 returning id", [PEER_ADMIN])).rows).toEqual([]);
        expect((await q("update public.editions set label = 'x' returning id")).rows).toEqual([]);
      });
    });
  });

  describe("authenticated's table privileges", () => {
    it("are SELECT everywhere it reads, writes only on editions/members, and never TRUNCATE/REFERENCES/TRIGGER", async () => {
      const grants = (
        await db.query(`
          select table_name, string_agg(privilege_type, ',' order by privilege_type) as p
            from information_schema.role_table_grants
           where grantee = 'authenticated' and table_schema = 'public'
           group by table_name order by table_name`)
      ).rows;
      for (const g of grants) {
        if (g.table_name === "editions" || g.table_name === "members") expect(g.p, g.table_name).toBe("DELETE,INSERT,SELECT,UPDATE");
        else expect(g.p, g.table_name).toBe("SELECT");
      }
      expect(grants.map((g) => g.table_name)).toContain("lessons");
    });
  });
});
