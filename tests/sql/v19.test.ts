// Schema v19 — the logistics home, and what the guests' site will read — in the database, as the roles a browser
// gets: a global admin, an edition's admin, the content member who handles a speaker, another content member,
// logistics, another live edition's staff, a practice week's, last year's (archived), a stranger, anon:
//   * a speaker's photo — app.photo_ok (≡ photoOk, src/domain/photo.ts: every fixture, hand-built edge cases and
//     seeded mutations through both), set_speaker_photo (who, every refusal in order, the base64 rules, a
//     non-canonical padding stored canonical, removal, the log without a byte of it), get_speaker_photo under the
//     table's policy, the table itself (read by members, written by nobody, never anon's, never in Realtime),
//     load_week's has_photo, app.member_has_history;
//   * the approval to appear — set_public_ok (set_approach_status's rule, in order) and its log line;
//   * a speaker's public words (create_speaker / update_speaker) and a lesson's note (update_lesson): the limits,
//     no phone or e-mail, who, the order of the checks, a reopen keeping the note;
//   * the guests' schedule — schedule_view's new shape: the people only with public_ok, each once by first
//     appearance, the rows' indexes, a co-speaker without an approval, taken back → gone at once, a memorial
//     slot nameless and peopleless, the grid's fixed rows by the window's rule — and nothing of a photo, a
//     speaker's words or a note reaching anon by any other door;
//   * «נשלח לדפוס» — set_reader_sent (logistics or an admin, archived for others, the stamp, its removal);
//   * presentations — p_kind on register_source_file (every refusal in order), the PowerPoint rule, the
//     week's presentation on the cover path, never the reader's or a memorial slot's;
//   * the cohorts' two flags and Saturday night's shopping list — the guards, load_rota;
//   * and the file run again on all of it: nothing lost.
// (What each command does on the engine as well is tests/parity; the rota's shared cases are tests/sql/rota.test.ts.)
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { photoOk, photoToBase64 } from "../../src/domain/photo";
import { PHOTO_FIXTURES, nonCanonical, photoBase64, photoBytes } from "../../src/testing/photos";
import { SCHEMA, dropDatabase, freshDatabase, type Claims } from "./db";

const ADMIN = "admin@example.org"; // every edition
const ED_ADMIN = "edition.admin@example.org";
const A = "a@example.org"; // content; handles «אלפא»
const B = "b@example.org"; // content; handles «בטא»
const L = "logistics@example.org";
const O_ADMIN = "other.admin@example.org"; // another live, real edition
const P_ADMIN = "practice.admin@example.org"; // a practice week
const P_C = "practice.content@example.org";
const OLD_ADMIN = "old.admin@example.org"; // last year's edition, archived
const OLD_C = "old.content@example.org";
const OLD_L = "old.logistics@example.org";
const STRANGER = "stranger@example.org";
// Synthetic: no scanner takes these for a real address or phone.
const PHONE = "טלפון 000-000-0081";
const EMAIL = "כתבו ל-speaker@example.org";
const BIO = "תיאור לדוגמה לאתר האורחים";
const BIO_SHORT = "תקציר פנימי לבדיקה";
const FALLEN = "חלל/ה לדוגמה 1";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DATA_URL = "data:image/jpeg;base64,";
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

type Run = (who: string, sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

/** A Google session with a sub of its own per address — the Storage API writes it as an object's owner_id. */
function claims(email: string): Claims {
  const hex = Buffer.from(email).toString("hex").padEnd(12, "0").slice(0, 12);
  return { sub: `00000000-0000-4000-8000-${hex}`, role: "authenticated", email, app_metadata: { provider: "google", providers: ["google"] } };
}

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

/** Every key anywhere in a JSON value. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.add(k), keysOf(x, out));
  return out;
}

// ---------------------------------------------------------------- JPEGs, byte by byte (never a picture in git)

const seg = (marker: number, body: readonly number[]): number[] => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const APP0 = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const DQT = seg(0xdb, [0x00, ...new Array<number>(64).fill(1)]);
const sof = (h: number, w: number, marker = 0xc0) => seg(marker, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]);
const DHT = [...seg(0xc4, [0x00, 1, ...new Array<number>(15).fill(0), 0]), ...seg(0xc4, [0x10, 1, ...new Array<number>(15).fill(0), 0])];
const SOS = seg(0xda, [1, 1, 0x00, 0, 63, 0]);
/** A JPEG of the given parts: SOI, the segments, the scan's entropy data, EOI (unless `end` says otherwise). */
function jpeg(segments: number[][], entropy: number[] = new Array<number>(8).fill(0), end: number[] = [0xff, 0xd9]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...segments.flat(), ...entropy, ...end]);
}
const BASE = () => [APP0, DQT, sof(16, 32), DHT, SOS];

/** A seeded run of numbers (a linear congruential generator), so a failure names its case. */
function rng(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x80000000;
  };
}

