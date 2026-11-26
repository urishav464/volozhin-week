// The owner re-runs the whole of supabase/schema.sql in the SQL Editor on a
// database that already holds an older version and its data. This runs exactly
// that, from seven bases read from git history — v13 (PR #6), v14 (PR #8), v15
// (PR #9), v16 (PR #11), v17 (PR #14), v18 (PR #15) and v19 (PR #19, what production runs) — under both default-privilege regimes the
// other tests model: the old file with some data in it — last year's week with
// its transport details, links, a member, availability (v13's by part of a day,
// in every shape the conversion meets; v14's and v15's per slot) and מכריכה
// לכריכה (v13–v14 in its per-session shape: a track, a group, its leader, a
// sign-up, a book order; v15 by the week: a group with its book, place, leader,
// a sign-up and a book order; the window and the sign-up link) — then this file
// twice. Afterwards the data is all there (v13's availability per slot, by the
// conversion's rule), the old kk structure is gone (v13–v14) or kept as it was
// (v15) while the window and the link stay, «תורנויות» (v16) is there and empty,
// the days' owners (v18) are there and empty and every transport detail is as it
// was, its new pickup_min unset — and what v18 itself writes after the first run
// (an owner who looked at their day, a pickup time in minutes) is still there
// after the second. v19 adds its columns to the old rows with their defaults (no speaker approved for the
// guests' site, every file a source, every preparation a task, every cohort helping and none driving), a fifth
// type to the bucket's list, and keeps what it writes after the first run — a photo, an approval to appear,
// «נשלח לדפוס», an item of the shopping list. v20 converts the cohorts' help into the duties they help in (v19's flag:
// a helping cohort every duty, one that did not none; v16–v18, before the flag: every cohort every duty), drops the
// free-typed diets, the flag and a staff shift's kind (a lead's row stays, as a shift), leaves the new numbers TBD, and
// keeps what it writes after the first run — a cohort's numbers and staff contact, its phone, a set of duties. And the catalog — every table, column, constraint, index, trigger, policy,
// function body, privilege and the Realtime publication — is exactly a fresh
// install's, so nothing a fresh database is tested for can differ on the owner's.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { photoBase64 } from "../../src/testing/photos";
import { SCHEMA, dropDatabase, freshDatabase, type Regime } from "./db";

interface Base {
  /** The commit whose schema.sql is this version. The sql job checks out the whole history for it. */
  commit: string;
  version: number;
}

