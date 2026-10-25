// The owner re-runs the whole of supabase/schema.sql in the SQL Editor on a
// database that already holds the last version and its data. This runs exactly
// that, under both default-privilege regimes the other tests model: v12 (the
// file as it stood at V12_COMMIT, read from git history) with some data in it —
// last year's week with its transport details, links and a member — then this
// file twice. Afterwards the data is all there, and the catalog — every
// table, column, constraint, index, trigger, policy, function body, privilege
// and the Realtime publication — is exactly a fresh install's, so nothing a
// fresh database is tested for can differ on the owner's.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SCHEMA, dropDatabase, freshDatabase, type Regime } from "./db";

/** The commit whose schema.sql is v12 — what production runs (PR #5, as merged). The sql job checks out the whole history for it. */
const V12_COMMIT = "b9311bc";

function v12Schema(): string {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  try {
    return execFileSync("git", ["show", `${V12_COMMIT}:supabase/schema.sql`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`the v12 schema is read from git history (${V12_COMMIT}); a shallow checkout has none — fetch-depth: 0 (${(e as Error).message})`);
  }
}

/** Everything about the database's shape and permissions, one line each — two databases with equal lists are the same schema. */
const FINGERPRINT = `
  select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') || ' ' || coalesce(is_generated, '') || ' ' || coalesce(generation_expression, '')
    from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'idx ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'trg ' || tgrelid::regclass::text || ' ' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%'
  union all
  select 'rls ' || c.relname || ' ' || c.relrowsecurity || ' ' || c.relforcerowsecurity
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  union all
  select 'pol ' || schemaname || '.' || tablename || ' ' || policyname || ' ' || permissive || ' ' || array_to_string(roles, ',') || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fn ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || p.prosecdef || ' ' || p.provolatile::text || ' '
         || coalesce(array_to_string(p.proconfig, ','), '') || ' ' || md5(p.prosrc)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app')
  union all
  select 'exec ' || r.rolname || ' ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join (values ('anon'), ('authenticated'), ('public')) r(rolname)
   where n.nspname in ('public', 'app')
     and case when r.rolname = 'public' then exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
              else has_function_privilege(r.rolname, p.oid, 'EXECUTE') end
  union all
  select 'tbl ' || grantee || ' ' || table_name || ' ' || privilege_type
    from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
  union all
  select 'colgrant ' || grantee || ' ' || table_name || '.' || column_name || ' ' || privilege_type
    from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated')
  union all
  select 'pub ' || tablename from pg_publication_tables where pubname = 'supabase_realtime'
  union all
  select 'schema ' || nspname || ' ' || has_schema_privilege('anon', oid, 'USAGE') || ' ' || has_schema_privilege('authenticated', oid, 'USAGE')
    from pg_namespace where nspname in ('public', 'app')
  order by 1`;

async function fingerprint(db: pg.Client): Promise<string[]> {
  return (await db.query(FINGERPRINT)).rows.map((r) => Object.values(r)[0] as string);
}

describe.each<Regime>(["old", "new"])("re-running schema.sql on a v12 database, under %s Supabase defaults", (regime) => {
  const upgraded = `vw_upgrade_${regime}_${process.pid}`;
  const fresh = `vw_fresh_${regime}_${process.pid}`;
  let db: pg.Client;
  let ref: pg.Client;
  let ed: number;

  beforeAll(async () => {
    db = await freshDatabase(upgraded, regime);
    const v12 = v12Schema();
    expect(v12).toContain("as $$ select 12 $$");
    await db.query(v12);
    // last year's data, as v12 kept it
    await db.query("select app.add_admin('admin@example.org')");
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", role: "authenticated", email: "admin@example.org", app_metadata: { provider: "google" } })]);
    ed = Number((await db.query("select public.start_edition('תשפ\"ז', '2027-02-14', 510) as id")).rows[0].id);
    await db.query("commit");
    await db.query("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה לבדיקה')", [ed]);
    await db.query("insert into public.lessons (edition_id, kind, day, start_min, end_min, room_id, title) select $1, 'memorial', 0, 780, 795, id, 'זמן זיכרון' from public.rooms where edition_id = $1", [ed]);
    await db.query(
      "insert into public.source_files (edition_id, lesson_id, cover, storage_path, display_name, mime, size_bytes, page_count) values ($1, null, true, $2, 'שער.pdf', 'application/pdf', 100, 1)",
      [ed, `${ed}/cover/00000000-0000-4000-8000-000000000000-cover.pdf`],
    );
    // the memorial rows as v12 named them (א and ב), one renamed by hand — a hand's label is the admin's and stays
    await db.query("update public.grid_rows set label = 'זמן זיכרון — מיוחד' where edition_id = $1 and kind = 'memorial' and start_min = 855", [ed]);
    // after-the-week data: a content member, a link and a lesson's transport details (synthetic words only)
    await db.query("insert into public.members (email, display_name, role, edition_id) values ('content@example.org', 'חבר/ת צוות', 'content', $1)", [ed]);
    await db.query("insert into public.share_links (edition_id, scope, token_hash, expires_at) values ($1, 'schedule', extensions.digest('a-token-for-the-upgrade', 'sha256'), now() + interval '1 day')", [ed]);
    await db.query("insert into public.transport_details (lesson_id, pickup_address, driver_name) select id, 'כתובת לדוגמה', 'נהג/ת לדוגמה' from public.lessons where edition_id = $1", [ed]);
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    ref = await freshDatabase(fresh, regime);
    await ref.query(SCHEMA);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, upgraded);
    if (ref) await dropDatabase(ref, fresh);
  });

  it("is v13 and keeps every row v12 held; the memorial rows lose their א/ב, a hand's label stays", async () => {
    expect((await db.query("select public.schema_version() as v")).rows[0].v).toBe(13);
    expect((await db.query("select start_min, label from public.grid_rows where edition_id = $1 and kind = 'memorial' order by start_min", [ed])).rows).toEqual([
      { start_min: 780, label: "זמן זיכרון" },
      { start_min: 855, label: "זמן זיכרון — מיוחד" },
    ]);
    expect((await db.query("select distinct label from public.grid_template where kind = 'memorial'")).rows).toEqual([{ label: "זמן זיכרון" }]);
    expect((await db.query("select settings from public.editions where id = $1", [ed])).rows[0].settings).not.toHaveProperty("gender_tolerance"); // never seeded
    expect((await db.query("select count(*)::int as n from public.roster where edition_id = $1", [ed])).rows[0].n).toBe(1);
    // v12: the imported lessons' notes have a table of their own (lesson_import_notes) — empty; lessons gained no column
    expect((await db.query("select kind, title from public.lessons where edition_id = $1", [ed])).rows).toEqual([{ kind: "memorial", title: "זמן זיכרון" }]);
    expect((await db.query("select count(*)::int as n from public.lesson_import_notes")).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'lessons' and column_name = 'import_note'")).rows[0].n).toBe(0);
    expect((await db.query("select display_name, fallen_id from public.source_files")).rows).toEqual([{ display_name: "שער.pdf", fallen_id: null }]);
    expect((await db.query("select count(*)::int as n from public.grid_rows where edition_id = $1 and kind = 'memorial'", [ed])).rows[0].n).toBe(2);
    for (const t of ["fallen", "fallen_contacts", "memorial_plans", "lesson_reviews"]) {
      expect((await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n, t).toBe(0);
    }
    expect((await db.query("select purged_at from public.editions where id = $1", [ed])).rows).toEqual([{ purged_at: null }]);
    expect((await db.query("select active from public.members where email = 'content@example.org'")).rows).toEqual([{ active: true }]);
    expect((await db.query("select revoked_at from public.share_links where edition_id = $1", [ed])).rows).toEqual([{ revoked_at: null }]);
    expect((await db.query("select pickup_address, driver_name from public.transport_details")).rows).toEqual([{ pickup_address: "כתובת לדוגמה", driver_name: "נהג/ת לדוגמה" }]);
    // start_edition keeps its one signature, with the option
    expect((await db.query("select pg_get_function_identity_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'start_edition'")).rows).toEqual([
      { a: "p_label text, p_start_date date, p_first_day_from integer, p_room text, p_deactivate_team boolean" },
    ]);
  });

  it("ends with exactly a fresh install's catalog: tables, constraints, policies, functions, privileges, Realtime", async () => {
    const [a, b] = [await fingerprint(db), await fingerprint(ref)];
    expect(a.length).toBeGreaterThan(500);
    expect(a.filter((x) => !b.includes(x))).toEqual([]);
    expect(b.filter((x) => !a.includes(x))).toEqual([]);
  });
});