describe("schema v19 — the logistics home, and what the guests' site reads", () => {
  const dbName = `vw_v19_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let other: number;
  let practice: number;
  let old: number;
  const member: Record<string, number> = {};
  const sp: Record<string, number> = {};
  const lesson: Record<string, number> = {};
  const appr: Record<string, number> = {};
  const token: Record<string, string> = {};

  /** One transaction, always rolled back: each statement as the owner, anon or a Google member, under its own savepoint. */
  async function inTx<T>(fn: (run: Run) => Promise<T>): Promise<T> {
    await db.query("begin");
    try {
      const run: Run = async (who, sql, params = []) => {
        await db.query("savepoint s");
        try {
          if (who === "owner") await db.query("reset role");
          else if (who === "anon") {
            await db.query("set local role anon");
            await db.query("select set_config('request.jwt.claims', '', true)");
          } else {
            await db.query("set local role authenticated");
            await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims(who))]);
          }
          const r = await db.query(sql, params);
          await db.query("release savepoint s");
          return r;
        } catch (e) {
          await db.query("rollback to savepoint s");
          throw e;
        }
      };
      return await fn(run);
    } finally {
      await db.query("rollback");
      await db.query("reset role");
    }
  }
  const val = async (run: Run, who: string, sql: string, params: unknown[] = []) => Object.values((await run(who, sql, params)).rows[0] ?? {})[0];

  async function commitAs(email: string, sql: string, params: unknown[] = []): Promise<unknown> {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims(email))]);
      const r = await db.query(sql, params);
      await db.query("commit");
      return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
  const owner = async (sql: string, params: unknown[] = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];

  const speaker = async (name: string, title: string | null = null) =>
    Number(await owner("insert into public.speakers (title, name, gender, vetted) values ($1, $2, 'f', 'approved') returning id", [title, name]));
  /** `email` places the speaker in the lesson row (day, start) of edition `e` and closes the lesson. */
  async function closedLesson(email: string, e: number, s: number, day: number, start: number): Promise<number> {
    const p = Number(await commitAs(email, "select (public.propose($1, $2, null, $3, $4, $5, null) ->> 'pitch_id')::bigint", [e, s, day, start, start + 90]));
    await commitAs(email, "select public.close_lesson($1)", [p]);
    return Number(await owner("select lesson_id from public.pitches where id = $1", [p]));
  }
  const approachOf = async (e: number, s: number) => Number(await owner("select id from public.approaches where edition_id = $1 and speaker_id = $2", [e, s]));
  const versionOf = async (run: Run, id: number) => Number(await val(run, "owner", "select version from public.approaches where id = $1", [id]));
  const lessonVersion = async (run: Run, id: number) => Number(await val(run, "owner", "select version from public.lessons where id = $1", [id]));
  const room = async (e: number) => Number(await owner("select id from public.rooms where edition_id = $1 and is_default", [e]));
  /** The schedule link's answer, as anon. */
  const view = async (run: Run, t = token.ed) => (await run("anon", "select public.schedule_view($1) as v", [t])).rows[0].v;
  /** The log lines of one entity, oldest first. */
  const log = async (run: Run, entity: string, id: number, kind: string) =>
    (await run("owner", "select actor, detail from public.activity where entity = $1 and entity_id = $2 and kind = $3 order by id", [entity, id, kind])).rows.map((r) => ({
      actor: r.actor == null ? null : Number(r.actor), detail: r.detail,
    }));

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    // the live real edition, as start_edition makes it: Sunday opens 08:30, Thursday closes 19:00 (the default)
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', '2027-02-14', 510)"));
    const insert = async (label: string, kind: string, status: string) => {
      const id = Number(await owner("insert into public.editions (label, kind, status, start_date, first_day_from) values ($1, $2, $3, '2027-02-14', 510) returning id", [label, kind, status]));
      await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'בית מדרש', true)", [id]);
      await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [id]);
      return id;
    };
    other = await insert("מחזור אחר", "real", "planning");
    practice = await insert("תרגול", "practice", "planning");
    old = await insert("שנה קודמת", "real", "archived");
    for (const [email, role, edition] of [
      [ED_ADMIN, "admin", ed], [A, "content", ed], [B, "content", ed], [L, "logistics", ed], [O_ADMIN, "admin", other],
      [P_ADMIN, "admin", practice], [P_C, "content", practice], [OLD_ADMIN, "admin", old], [OLD_C, "content", old], [OLD_L, "logistics", old],
    ] as const) {
      member[email] = Number(await owner("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3) returning id", [email, role, edition]));
    }
    member[ADMIN] = Number(await owner("select id from public.members where email = $1", [ADMIN]));
    sp.alpha = await speaker("מרצה לדוגמה אלפא", "ד״ר");
    sp.beta = await speaker("מרצה לדוגמה בטא");
    sp.gamma = await speaker("מרצה לדוגמה גמא");
    sp.delta = await speaker("מרצה לדוגמה דלתא");
    sp.free = await speaker("מרצה לדוגמה חופשי/ה"); // nobody's: no approach anywhere
    // אלפא teaches Monday 10:00 and Tuesday 08:30 (A's), בטא Monday 08:30 (B's); גמא beside אלפא on Monday, with no approach
    lesson.a1 = await closedLesson(A, ed, sp.alpha, 1, 600);
    lesson.a2 = await closedLesson(A, ed, sp.alpha, 2, 510);
    lesson.b = await closedLesson(B, ed, sp.beta, 1, 510);
    await db.query("insert into public.lesson_speakers (lesson_id, speaker_id, role) values ($1, $2, 'co')", [lesson.a1, sp.gamma]);
    // a draft on Sunday with אלפא pitched — never a row of the schedule, never their first appearance
    const p = Number(await commitAs(A, "select (public.propose($1, $2, null, 0, 600, 690, null) ->> 'pitch_id')::bigint", [ed, sp.alpha]));
    lesson.draft = Number(await owner("select lesson_id from public.pitches where id = $1", [p]));
    // a memorial slot with a plan for a fallen (synthetic): its row names nobody
    lesson.memorial = Number(await owner(
      "insert into public.lessons (edition_id, kind, day, start_min, end_min, room_id, title) values ($1, 'memorial', 0, 780, 795, $2, 'זמן זיכרון') returning id", [ed, await room(ed)]));
    const fallen = Number(await owner("insert into public.fallen (name, gender) values ($1, 'm') returning id", [FALLEN]));
    await db.query("insert into public.memorial_plans (edition_id, fallen_id, lesson_id) values ($1, $2, $3)", [ed, fallen, lesson.memorial]);
    lesson.practice = await closedLesson(P_C, practice, sp.delta, 1, 510);
    appr.alpha = await approachOf(ed, sp.alpha);
    appr.beta = await approachOf(ed, sp.beta);
    appr.delta = await approachOf(practice, sp.delta);
    appr.old = Number(await owner("insert into public.approaches (edition_id, speaker_id, owner_member_id) values ($1, $2, $3) returning id", [old, sp.alpha, member[OLD_C]]));
    token.ed = (await commitAs(ED_ADMIN, "select public.issue_link($1, 'schedule')", [ed]) as { token: string }).token;
    token.other = (await commitAs(O_ADMIN, "select public.issue_link($1, 'schedule')", [other]) as { token: string }).token;
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  // ---------------------------------------------------------------- the catalog

  describe("the catalog", () => {
    it("is v19: four new functions — three definer, the photo's read invoker — and register_source_file with p_kind, one signature", async () => {
      expect(await owner("select public.schema_version()")).toBe(19);
      const fns = (await db.query(
        `select p.proname || '(' || pg_get_function_arguments(p.oid) || ') ' || pg_get_function_result(p.oid) || ' ' || p.prosecdef || ' ' || p.provolatile::text as f
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = any ($1)`,
        [["set_reader_sent", "set_speaker_photo", "get_speaker_photo", "set_public_ok", "register_source_file"]],
      )).rows.map((r) => r.f as string).sort();
      expect(fns).toEqual([
        "get_speaker_photo(p_speaker bigint) jsonb false s",
        "register_source_file(p_edition bigint, p_lesson bigint, p_path text, p_display_name text, p_pages integer, p_kind text DEFAULT 'source'::text) jsonb true v",
        "set_public_ok(p_approach bigint, p_version integer, p_ok boolean) void true v",
        "set_reader_sent(p_edition bigint, p_sent boolean) void true v",
        "set_speaker_photo(p_edition bigint, p_speaker bigint, p_photo text) void true v",
      ]);
      // app.photo_ok: immutable, and no API role runs it (it runs inside set_speaker_photo)
      expect(await owner("select provolatile from pg_proc where oid = 'app.photo_ok(bytea)'::regprocedure")).toBe("i");
      for (const role of ["anon", "authenticated"]) {
        expect(await owner("select has_function_privilege($1, 'app.photo_ok(bytea)', 'EXECUTE')", [role]), role).toBe(false);
      }
    });

    it("keeps speaker_photos to the team: one policy (SELECT, any member), SELECT for authenticated only, nothing for anon, never in Realtime", async () => {
      expect((await db.query("select policyname, permissive, roles::text[] as roles, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'speaker_photos'")).rows).toEqual([
        { policyname: "speaker_photos_read", permissive: "PERMISSIVE", roles: ["authenticated"], cmd: "SELECT", qual: "( SELECT app.is_member() AS is_member)" },
      ]);
      expect(await owner("select has_table_privilege('authenticated', 'public.speaker_photos', 'SELECT')")).toBe(true);
      expect(await owner("select has_table_privilege('authenticated', 'public.speaker_photos', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')")).toBe(false);
      expect(await owner("select has_table_privilege('anon', 'public.speaker_photos', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')")).toBe(false);
      expect(await owner("select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'speaker_photos'")).toBe(0);
      expect((await db.query("select conname, pg_get_constraintdef(oid) as c from pg_constraint where conrelid = 'public.speaker_photos'::regclass and contype = 'c'")).rows).toEqual([
        { conname: "speaker_photos_image_check", c: "CHECK (((octet_length(image) >= 100) AND (octet_length(image) <= 20480)))" },
      ]);
    });

    it("gives the new columns their checks and defaults", async () => {
      const cols = (await db.query(
        `select table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-') as c
           from information_schema.columns
          where table_schema = 'public' and (table_name, column_name) in (('speakers', 'public_bio'), ('approaches', 'public_ok'), ('lessons', 'public_note'),
                ('source_files', 'kind'), ('rota_cohorts', 'helps_rota'), ('rota_cohorts', 'can_drive'), ('rota_prep_tasks', 'kind'), ('rota_prep_tasks', 'qty'))`,
      )).rows.map((r) => r.c as string).sort();
      expect(cols).toEqual([
        "approaches.public_ok boolean NO false",
        "lessons.public_note text YES -",
        "rota_cohorts.can_drive boolean NO false",
        "rota_cohorts.helps_rota boolean NO true",
        "rota_prep_tasks.kind text NO 'task'::text",
        "rota_prep_tasks.qty text YES -",
        "source_files.kind text NO 'source'::text",
        "speakers.public_bio text YES -",
      ]);
      const checks = (await db.query(
        `select conrelid::regclass::text || ' ' || pg_get_constraintdef(oid) as c from pg_constraint
          where conname in ('speakers_public_bio_check', 'lessons_public_note_check', 'source_files_kind_check', 'source_files_pptx_kind',
                            'rota_prep_tasks_kind_check', 'rota_prep_tasks_qty_check', 'source_files_mime_check')`,
      )).rows.map((r) => r.c as string).sort();
      expect(checks).toEqual([
        "lessons CHECK ((char_length(public_note) <= 400))",
        "rota_prep_tasks CHECK ((char_length(qty) <= 40))",
        "rota_prep_tasks CHECK ((kind = ANY (ARRAY['task'::text, 'item'::text])))",
        `source_files CHECK (((mime <> '${PPTX}'::text) OR (kind = 'presentation'::text)))`,
        "source_files CHECK ((kind = ANY (ARRAY['source'::text, 'presentation'::text])))",
        `source_files CHECK ((mime = ANY (ARRAY['${PDF}'::text, 'image/png'::text, 'image/jpeg'::text, '${DOCX}'::text, '${PPTX}'::text])))`,
        "speakers CHECK ((char_length(public_bio) <= 600))",
      ]);
    });
  });

  // ---------------------------------------------------------------- the photo's grammar

  describe("app.photo_ok ≡ photoOk (src/domain/photo.ts)", () => {
    const sqlOk = async (bytes: Uint8Array[]): Promise<boolean[]> =>
      (await db.query("select app.photo_ok(decode(t.h, 'hex')) as ok from unnest($1::text[]) with ordinality as t(h, o) order by t.o",
        [bytes.map((b) => Buffer.from(b).toString("hex"))])).rows.map((r) => r.ok);

    it("answers every fixture as the browser does: the clean one passes, the rest are refused", async () => {
      const all = PHOTO_FIXTURES.map((f) => photoBytes(f));
      expect(await sqlOk(all)).toEqual(PHOTO_FIXTURES.map((f) => f === "clean"));
      expect(all.map((b) => photoOk(b))).toEqual(PHOTO_FIXTURES.map((f) => f === "clean"));
      expect(await owner("select app.photo_ok(null)")).toBe(false);
    });

    it("holds the grammar, case by case — the same answer in both", async () => {
      const MIN = () => [sof(16, 32), SOS]; // a frame and a scan: 27 bytes before the scan data
      const sized = (n: number, parts = BASE()) => jpeg(parts, new Array<number>(n - jpeg(parts, []).length).fill(0));
      const cases: [string, Uint8Array, boolean][] = [
        ["the base", jpeg(BASE()), true],
        ["stuffed bytes and restart markers in the scan", jpeg(BASE(), [0, 0xff, 0x00, 1, 0xff, 0xd0, 2, 0xff, 0xd7, 0]), true],
        ["an FF right before the end marker", jpeg(BASE(), [0, 0, 0, 0xff]), false],
        ["any other marker inside the scan", jpeg(BASE(), [0, 0xff, 0xc4, 0]), false],
        ["a second scan", jpeg(BASE(), [0, 0, ...SOS, 0, 0]), false],
        ["no scan data at all", jpeg(BASE(), []), true],
        ["APP14 (Adobe) and DRI", jpeg([APP0, seg(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 1]), seg(0xdd, [0, 4]), DQT, sof(16, 32), DHT, SOS]), true],
        ["two APP0", jpeg([APP0, APP0, DQT, sof(16, 32), DHT, SOS]), true],
        ["APP0 that is not JFIF", jpeg([seg(0xe0, [0x4a, 0x46, 0x58, 0x58, 0x00, 1]), DQT, sof(16, 32), DHT, SOS]), false],
        ["APP0 too short for «JFIF\\0»", jpeg([seg(0xe0, [0x4a, 0x46, 0x49, 0x46]), DQT, sof(16, 32), DHT, SOS]), false],
        ["no APP0 at all", jpeg([DQT, sof(16, 32), DHT, SOS]), true],
        ["APP1 (EXIF)", jpeg([APP0, seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0]), DQT, sof(16, 32), DHT, SOS]), false],
        ["APP2 (ICC)", jpeg([APP0, seg(0xe2, [1, 2, 3]), DQT, sof(16, 32), DHT, SOS]), false],
        ["APP13", jpeg([APP0, seg(0xed, [1, 2, 3]), DQT, sof(16, 32), DHT, SOS]), false],
        ["APP15", jpeg([APP0, seg(0xef, [1, 2, 3]), DQT, sof(16, 32), DHT, SOS]), false],
        ["a comment", jpeg([APP0, seg(0xfe, [0x41, 0x42]), DQT, sof(16, 32), DHT, SOS]), false],
        ["SOF1 (extended)", jpeg([APP0, DQT, sof(16, 32, 0xc1), DHT, SOS]), true],
        ["SOF2 (progressive)", jpeg([APP0, DQT, sof(16, 32, 0xc2), DHT, SOS]), false],
        ["SOF3 (lossless)", jpeg([APP0, DQT, sof(16, 32, 0xc3), DHT, SOS]), false],
        ["two frames", jpeg([APP0, DQT, sof(16, 32), sof(16, 32), DHT, SOS]), false],
        ["no frame before the scan", jpeg([APP0, DQT, DHT, SOS, sof(16, 32)]), false],
        ["a frame of 512 × 512", jpeg([APP0, DQT, sof(512, 512), DHT, SOS]), true],
        ["513 high", jpeg([APP0, DQT, sof(513, 32), DHT, SOS]), false],
        ["513 wide", jpeg([APP0, DQT, sof(16, 513), DHT, SOS]), false],
        ["0 high", jpeg([APP0, DQT, sof(0, 32), DHT, SOS]), false],
        ["0 wide", jpeg([APP0, DQT, sof(16, 0), DHT, SOS]), false],
        ["a frame segment too short", jpeg([APP0, DQT, seg(0xc0, [8, 0, 16, 0, 32]), DHT, SOS]), false],
        ["a fill byte before a marker", new Uint8Array([0xff, 0xd8, 0xff, ...APP0, ...DQT, ...sof(16, 32), ...DHT, ...SOS, 0, 0, 0, 0, 0xff, 0xd9]), false],
        ["a length of 1", new Uint8Array([0xff, 0xd8, ...APP0, ...DQT, 0xff, 0xdd, 0, 1, ...sof(16, 32), ...DHT, ...SOS, ...new Array(8).fill(0), 0xff, 0xd9]), false],
        ["a segment running past the end", new Uint8Array([0xff, 0xd8, ...APP0, ...DQT, ...sof(16, 32), ...DHT, 0xff, 0xdd, 0x7f, 0xff, 0, 0]), false],
        ["no start marker", jpeg(BASE()).slice(2), false],
        ["bytes after the end", jpeg(BASE(), new Array(8).fill(0), [0xff, 0xd9, 0]), false],
        ["no end marker", jpeg(BASE(), new Array(8).fill(0), [0, 0]), false],
        ["the end marker alone, no scan", jpeg([APP0, DQT, sof(16, 32), DHT], [], [0xff, 0xd9]), false],
        ["a frame and a scan alone", jpeg(MIN(), new Array(80).fill(0)), true],
        ["99 bytes", sized(99, MIN()), false],
        ["100 bytes", sized(100, MIN()), true],
        ["20480 bytes", sized(20480), true],
        ["20481 bytes", sized(20481), false],
      ];
      expect([sized(99, MIN()).length, sized(100, MIN()).length, sized(20480).length, sized(20481).length]).toEqual([99, 100, 20480, 20481]);
      const sql = await sqlOk(cases.map((c) => c[1]));
      expect(cases.map((c, i) => `${c[0]}: ${sql[i]}`)).toEqual(cases.map((c) => `${c[0]}: ${c[2]}`));
      expect(cases.map((c) => `${c[0]}: ${photoOk(c[1])}`)).toEqual(cases.map((c) => `${c[0]}: ${c[2]}`));
    });

    it("gives the same answer as the browser on 600 seeded mutations of a clean photo — passing and failing alike", async () => {
      const next = rng(19);
      const int = (n: number) => Math.floor(next() * n);
      const clean = photoBytes("clean");
      const scan = clean.length - 2 - 2; // the clean file's last entropy bytes sit just before FFD9
      const variants: Uint8Array[] = [];
      for (let k = 0; k < 600; k++) {
        const b = [...clean];
        switch (k % 8) {
          case 0: b[scan - int(2)] = int(256); break; // a byte of the scan
          case 1: b[int(b.length)] = int(256); break; // any byte
          case 2: b.length = int(b.length); break; // cut short
          case 3: b.push(...Array.from({ length: 1 + int(4) }, () => int(256))); break; // something after the end
          case 4: { // the frame's size
            const at = b.findIndex((x, i) => x === 0xff && b[i + 1] === 0xc0);
            const h = int(600);
            const w = int(600);
            b.splice(at + 5, 4, h >> 8, h & 0xff, w >> 8, w & 0xff);
            break;
          }
          case 5: b.splice(scan - int(2), 0, 0xff, int(256)); break; // a marker in the scan
          case 6: b.splice(2, 0, ...seg(0xc0 + int(64), Array.from({ length: int(12) }, () => int(256)))); break; // a segment of any kind, first
          case 7: b.splice(b.length - 2, 0, ...Array.from({ length: 1 + int(40) }, () => (int(4) === 0 ? 0xff : int(256)))); break; // more scan data
        }
        variants.push(new Uint8Array(b.map((x) => x & 0xff)));
      }
      const sql = await sqlOk(variants);
      const js = variants.map((v) => photoOk(v));
      const differ = variants.map((_, i) => [i, sql[i], js[i]]).filter(([, s, j]) => s !== j);
      expect(differ).toEqual([]);
      // both answers occur, often
      expect(js.filter(Boolean).length).toBeGreaterThan(60);
      expect(js.filter((x) => !x).length).toBeGreaterThan(60);
    });
  });

  // ---------------------------------------------------------------- set_speaker_photo / get_speaker_photo

  describe("a speaker's photo — set_speaker_photo", () => {
    const set = (run: Run, who: string, e: number, s: number, photo: string | null) => code(run(who, "select public.set_speaker_photo($1, $2, $3)", [e, s, photo]));
    const stored = async (run: Run, s: number) =>
      (await run("owner", "select encode(image, 'hex') as h, uploaded_by from public.speaker_photos where speaker_id = $1", [s])).rows.map((r) => ({
        hex: r.h as string, by: r.uploaded_by == null ? null : Number(r.uploaded_by),
      }));
    const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

    it("refuses in the contract's order: not a member, logistics, an archive's content, a speaker gone, not theirs to edit — before the photo is read", async () => {
      await inTx(async (run) => {
        const garbage = photoBase64("garbage");
        expect(await set(run, STRANGER, ed, sp.alpha, photoBase64("clean"))).toBe("not_member");
        expect(await set(run, A, ed + 1000, sp.alpha, photoBase64("clean"))).toBe("not_member");
        expect(await set(run, L, ed, sp.alpha, garbage)).toBe("forbidden");
        expect(await set(run, OLD_C, old, sp.alpha, garbage)).toBe("archived");
        expect(await set(run, A, ed, -1, garbage)).toBe("stale");
        expect(await set(run, A, ed, sp.free, garbage)).toBe("not_handler"); // nobody's
        expect(await set(run, B, ed, sp.alpha, garbage)).toBe("not_handler"); // A's
        expect(await set(run, B, ed, sp.alpha, null)).toBe("not_handler");
        // a practice week gives no right over the pool's speakers — its handler and admin alike; an archived edition's admin neither
        expect(await set(run, P_C, practice, sp.delta, photoBase64("clean"))).toBe("not_handler");
        expect(await set(run, P_ADMIN, practice, sp.delta, photoBase64("clean"))).toBe("not_handler");
        expect(await set(run, OLD_ADMIN, old, sp.alpha, photoBase64("clean"))).toBe("not_handler");
        expect(await stored(run, sp.alpha)).toEqual([]);
        expect(await run("owner", "select count(*)::int as n from public.activity where kind = 'photo'").then((r) => r.rows[0].n)).toBe(0);
        // who may: the handler, the edition's admin (any speaker), a global admin (anywhere)
        expect(await set(run, A, ed, sp.alpha, photoBase64("clean"))).toBe("ok");
        expect(await set(run, ED_ADMIN, ed, sp.free, photoBase64("clean"))).toBe("ok");
        expect(await set(run, ADMIN, practice, sp.delta, photoBase64("clean"))).toBe("ok");
      });
    });

    it("takes only base64 of a photo app.photo_ok accepts — every other text is bad_file", async () => {
      await inTx(async (run) => {
        for (const f of PHOTO_FIXTURES.filter((x) => x !== "clean")) expect(await set(run, A, ed, sp.alpha, photoBase64(f)), f).toBe("bad_file");
        const clean = photoBase64("clean");
        const bad: [string, string][] = [
          ["empty", ""], ["three characters", "abc"], ["a space", `${clean.slice(0, 8)} ${clean.slice(9)}`], ["a line break", `${clean.slice(0, 76)}\n${clean.slice(76, -1)}`],
          ["url-safe letters", clean.replace(/\+/g, "-").replace(/\//g, "_").replace(/^./, "-")], ["«=» inside", `${clean.slice(0, 4)}=${clean.slice(5)}`],
          ["three «=»", `${clean.slice(0, -3)}===`], ["not a multiple of four", clean.slice(0, -1)], ["a data: URL", `${DATA_URL}${clean}`],
          ["too long", "A".repeat(27312)], ["27308 characters that are no photo", "A".repeat(27308)],
        ];
        for (const [name, text] of bad) expect(await set(run, A, ed, sp.alpha, text), name).toBe("bad_file");
        expect(await stored(run, sp.alpha)).toEqual([]);
      });
    });

    it("stores the bytes (a non-canonical padding read as Postgres reads it), replaces them, removes them with NULL — and logs {set} alone", async () => {
      await inTx(async (run) => {
        expect(await set(run, A, ed, sp.alpha, photoBase64("clean"))).toBe("ok");
        expect(await stored(run, sp.alpha)).toEqual([{ hex: hex(photoBytes("clean")), by: member[A] }]);
        // the same bytes in a base64 whose padding bits are not zero — stored as the same bytes, read back canonical
        expect(await set(run, ED_ADMIN, ed, sp.alpha, nonCanonical(photoBase64("clean")))).toBe("ok");
        expect(await stored(run, sp.alpha)).toEqual([{ hex: hex(photoBytes("clean")), by: member[ED_ADMIN] }]);
        expect(((await val(run, A, "select public.get_speaker_photo($1)", [sp.alpha])) as { photo: string }).photo).toBe(photoBase64("clean"));
        // another photo replaces it
        const another = jpeg(BASE(), new Array<number>(200).fill(0));
        expect(await set(run, A, ed, sp.alpha, photoToBase64(another))).toBe("ok");
        expect(await stored(run, sp.alpha)).toEqual([{ hex: hex(another), by: member[A] }]);
        // removed; removing again writes and logs nothing
        expect(await set(run, A, ed, sp.alpha, null)).toBe("ok");
        expect(await stored(run, sp.alpha)).toEqual([]);
        expect(await set(run, A, ed, sp.alpha, null)).toBe("ok");
        expect(await log(run, "speakers", sp.alpha, "photo")).toEqual([
          { actor: member[A], detail: { set: true } },
          { actor: member[ED_ADMIN], detail: { set: true } },
          { actor: member[A], detail: { set: true } },
          { actor: member[A], detail: { set: false } },
        ]);
        // the speaker's own row and version are untouched — a photo is not an edit of the record
        expect(Number(await val(run, "owner", "select version from public.speakers where id = $1", [sp.alpha]))).toBe(1);
      });
    });

    it("is read one speaker at a time by any member (get_speaker_photo, invoker) — canonical base64 with no line breaks — and by nobody else", async () => {
      await inTx(async (run) => {
        await run(A, "select public.set_speaker_photo($1, $2, $3)", [ed, sp.alpha, photoBase64("clean")]);
        const b64 = photoBase64("clean");
        expect(b64.length).toBeGreaterThan(76); // encode() breaks lines at 76: the read takes them out
        for (const who of [A, B, L, ED_ADMIN, ADMIN, P_C, OLD_C, O_ADMIN]) {
          const r = (await val(run, who, "select public.get_speaker_photo($1)", [sp.alpha])) as { photo: string; uploaded_at: string };
          expect(Object.keys(r).sort(), who).toEqual(["photo", "uploaded_at"]);
          expect(r.photo, who).toBe(b64);
          expect(r.uploaded_at, who).toMatch(ISO);
        }
        expect(await val(run, A, "select public.get_speaker_photo($1)", [sp.beta])).toBeNull(); // none stored
        expect(await val(run, STRANGER, "select public.get_speaker_photo($1)", [sp.alpha])).toBeNull(); // the policy hides it
        expect(await code(run("anon", "select public.get_speaker_photo($1)", [sp.alpha]))).toBe("42501");
        // the table: read under its policy, written by nobody, nothing for anon
        expect((await run(B, "select speaker_id from public.speaker_photos")).rows.map((r) => Number(r.speaker_id))).toEqual([sp.alpha]);
        expect((await run(STRANGER, "select speaker_id from public.speaker_photos")).rows).toEqual([]);
        for (const sql of [
          "insert into public.speaker_photos (speaker_id, image) values ($1, '\\x00'::bytea)",
          "update public.speaker_photos set uploaded_by = null where speaker_id = $1",
          "delete from public.speaker_photos where speaker_id = $1",
        ]) {
          for (const who of [ADMIN, ED_ADMIN, A]) expect(await code(run(who, sql, [sp.alpha])), `${who}: ${sql}`).toBe("42501");
        }
        expect(await code(run("anon", "select * from public.speaker_photos"))).toBe("42501");
        // the table's own bounds (set_speaker_photo never reaches them: photo_ok holds the same)
        expect(await code(run("owner", "insert into public.speaker_photos (speaker_id, image) values ($1, decode(repeat('00', 99), 'hex'))", [sp.beta]))).toBe("23514");
        expect(await code(run("owner", "insert into public.speaker_photos (speaker_id, image) values ($1, decode(repeat('00', 20481), 'hex'))", [sp.beta]))).toBe("23514");
      });
    });

    it("comes in load_week as has_photo alone — never the bytes — and goes with the speaker", async () => {
      await inTx(async (run) => {
        await run(A, "select public.set_speaker_photo($1, $2, $3)", [ed, sp.alpha, photoBase64("clean")]);
        const w = (await val(run, B, "select public.load_week($1)", [ed])) as { speakers: { id: number; has_photo: boolean }[] };
        expect(w.speakers.filter((s) => s.has_photo).map((s) => Number(s.id))).toEqual([sp.alpha]);
        expect(w.speakers.every((s) => typeof s.has_photo === "boolean")).toBe(true);
        const text = JSON.stringify(w);
        expect(text).not.toContain(photoBase64("clean").slice(0, 40));
        expect(text).not.toContain("data:image");
        for (const k of ["image", "photo"]) expect(keysOf(w).has(k), k).toBe(false);
        // a speaker deleted (unseed_gate.sql deletes the gate's synthetic ones) takes their photo
        await run(ED_ADMIN, "select public.set_speaker_photo($1, $2, $3)", [ed, sp.free, photoBase64("clean")]);
        await run("owner", "delete from public.speakers where id = $1", [sp.free]);
        expect(Number(await val(run, "owner", "select count(*) from public.speaker_photos where speaker_id = $1", [sp.free]))).toBe(0);
      });
    });

    it("counts an upload as a member's history (deactivate, never delete)", async () => {
      await inTx(async (run) => {
        const x = Number(await val(run, "owner", "insert into public.members (email, display_name, role, edition_id) values ('photo.only@example.org', 'x', 'content', $1) returning id", [ed]));
        expect(await val(run, "owner", "select app.member_has_history($1)", [x])).toBe(false);
        await run("owner", "insert into public.speaker_photos (speaker_id, image, uploaded_by) select $1, image, $2 from (select decode($3, 'hex') as image) i", [sp.beta, x, hex(photoBytes("clean"))]);
        expect(await val(run, "owner", "select app.member_has_history($1)", [x])).toBe(true);
        expect(await code(run(ED_ADMIN, "delete from public.members where id = $1", [x]))).toBe("member_has_history");
      });
    });
  });

  // ---------------------------------------------------------------- set_public_ok

  describe("the approval to appear — set_public_ok", () => {
    const set = (run: Run, who: string, a: number, v: number, ok: boolean | null) => code(run(who, "select public.set_public_ok($1, $2, $3)", [a, v, ok]));

    it("refuses in set_approach_status's order: an approach gone, not a member, logistics, an archive's content, not the handler, a stale version, a null", async () => {
      await inTx(async (run) => {
        const v = await versionOf(run, appr.alpha);
        expect(await set(run, STRANGER, -1, 1, true)).toBe("stale");
        expect(await set(run, A, -1, 1, true)).toBe("stale");
        expect(await set(run, STRANGER, appr.alpha, v, true)).toBe("not_member");
        expect(await set(run, O_ADMIN, appr.alpha, v, true)).toBe("not_member"); // another edition's admin
        expect(await set(run, L, appr.alpha, v, true)).toBe("forbidden");
        expect(await set(run, L, appr.alpha, v, null)).toBe("forbidden");
        expect(await set(run, OLD_C, appr.old, 1, true)).toBe("archived");
        expect(await set(run, B, appr.alpha, v, true)).toBe("not_handler");
        expect(await set(run, A, appr.alpha, v + 1, true)).toBe("stale");
        expect(await set(run, A, appr.alpha, v + 1, null)).toBe("stale"); // the version first
        expect(await set(run, A, appr.alpha, v, null)).toBe("bad_value");
        expect(await versionOf(run, appr.alpha)).toBe(v);
        expect(await val(run, "owner", "select public_ok from public.approaches where id = $1", [appr.alpha])).toBe(false);
      });
    });

    it("writes the flag and the version — the same value again writes nothing — and the log line carries public_ok", async () => {
      await inTx(async (run) => {
        const v = await versionOf(run, appr.alpha);
        const before = (await log(run, "approaches", appr.alpha, "update")).length;
        expect(await set(run, A, appr.alpha, v, false)).toBe("ok"); // unchanged
        expect(await versionOf(run, appr.alpha)).toBe(v);
        expect((await log(run, "approaches", appr.alpha, "update")).length).toBe(before);
        expect(await set(run, A, appr.alpha, v, true)).toBe("ok");
        expect(await versionOf(run, appr.alpha)).toBe(v + 1);
        expect(await set(run, A, appr.alpha, v + 1, true)).toBe("ok"); // unchanged again: no bump
        expect(await versionOf(run, appr.alpha)).toBe(v + 1);
        // an admin of the edition, not the handler, takes it back
        expect(await set(run, ED_ADMIN, appr.alpha, v + 1, false)).toBe("ok");
        const lines = (await log(run, "approaches", appr.alpha, "update")).slice(before);
        expect(lines).toEqual([
          { actor: member[A], detail: { status: "positive", owner: member[A], speaker: sp.alpha, public_ok: true } },
          { actor: member[ED_ADMIN], detail: { status: "positive", owner: member[A], speaker: sp.alpha, public_ok: false } },
        ]);
        // the call's result written again, with a word: its line says nothing of the approval
        await run(A, "select public.set_approach_status($1, $2, 'positive', 'הערה לדוגמה')", [appr.alpha, v + 2]);
        expect((await log(run, "approaches", appr.alpha, "update")).at(-1)?.detail).toEqual({ status: "positive", owner: member[A], speaker: sp.alpha, note: "הערה לדוגמה" });
        // in load_week, for the team
        await run(A, "select public.set_public_ok($1, $2, true)", [appr.alpha, v + 3]);
        const w = (await val(run, L, "select public.load_week($1)", [ed])) as { approaches: { id: number; public_ok: boolean }[] };
        expect(w.approaches.map((a) => [Number(a.id), a.public_ok])).toEqual([[appr.alpha, true], [appr.beta, false]].sort((x, y) => (x[0] as number) - (y[0] as number)));
        // a practice week's handler may mark their own (the rule has no gate on the edition's kind)
        expect(await set(run, P_C, appr.delta, await versionOf(run, appr.delta), true)).toBe("ok");
      });
    });

    it("starts every year without it: start_edition copies no approach", async () => {
      await inTx(async (run) => {
        await run(A, "select public.set_public_ok($1, $2, true)", [appr.alpha, await versionOf(run, appr.alpha)]);
        const next = Number(await val(run, ADMIN, "select public.start_edition('תשפ\"ח', '2028-02-13', 510)"));
        expect(Number(await val(run, "owner", "select count(*) from public.approaches where edition_id = $1", [next]))).toBe(0);
      });
    });
  });

  // ---------------------------------------------------------------- public_bio, public_note

  describe("a speaker's public words — create_speaker / update_speaker", () => {
    const update = (run: Run, who: string, s: number, patch: Record<string, unknown>, e = ed) =>
      run("owner", "select version from public.speakers where id = $1", [s]).then((r) =>
        code(run(who, "select public.update_speaker($1, $2, $3, $4::jsonb)", [e, s, Number(r.rows[0].version), JSON.stringify(patch)])));

    it("cleans them as a block of ≤ 600 with no phone or e-mail — on create", async () => {
      await inTx(async (run) => {
        const create = (bio: unknown, name: string) => val(run, A, "select public.create_speaker($1, $2::jsonb, false, false, true) ->> 'speaker_id'", [ed, JSON.stringify({ name, public_bio: bio })]);
        const id = Number(await create("  שורה ראשונה  \r\nשורה שנייה \t", "מרצה לדוגמה חדש/ה 1"));
        expect(await val(run, "owner", "select public_bio from public.speakers where id = $1", [id])).toBe("שורה ראשונה  \nשורה שנייה");
        expect(await code(create("א".repeat(601), "מרצה לדוגמה חדש/ה 2"))).toBe("bad_value");
        expect(Number(await create("א".repeat(600), "מרצה לדוגמה חדש/ה 3"))).toBeGreaterThan(0);
        expect(await code(create(PHONE, "מרצה לדוגמה חדש/ה 4"))).toBe("contact_in_text");
        expect(await code(create(EMAIL, "מרצה לדוגמה חדש/ה 5"))).toBe("contact_in_text");
        expect(await val(run, "owner", "select public_bio from public.speakers where id = $1", [Number(await create("   ", "מרצה לדוגמה חדש/ה 6"))])).toBeNull();
        // the log of a new speaker is as before
        expect((await log(run, "speakers", id, "insert")).map((l) => l.detail)).toEqual([{ vetted: "pending" }]);
      });
    });

    it("on update: who may edit the record, the checks after bio_short and before topics, the field logged by name", async () => {
      await inTx(async (run) => {
        expect(await update(run, L, sp.alpha, { public_bio: BIO })).toBe("forbidden");
        expect(await update(run, B, sp.alpha, { public_bio: BIO })).toBe("not_handler");
        expect(await update(run, P_C, sp.delta, { public_bio: BIO }, practice)).toBe("not_handler"); // a practice week gives no right over the pool
        expect(await update(run, A, sp.alpha, { public_bio: "א".repeat(601) })).toBe("bad_value");
        expect(await update(run, A, sp.alpha, { public_bio: PHONE })).toBe("contact_in_text");
        expect(await update(run, A, sp.alpha, { public_bio: EMAIL })).toBe("contact_in_text");
        expect(await update(run, A, sp.alpha, { bio_short: "א".repeat(401), public_bio: PHONE })).toBe("bad_value"); // bio_short first
        expect(await update(run, A, sp.alpha, { public_bio: PHONE, topics: "x" })).toBe("contact_in_text"); // then public_bio, then topics
        expect(Number(await val(run, "owner", "select version from public.speakers where id = $1", [sp.alpha]))).toBe(1);
        expect(await update(run, A, sp.alpha, { public_bio: `  ${BIO}  ` })).toBe("ok");
        expect(await update(run, A, sp.alpha, { public_bio: BIO })).toBe("ok"); // the same: nothing written
        expect(await update(run, A, sp.alpha, { bio_short: BIO_SHORT, public_bio: "א".repeat(600) })).toBe("ok");
        expect(await update(run, ED_ADMIN, sp.alpha, { public_bio: null })).toBe("ok");
        expect((await log(run, "speakers", sp.alpha, "update")).map((l) => l.detail)).toEqual([
          { fields: ["public_bio"] }, { fields: ["bio_short", "public_bio"] }, { fields: ["public_bio"] },
        ]);
        expect(Number(await val(run, "owner", "select version from public.speakers where id = $1", [sp.alpha]))).toBe(4);
        expect(await update(run, A, sp.alpha, { public_bio: BIO })).toBe("ok");
        const w = (await val(run, L, "select public.load_week($1)", [ed])) as { speakers: { id: number; public_bio: string | null }[] };
        expect(w.speakers.find((s) => Number(s.id) === sp.alpha)?.public_bio).toBe(BIO);
      });
    });
  });

  describe("a lesson's note for guests — update_lesson's public_note", () => {
    const patch = async (run: Run, who: string, l: number, p: Record<string, unknown>, by = 0) =>
      code(run(who, "select public.update_lesson($1, $2, $3::jsonb)", [l, (await lessonVersion(run, l)) + by, JSON.stringify(p)]));
    const note = (run: Run, l: number) => val(run, "owner", "select public_note from public.lessons where id = $1", [l]);

    it("is a block of ≤ 400 with no phone or e-mail, after the shape's checks and the version, for the grid's editors", async () => {
      await inTx(async (run) => {
        expect(await patch(run, L, lesson.a1, { public_note: "שיעור לדוגמה" })).toBe("forbidden");
        expect(await patch(run, A, lesson.a1, { public_note: "א".repeat(401) }, 1)).toBe("stale"); // the version first
        expect(await patch(run, A, lesson.a1, { teach_min: 0, public_note: "א".repeat(401) })).toBe("bad_shape");
        expect(await patch(run, A, lesson.a1, { public_note: "א".repeat(401) })).toBe("bad_value");
        expect(await patch(run, A, lesson.a1, { public_note: PHONE })).toBe("contact_in_text");
        expect(await patch(run, A, lesson.a1, { public_note: EMAIL })).toBe("contact_in_text");
        expect(await patch(run, A, lesson.memorial, { public_note: "שיעור לדוגמה" })).toBe("memorial_slot");
        expect(await note(run, lesson.a1)).toBeNull();
        expect(await patch(run, A, lesson.a1, { public_note: "  שיעור לדוגמה\r\nבשתי שורות  " })).toBe("ok");
        expect(await note(run, lesson.a1)).toBe("שיעור לדוגמה\nבשתי שורות");
        expect(await patch(run, A, lesson.a1, { public_note: "א".repeat(400) })).toBe("ok");
        expect(await patch(run, A, lesson.a1, { public_note: 5 })).toBe("ok"); // a number, written out as ->> reads it
        expect(await note(run, lesson.a1)).toBe("5");
        expect(await patch(run, A, lesson.a1, { title: "כותרת לדוגמה" })).toBe("ok"); // a patch without the key keeps it
        expect(await note(run, lesson.a1)).toBe("5");
        expect(await patch(run, B, lesson.draft, { public_note: "טיוטה לדוגמה" })).toBe("ok"); // a draft's too
        expect(await patch(run, A, lesson.a1, { public_note: "   " })).toBe("ok");
        expect(await note(run, lesson.a1)).toBeNull();
      });
    });

    it("stays through a reopen, like the title, and comes in load_week with the lesson", async () => {
      await inTx(async (run) => {
        expect(await patch(run, A, lesson.a2, { public_note: "שיעור לדוגמה" })).toBe("ok");
        expect(await code(run(A, "select public.reopen_lesson($1)", [lesson.a2]))).toBe("ok");
        expect(await val(run, "owner", "select state from public.lessons where id = $1", [lesson.a2])).toBe("draft");
        expect(await note(run, lesson.a2)).toBe("שיעור לדוגמה");
        const w = (await val(run, L, "select public.load_week($1)", [ed])) as { lessons: { id: number; public_note: string | null }[] };
        expect(w.lessons.find((l) => Number(l.id) === lesson.a2)?.public_note).toBe("שיעור לדוגמה");
        expect(w.lessons.every((l) => "public_note" in l)).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------- schedule_view

  describe("the guests' schedule — schedule_view", () => {
    interface Row { kind: string; day: number; start_min: number; speaker: string; note: string | null; people: number[] }
    interface View { edition: unknown; rows: Row[]; people: { label: string; bio: string | null; photo: string | null }[]; fixed: { day: number; start_min: number; end_min: number; label: string }[] }
    const rowsOf = (v: View) => v.rows.map((r) => `${r.kind}|${r.day}|${r.start_min}|${r.speaker || "-"}|note=${r.note ?? "-"}|people=${r.people.join(",") || "-"}`);
    const peopleOf = (v: View) => v.people.map((p) => `${p.label}|bio=${p.bio ?? "-"}|photo=${p.photo == null ? "-" : p.photo === DATA_URL + photoBase64("clean") ? "clean" : "other"}`);
    const ALPHA = "ד״ר מרצה לדוגמה אלפא";
    const BETA = "מרצה לדוגמה בטא";
    const GAMMA = "מרצה לדוגמה גמא";
    const okFor = async (run: Run, who: string, a: number, ok = true) => run(who, "select public.set_public_ok($1, $2, $3)", [a, await versionOf(run, a), ok]);

    it("answers {edition, rows, people, fixed}: the rows as before plus a note and people — nobody until someone marks public_ok", async () => {
      await inTx(async (run) => {
        const v = (await view(run)) as View;
        expect(Object.keys(v).sort()).toEqual(["edition", "fixed", "people", "rows"]);
        expect(v.edition).toEqual({ label: "תשפ\"ז", start_date: "2027-02-14" });
        for (const r of v.rows) {
          expect(Object.keys(r).sort()).toEqual(["category", "date", "day", "end_min", "kind", "note", "parallel", "people", "room", "speaker", "start_min", "title"]);
        }
        // the draft is no row; the memorial slot is, and names nobody
        expect(rowsOf(v)).toEqual([
          "memorial|0|780|-|note=-|people=-",
          `lesson|1|510|${BETA}|note=-|people=-`,
          `lesson|1|600|${ALPHA} · ${GAMMA}|note=-|people=-`,
          `lesson|2|510|${ALPHA}|note=-|people=-`,
        ]);
        expect(v.people).toEqual([]);
        expect(JSON.stringify(v)).not.toContain(FALLEN);
      });
    });

    it("shows a speaker only while their approach in the link's edition has public_ok — each once, by first appearance, the rows pointing at them", async () => {
      await inTx(async (run) => {
        await okFor(run, A, appr.alpha);
        let v = (await view(run)) as View;
        expect(peopleOf(v)).toEqual([`${ALPHA}|bio=-|photo=-`]);
        expect(rowsOf(v).slice(1)).toEqual([
          `lesson|1|510|${BETA}|note=-|people=-`,
          `lesson|1|600|${ALPHA} · ${GAMMA}|note=-|people=0`, // גמא, beside: no approach — in the names, not among the people
          `lesson|2|510|${ALPHA}|note=-|people=0`,
        ]);
        // the public words and the photo; the team's own words never
        await run(A, "select public.update_speaker($1, $2, 1, $3::jsonb)", [ed, sp.alpha, JSON.stringify({ public_bio: BIO, bio_short: BIO_SHORT })]);
        await run(A, "select public.set_speaker_photo($1, $2, $3)", [ed, sp.alpha, photoBase64("clean")]);
        v = (await view(run)) as View;
        expect(peopleOf(v)).toEqual([`${ALPHA}|bio=${BIO}|photo=clean`]);
        expect(JSON.stringify(v)).not.toContain(BIO_SHORT);
        // בטא teaches first (Monday 08:30): first among the people, the indexes shift
        await okFor(run, B, appr.beta);
        v = (await view(run)) as View;
        expect(peopleOf(v)).toEqual([`${BETA}|bio=-|photo=-`, `${ALPHA}|bio=${BIO}|photo=clean`]);
        expect(rowsOf(v).slice(1).map((r) => r.split("|").at(-1))).toEqual(["people=0", "people=1", "people=1"]);
        // גמא approved in ANOTHER edition: still nobody here
        const elsewhere = Number(await val(run, "owner", "insert into public.approaches (edition_id, speaker_id, public_ok) values ($1, $2, true) returning id", [other, sp.gamma]));
        expect(peopleOf((await view(run)) as View)).toHaveLength(2);
        // …and the other edition's link shows nobody of this edition's
        expect(((await view(run, token.other)) as View).people).toEqual([]);
        // גמא approved here: after the lead in that lesson
        const here = Number(await val(run, ED_ADMIN, "select public.claim_speaker($1, $2)", [ed, sp.gamma]));
        await okFor(run, ED_ADMIN, here);
        v = (await view(run)) as View;
        expect(peopleOf(v).map((p) => p.split("|")[0])).toEqual([BETA, ALPHA, GAMMA]);
        expect(rowsOf(v).slice(1).map((r) => r.split("|").at(-1))).toEqual(["people=0", "people=1,2", "people=1"]);
        // taken back: gone at once, the indexes close up — the words and the photo with them
        await okFor(run, A, appr.alpha, false);
        v = (await view(run)) as View;
        expect(peopleOf(v).map((p) => p.split("|")[0])).toEqual([BETA, GAMMA]);
        expect(rowsOf(v).slice(1).map((r) => r.split("|").at(-1))).toEqual(["people=0", "people=1", "people=-"]);
        const text = JSON.stringify(v);
        expect(text).not.toContain(BIO);
        expect(text).not.toContain("data:image");
        expect(elsewhere).toBeGreaterThan(0);
      });
    });

    it("carries a lesson's note — never a memorial slot's — and nothing the guests are not to read", async () => {
      await inTx(async (run) => {
        await run(A, "select public.update_lesson($1, $2, $3::jsonb)", [lesson.a1, await lessonVersion(run, lesson.a1), JSON.stringify({ public_note: "שיעור לדוגמה לאורחים" })]);
        await run(B, "select public.update_lesson($1, $2, $3::jsonb)", [lesson.draft, await lessonVersion(run, lesson.draft), JSON.stringify({ public_note: "טיוטה לדוגמה" })]);
        // a memorial slot's note cannot be written through update_lesson; were one there, the guests would not see it
        await run("owner", "update public.lessons set public_note = 'הערה לדוגמה' where id = $1", [lesson.memorial]);
        await okFor(run, A, appr.alpha);
        const v = (await view(run)) as View;
        expect(v.rows.map((r) => r.note)).toEqual([null, null, "שיעור לדוגמה לאורחים", null]);
        expect(v.rows[0].people).toEqual([]);
        const text = JSON.stringify(v);
        for (const s of ["טיוטה לדוגמה", "הערה לדוגמה", FALLEN]) expect(text, s).not.toContain(s);
        const keys = keysOf(v);
        for (const k of ["bio_short", "vetted_note", "disambiguator", "image", "uploaded_by", "public_ok", "public_bio", "public_note", "approval", "pay_amount", "email", "phone", "contact", "notes"]) {
          expect(keys.has(k), k).toBe(false);
        }
      });
    });

    it("lists the grid's fixed rows — meals, prayers, «מכריכה לכריכה» — one per day of `days` the window lets through, by day and time, with no person", async () => {
      const template = (await db.query("select start_min, end_min, label from public.grid_template where kind in ('fixed', 'kk') order by start_min")).rows as { start_min: number; end_min: number; label: string }[];
      expect(template.map((r) => r.start_min)).toEqual([420, 480, 795, 1140, 1290, 1440, 1740]);
      const lines = (v: View) => v.fixed.map((f) => `${f.day}|${f.start_min}-${f.end_min}|${f.label}`);
      const expected = (first: number | null, last: number, days: (start: number) => number[] = () => [0, 1, 2, 3, 4]) =>
        [0, 1, 2, 3, 4].flatMap((d) =>
          template
            .filter((r) => days(r.start_min).includes(d) && !(d === 0 && first != null && r.end_min <= first) && !(d === 4 && r.start_min >= last))
            .map((r) => `${d}|${r.start_min}-${r.end_min}|${r.label}`));
      await inTx(async (run) => {
        const v = (await view(run)) as View;
        for (const f of v.fixed) expect(Object.keys(f).sort()).toEqual(["day", "end_min", "label", "start_min"]);
        // Sunday opens 08:30: not the two morning rows; Thursday closes 19:00: the morning's, the noon's — 29 in all
        expect(lines(v)).toEqual(expected(510, 1140));
        expect(lines(v)).toHaveLength(29);
        expect(v.fixed.filter((f) => f.day === 0).map((f) => f.start_min)).toEqual([795, 1140, 1290, 1440, 1740]);
        expect(v.fixed.filter((f) => f.day === 4).map((f) => f.start_min)).toEqual([420, 480, 795]);
        // the window moves, a row's days change: the list follows (rowActive / app.kk_rows's rule)
        await run("owner", "update public.editions set first_day_from = null, last_day_until = 1830 where id = $1", [ed]);
        await run("owner", "update public.grid_rows set days = '{3,1}' where edition_id = $1 and start_min = 1290", [ed]);
        expect(lines((await view(run)) as View)).toEqual(expected(null, 1830, (s) => (s === 1290 ? [1, 3] : [0, 1, 2, 3, 4])));
        expect(lines((await view(run)) as View)).toHaveLength(32);
      });
    });

    it("is the guests' only door: the escort's page and the sign-up form carry nothing of a photo, a speaker's words or a note", async () => {
      await inTx(async (run) => {
        await okFor(run, A, appr.alpha);
        await run(A, "select public.update_speaker($1, $2, 1, $3::jsonb)", [ed, sp.alpha, JSON.stringify({ public_bio: BIO })]);
        await run(A, "select public.set_speaker_photo($1, $2, $3)", [ed, sp.alpha, photoBase64("clean")]);
        await run(A, "select public.update_lesson($1, $2, $3::jsonb)", [lesson.a1, await lessonVersion(run, lesson.a1), JSON.stringify({ public_note: "שיעור לדוגמה לאורחים" })]);
        const trainee = Number(await val(run, "owner", "insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה לדוגמה') returning id", [ed]));
        await run(A, "select public.set_escort($1, $2, $3, false)", [lesson.a1, await lessonVersion(run, lesson.a1), trainee]);
        const escort = ((await val(run, ED_ADMIN, "select public.issue_link($1, 'escort', $2)", [ed, trainee])) as { token: string }).token;
        await run(ED_ADMIN, "select public.kk_set_window($1, now() - interval '1 day', now() + interval '1 day')", [ed]);
        const kk = ((await val(run, ED_ADMIN, "select public.issue_link($1, 'kk_signup')", [ed])) as { token: string }).token;
        for (const [fn, t] of [["escort_view", escort], ["kk_form", kk]] as const) {
          const answer = (await run("anon", `select public.${fn}($1) as v`, [t])).rows[0].v;
          const text = JSON.stringify(answer);
          for (const s of [BIO, "שיעור לדוגמה לאורחים", "data:image", photoBase64("clean").slice(0, 40)]) expect(text, `${fn}: ${s}`).not.toContain(s);
          for (const k of ["public_bio", "public_note", "public_ok", "photo", "image", "people", "bio"]) expect(keysOf(answer).has(k), `${fn}: ${k}`).toBe(false);
        }
        // and the schedule link itself shows them — the one door
        const v = (await view(run)) as View;
        expect(peopleOf(v)).toEqual([`${ALPHA}|bio=${BIO}|photo=clean`]);
      });
    });
  });

  // ---------------------------------------------------------------- set_reader_sent

  describe("«נשלח לדפוס» — set_reader_sent", () => {
    const send = (run: Run, who: string, e: number, sent: boolean | null) => code(run(who, "select public.set_reader_sent($1, $2)", [e, sent]));
    const sentOf = (run: Run, e: number) => val(run, "owner", "select settings -> 'reader_sent' from public.editions where id = $1", [e]) as Promise<{ at: string; by: number } | null>;

    it("is logistics' or an admin's: not a member, a content member (the role before the value), an archive's non-admin — then a null", async () => {
      await inTx(async (run) => {
        expect(await send(run, STRANGER, ed, true)).toBe("not_member");
        expect(await send(run, L, ed + 1000, true)).toBe("not_member");
        expect(await send(run, O_ADMIN, ed, true)).toBe("not_member");
        expect(await send(run, A, ed, true)).toBe("forbidden");
        expect(await send(run, A, ed, null)).toBe("forbidden");
        expect(await send(run, P_C, practice, true)).toBe("forbidden");
        expect(await send(run, OLD_L, old, true)).toBe("archived");
        expect(await send(run, OLD_C, old, true)).toBe("forbidden");
        expect(await send(run, L, ed, null)).toBe("bad_value");
        expect(await sentOf(run, ed)).toBeNull();
        expect(await send(run, OLD_ADMIN, old, true)).toBe("ok");
        expect(await send(run, P_ADMIN, practice, true)).toBe("ok");
      });
    });

    it("stamps {at, by} — again re-stamps — false takes it away, false again changes nothing; the team reads it in load_week; next year starts without it", async () => {
      await inTx(async (run) => {
        expect(await send(run, L, ed, true)).toBe("ok");
        const first = await sentOf(run, ed);
        expect(first).toEqual({ at: expect.stringMatching(ISO), by: member[L] });
        expect(Date.parse(first!.at)).toBeLessThanOrEqual(Date.now() + 60_000);
        expect(await send(run, ED_ADMIN, ed, true)).toBe("ok");
        expect(await sentOf(run, ed)).toEqual({ at: first!.at, by: member[ED_ADMIN] }); // one transaction: one now()
        expect(await send(run, ADMIN, ed, true)).toBe("ok");
        expect((await sentOf(run, ed))!.by).toBe(member[ADMIN]);
        const w = (await val(run, A, "select public.load_week($1)", [ed])) as { edition: { settings: Record<string, unknown> } };
        expect(w.edition.settings.reader_sent).toEqual({ at: first!.at, by: member[ADMIN] });
        // the rest of the settings stay
        const others = async () => val(run, "owner", "select settings - 'reader_sent' from public.editions where id = $1", [ed]);
        const before = await others();
        const next = Number(await val(run, ADMIN, "select public.start_edition('תשפ\"ח', '2028-02-13', 510)"));
        expect(await sentOf(run, next)).toBeNull();
        expect(await send(run, L, ed, false)).toBe("archived"); // start_edition archived it: logistics is done there
        await run("owner", "update public.editions set status = 'planning' where id = $1", [ed]);
        expect(await send(run, L, ed, false)).toBe("ok");
        expect(await sentOf(run, ed)).toBeNull();
        expect(await others()).toEqual(before);
        const tuple = await val(run, "owner", "select ctid::text from public.editions where id = $1", [ed]);
        expect(await send(run, L, ed, false)).toBe("ok"); // nothing to remove: the row is not even rewritten
        expect(await val(run, "owner", "select ctid::text from public.editions where id = $1", [ed])).toBe(tuple);
      });
    });
  });

  // ---------------------------------------------------------------- presentations

  describe("presentations — register_source_file's p_kind", () => {
    const path = (e: number, l: number | "cover", name: string) => `${e}/${l}/${randomUUID()}-${name}`;
    /** As the Storage API uploads: the INSERT as the caller (the policies decide), the type and size in metadata. */
    const upload = (run: Run, who: string, name: string, mime: string) =>
      code(run(who, "insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('sources', $1, $2, $3, $4)", [
        name, claims(who).sub, claims(who).sub, { mimetype: mime, size: 4096 },
      ]));
    const register = (run: Run, who: string, e: number, l: number | null, name: string, kind?: string | null, display = "קובץ לדוגמה", pages: number | null = 3) =>
      kind === undefined
        ? run(who, "select public.register_source_file($1, $2, $3, $4, $5) as r", [e, l, name, display, pages])
        : run(who, "select public.register_source_file($1, $2, $3, $4, $5, $6) as r", [e, l, name, display, pages, kind]);
    const lessonState = async (run: Run, l: number) => (await run("owner", "select sources_kind, in_reader, version from public.lessons where id = $1", [l])).rows[0];
    const coverOf = (run: Run, e: number) => val(run, "owner", "select settings -> 'reader_cover' from public.editions where id = $1", [e]);

    it("knows PowerPoint: the bucket, the path, the type and its extension", async () => {
      expect((await db.query("select allowed_mime_types from storage.buckets where id = 'sources'")).rows[0].allowed_mime_types).toEqual([PDF, "image/png", "image/jpeg", DOCX, PPTX]);
      expect(await owner("select $1 ~ app.source_path_re()", [`${ed}/${lesson.b}/${randomUUID()}-deck.pptx`])).toBe(true);
      expect(await owner("select $1 ~ app.source_path_re()", [`${ed}/${lesson.b}/${randomUUID()}-deck.ppt`])).toBe(false);
      expect((await db.query("select app.source_mime_ok($1, 'pptx') as a, app.source_mime_ok($1, 'pdf') as b, app.source_mime_ok('application/pdf', 'pptx') as c", [PPTX])).rows[0]).toEqual({ a: true, b: false, c: false });
    });

    it("refuses in order, after the old checks: an unknown kind, a presentation on a memorial slot, a PowerPoint file as a source — then the name and the pages", async () => {
      await inTx(async (run) => {
        const deck = path(ed, lesson.b, "deck.pptx");
        expect(await code(register(run, B, ed, lesson.b, deck, "slides"))).toBe("no_file"); // nothing uploaded yet: the old checks first
        expect(await upload(run, B, deck, PPTX)).toBe("ok");
        expect(await code(register(run, B, ed, lesson.b, deck))).toBe("bad_file"); // the five-argument call: a source
        expect(await code(register(run, B, ed, lesson.b, deck, "source"))).toBe("bad_file");
        expect(await code(register(run, B, ed, lesson.b, deck, "slides"))).toBe("bad_value");
        expect(await code(register(run, B, ed, lesson.b, deck, null))).toBe("bad_value");
        expect(await code(register(run, B, ed, lesson.b, deck, "source", "   "))).toBe("bad_file"); // the PowerPoint rule before the name
        expect(await code(register(run, B, ed, lesson.b, deck, "presentation", "   "))).toBe("bad_value");
        expect(await code(register(run, B, ed, lesson.b, deck, "presentation", "מצגת", 0))).toBe("bad_value");
        const text = path(ed, lesson.b, "notes.pdf");
        expect(await upload(run, B, text, "text/plain")).toBe("ok");
        expect(await code(register(run, B, ed, lesson.b, text, "slides"))).toBe("bad_file"); // the type before the kind
        // a memorial slot with a plan: the files are the fallen's, for the reader — never a presentation
        const slot = path(ed, lesson.memorial, "slot.pptx");
        expect(await upload(run, ED_ADMIN, slot, PPTX)).toBe("ok");
        expect(await code(register(run, ED_ADMIN, ed, lesson.memorial, slot, "presentation"))).toBe("bad_value");
        expect(await code(register(run, ED_ADMIN, ed, lesson.memorial, slot))).toBe("bad_file");
        const slotPdf = path(ed, lesson.memorial, "slot.pdf");
        expect(await upload(run, ED_ADMIN, slotPdf, PDF)).toBe("ok");
        expect(await code(register(run, ED_ADMIN, ed, lesson.memorial, slotPdf, "presentation"))).toBe("bad_value");
        expect(await code(register(run, ED_ADMIN, ed, lesson.memorial, slotPdf))).toBe("ok");
        // no PowerPoint row as a source, even by hand
        expect(await code(run("owner", "insert into public.source_files (edition_id, lesson_id, storage_path, display_name, mime, size_bytes) values ($1, $2, 'x', 'x', $3, 1)", [ed, lesson.b, PPTX]))).toBe("23514");
      });
    });

    it("keeps a lesson's presentation out of its sources and the reader: the first SOURCE file still makes it «דף מקורות» in the reader", async () => {
      await inTx(async (run) => {
        const before = await lessonState(run, lesson.b);
        expect(before).toMatchObject({ sources_kind: "pending", in_reader: false });
        const deck = path(ed, lesson.b, "deck.pptx");
        await upload(run, B, deck, PPTX);
        const row = (await register(run, B, ed, lesson.b, deck, "presentation", "מצגת לדוגמה.pptx")).rows[0].r;
        expect(row).toMatchObject({ kind: "presentation", cover: false, lesson_id: lesson.b, speaker_id: sp.beta, mime: PPTX, page_count: null });
        expect(await lessonState(run, lesson.b)).toEqual(before); // nothing of the lesson changes
        // a retry of the same path answers its row, whatever kind it says now
        expect((await register(run, B, ed, lesson.b, deck, "source")).rows[0].r).toEqual(row);
        // a PDF and a Word file may be presentations too — still nothing of the lesson
        const slides = path(ed, lesson.b, "slides.pdf");
        await upload(run, B, slides, PDF);
        expect((await register(run, B, ed, lesson.b, slides, "presentation", "שקפים.pdf", 7)).rows[0].r).toMatchObject({ kind: "presentation", page_count: 7 });
        const doc = path(ed, lesson.b, "outline.docx");
        await upload(run, B, doc, DOCX);
        expect(await code(register(run, B, ed, lesson.b, doc, "presentation"))).toBe("ok");
        expect(await lessonState(run, lesson.b)).toEqual(before);
        // the first source file: «דף מקורות», in the reader
        const sheet = path(ed, lesson.b, "sheet.pdf");
        await upload(run, B, sheet, PDF);
        expect((await register(run, B, ed, lesson.b, sheet)).rows[0].r).toMatchObject({ kind: "source", cover: false });
        expect(await lessonState(run, lesson.b)).toEqual({ sources_kind: "sheet", in_reader: true, version: before.version + 1 });
        // load_week says which is which
        const w = (await val(run, L, "select public.load_week($1)", [ed])) as { sourceFiles: { storage_path: string; kind: string }[] };
        expect(w.sourceFiles.map((f) => [f.storage_path, f.kind]).sort()).toEqual([[deck, "presentation"], [doc, "presentation"], [sheet, "source"], [slides, "presentation"]].sort());
      });
    });

    it("lets the edition's admins keep the week's presentation on the cover path — never the poster, never the reader's cover", async () => {
      await inTx(async (run) => {
        const week = path(ed, "cover", "week.pptx");
        expect(await upload(run, A, week, PPTX)).toBe("42501"); // the cover path is the admins'
        expect(await upload(run, ED_ADMIN, week, PPTX)).toBe("ok");
        expect(await code(register(run, ED_ADMIN, ed, null, week))).toBe("bad_file");
        const row = (await register(run, ED_ADMIN, ed, null, week, "presentation", "המצגת המלווה לשבוע.pptx")).rows[0].r;
        expect(row).toMatchObject({ kind: "presentation", cover: false, lesson_id: null, speaker_id: null });
        expect(await coverOf(run, ed)).toBeNull();
        const weekPdf = path(ed, "cover", "week.pdf");
        await upload(run, ED_ADMIN, weekPdf, PDF);
        const pdf = (await register(run, ED_ADMIN, ed, null, weekPdf, "presentation", "המצגת.pdf", 1)).rows[0].r;
        expect(pdf).toMatchObject({ kind: "presentation", cover: false, page_count: 1 });
        expect(await coverOf(run, ed)).toBeNull(); // readable, but no poster
        expect(await code(run(ED_ADMIN, "select public.set_reader_cover($1, $2)", [ed, pdf.id]))).toBe("bad_value");
        // a poster still becomes the cover
        const poster = path(ed, "cover", "poster.pdf");
        await upload(run, ED_ADMIN, poster, PDF);
        const p = (await register(run, ED_ADMIN, ed, null, poster, "source", "שער.pdf", 1)).rows[0].r;
        expect(p).toMatchObject({ kind: "source", cover: true });
        expect(Number(await coverOf(run, ed))).toBe(Number(p.id));
      });
    });
  });

  // ---------------------------------------------------------------- the rota

  describe("the cohorts' two flags and Saturday night's shopping list", () => {
    it("gives a cohort helps_rota and can_drive (true and false by default), refuses a null, and load_rota carries them", async () => {
      await inTx(async (run) => {
        const c = Number(await val(run, L, "insert into public.rota_cohorts (edition_id, letter, name) values ($1, 'א', 'מכינה לדוגמה') returning id", [ed]));
        expect((await run("owner", "select helps_rota, can_drive from public.rota_cohorts where id = $1", [c])).rows[0]).toEqual({ helps_rota: true, can_drive: false });
        expect(await code(run(L, "insert into public.rota_cohorts (edition_id, letter, name, helps_rota) values ($1, 'ב', 'מכינה לדוגמה ב', null)", [ed]))).toBe("bad_value");
        expect(await code(run(L, "insert into public.rota_cohorts (edition_id, letter, name, can_drive) values ($1, 'ב', 'מכינה לדוגמה ב', null)", [ed]))).toBe("bad_value");
        expect(await code(run(L, "update public.rota_cohorts set can_drive = null where id = $1", [c]))).toBe("bad_value");
        expect(await code(run(L, "update public.rota_cohorts set helps_rota = false, can_drive = true where id = $1", [c]))).toBe("ok");
        expect((await run(A, "update public.rota_cohorts set helps_rota = true where id = $1 returning id", [c])).rowCount).toBe(0); // content: the policy's no
        const rota = (await val(run, B, "select public.load_rota($1)", [ed])) as { cohorts: Record<string, unknown>[] };
        expect(rota.cohorts).toEqual([{ id: c, edition_id: ed, letter: "א", name: "מכינה לדוגמה", diets: [], sort: 0, helps_rota: false, can_drive: true }]);
      });
    });

    it("keeps a task or an item: a quantity cleaned whatever the kind (one line ≤ 40, no phone), a task's then dropped; the kind checked after the text", async () => {
      await inTx(async (run) => {
        const add = (text: string, kind: unknown, qty: unknown) =>
          run(L, "insert into public.rota_prep_tasks (edition_id, text, kind, qty) values ($1, $2, $3, $4) returning id", [ed, text, kind, qty]);
        const t = Number((await run(L, "insert into public.rota_prep_tasks (edition_id, text) values ($1, 'משימה לדוגמה') returning id", [ed])).rows[0].id);
        const i = Number((await add("פריט לדוגמה", "item", "  2   (לדוגמה) ")).rows[0].id);
        const t2 = Number((await add("משימה לדוגמה 2", "task", "3")).rows[0].id);
        const rows = async () => (await run("owner", "select id, kind, qty from public.rota_prep_tasks where edition_id = $1 order by id", [ed])).rows.map((r) => [Number(r.id), r.kind, r.qty]);
        expect(await rows()).toEqual([[t, "task", null], [i, "item", "2 (לדוגמה)"], [t2, "task", null]]);
        expect(await code(add("פריט לדוגמה", "thing", null))).toBe("bad_value");
        expect(await code(add("פריט לדוגמה", null, null))).toBe("bad_value");
        expect(await code(add("   ", "thing", null))).toBe("name_required"); // the text first
        expect(await code(add("פריט לדוגמה", "item", "א".repeat(41)))).toBe("bad_value");
        expect(await code(add("פריט לדוגמה", "item", "טל' 1234567"))).toBe("rota_contact_in_text");
        expect(await code(add("פריט לדוגמה", "task", "טל' 1234567"))).toBe("rota_contact_in_text"); // a task's too, before it is dropped
        expect(await code(add("פריט לדוגמה", "task", "א".repeat(41)))).toBe("bad_value");
        expect(await code(run(L, "update public.rota_prep_tasks set qty = 'טל'' 1234567' where id = $1", [t2]))).toBe("rota_contact_in_text");
        // a task made an item takes a quantity; an item made a task loses it
        await run(L, "update public.rota_prep_tasks set kind = 'item', qty = '5' where id = $1", [t]);
        await run(L, "update public.rota_prep_tasks set kind = 'task' where id = $1", [i]);
        expect((await rows()).slice(0, 3)).toEqual([[t, "item", "5"], [i, "task", null], [t2, "task", null]]);
        const rota = (await val(run, B, "select public.load_rota($1)", [ed])) as { prep: Record<string, unknown>[] };
        expect(rota.prep[0]).toEqual({ id: t, edition_id: ed, text: "משימה לדוגמה", group_id: null, done: false, sort: 0, kind: "item", qty: "5" });
      });
    });
  });

  // ---------------------------------------------------------------- the file again

  describe("the file run again", () => {
    it("keeps what v19 wrote — a photo, an approval, «נשלח לדפוס», a presentation, an item, the flags — and still answers", async () => {
      await commitAs(A, "select public.set_speaker_photo($1, $2, $3)", [ed, sp.alpha, photoBase64("clean")]);
      await commitAs(A, "select public.set_public_ok($1, (select version from public.approaches where id = $1), true)", [appr.alpha]);
      await commitAs(L, "select public.set_reader_sent($1, true)", [ed]);
      await commitAs(A, "select public.update_speaker($1, $2, (select version from public.speakers where id = $2), $3::jsonb)", [ed, sp.alpha, JSON.stringify({ public_bio: BIO })]);
      await commitAs(A, "select public.update_lesson($1, (select version from public.lessons where id = $1), $2::jsonb)", [lesson.a1, JSON.stringify({ public_note: "שיעור לדוגמה" })]);
      await commitAs(L, "insert into public.rota_cohorts (edition_id, letter, name, helps_rota, can_drive) values ($1, 'א', 'מכינה לדוגמה', false, true)", [ed]);
      await commitAs(L, "insert into public.rota_prep_tasks (edition_id, text, kind, qty) values ($1, 'פריט לדוגמה', 'item', '2 (לדוגמה)')", [ed]);
      await db.query("insert into public.source_files (edition_id, lesson_id, storage_path, display_name, mime, size_bytes, kind) values ($1, $2, $3, 'מצגת.pptx', $4, 1, 'presentation')",
        [ed, lesson.b, `${ed}/${lesson.b}/${randomUUID()}-deck.pptx`, PPTX]);
      const snapshot = async () => ({
        photo: (await db.query("select encode(image, 'hex') as h from public.speaker_photos")).rows,
        approaches: (await db.query("select id, public_ok, version from public.approaches order by id")).rows,
        settings: (await db.query("select settings from public.editions where id = $1", [ed])).rows,
        speakers: (await db.query("select id, public_bio from public.speakers order by id")).rows,
        lessons: (await db.query("select id, public_note from public.lessons order by id")).rows,
        cohorts: (await db.query("select helps_rota, can_drive from public.rota_cohorts")).rows,
        prep: (await db.query("select kind, qty from public.rota_prep_tasks")).rows,
        files: (await db.query("select storage_path, kind from public.source_files order by id")).rows,
        bucket: (await db.query("select allowed_mime_types from storage.buckets")).rows,
      });
      const before = await snapshot();
      expect(before.photo).toHaveLength(1);
      await db.query(SCHEMA);
      await db.query(SCHEMA);
      expect(await snapshot()).toEqual(before);
      await inTx(async (run) => {
        const v = (await view(run)) as { people: { label: string; bio: string; photo: string }[] };
        expect(v.people).toEqual([{ label: "ד״ר מרצה לדוגמה אלפא", bio: BIO, photo: DATA_URL + photoBase64("clean") }]);
      });
    });
  });
});
