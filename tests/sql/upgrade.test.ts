// The owner re-runs the whole of supabase/schema.sql in the SQL Editor on a
// database that already holds an older version and its data. This runs exactly
// that, from two bases read from git history — v13 (PR #6) and v14 (PR #8, what
// production runs) — under both default-privilege regimes the other tests
// model: the old file with some data in it — last year's week with its
// transport details, links, a member, availability (v13's by part of a day, in
// every shape the conversion meets; v14's per slot) and מכריכה לכריכה in its
// per-session shape (a track, a group, its leader, a sign-up, a book order, the
// window and the sign-up link) — then this file twice. Afterwards the data is
// all there (v13's availability per slot, by the conversion's rule), the old kk
// structure is gone while the window and the link stay, and the catalog — every
// table, column, constraint, index, trigger, policy, function body, privilege
// and the Realtime publication — is exactly a fresh install's, so nothing a
// fresh database is tested for can differ on the owner's.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SCHEMA, dropDatabase, freshDatabase, type Regime } from "./db";

interface Base {
  /** The commit whose schema.sql is this version. The sql job checks out the whole history for it. */
  commit: string;
  version: number;
}

const BASES: Base[] = [
  { commit: "c6d6012", version: 13 }, // PR #6, as merged: availability by part of a day
  { commit: "fe55f7c", version: 14 }, // PR #8, as merged — what production runs: availability per slot
];

