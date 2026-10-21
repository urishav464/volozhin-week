// supabase/schema.sql against a real PostgreSQL 16, as the roles a browser
// gets. Runs twice: under the old Supabase defaults (public roles granted
// everything) and the new ones (nothing) — the schema's own REVOKE/GRANT list
// must produce the same result under both.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { REALTIME_TABLES } from "../../src/data/realtime";
import { SCHEMA, as, dropDatabase, emailPassword, freshDatabase, google, linkedPassword, sqlstate, type Regime } from "./db";

const ADMIN = "Admin.Person@Example.org"; // mixed case on purpose: stored and matched lower-case
const CONTENT = "content.person@example.org";
const STRANGER = "stranger@example.org";
const OTHER_YEAR = "other.year@example.org";
const EDITION_ADMIN = "edition.admin@example.org";
const PEER_ADMIN = "peer.admin@example.org";

// What each API role may execute — the complete list. A new browser-callable
// function means updating this on purpose. v6 (the speaker pool) added
// answer_handover … vet_speakers to the public list, and may_see_contacts —
// the contacts policy's predicate, which the policy runs as the browser's role.
// v7 (from placement to arrival) added decide_payments, get_transport_details,
// mark_confirm_sent, set_confirm_template, set_duty_phrases, set_escort,
// set_paid, set_payment, set_sources and set_transport_details, and
// may_see_transport — the transport details policy's predicate.
// v8 (outputs and knowledge) added get_contacts_for — the outputs' phones, in
// one invoker call under the contacts policy.
// v9 (links without an account, מכריכה לכריכה) gave anon — for the first time —
// the six link functions, keyed by a token alone (tests/sql/links.test.ts), and
// the signed-in roles issue_link, revoke_link, load_kk and the kk writes.
// v10 (sources and the reader) added register_source_file, remove_source_file,
// set_reader_cover and set_reader_headers, and the three predicates the
// policies on storage.objects call as the browser's role: may_read_source,
// may_upload_source, may_delete_source (tests/sql/sources.test.ts).
// v11 (memorial times and logistics) added the fallen's writes (save_fallen,
// delete_fallen), their families' contacts (get_fallen_contacts — invoker,
// set_fallen_contacts), the memorial slots and plans (add/remove_memorial_slot,
// add/update/place/delete_memorial_plan, set_memorial_policy), the logistics
// screen's transports (get_transports_for — invoker), and the two policies'
// predicates, may_see_fallen and may_see_fallen_contacts (tests/sql/memorial.test.ts).
// v12 had two parts. The import of 5786 added import_commit and import_lookup — a global admin's, each
// checking it (tests/sql/import.test.ts) — and get_import_note (invoker: lesson_import_notes under the
// transport details' policy); every helper of the import stays in app, executable by no API role.
// After the week added «איך עבר» — save_lesson_review, load_reviews (invoker),
// speaker_reviews — the summary's edition_returning, purge_edition_private and
// start_edition_preview (the dry run); start_edition took a new argument
// (tests/sql/after.test.ts). No new app.* function is a browser's to run.
const ANON_FUNCTIONS = ["escort_pickup", "escort_tick", "escort_view", "kk_form", "kk_signup", "ping", "schedule_view"];
const AUTH_PUBLIC_FUNCTIONS = [
  "add_memorial_plan", "add_memorial_slot", "answer_handover", "claim_speaker", "close_lesson", "create_speaker", "decide_payments", "delete_fallen",
  "delete_memorial_plan", "edition_returning", "get_contacts_for", "get_fallen_contacts", "get_import_note", "get_speaker_contacts", "get_transport_details", "get_transports_for", "hand_over",
  "import_commit", "import_lookup", "issue_link", "kk_add_group", "kk_delete_group", "kk_place", "kk_set_window", "kk_unplace",
  "kk_update_group", "load_kk", "load_reviews", "load_week", "mark_confirm_sent", "move_lesson", "ping", "place_memorial_plan", "propose", "purge_edition_private",
  "register_source_file",
  "remove_memorial_slot", "remove_source_file", "reopen_lesson", "reshape", "revoke_link", "save_fallen", "save_lesson_review", "schema_version", "set_approach_status",
  "set_availability", "set_book_order", "set_confirm_template", "set_default_room", "set_duty_phrases", "set_escort", "set_fallen_contacts",
  "set_memorial_policy", "set_my_profile", "set_paid", "set_payment", "set_pitch", "set_reader_cover", "set_reader_headers",
  "set_sources", "set_speaker_contacts", "set_transport_details", "speaker_activity", "speaker_history",
  "speaker_matches", "speaker_reviews", "start_edition", "start_edition_preview", "team", "unpropose", "update_lesson", "update_memorial_plan", "update_speaker", "vet_speakers", "whoami",
];
const AUTH_APP_FUNCTIONS = [
  "can_see_edition", "is_global_admin", "is_member", "may_delete_source", "may_read_source", "may_see_contacts", "may_see_fallen", "may_see_fallen_contacts",
  "may_see_transport", "may_upload_source", "my_email", "my_member_id", "my_role", "name_key",
];

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

    it("publishes to Realtime exactly the tables the grid listens to — no contacts, members, log, transport details, notes or snapshots", async () => {
      const rows = (
        await db.query(
          "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1",
        )
      ).rows.map((r) => r.tablename);
      expect(rows).toEqual([...REALTIME_TABLES].sort());
    });

    it("takes personal-data tables back out of Realtime if someone published them by hand", async () => {
      await db.query(
        "alter publication supabase_realtime add table public.speaker_contacts, public.members, public.roster, public.transport_details, public.export_snapshots, public.notes, public.milestones, " +
          "public.share_links, public.share_link_hits, public.escort_ticks, public.kk_tracks, public.kk_groups, public.kk_leaders, public.kk_signups, public.book_orders, public.source_files, " +
          "public.fallen, public.fallen_contacts, public.memorial_plans, public.lesson_reviews, public.lesson_import_notes",
      );
      await db.query(SCHEMA);
      const rows = (
        await db.query(
          "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1",
        )
      ).rows.map((r) => r.tablename);
      expect(rows).toEqual([...REALTIME_TABLES].sort());
    });

    it("pins search_path on every function in public and app — definer or invoker (Security Advisor, lint 0011)", async () => {
      const r = await db.query(`
        select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'app') and p.prokind in ('f', 'p')
           and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
      expect(r.rows).toEqual([]);
    });

    it("gives anon exactly six SECURITY DEFINER functions — the token-gated link functions; ping runs as the caller", async () => {
      const definer = async (role: string) =>
        (
          await db.query(
            `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'app') and p.prosecdef and has_function_privilege($1, p.oid, 'EXECUTE') order by 1`,
            [role],
          )
        ).rows.map((x) => x.proname);
      expect(await definer("anon")).toEqual(["escort_pickup", "escort_tick", "escort_view", "kk_form", "kk_signup", "schedule_view"]);
      expect((await db.query("select prosecdef from pg_proc where oid = 'public.ping()'::regprocedure")).rows[0].prosecdef).toBe(false);
    });
  });

  describe("anon (the publishable key, no sign-in)", () => {
    it("can ping (and call the link functions — tests/sql/links.test.ts), and reach nothing else", async () => {
      await as(db, "anon", null, async (q) => {
        expect((await q("select public.ping() as v")).rows[0].v).toBe("ok");
        expect(await sqlstate(q("select * from public.members"))).toBe("42501");
        expect(await sqlstate(q("select * from public.editions"))).toBe("42501");
        expect(await sqlstate(q("select public.whoami()"))).toBe("42501");
        expect(await sqlstate(q("select app.add_admin('x@example.org')"))).toBe("42501");
        for (const t of ["share_links", "share_link_hits", "escort_ticks", "kk_tracks", "kk_groups", "kk_leaders", "kk_signups", "book_orders", "roster", "lessons", "fallen", "fallen_contacts", "memorial_plans", "lesson_reviews", "lesson_import_notes"]) {
          expect(await sqlstate(q(`select * from public.${t}`)), t).toBe("42501");
        }
        expect(await sqlstate(q("select public.issue_link(1, 'schedule')"))).toBe("42501");
        expect(await sqlstate(q("select public.load_kk(1)"))).toBe("42501");
        expect(await sqlstate(q("select app.link_for('x', 'escort')"))).toBe("42501");
        // v12: nothing of «איך עבר», the purge or the dry run
        for (const f of ["public.load_reviews(1)", "public.speaker_reviews(1)", "public.edition_returning(1)", "public.purge_edition_private(1, 'x')", "public.start_edition_preview()",
                         "public.save_lesson_review(1, 0, 'x', null, null, false, null)"]) {
          expect(await sqlstate(q(`select ${f}`)), f).toBe("42501");
        }
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
        expect(w.schema_version).toBe(12);
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
    // The complete list, on purpose. editions: whole-row writes under RLS.
    // members/roster/rooms/categories (settings, v5): DELETE on the row, INSERT
    // and UPDATE only on the columns below — never an id, never rooms.is_default,
    // and a member's address and edition never change once written.
    // Everything else: SELECT only (the grid writes through functions).
    // v8: notes and milestones (admins, under RLS) like the settings tables;
    // export_snapshots INSERT by column only — never UPDATE or DELETE: a
    // snapshot is what an export held. No author, time, version or done_by is
    // ever a browser's to write (the guard triggers stamp them).
    const TABLE_WRITES: Record<string, string> = {
      editions: "DELETE,INSERT,SELECT,UPDATE",
      members: "DELETE,SELECT",
      roster: "DELETE,SELECT",
      rooms: "DELETE,SELECT",
      categories: "DELETE,SELECT",
      notes: "DELETE,SELECT",
      milestones: "DELETE,SELECT",
    };
    const COLUMN_WRITES = [
      "categories.active:INSERT,UPDATE", "categories.color:INSERT,UPDATE", "categories.name:INSERT,UPDATE", "categories.sort:INSERT,UPDATE",
      "export_snapshots.edition_id:INSERT", "export_snapshots.kind:INSERT", "export_snapshots.payload:INSERT",
      "members.active:INSERT,UPDATE", "members.display_name:INSERT,UPDATE", "members.edition_id:INSERT", "members.email:INSERT",
      "members.gender:INSERT,UPDATE", "members.role:INSERT,UPDATE",
      "milestones.days_before:INSERT,UPDATE", "milestones.done_at:UPDATE", "milestones.edition_id:INSERT", "milestones.title:INSERT,UPDATE",
      "notes.body_md:INSERT,UPDATE", "notes.edition_id:INSERT", "notes.section:INSERT,UPDATE", "notes.title:INSERT,UPDATE",
      "rooms.edition_id:INSERT", "rooms.name:INSERT,UPDATE", "rooms.sort:INSERT,UPDATE",
      "roster.edition_id:INSERT", "roster.full_name:INSERT,UPDATE", "roster.gender:INSERT,UPDATE",
    ];

    it("are SELECT everywhere it reads, row writes only on editions, column writes on the settings, knowledge and snapshot tables, never TRUNCATE/REFERENCES/TRIGGER", async () => {
      const grants = (
        await db.query(`
          select table_name, string_agg(privilege_type, ',' order by privilege_type) as p
            from information_schema.role_table_grants
           where grantee = 'authenticated' and table_schema = 'public'
           group by table_name order by table_name`)
      ).rows;
      for (const g of grants) expect(g.p, g.table_name).toBe(TABLE_WRITES[g.table_name] ?? "SELECT");
      expect(grants.map((g) => g.table_name)).toEqual(expect.arrayContaining(["lessons", ...Object.keys(TABLE_WRITES)]));

      // Column grants beyond what the table grant already gives (editions has whole-row grants).
      const cols = (
        await db.query(`
          select c.relname || '.' || a.attname || ':' ||
                 concat_ws(',', case when has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT') then 'INSERT' end,
                                case when has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE') then 'UPDATE' end) as g
            from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
           where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
             and c.relname <> 'editions'
             and (has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT')
                  or has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE'))
           order by 1`)
      ).rows.map((r) => r.g);
      expect(cols).toEqual(COLUMN_WRITES);
    });

    it("read share_links by column — every one but the token's hash — and never its rate-limit counts", async () => {
      const cols = (
        await db.query(`
          select a.attname from pg_attribute a
           where a.attrelid = 'public.share_links'::regclass and a.attnum > 0 and not a.attisdropped
             and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT') order by a.attnum`)
      ).rows.map((r) => r.attname);
      expect(cols).toEqual(["id", "edition_id", "scope", "subject_id", "created_by", "created_at", "expires_at", "revoked_at"]);
      const any = async (table: string, role: string) =>
        (await db.query(`select has_table_privilege($2, $1::regclass, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as p`, [table, role])).rows[0].p;
      expect(await any("public.share_links", "authenticated")).toBe(false);
      expect(await any("public.share_link_hits", "authenticated")).toBe(false);
      for (const role of ["anon", "authenticated"]) {
        expect(
          (await db.query("select has_column_privilege($1, 'public.share_links'::regclass, 'token_hash', 'SELECT, INSERT, UPDATE, REFERENCES') as p", [role])).rows[0].p,
          role,
        ).toBe(false);
      }
    });
  });
});
