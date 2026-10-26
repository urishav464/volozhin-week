// The owner re-runs the whole of supabase/schema.sql in the SQL Editor on a
// database that already holds the last version and its data. This runs exactly
// that, under both default-privilege regimes the other tests model: v13 (the
// file as it stood at V13_COMMIT, read from git history) with some data in it —
// last year's week with its transport details, links, a member and v13's
// availability by part of a day in every shape the conversion meets — then this
// file twice. Afterwards the data is all there (availability per slot, by the
// conversion's rule), and the catalog — every table, column, constraint, index,
// trigger, policy, function body, privilege and the Realtime publication — is
// exactly a fresh install's, so nothing a fresh database is tested for can
// differ on the owner's.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SCHEMA, dropDatabase, freshDatabase, type Regime } from "./db";

/** The commit whose schema.sql is v13 — what production runs (PR #6, as merged). The sql job checks out the whole history for it. */
const V13_COMMIT = "c6d6012";

function v13Schema(): string {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  try {
    return execFileSync("git", ["show", `${V13_COMMIT}:supabase/schema.sql`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`the v13 schema is read from git history (${V13_COMMIT}); a shallow checkout has none — fetch-depth: 0 (${(e as Error).message})`);
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

describe.each<Regime>(["old", "new"])("re-running schema.sql on a v13 database, under %s Supabase defaults", (regime) => {
  const upgraded = `vw_upgrade_${regime}_${process.pid}`;
  const fresh = `vw_fresh_${regime}_${process.pid}`;
  let db: pg.Client;
  let ref: pg.Client;
  let ed: number;
  let s1: number;
  let s2: number;

  beforeAll(async () => {
    db = await freshDatabase(upgraded, regime);
    const v13 = v13Schema();
    expect(v13).toContain("as $$ select 13 $$");
    await db.query(v13);
    // last year's data, as v13 kept it
    await db.query("select app.add_admin('admin@example.org')");
    s1 = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה לבדיקה', 'f', 'approved') returning id")).rows[0].id);
    s2 = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה שנייה לבדיקה', 'm', 'pending') returning id")).rows[0].id);
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", role: "authenticated", email: "admin@example.org", app_metadata: { provider: "google" } })]);
    ed = Number((await db.query("select public.start_edition('תשפ\"ז', '2027-02-14', 510) as id")).rows[0].id);   // Sunday opens 08:30, Thursday closes 19:00
    await db.query("select public.claim_speaker($1, $2)", [ed, s1]);
    await db.query("select public.claim_speaker($1, $2)", [ed, s2]);
    // v13's own command: Monday's morning (06:30–13:00) «לא», with a note — the row and its log line
    await db.query("select public.set_availability($1, $2, 1, 'morning', 'cannot', 'לא בבקרים')", [ed, s1]);
    await db.query("commit");
    // every other shape the old table can hold (day, from, to, kind, note) — what the conversion must read right
    for (const [speaker, day, from, to, kind, note] of [
      [s1, 2, 1200, 1830, "can", "ערב ולילה"], // Tuesday evening and night: five whole rows
      [s1, 3, 700, 1200, "cannot", null], // Wednesday, across two parts: every row it touches
      [s1, 3, 390, 780, "can", null], // Wednesday's morning — but 11:30 is «לא» already: «לא» wins
      [s1, 0, 390, 600, "cannot", null], // Sunday before the opening: only 08:30 is a row that day
      [s1, 4, 1140, 1440, "can", null], // Thursday after the close: no row at all
      [s1, 1, 870, 930, "can", null], // half of Monday's 14:30 row: says nothing about the row
      [s1, 4, 510, 780, "can", "בבוקר"], // Thursday's morning, but not 10:00 — and 10:00 keeps no word of the «can»
      [s1, 4, 600, 690, "cannot", null],
      [s2, 0, 390, 780, "can", "דוגמה"], // another speaker, Sunday's morning: from the opening on
    ] as const) {
      await db.query(
        "insert into public.availability (approach_id, day, from_min, to_min, kind, note) select id, $3, $4, $5, $6, $7 from public.approaches where edition_id = $1 and speaker_id = $2",
        [ed, speaker, day, from, to, kind, note],
      );
    }
    await db.query("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה לבדיקה')", [ed]);
    await db.query("insert into public.lessons (edition_id, kind, day, start_min, end_min, room_id, title) select $1, 'memorial', 0, 780, 795, id, 'זמן זיכרון' from public.rooms where edition_id = $1", [ed]);
    await db.query(
      "insert into public.source_files (edition_id, lesson_id, cover, storage_path, display_name, mime, size_bytes, page_count) values ($1, null, true, $2, 'שער.pdf', 'application/pdf', 100, 1)",
      [ed, `${ed}/cover/00000000-0000-4000-8000-000000000000-cover.pdf`],
    );
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

  it("is v14 and turns availability by part of a day into marks per slot: «לא» wins every row it touches, «יכול/ה» only a row it covers whole", async () => {
    expect((await db.query("select public.schema_version() as v")).rows[0].v).toBe(14);
    const who = (id: number) => (id === s1 ? "s1" : id === s2 ? "s2" : String(id));
    const slots = (
      await db.query(
        `select v.speaker_id, v.day, r.start_min, v.kind, v.note, v.updated_by, r.edition_id = v.edition_id as same_edition
           from public.slot_availability v join public.grid_rows r on r.id = v.row_id
          order by v.speaker_id, v.day, r.start_min`,
      )
    ).rows;
    expect(slots.every((r) => r.same_edition && r.updated_by === null)).toBe(true); // nobody's act
    expect(slots.map((r) => `${who(Number(r.speaker_id))} ${r.day} ${r.start_min} ${r.kind} ${r.note ?? "-"}`)).toEqual([
      "s1 0 510 cannot -",
      "s1 1 390 cannot לא בבקרים", "s1 1 510 cannot לא בבקרים", "s1 1 600 cannot לא בבקרים", "s1 1 690 cannot לא בבקרים",
      "s1 2 1200 can ערב ולילה", "s1 2 1350 can ערב ולילה", "s1 2 1470 can ערב ולילה", "s1 2 1560 can ערב ולילה", "s1 2 1650 can ערב ולילה",
      "s1 3 390 can -", "s1 3 510 can -", "s1 3 600 can -", "s1 3 690 cannot -", "s1 3 870 cannot -", "s1 3 960 cannot -", "s1 3 1050 cannot -",
      "s1 4 510 can בבוקר", "s1 4 600 cannot -", "s1 4 690 can בבוקר",
      "s2 0 510 can דוגמה", "s2 0 600 can דוגמה", "s2 0 690 can דוגמה",
    ]);
    // the old table and its command are gone; the log keeps what v13 wrote; the approaches are as they were
    expect((await db.query("select to_regclass('public.availability') as t")).rows[0].t).toBeNull();
    expect((await db.query("select count(*)::int as n from pg_proc where proname = 'set_availability'")).rows[0].n).toBe(0);
    expect((await db.query("select detail from public.activity where entity = 'approaches' and kind = 'availability'")).rows.map((r) => r.detail)).toEqual([
      { speaker: s1, day: 1, part: "morning", kind: "cannot" },
    ]);
    expect((await db.query("select status, version from public.approaches where edition_id = $1 order by speaker_id", [ed])).rows).toEqual([
      { status: "claimed", version: 1 },
      { status: "claimed", version: 1 },
    ]);
  });

  it("keeps every row v13 held, and seeds nothing — «נקודות לשיחה» stay the code's own text until edited", async () => {
    expect((await db.query("select settings from public.editions where id = $1", [ed])).rows[0].settings).toEqual({ lesson_minutes: 75, row_minutes: 90 });
    expect((await db.query("select count(*)::int as n from public.roster where edition_id = $1", [ed])).rows[0].n).toBe(1);
    expect((await db.query("select kind, title from public.lessons where edition_id = $1", [ed])).rows).toEqual([{ kind: "memorial", title: "זמן זיכרון" }]);
    expect((await db.query("select display_name, fallen_id from public.source_files")).rows).toEqual([{ display_name: "שער.pdf", fallen_id: null }]);
    expect((await db.query("select purged_at from public.editions where id = $1", [ed])).rows).toEqual([{ purged_at: null }]);
    expect((await db.query("select active from public.members where email = 'content@example.org'")).rows).toEqual([{ active: true }]);
    expect((await db.query("select revoked_at from public.share_links where edition_id = $1", [ed])).rows).toEqual([{ revoked_at: null }]);
    expect((await db.query("select pickup_address, driver_name from public.transport_details")).rows).toEqual([{ pickup_address: "כתובת לדוגמה", driver_name: "נהג/ת לדוגמה" }]);
    // start_edition keeps its one signature
    expect((await db.query("select pg_get_function_identity_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'start_edition'")).rows).toEqual([
      { a: "p_label text, p_start_date date, p_first_day_from integer, p_room text, p_deactivate_team boolean" },
    ]);
  });

  it("ends with exactly a fresh install's catalog: tables, constraints, policies, functions, privileges, Realtime", async () => {
    const [a, b] = [await fingerprint(db), await fingerprint(ref)];
    expect(a.length).toBeGreaterThan(500);
    expect(a).toContain("pub slot_availability");
    expect(a.filter((x) => !b.includes(x))).toEqual([]);
    expect(b.filter((x) => !a.includes(x))).toEqual([]);
  });
});