const BASES: Base[] = [
  { commit: "c6d6012", version: 13 }, // PR #6, as merged: availability by part of a day
  { commit: "fe55f7c", version: 14 }, // PR #8, as merged: availability per slot
  { commit: "baf3cbe", version: 15 }, // PR #9, as merged: מכריכה לכריכה by the week
  { commit: "bcab571", version: 16 }, // PR #11: «תורנויות»
  { commit: "035f6fa", version: 17 }, // PR #14: titles
  { commit: "512ae35", version: 18 }, // PR #15: the reset's data foundation
  { commit: "9952be4", version: 19 }, // PR #19 — what production runs: the logistics home, the guests' site, presentations
];

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** «תורנויות» (v16; v20's two tables): every table, empty after the run but for what the test wrote. */
const ROTA_TABLES = [
  "rota_cohorts", "rota_presence", "rota_groups", "rota_group_contacts", "rota_duties", "rota_assignments", "rota_staff_shifts", "rota_prep_tasks", "rota_cohort_duties", "rota_cohort_contacts",
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
  let s3: number; // v19: claimed between the two runs — its approach approved for the guests' site, its photo stored
  let adminId: number;
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
    await asAdmin(async () => {
      await db.query("select public.kk_set_window($1, now() - interval '1 day', now() + interval '30 days')", [ed]);
      kkToken = (await db.query("select public.issue_link($1, 'kk_signup') as l", [ed])).rows[0].l.token;
      const fields = { title: "ספר לבדיקה", capacity: 3, leaders: [{ kind: "staff", label: "צוות לבדיקה" }] };
      const group = Number((version >= 15
        // v15: a group for the whole week (its book, a place, its leader) — what the run must keep as it is
        ? await db.query("select public.kk_add_group($1, $2) as id", [ed, JSON.stringify({ ...fields, place: "מקום לבדיקה" })])
        // as v9–v14 kept it — groups per session (the drop is what the instructor confirmed: no edition held any)
        : await db.query("select public.kk_add_group($1, 1, 1290, $2) as id", [ed, JSON.stringify(fields)])).rows[0].id);
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
    if (version >= 16) {
      // «תורנויות» as v16–v18 kept it: a cohort and a preparation, which v19 gives their defaults; v20: a duty (the cohort
      // helped: it helps in it), a group, diets as typed and a lead's staff shift — which v20 drops (the shift stays)
      await db.query("insert into public.rota_cohorts (edition_id, letter, name, diets) values ($1, 'א', 'מכינה לבדיקה', '[{\"label\": \"צמחוני\", \"count\": 2}]')", [ed]);
      await db.query("insert into public.rota_prep_tasks (edition_id, text) values ($1, 'הכנה לבדיקה')", [ed]);
      await db.query("insert into public.rota_duties (edition_id, name) values ($1, 'מטבח לבדיקה')", [ed]);
      await db.query("insert into public.rota_groups (edition_id, cohort_id, number, size) select $1, id, 1, 8 from public.rota_cohorts where edition_id = $1", [ed]);
      await db.query("insert into public.rota_staff_shifts (edition_id, day, start_min, end_min, name, kind) values ($1, 1, 510, 870, 'צוות לבדיקה', 'lead')", [ed]);
    }
    if (version === 19) {
      // v19's flag: a cohort that did not help — v20 gives it no duty (and it has no groups)
      await db.query("insert into public.rota_cohorts (edition_id, letter, name, helps_rota) values ($1, 'נ', 'מכינה שלא עוזרת', false)", [ed]);
    }
    for (const [i, run] of notices.entries()) {
      const heard = (n: { message?: string }) => run.push(n.message ?? "");
      db.on("notice", heard);
      await db.query(SCHEMA);
      db.off("notice", heard);
      if (i === 0) {
        // what v18 itself writes, between the two runs: Monday's owner, who has looked at the day, and a pickup
        // time in minutes — the second run (the file on a v18 database) must leave both as they are
        await asAdmin(async () => {
          await db.query("select public.set_day_owners($1, 1, array[(select id from public.members where email = 'content@example.org')])", [ed]);
        });
        await db.query("update public.day_owners set seen_at = '2027-02-01T08:00:00Z' where edition_id = $1", [ed]);
        await db.query("update public.transport_details set pickup_min = 435");
        // what v19 itself writes, between the two runs: a third speaker claimed, approved for the guests' site, with a
        // photo; «נשלח לדפוס»; an item of the shopping list — the second run must leave every one as it is
        s3 = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה שלישית לבדיקה', 'f', 'approved') returning id")).rows[0].id);
        await asAdmin(async () => {
          const a = Number((await db.query("select public.claim_speaker($1, $2) as id", [ed, s3])).rows[0].id);
          await db.query("select public.set_public_ok($1, 1, true)", [a]);
          await db.query("select public.set_speaker_photo($1, $2, $3)", [ed, s3, photoBase64("clean")]);
          await db.query("select public.set_reader_sent($1, true)", [ed]);
        });
        await db.query("insert into public.rota_prep_tasks (edition_id, text, kind, qty) values ($1, 'פריט לבדיקה', 'item', '3 (לבדיקה)')", [ed]);
        // what v20 itself writes, between the two runs: a cohort with its numbers and staff contact, its phone, the duty it
        // helps in — the second run must leave every one as it is (and convert nothing again)
        const c = Number((await db.query("insert into public.rota_cohorts (edition_id, letter, name, trainees, diet_veg, diet_gf, diet_both, contact_name) values ($1, 'ש', 'מכינה חדשה לבדיקה', 20, 3, 2, 1, 'איש/אשת קשר לבדיקה') returning id", [ed])).rows[0].id);
        const d = Number((await db.query("insert into public.rota_duties (edition_id, name) values ($1, 'נקיון לבדיקה') returning id", [ed])).rows[0].id);
        await db.query("insert into public.rota_cohort_duties (edition_id, cohort_id, duty_id) values ($1, $2, $3)", [ed, c, d]);
        await db.query("insert into public.rota_cohort_contacts (cohort_id, edition_id, phone) values ($1, $2, '555 0100 91')", [c, ed]);
      }
    }
    ref = await freshDatabase(fresh, regime);
    await ref.query(SCHEMA);
    adminId = Number((await db.query("select id from public.members where email = 'admin@example.org'")).rows[0].id);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, upgraded);
    if (ref) await dropDatabase(ref, fresh);
  });

  it("is v20, with «תורנויות»'s tables there — empty but for the rows written into them", async () => {
    expect((await db.query("select public.schema_version() as v")).rows[0].v).toBe(20);
    // the old version's rota (v16 on; v19 its cohort that did not help), v19's item and v20's own written between the two runs
    const old = version >= 16 ? 1 : 0;
    const written: Record<string, number> = {
      rota_cohorts: old + (version === 19 ? 1 : 0) + 1, rota_prep_tasks: old + 1, rota_duties: old + 1, rota_groups: old, rota_staff_shifts: old,
      rota_cohort_duties: old + 1, rota_cohort_contacts: 1,
    };
    for (const t of ROTA_TABLES) {
      expect((await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n, t).toBe(written[t] ?? 0);
    }
    // nothing carried into the old edition's settings: its shifts are last year's
    expect((await db.query("select settings ? 'rota_shifts' as k from public.editions where id = $1", [ed])).rows[0].k).toBe(false);
    // v17 writes no title list into an edition: one with none keeps reading the default list
    expect((await db.query("select settings ? 'titles' as k from public.editions where id = $1", [ed])).rows[0].k).toBe(false);
  });

  it(version === 13
    ? "turns v13's availability by part of a day into marks per slot: «לא» wins every row it touches, «יכול/ה» only a row it covers whole"
    : `keeps v${version}'s availability per slot as it was`, async () => {
    if (version >= 14) {
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
    expect((await db.query("select status, version from public.approaches where edition_id = $1 and speaker_id <> $2 order by speaker_id", [ed, s3])).rows).toEqual([
      { status: "claimed", version: 1 },
      { status: "claimed", version: 1 },
    ]);
  });

  it(version >= 15
    ? "keeps מכריכה לכריכה's week-long group as it was — its book, place, leader, sign-up and book order — with the window and the sign-up link"
    : "drops מכריכה לכריכה's per-session structure — once, saying what it dropped — and keeps the window and the sign-up link", async () => {
    if (version >= 15) {
      expect([...notices[0], ...notices[1]].filter((m) => m.includes("per-session"))).toEqual([]);
      expect((await db.query("select title, place, capacity, open from public.kk_groups where edition_id = $1", [ed])).rows).toEqual([
        { title: "ספר לבדיקה", place: "מקום לבדיקה", capacity: 3, open: true },
      ]);
      expect((await db.query("select l.kind, l.label from public.kk_leaders l join public.kk_groups g on g.id = l.group_id where g.edition_id = $1", [ed])).rows).toEqual([
        { kind: "staff", label: "צוות לבדיקה" },
      ]);
      expect((await db.query("select via from public.kk_signups where edition_id = $1", [ed])).rows).toEqual([{ via: "staff" }]);
      expect((await db.query("select copies, ordered_at is not null as ordered from public.book_orders")).rows).toEqual([{ copies: 3, ordered: true }]);
      expect((await db.query("select settings -> 'kk_window' as w from public.editions where id = $1", [ed])).rows[0].w).toEqual(kkWindow);
      await db.query("begin");
      try {
        await db.query("set local role anon");
        const f = (await db.query("select public.kk_form($1) as f", [kkToken])).rows[0].f;
        expect(f).toMatchObject({ open: true, groups: [{ title: "ספר לבדיקה", place: "מקום לבדיקה", full: false }], roster: [{ full_name: "חניך/ה לבדיקה" }] });
        expect(f.sessions).toHaveLength(8);
      } finally {
        await db.query("rollback");
      }
      return;
    }
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

  it("adds v18's own: the days' owners (none of the old version's making), a pickup time in minutes (unset on every old row) — and a second run keeps what v18 wrote", async () => {
    // only the owner set between the two runs — the upgrade itself made none — and their «ראיתי» survived the second run
    expect((await db.query(
      "select o.day, m.email, to_char(o.seen_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as seen_at from public.day_owners o join public.members m on m.id = o.member_id",
    )).rows).toEqual([{ day: 1, email: "content@example.org", seen_at: "2027-02-01T08:00:00Z" }]);
    expect((await db.query("select detail from public.activity where kind = 'day_owners'")).rows).toHaveLength(1);
    // the old row's words as they were; the minutes written after the first run still there
    expect((await db.query("select pickup_address, pickup_time, driver_name, driver_phone, arranged, pickup_min from public.transport_details")).rows).toEqual([
      { pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: "נהג/ת לדוגמה", driver_phone: null, arranged: false, pickup_min: 435 },
    ]);
    // the new commands are there, each once
    const count = async (fn: string) => (await db.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows[0].n;
    for (const fn of ["set_day_owners", "mark_day_seen", "set_availability_ranges", "set_transport_request", "set_transport_driver", "set_transport_details", "set_slot_availability", "decide_payments", "get_transports_for"]) {
      expect(await count(fn), fn).toBe(1);
    }
  });

  it("adds v19's own: the old rows' new columns at their defaults, pptx in the bucket's list — and a second run keeps what v19 wrote", async () => {
    // the old rows: no public words, no approval to appear, no note for guests, every file a source
    expect((await db.query("select public_bio from public.speakers where id = any ($1) order by id", [[s1, s2]])).rows).toEqual([{ public_bio: null }, { public_bio: null }]);
    expect((await db.query("select public_ok from public.approaches where edition_id = $1 and speaker_id = any ($2) order by speaker_id", [ed, [s1, s2]])).rows).toEqual([
      { public_ok: false }, { public_ok: false },
    ]);
    expect((await db.query("select public_note from public.lessons where edition_id = $1", [ed])).rows).toEqual([{ public_note: null }]);
    expect((await db.query("select kind from public.source_files")).rows).toEqual([{ kind: "source" }]);
    if (version >= 16) {
      expect((await db.query("select can_drive from public.rota_cohorts where letter = 'א'")).rows).toEqual([{ can_drive: false }]);
    }
    expect((await db.query("select text, kind, qty from public.rota_prep_tasks order by id")).rows).toEqual([
      ...(version >= 16 ? [{ text: "הכנה לבדיקה", kind: "task", qty: null }] : []),
      { text: "פריט לבדיקה", kind: "item", qty: "3 (לבדיקה)" },
    ]);
    // the bucket: the old four types and pptx after them (a fresh install's order), still private
    expect((await db.query("select public, allowed_mime_types from storage.buckets where id = 'sources'")).rows).toEqual([
      { public: false, allowed_mime_types: ["application/pdf", "image/png", "image/jpeg", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", PPTX] },
    ]);
    // the type check widened in place, the PowerPoint rule beside it
    expect((await db.query("select pg_get_constraintdef(oid) as c from pg_constraint where conname = 'source_files_mime_check'")).rows[0].c).toContain(PPTX);
    expect((await db.query("select pg_get_constraintdef(oid) as c from pg_constraint where conname = 'source_files_pptx_kind'")).rows).toEqual([
      { c: `CHECK (((mime <> '${PPTX}'::text) OR (kind = 'presentation'::text)))` },
    ]);
    // what v19 wrote between the two runs survived the second: the photo (the same bytes), the approval, «נשלח לדפוס»
    const photo = (await db.query("select encode(image, 'base64') as b, uploaded_by, app.photo_ok(image) as ok from public.speaker_photos where speaker_id = $1", [s3])).rows;
    expect(photo.map((r) => ({ b: String(r.b).replace(/\n/g, ""), by: Number(r.uploaded_by), ok: r.ok }))).toEqual([{ b: photoBase64("clean"), by: adminId, ok: true }]);
    expect((await db.query("select public_ok, version from public.approaches where edition_id = $1 and speaker_id = $2", [ed, s3])).rows).toEqual([{ public_ok: true, version: 2 }]);
    const sent = (await db.query("select settings -> 'reader_sent' as s from public.editions where id = $1", [ed])).rows[0].s;
    expect(sent).toEqual({ at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/), by: adminId });
    expect((await db.query("select kind, detail from public.activity where entity = 'speakers' and entity_id = $1 and kind = 'photo'", [s3])).rows).toEqual([
      { kind: "photo", detail: { set: true } },
    ]);
    // the new commands are there, each once; register_source_file has its one new signature
    const count = async (fn: string) => (await db.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows[0].n;
    for (const fn of ["set_reader_sent", "set_speaker_photo", "get_speaker_photo", "set_public_ok", "register_source_file", "schedule_view"]) {
      expect(await count(fn), fn).toBe(1);
    }
    expect((await db.query("select pg_get_function_identity_arguments('public.register_source_file'::regproc) as a")).rows[0].a).toBe(
      "p_edition bigint, p_lesson bigint, p_path text, p_display_name text, p_pages integer, p_kind text",
    );
  });

  it("adds v20's own: the cohorts' help converted to the duties they help in, the diets, the flag and the staff's kind gone, the numbers TBD — and a second run keeps what v20 wrote", async () => {
    const cols = (await db.query("select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public' and table_name in ('rota_cohorts', 'rota_staff_shifts')")).rows.map((r) => r.c);
    for (const gone of ["rota_cohorts.diets", "rota_cohorts.helps_rota", "rota_staff_shifts.kind"]) expect(cols, gone).not.toContain(gone);
    const helps = (await db.query(
      "select c.letter || ':' || d.name as x from public.rota_cohort_duties x join public.rota_cohorts c on c.id = x.cohort_id join public.rota_duties d on d.id = x.duty_id order by 1",
    )).rows.map((r) => r.x);
    // v16–v19's helping cohort: every duty of its edition; v19's that did not: none; v20's own, written between the runs: as written
    expect(helps).toEqual([...(version >= 16 ? ["א:מטבח לבדיקה"] : []), "ש:נקיון לבדיקה"]);
    if (version >= 16) {
      expect((await db.query("select trainees, diet_veg, diet_gf, diet_both, contact_name from public.rota_cohorts where letter = 'א'")).rows).toEqual([
        { trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null },
      ]);
      expect((await db.query("select name, start_min, end_min from public.rota_staff_shifts")).rows).toEqual([{ name: "צוות לבדיקה", start_min: 510, end_min: 870 }]); // the lead's row, a shift now
      expect((await db.query("select number, size from public.rota_groups")).rows).toEqual([{ number: 1, size: 8 }]);
    }
    expect((await db.query("select trainees, diet_veg, diet_gf, diet_both, contact_name from public.rota_cohorts where letter = 'ש'")).rows).toEqual([
      { trainees: 20, diet_veg: 3, diet_gf: 2, diet_both: 1, contact_name: "איש/אשת קשר לבדיקה" },
    ]);
    expect((await db.query("select phone from public.rota_cohort_contacts")).rows).toEqual([{ phone: "555 0100 91" }]);
    // the new functions there, each once; set_rota_contact's one signature
    const sigs = async (fn: string) => (await db.query("select pg_get_function_identity_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows.map((r) => r.a);
    expect(await sigs("set_rota_contact")).toEqual(["p_kind text, p_id bigint, p_phone text"]);
    expect(await sigs("rota_split_cohort")).toEqual(["p_edition bigint, p_cohort bigint, p_sizes integer[]"]);
    expect((await db.query("select count(*)::int as n from pg_proc where proname = 'rota_clean_diets'")).rows[0].n).toBe(0);
  });

  it("keeps every other row it held, and seeds nothing — «נקודות לשיחה» stay the code's own text until edited", async () => {
    // (and «נשלח לדפוס», which v19 wrote between the two runs)
    expect((await db.query("select settings from public.editions where id = $1", [ed])).rows[0].settings).toEqual({
      lesson_minutes: 75, row_minutes: 90, kk_window: kkWindow, reader_sent: { at: expect.any(String), by: adminId },
    });
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
    expect(a).toContain("con rota_assignments rota_assignments_one_duty UNIQUE (edition_id, day, shift, group_id)");
    // v18: the days' owners and the pickup time in minutes; the owners are not published
    expect(a).toContain("con day_owners day_owners_pkey PRIMARY KEY (edition_id, day, member_id)");
    expect(a).toContain("con transport_details transport_details_pickup_min_check CHECK (((pickup_min >= 0) AND (pickup_min <= 1830)))");
    expect(a).toContain("pol public.day_owners day_owners_read PERMISSIVE authenticated SELECT app.can_see_edition(edition_id) ");
    expect(a).not.toContain("pub day_owners");
    // v19: the photos' table, read by every member and never published; the old type check replaced, not doubled
    expect(a).toContain("pol public.speaker_photos speaker_photos_read PERMISSIVE authenticated SELECT ( SELECT app.is_member() AS is_member) ");
    expect(a).not.toContain("pub speaker_photos");
    expect(a.filter((x) => x.startsWith("con source_files source_files_mime_check "))).toHaveLength(1);
    expect(a.filter((x) => !b.includes(x))).toEqual([]);
    expect(b.filter((x) => !a.includes(x))).toEqual([]);
  });
});