function schemaAt(base: Base): string {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  try {
    return execFileSync("git", ["show", `${base.commit}:supabase/schema.sql`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`the v${base.version} schema is read from git history (${base.commit}); a shallow checkout has none — fetch-depth: 0 (${(e as Error).message})`);
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

const CASES = BASES.flatMap((base) => (["old", "new"] as Regime[]).map((regime) => ({ ...base, regime })));

describe.each(CASES)("re-running schema.sql on a v$version database ($commit), under $regime Supabase defaults", (base) => {
  const { version, regime } = base;
  const upgraded = `vw_upgrade_${version}_${regime}_${process.pid}`;
  const fresh = `vw_fresh_${version}_${regime}_${process.pid}`;
  let db: pg.Client;
  let ref: pg.Client;
  let ed: number;
  let s1: number;
  let s2: number;
  let kkToken: string;
  let kkWindow: unknown;
  const notices: string[][] = [[], []]; // what each of the two runs said

  /** As the global admin, in one committed transaction. */
  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", role: "authenticated", email: "admin@example.org", app_metadata: { provider: "google" } })]);
    const out = await fn();
    await db.query("commit");
    return out;
  }

  beforeAll(async () => {
    db = await freshDatabase(upgraded, regime);
    const old = schemaAt(base);
    expect(old).toContain(`as $$ select ${version} $$`);
    await db.query(old);
    // last year's data, as the old version kept it
    await db.query("select app.add_admin('admin@example.org')");
    s1 = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה לבדיקה', 'f', 'approved') returning id")).rows[0].id);
    s2 = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה שנייה לבדיקה', 'm', 'pending') returning id")).rows[0].id);
    ed = await asAdmin(async () => {
      const id = Number((await db.query("select public.start_edition('תשפ\"ז', '2027-02-14', 510) as id")).rows[0].id);   // Sunday opens 08:30, Thursday closes 19:00
      await db.query("select public.claim_speaker($1, $2)", [id, s1]);
      await db.query("select public.claim_speaker($1, $2)", [id, s2]);
      return id;
    });
    if (version === 13) {
      // v13's own command: Monday's morning (06:30–13:00) «לא», with a note — the row and its log line
      await asAdmin(() => db.query("select public.set_availability($1, $2, 1, 'morning', 'cannot', 'לא בבקרים')", [ed, s1]));
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
    } else {
      // v14's own command: Monday 08:30 «לא», with a note
      await asAdmin(() =>
        db.query("select public.set_slot_availability($1, $2, 1, (select id from public.grid_rows where edition_id = $1 and start_min = 510), 'cannot', 'לא בבקרים')", [ed, s1]),
      );
    }
    const trainee = Number((await db.query("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה לבדיקה') returning id", [ed])).rows[0].id);
    // מכריכה לכריכה as v9–v14 kept it — groups per session (the drop is what the instructor confirmed: no edition held any)
    await asAdmin(async () => {
      await db.query("select public.kk_set_window($1, now() - interval '1 day', now() + interval '30 days')", [ed]);
      kkToken = (await db.query("select public.issue_link($1, 'kk_signup') as l", [ed])).rows[0].l.token;
      const group = Number((await db.query("select public.kk_add_group($1, 1, 1290, $2) as id", [ed, JSON.stringify({
        title: "ספר לבדיקה", capacity: 3, leaders: [{ kind: "staff", label: "צוות לבדיקה" }],
      })])).rows[0].id);
      await db.query("select public.kk_place($1, $2)", [group, trainee]);
      await db.query("select public.set_book_order($1, 3, true)", [group]);
    });
    kkWindow = (await db.query("select settings -> 'kk_window' as w from public.editions where id = $1", [ed])).rows[0].w;
    await db.query("insert into public.lessons (edition_id, kind, day, start_min, end_min, room_id, title) select $1, 'memorial', 0, 780, 795, id, 'זמן זיכרון' from public.rooms where edition_id = $1", [ed]);
    await db.query(
      "insert into public.source_files (edition_id, lesson_id, cover, storage_path, display_name, mime, size_bytes, page_count) values ($1, null, true, $2, 'שער.pdf', 'application/pdf', 100, 1)",
      [ed, `${ed}/cover/00000000-0000-4000-8000-000000000000-cover.pdf`],
    );
    // after-the-week data: a content member, a link and a lesson's transport details (synthetic words only)
    await db.query("insert into public.members (email, display_name, role, edition_id) values ('content@example.org', 'חבר/ת צוות', 'content', $1)", [ed]);
    await db.query("insert into public.share_links (edition_id, scope, token_hash, expires_at) values ($1, 'schedule', extensions.digest('a-token-for-the-upgrade', 'sha256'), now() + interval '1 day')", [ed]);
    await db.query("insert into public.transport_details (lesson_id, pickup_address, driver_name) select id, 'כתובת לדוגמה', 'נהג/ת לדוגמה' from public.lessons where edition_id = $1", [ed]);
    for (const run of notices) {
      const heard = (n: { message?: string }) => run.push(n.message ?? "");
      db.on("notice", heard);
      await db.query(SCHEMA);
      db.off("notice", heard);
    }
    ref = await freshDatabase(fresh, regime);
    await ref.query(SCHEMA);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, upgraded);
    if (ref) await dropDatabase(ref, fresh);
  });

  it("is v15", async () => {
    expect((await db.query("select public.schema_version() as v")).rows[0].v).toBe(15);
  });

  it(version === 13
    ? "turns v13's availability by part of a day into marks per slot: «לא» wins every row it touches, «יכול/ה» only a row it covers whole"
    : "keeps v14's availability per slot as it was", async () => {
    if (version === 14) {
      expect((await db.query(
        "select v.speaker_id, v.day, r.start_min, v.kind, v.note from public.slot_availability v join public.grid_rows r on r.id = v.row_id",
      )).rows.map((r) => ({ ...r, speaker_id: Number(r.speaker_id) }))).toEqual([{ speaker_id: s1, day: 1, start_min: 510, kind: "cannot", note: "לא בבקרים" }]);
      return;
    }
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

  it("drops מכריכה לכריכה's per-session structure — once, saying what it dropped — and keeps the window and the sign-up link", async () => {
    expect(notices[0].filter((m) => m.includes("per-session"))).toEqual([
      "מכריכה לכריכה by the week (v15): dropping the per-session tables — 1 tracks, 1 groups, 1 leaders, 1 sign-ups, 1 book orders",
    ]);
    expect(notices[1].filter((m) => m.includes("per-session"))).toEqual([]); // the second run finds nothing to drop
    expect((await db.query("select to_regclass('public.kk_tracks') as t")).rows[0].t).toBeNull();
    expect((await db.query("select count(*)::int as n from pg_proc where proname = 'kk_track_on_grid'")).rows[0].n).toBe(0);
    const signatures = async (fn: string) =>
      (await db.query("select pg_get_function_identity_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows.map((r) => r.a);
    expect(await signatures("kk_add_group")).toEqual(["p_edition bigint, p_fields jsonb"]);
    expect(await signatures("kk_unplace")).toEqual(["p_edition bigint, p_roster bigint"]);
    for (const t of ["kk_groups", "kk_leaders", "kk_signups", "book_orders"]) {
      expect((await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n, t).toBe(0);
    }
    expect((await db.query("select settings -> 'kk_window' as w from public.editions where id = $1", [ed])).rows[0].w).toEqual(kkWindow);
    expect((await db.query("select scope, revoked_at from public.share_links where edition_id = $1 order by scope", [ed])).rows).toEqual([
      { scope: "kk_signup", revoked_at: null },
      { scope: "schedule", revoked_at: null },
    ]);
    // the link opens the new form, its window still open
    await db.query("begin");
    try {
      await db.query("set local role anon");
      const f = (await db.query("select public.kk_form($1) as f", [kkToken])).rows[0].f;
      expect(f).toMatchObject({ open: true, groups: [], roster: [{ full_name: "חניך/ה לבדיקה" }] });
      expect(f.sessions).toHaveLength(8);
    } finally {
      await db.query("rollback");
    }
  });

  it("keeps every other row it held, and seeds nothing — «נקודות לשיחה» stay the code's own text until edited", async () => {
    expect((await db.query("select settings from public.editions where id = $1", [ed])).rows[0].settings).toEqual({ lesson_minutes: 75, row_minutes: 90, kk_window: kkWindow });
    expect((await db.query("select count(*)::int as n from public.roster where edition_id = $1", [ed])).rows[0].n).toBe(1);
    expect((await db.query("select kind, title from public.lessons where edition_id = $1", [ed])).rows).toEqual([{ kind: "memorial", title: "זמן זיכרון" }]);
    expect((await db.query("select display_name, fallen_id from public.source_files")).rows).toEqual([{ display_name: "שער.pdf", fallen_id: null }]);
    expect((await db.query("select purged_at from public.editions where id = $1", [ed])).rows).toEqual([{ purged_at: null }]);
    expect((await db.query("select active from public.members where email = 'content@example.org'")).rows).toEqual([{ active: true }]);
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
    expect(a).toContain("idx CREATE UNIQUE INDEX kk_leaders_trainee ON public.kk_leaders USING btree (roster_id) WHERE (roster_id IS NOT NULL)");
    expect(a.filter((x) => !b.includes(x))).toEqual([]);
    expect(b.filter((x) => !a.includes(x))).toEqual([]);
  });
});
