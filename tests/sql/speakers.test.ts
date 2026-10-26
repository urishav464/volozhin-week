// The speaker pool (v6) in the database, as the roles a browser gets: what
// tests/parity cannot see — the contacts policy re-proved through the new
// functions, the log and its notes, the timeline and history across editions,
// two people at once, and the catalog. (What each command does, refusal by
// refusal, is tests/parity: engine and SQL held to one contract.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { SIMILAR_THRESHOLD } from "../../src/data/speakerRules";
import { similarity } from "../../src/domain/trigram";
import { nameKey } from "../../src/domain/nameKey";
import { SCHEMA, adminUrl, as, dropDatabase, freshDatabase, google, sqlstate } from "./db";

const ADMIN = "admin@example.org"; // every edition
const ED_ADMIN = "edition.admin@example.org";
const A = "a@example.org";
const B = "b@example.org";
const L = "logistics@example.org";
const PRACTICE = "practice@example.org"; // content in a practice edition only
const DEMO_ADMIN = "demo.admin@example.org"; // admin of a demo edition only
const OLD = "old@example.org"; // content in last year's real edition (archived), still active
const OLD_ADMIN = "old.admin@example.org"; // admin of last year's real edition only
const STRANGER = "stranger@example.org";
const PHONE = "555 0100 99"; // a phone-shaped value no scanner takes for an Israeli number

/** The message of a P0001 refusal (the contract's code), else the SQLSTATE. */
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message: string };
    return err.code === "P0001" ? err.message : (err.code ?? "error");
  }
}

describe("the speaker pool", () => {
  const dbName = `vw_speakers_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let practice: number;
  let archive: number;
  let demo: number;
  let old: number;
  const member: Record<string, number> = {};
  const sp: Record<string, number> = {};

  /** Runs as a member and COMMITS (the next test sees it); returns the first column, or the refusal. */
  async function commitAs(email: string, sql: string, params: unknown[] = []): Promise<unknown> {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(email))]);
      const r = await db.query(sql, params);
      await db.query("commit");
      return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', '2027-02-14', 510)"));
    practice = Number((await db.query("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id")).rows[0].id);
    archive = Number((await db.query("insert into public.editions (label, kind, status) values ('תשפ\"ו', 'archive', 'archived') returning id")).rows[0].id);
    demo = Number((await db.query("insert into public.editions (label, kind) values ('הדגמה', 'demo') returning id")).rows[0].id);
    old = Number((await db.query("insert into public.editions (label, kind, status) values ('שנה קודמת', 'real', 'archived') returning id")).rows[0].id);
    for (const e of [practice, archive, demo, old]) {
      await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'בית מדרש', true)", [e]);
      await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [e]);
    }
    for (const [email, role, edition] of [
      [ED_ADMIN, "admin", ed], [A, "content", ed], [B, "content", ed], [L, "logistics", ed], [PRACTICE, "content", practice],
      [DEMO_ADMIN, "admin", demo], [OLD, "content", old], [OLD_ADMIN, "admin", old],
    ] as const) {
      member[email] = Number((await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3) returning id", [email, role, edition])).rows[0].id);
    }
    member[ADMIN] = Number((await db.query("select id from public.members where email = $1", [ADMIN])).rows[0].id);
    for (const [key, name, gender] of [["s1", "מרצה לבדיקה", "f"], ["s2", "מרצה שנייה לבדיקה", "m"], ["past", "מרצה מן העבר", "f"]] as const) {
      sp[key] = Number((await db.query("insert into public.speakers (name, gender, vetted) values ($1, $2, 'approved') returning id", [name, gender])).rows[0].id);
    }
    await db.query("insert into public.speaker_contacts (speaker_id, phone, email, notes) values ($1, 'synthetic-phone', 'speaker@example.org', 'synthetic-note')", [sp.s1]);
    // A handles s1 this year.
    await commitAs(A, "select public.claim_speaker($1, $2)", [ed, sp.s1]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  /** A closed lesson written as the owner (like the import, or last year's week). */
  async function closedLesson(edition: number, speaker: number, day: number, start: number, title: string): Promise<void> {
    const room = Number((await db.query("select id from public.rooms where edition_id = $1 and is_default", [edition])).rows[0].id);
    const l = Number((await db.query("insert into public.lessons (edition_id, state, day, start_min, end_min, room_id, title, category_id) values ($1, 'closed', $2, $3, $3 + 90, $4, $5, (select id from public.categories order by sort limit 1)) returning id", [edition, day, start, room, title])).rows[0].id);
    await db.query("insert into public.lesson_speakers (lesson_id, speaker_id, role, edition_id, span) values ($1, $2, 'lead', $3, 'empty')", [l, speaker, edition]);
  }

  it("exposes the pool's RPCs with the contract's parameter names (src/data/supabaseSpeakers.ts calls them by name)", async () => {
    const sig = async (fn: string) =>
      (await db.query("select pg_get_function_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows.map((r) => r.a);
    expect(await sig("speaker_matches")).toEqual(["p_name text"]);
    expect(await sig("create_speaker")).toEqual(["p_edition bigint, p_fields jsonb, p_claim boolean DEFAULT false, p_approve boolean DEFAULT false, p_confirmed boolean DEFAULT false"]);
    expect(await sig("update_speaker")).toEqual(["p_edition bigint, p_speaker bigint, p_version integer, p_patch jsonb"]);
    expect(await sig("vet_speakers")).toEqual(["p_speakers bigint[], p_state text, p_note text DEFAULT NULL::text"]);
    expect(await sig("get_speaker_contacts")).toEqual(["p_speaker bigint"]);
    expect(await sig("set_speaker_contacts")).toEqual(["p_speaker bigint, p_phone text, p_email text, p_secretary_note text DEFAULT NULL::text, p_notes text DEFAULT NULL::text"]);
    expect(await sig("speaker_history")).toEqual(["p_speaker bigint"]);
    expect(await sig("speaker_activity")).toEqual(["p_speaker bigint"]);
    expect(await sig("claim_speaker")).toEqual(["p_edition bigint, p_speaker bigint"]);
    expect(await sig("set_approach_status")).toEqual(["p_approach bigint, p_version integer, p_status text, p_note text DEFAULT NULL::text"]);
    expect(await sig("hand_over")).toEqual(["p_approach bigint, p_to bigint, p_note text DEFAULT NULL::text"]);
    expect(await sig("answer_handover")).toEqual(["p_approach bigint, p_accept boolean, p_note text DEFAULT NULL::text"]);
    expect(await sig("set_slot_availability")).toEqual(["p_edition bigint, p_speaker bigint, p_day integer, p_row bigint, p_kind text, p_note text DEFAULT NULL::text"]);
  });

  it("computes trigram similarity exactly as pg_trgm (src/domain/trigram.ts), with the same threshold", async () => {
    const names = [
      "פלונית אלמונית", "פלונית אלמוני", "אלמונית פלונית", "פלונית כהן", "יוסף בן שמעון", "יוסי בן שמעון", "בן ציון", "בנציון",
      "שרה כהן", "כהן", "מרצה לדוגמה 07", "מרצה לדוגמה 70", "Some Name", "some-name", "א", "אב", "Ab12 x9", "",
      "מכון ון ליר", "רבקה לוי-כהן", "רבקה לוי כהן", "שלמה בר־און", "שלמה בראון",
    ];
    const r = await db.query(
      "select a, b, extensions.similarity(app.name_key(a), app.name_key(b)) as s from unnest($1::text[]) a, unnest($1::text[]) b",
      [names],
    );
    expect(r.rows.length).toBe(names.length ** 2);
    // a real arrives as its shortest decimal text: back to the same 4-byte float
    for (const row of r.rows) expect(similarity(nameKey(row.a), nameKey(row.b)), `${row.a} ~ ${row.b}`).toBe(Math.fround(row.s));
    expect(r.rows.filter((x) => x.s >= Math.fround(SIMILAR_THRESHOLD) && x.s < 1).length).toBeGreaterThan(5); // the sample crosses the line both ways
    expect(r.rows.filter((x) => x.s > 0 && x.s < Math.fround(SIMILAR_THRESHOLD)).length).toBeGreaterThan(5);
    expect(Math.fround((await db.query("select app.similar_threshold() as t")).rows[0].t)).toBe(Math.fround(SIMILAR_THRESHOLD));
  });

  it("answers «ייתכן שזה…» from a trigram index on the name key", async () => {
    expect((await db.query("select indexdef from pg_indexes where indexname = 'speakers_name_trgm'")).rows[0].indexdef).toMatch(/gin \(name_key extensions\.gin_trgm_ops\)/);
    await db.query("begin");
    try {
      await db.query("set local enable_seqscan = off");
      const plan = (await db.query("explain select id from public.speakers where name_key operator(extensions.%) 'מרצה לבדיקה'")).rows.map((x) => x["QUERY PLAN"]).join("\n");
      expect(plan).toContain("speakers_name_trgm");
    } finally {
      await db.query("rollback");
    }
    await as(db, "authenticated", google(L), async (q) => {
      // any member may search (logistics too); the same name first, then the similar
      const m = (await q("select public.speaker_matches('מרצה לבדיקה') as m")).rows[0].m;
      expect(m.map((x: { name: string; match: string }) => `${x.name}:${x.match}`)).toEqual(["מרצה לבדיקה:same", "מרצה שנייה לבדיקה:similar"]);
      expect(Object.keys(m[0]).sort()).toEqual(["affiliation", "disambiguator", "gender", "id", "match", "name", "retired", "similarity", "title", "vetted"]);
    });
  });

  it("reaches contacts only through the policy, unchanged: the handler in the current real edition and a global admin — read and write", async () => {
    const read = (email: string) => as(db, "authenticated", google(email), async (q) => {
      const rpc = (await q("select public.get_speaker_contacts($1) as c", [sp.s1])).rows[0].c;
      const table = (await q("select phone from public.speaker_contacts where speaker_id = $1", [sp.s1])).rows;
      // the function and the table agree, for everyone
      expect(table.length, email).toBe(rpc == null ? 0 : 1);
      return rpc;
    });
    expect(await read(A)).toEqual({ phone: "synthetic-phone", email: "speaker@example.org", secretary_note: null, notes: "synthetic-note" });
    expect(await read(ADMIN)).not.toBeNull();
    for (const who of [B, L, ED_ADMIN, PRACTICE, STRANGER]) expect(await read(who), who).toBeNull();

    // writing: the same people
    for (const who of [B, L, ED_ADMIN, PRACTICE]) {
      await as(db, "authenticated", google(who), async (q) => {
        expect(await refusal(q("select public.set_speaker_contacts($1, $2, null)", [sp.s1, PHONE])), who).toBe("contacts_hidden");
      });
    }
    await as(db, "authenticated", google(STRANGER), async (q) => {
      expect(await refusal(q("select public.set_speaker_contacts($1, $2, null)", [sp.s1, PHONE]))).toBe("not_member");
    });
    await as(db, "authenticated", google(A), async (q) => {
      await q("select public.set_speaker_contacts($1, $2, 'Speaker@Example.org', null, null)", [sp.s1, PHONE]);
      expect((await q("select public.get_speaker_contacts($1) as c", [sp.s1])).rows[0].c).toEqual({ phone: PHONE, email: "Speaker@Example.org", secretary_note: null, notes: null });
      expect(await refusal(q("select public.set_speaker_contacts(-1, null, null)"))).toBe("stale");
    });

    // a practice edition gives no contacts, even to whoever claims the speaker there
    await as(db, "authenticated", google(PRACTICE), async (q) => {
      await q("select public.claim_speaker($1, $2)", [practice, sp.s1]);
      expect((await q("select public.get_speaker_contacts($1) as c", [sp.s1])).rows[0].c).toBeNull();
      expect(await refusal(q("select public.set_speaker_contacts($1, $2, null)", [sp.s1, PHONE]))).toBe("contacts_hidden");
    });

    // a new real edition archives this one: last year's handler loses them, the admin keeps them
    await as(db, "authenticated", google(ADMIN), async (q) => {
      await q("select public.start_edition('תשפ\"ח', null)");
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(A))]);
      expect((await q("select public.get_speaker_contacts($1) as c", [sp.s1])).rows[0].c).toBeNull();
      expect(await refusal(q("select public.set_speaker_contacts($1, $2, null)", [sp.s1, PHONE]))).toBe("contacts_hidden");
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(ADMIN))]);
      expect((await q("select public.get_speaker_contacts($1) as c", [sp.s1])).rows[0].c).not.toBeNull();
    });

    // the policy is the one predicate — and it is still the only way to the table
    const policy = (await db.query("select pg_get_expr(polqual, polrelid) as q from pg_policy where polname = 'speaker_contacts_read'")).rows[0].q;
    expect(policy).toContain("may_see_contacts");
  });

  it("keeps the pool's tables SELECT-only for a browser — every write is a function", async () => {
    await as(db, "authenticated", google(ADMIN), async (q) => {
      expect(await sqlstate(q("insert into public.speakers (name) values ('x')"))).toBe("42501");
      expect(await sqlstate(q("update public.speakers set vetted = 'approved'"))).toBe("42501");
      expect(await sqlstate(q("insert into public.speaker_contacts (speaker_id, phone) values ($1, 'x')", [sp.s2]))).toBe("42501");
      expect(await sqlstate(q("update public.speaker_contacts set phone = 'x'"))).toBe("42501");
      expect(await sqlstate(q("update public.approaches set owner_member_id = null"))).toBe("42501");
      expect(await sqlstate(q("insert into public.slot_availability (edition_id, speaker_id, day, row_id, kind) select edition_id, speaker_id, 1, (select id from public.grid_rows limit 1), 'can' from public.approaches limit 1"))).toBe("42501");
      expect(await sqlstate(q("update public.slot_availability set kind = 'can'"))).toBe("42501");
      expect(await sqlstate(q("delete from public.slot_availability"))).toBe("42501");
      expect(await sqlstate(q("select app.log_event(null, 'speakers', 1, 'x', '{}')"))).toBe("42501");
      expect(await sqlstate(q("select app.contacts_edition(1)"))).toBe("42501");
    });
  });

  it("refuses a stranger every pool function, and anon all of them", async () => {
    const calls: [string, unknown[]][] = [
      ["select public.speaker_matches('x')", []],
      ["select public.speaker_history($1)", [sp.s1]],
      ["select public.speaker_activity($1)", [sp.s1]],
      ["select public.create_speaker($1, '{\"name\": \"x\"}')", [ed]],
      ["select public.update_speaker($1, $2, 1, '{}')", [ed, sp.s1]],
      ["select public.vet_speakers(array[$1::bigint], 'approved')", [sp.s1]],
      ["select public.claim_speaker($1, $2)", [ed, sp.s2]],
      ["select public.set_slot_availability($1, $2, 1, (select id from public.grid_rows where edition_id = $1 and start_min = 510), 'can')", [ed, sp.s1]],
    ];
    const a = Number((await db.query("select id from public.approaches limit 1")).rows[0].id);
    await as(db, "authenticated", google(STRANGER), async (q) => {
      for (const [sql, params] of calls) expect(await refusal(q(sql, params)), sql).toBe("not_member");
      expect((await q("select public.get_speaker_contacts($1) as c", [sp.s1])).rows[0].c).toBeNull();
      for (const sql of ["select public.set_approach_status($1, 1, 'approached')", "select public.hand_over($1, null)", "select public.answer_handover($1, true)"]) {
        expect(await refusal(q(sql, [a])), sql).toBe("not_member");
      }
    });
    await as(db, "anon", null, async (q) => {
      for (const [sql, params] of calls) expect(await sqlstate(q(sql, params)), sql).toBe("42501");
      expect(await sqlstate(q("select public.get_speaker_contacts(1)"))).toBe("42501");
    });
  });

  it("logs each change with its note — never a contact value — and the note does not leak to the next change", async () => {
    await as(db, "authenticated", google(A), async (q) => {
      const s = Number((await q("select (public.create_speaker($1, '{\"name\": \"מרצה ללוג\", \"gender\": \"m\"}', true) ->> 'speaker_id')::bigint as id", [ed])).rows[0].id);
      await q("select public.set_speaker_contacts($1, $2, 'speaker@example.org', 'secretary-synthetic', 'note-synthetic')", [s, PHONE]);
      const a = (await q("select id, version from public.approaches where edition_id = $1 and speaker_id = $2", [ed, s])).rows[0];
      await q("select public.update_speaker($1, $2, 1, '{\"bio_short\": \"ביו לדוגמה\"}')", [ed, s]);
      await q("select public.set_approach_status($1, $2, 'no_answer', '  שלחתי הודעה  ')", [a.id, a.version]);
      // v14: a slot — Monday's 20:00 row; the same again changes nothing and logs nothing
      for (let i = 0; i < 2; i++) {
        await q("select public.set_slot_availability($1, $2, 1, (select id from public.grid_rows where edition_id = $1 and start_min = 1200), 'cannot', 'בחו\"ל')", [ed, s]);
      }
      await q("select public.hand_over($1, $2, 'מכיר/ה אותו')", [a.id, member[B]]);
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(B))]);
      await q("select public.answer_handover($1, true)", [a.id]);
      expect(await q("select current_setting('app.note', true) as n").then((r) => r.rows[0].n)).toBe("");

      const log = (await q("select public.speaker_activity($1) as l", [s])).rows[0].l as { actor: number; entity: string; kind: string; detail: Record<string, unknown> }[];
      expect(log.map((r) => `${r.entity}:${r.kind}`).reverse()).toEqual([
        "speakers:insert", "approaches:insert", "speakers:contacts", "speakers:update", "approaches:update", "approaches:availability", "approaches:update", "approaches:update",
      ]);
      const [answered, offered, avail, status, update, contacts] = log;
      expect(contacts.detail).toEqual({ fields: ["phone", "email", "secretary_note", "notes"] });
      expect(update.detail).toEqual({ fields: ["bio_short"] });
      expect(status.detail).toMatchObject({ status: "no_answer", note: "שלחתי הודעה", owner: member[A] });
      expect(avail.detail).toEqual({ speaker: s, day: 1, start: 1200, end: 1290, kind: "cannot", note: "בחו\"ל" });
      expect(offered.detail).toMatchObject({ offered_to: member[B], note: "מכיר/ה אותו", owner: member[A] });
      expect(answered.detail).toMatchObject({ owner: member[B] });
      expect(answered.detail).not.toHaveProperty("note");
      expect(answered.detail).not.toHaveProperty("offered_to");
      expect(answered.actor).toBe(member[B]);
      expect(log.every((r) => r.actor != null)).toBe(true);
      const all = JSON.stringify((await db.query("select detail from public.activity")).rows);
      expect(all).not.toMatch(/555 0100|speaker@example|synthetic|@/);
    });
  });

  it("keeps availability per slot (v14): any editor marks a lesson row of the day — no approach, no vetting needed — and the log has each change once", async () => {
    const row = async (edition: number, start: number, kind = "lesson") =>
      Number((await db.query("select id from public.grid_rows where edition_id = $1 and start_min = $2 and kind = $3", [edition, start, kind])).rows[0].id);
    const [r390, r510, r600, r1200, lunch, practiceRow, oldRow] = [
      await row(ed, 390), await row(ed, 510), await row(ed, 600), await row(ed, 1200), await row(ed, 795, "fixed"), await row(practice, 510), await row(old, 510),
    ];
    const s = Number((await db.query("insert into public.speakers (name, gender) values ('מרצה לזמינות', 'm') returning id")).rows[0].id); // pending, handled by nobody
    const retired = Number((await db.query("insert into public.speakers (name, retired) values ('מרצה שפרש', true) returning id")).rows[0].id);
    const set = "select public.set_slot_availability($1, $2, $3, $4, $5, $6)";
    const mine = (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) =>
      q("select day, row_id, kind, note, updated_by from public.slot_availability where speaker_id = $1 order by id", [s]).then((r) =>
        r.rows.map((x) => ({ ...x, row_id: Number(x.row_id), updated_by: Number(x.updated_by) })));
    await as(db, "authenticated", google(B), async (q) => {
      expect(await refusal(q(set, [ed, s, 1, r510, "can", "  רק   בבוקר "]))).toBe("ok");
      expect(await refusal(q(set, [ed, s, 1, r510, "can", "רק בבוקר"]))).toBe("ok"); // the same once cleaned: nothing changes, nothing is logged
      expect(await refusal(q(set, [ed, s, 1, r390, "cannot", null]))).toBe("ok"); // Monday's 06:30 row is in play — only Sunday opens later
      expect(await refusal(q(set, [ed, s, 1, r390, null, "נשכח"]))).toBe("ok"); // unknown again: the mark goes, its note with it
      expect(await refusal(q(set, [ed, s, 1, r390, null, null]))).toBe("ok"); // nothing to remove
      expect(await refusal(q(set, [ed, s, 1, r510, "cannot", null]))).toBe("ok");
      expect(await mine(q)).toEqual([{ day: 1, row_id: r510, kind: "cannot", note: null, updated_by: member[B] }]);
      for (const [args, code] of [
        [[ed, s, 0, r390, "can", null], "outside_grid"], // Sunday, before the opening (08:30)
        [[ed, s, 4, r1200, "can", null], "outside_grid"], // Thursday, after the close (19:00)
        [[ed, s, 1, lunch, "can", null], "outside_grid"], // a meal is not a lesson row
        [[ed, s, 1, practiceRow, "can", null], "outside_grid"], // another edition's row
        [[ed, s, 1, -1, "can", null], "outside_grid"],
        [[ed, s, 5, r510, "can", null], "bad_value"],
        [[ed, s, null, r510, "can", null], "bad_value"],
        [[ed, s, 1, r510, "maybe", null], "bad_value"],
        [[ed, s, 1, r510, "can", "א".repeat(121)], "bad_value"],
        [[ed, retired, 1, r510, "can", null], "speaker_retired"],
        [[ed, -1, 1, r510, "can", null], "speaker_retired"],
      ] as const) {
        expect(await refusal(q(set, [...args])), JSON.stringify(args)).toBe(code);
      }
      // logged under no approach (nobody handles the speaker here), found by the speaker's timeline; newest first
      const log = (await q("select public.speaker_activity($1) as l", [s])).rows[0].l as { entity: string; entity_id: number | null; kind: string; actor: number; detail: unknown }[];
      expect(log.map((r) => [r.entity, r.entity_id, r.kind, Number(r.actor), r.detail])).toEqual([
        ["approaches", null, "availability", member[B], { speaker: s, day: 1, start: 510, end: 600, kind: "cannot" }],
        ["approaches", null, "availability", member[B], { speaker: s, day: 1, start: 390, end: 435, kind: null }],
        ["approaches", null, "availability", member[B], { speaker: s, day: 1, start: 390, end: 435, kind: "cannot" }],
        ["approaches", null, "availability", member[B], { speaker: s, day: 1, start: 510, end: 600, kind: "can", note: "רק בבוקר" }],
      ]);

      // logistics may not mark — but reads it, as the whole team does: the table under RLS, and load_week
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(L))]);
      expect(await refusal(q(set, [ed, s, 1, r600, "can", null]))).toBe("forbidden");
      expect(await mine(q)).toEqual([{ day: 1, row_id: r510, kind: "cannot", note: null, updated_by: member[B] }]);
      const w = (await q("select public.load_week($1) as w", [ed])).rows[0].w;
      expect(w.slotAvailability.filter((x: { speaker_id: number }) => x.speaker_id === s)).toEqual([
        { id: expect.any(Number), speaker_id: s, day: 1, row_id: r510, kind: "cannot", note: null, updated_by: member[B] },
      ]);
      // another edition's member reads none of it, and may not mark here
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(PRACTICE))]);
      expect(await mine(q)).toEqual([]);
      expect(await refusal(q(set, [ed, s, 1, r600, "can", null]))).toBe("not_member");
      // the handler, the edition's admin and a global admin may, like any editor
      for (const [who, kind] of [[A, "can"], [ED_ADMIN, "cannot"], [ADMIN, "can"]]) {
        await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(who))]);
        expect(await refusal(q(set, [ed, s, 1, r600, kind, null])), who).toBe("ok");
      }
      // an archived edition: its admin only
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(OLD))]);
      expect(await refusal(q(set, [old, s, 1, oldRow, "can", null]))).toBe("archived");
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(OLD_ADMIN))]);
      expect(await refusal(q(set, [old, s, 1, oldRow, "can", null]))).toBe("ok");
    });
    await as(db, "anon", null, async (q) => {
      expect(await sqlstate(q("select * from public.slot_availability"))).toBe("42501");
      expect(await sqlstate(q(set, [ed, s, 1, r510, "can", null]))).toBe("42501");
    });
  });

  it("shows the timeline across editions: the speaker's own events to every member, approaches only where one may look", async () => {
    await commitAs(A, "select public.update_speaker($1, $2, (select version from public.speakers where id = $2), '{\"affiliation\": \"מוסד לדוגמה\"}')", [ed, sp.s1]);
    await commitAs(ADMIN, "select public.vet_speakers(array[$1::bigint], 'approved', 'נבדק')", [sp.s2]);
    const timeline = (email: string, s: number) =>
      as(db, "authenticated", google(email), async (q) => ((await q("select public.speaker_activity($1) as l", [s])).rows[0].l as { entity: string; kind: string; edition_id: number | null }[]).map((r) => `${r.entity}:${r.kind}`));
    expect(await timeline(B, sp.s1)).toEqual(["speakers:update", "approaches:insert"]);
    expect(await timeline(PRACTICE, sp.s1)).toEqual(["speakers:update"]); // not this year's approach
    expect(await timeline(PRACTICE, sp.s2)).toEqual(["speakers:vet"]); // the gate is cross-year
    const vet = (await db.query("select edition_id, actor, detail from public.activity where entity = 'speakers' and kind = 'vet' and entity_id = $1", [sp.s2])).rows[0];
    expect([vet.edition_id, Number(vet.actor), vet.detail]).toEqual([null, member[ADMIN], { vetted: "approved", note: "נבדק" }]);
  });

  it("shows what a speaker taught in real and archived editions — not a practice week, never a contact", async () => {
    await closedLesson(archive, sp.past, 2, 870, "שיעור לדוגמה אשתקד");
    await closedLesson(practice, sp.past, 1, 510, "שיעור תרגול");
    await db.query("insert into public.speaker_contacts (speaker_id, phone) values ($1, 'synthetic-phone')", [sp.past]);
    for (const who of [B, L, PRACTICE]) {
      await as(db, "authenticated", google(who), async (q) => {
        const h = (await q("select public.speaker_history($1) as h", [sp.past])).rows[0].h;
        expect(h, who).toEqual([{
          edition_id: archive, edition_label: "תשפ\"ו", edition_kind: "archive", start_date: null, day: 2, start_min: 870, end_min: 960,
          title: "שיעור לדוגמה אשתקד", category: "תנ\"ך", role: "lead",
        }]);
        expect(JSON.stringify(h)).not.toContain("synthetic-phone");
      });
    }
    await as(db, "authenticated", google(A), async (q) => {
      expect((await q("select public.speaker_history($1) as h", [sp.s2])).rows[0].h).toEqual([]);
    });
  });

  it("shows a live edition's lessons in the history only to those who can see it — past years to everyone", async () => {
    const s = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה של השנה', 'f', 'approved') returning id")).rows[0].id);
    await closedLesson(old, s, 2, 870, "שיעור של שנה קודמת");
    const seen = async (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) =>
      ((await q("select public.speaker_history($1) as h", [s])).rows[0].h as { edition_id: number; title: string }[]).map((h) => [h.edition_id, h.title]);
    await as(db, "authenticated", google(A), async (q) => {
      // this year's lesson, closed through the grid's own commands
      await q("select public.claim_speaker($1, $2)", [ed, s]);
      const p = Number((await q("select (public.propose($1, $2, null, 1, 510, 600, null) ->> 'pitch_id')::bigint as p", [ed, s])).rows[0].p);
      await q("select public.close_lesson($1)", [p]);
      expect(await seen(q)).toEqual([[old, "שיעור של שנה קודמת"], [ed, null]]);
      for (const who of [PRACTICE, OLD, DEMO_ADMIN]) {
        await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(who))]);
        // they read none of this year's lessons through RLS, and none through the history either
        expect((await q("select count(*)::int as n from public.lessons where edition_id = $1", [ed])).rows[0].n, who).toBe(0);
        expect(await seen(q), who).toEqual([[old, "שיעור של שנה קודמת"]]);
      }
      for (const who of [B, L, ADMIN]) {
        await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(who))]);
        expect(await seen(q), who).toEqual([[old, "שיעור של שנה קודמת"], [ed, null]]);
      }
    });
  });

  it("lets only a live real edition — or a global admin — rewrite the pool's record of a speaker", async () => {
    const before = (await db.query("select name, gender, affiliation, bio_short, version from public.speakers where id = $1", [sp.s1])).rows[0];
    const upd = (edition: number, patch: string): [string, unknown[]] =>
      [`select public.update_speaker($1, $2, (select version from public.speakers where id = $2), '${patch}')`, [edition, sp.s1]];
    // a practice-only member who claims s1 there (A handles s1 this year)
    await as(db, "authenticated", google(PRACTICE), async (q) => {
      await q("select public.claim_speaker($1, $2)", [practice, sp.s1]);
      expect(await refusal(q(...upd(practice, '{"name": "שם אחר", "gender": "m", "bio_short": "ביו שהוחלף"}')))).toBe("not_handler");
      expect(await refusal(q(...upd(ed, '{"bio_short": "x"}')))).toBe("not_member");
    });
    // a demo edition's admin, without claiming
    await as(db, "authenticated", google(DEMO_ADMIN), async (q) => {
      expect(await refusal(q(...upd(demo, '{"name": "שם של הדגמה"}')))).toBe("not_handler");
    });
    // last year's admin — even as the handler there
    await as(db, "authenticated", google(OLD_ADMIN), async (q) => {
      expect(await refusal(q(...upd(old, '{"affiliation": "מוסד אחר"}')))).toBe("not_handler");
      await q("select public.claim_speaker($1, $2)", [old, sp.s1]);
      expect(await refusal(q(...upd(old, '{"affiliation": "מוסד אחר"}')))).toBe("not_handler");
    });
    expect((await db.query("select name, gender, affiliation, bio_short, version from public.speakers where id = $1", [sp.s1])).rows[0]).toEqual(before);
    // this year's handler and admin may; a global admin may from any edition
    for (const [who, edition] of [[A, ed], [ED_ADMIN, ed], [ADMIN, practice], [ADMIN, old]] as const) {
      await as(db, "authenticated", google(who), async (q) => {
        expect(await refusal(q(...upd(edition, '{"affiliation": "מוסד חדש"}'))), `${who} in ${edition}`).toBe("ok");
      });
    }
  });

  it("a closed lesson elsewhere — an archive, last year, a practice week — pins nothing here or in the pool; this year's does", async () => {
    const s = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה שלימדה בעבר', 'f', 'approved') returning id")).rows[0].id);
    await closedLesson(archive, s, 3, 510, "שיעור בארכיון");
    await closedLesson(old, s, 3, 600, "שיעור אשתקד");
    await closedLesson(practice, s, 3, 690, "שיעור בתרגול");
    await as(db, "authenticated", google(A), async (q) => {
      const a = Number((await q("select public.claim_speaker($1, $2) as a", [ed, s])).rows[0].a);
      expect(await refusal(q("select public.set_approach_status($1, 1, 'declined', 'לא השנה')", [a]))).toBe("ok");
      expect(await refusal(q("select public.set_approach_status($1, 2, 'no_answer')", [a]))).toBe("ok");
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(ADMIN))]);
      expect(await refusal(q("select public.vet_speakers(array[$1::bigint], 'rejected', 'לא מתאים')", [s]))).toBe("ok");
      expect(await refusal(q("select public.update_speaker($1, $2, (select version from public.speakers where id = $2), '{\"gender\": null, \"retired\": true}')", [ed, s]))).toBe("ok");
    });
    await as(db, "authenticated", google(A), async (q) => {
      await q("select public.claim_speaker($1, $2)", [ed, s]);
      const p = Number((await q("select (public.propose($1, $2, null, 3, 510, 600, null) ->> 'pitch_id')::bigint as p", [ed, s])).rows[0].p);
      await q("select public.close_lesson($1)", [p]);
      const a = (await q("select id, version from public.approaches where edition_id = $1 and speaker_id = $2", [ed, s])).rows[0];
      expect(await refusal(q("select public.set_approach_status($1, $2, 'declined')", [a.id, a.version]))).toBe("lesson_closed");
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(ADMIN))]);
      expect(await refusal(q("select public.vet_speakers(array[$1::bigint], 'rejected')", [s]))).toBe("lesson_closed");
    });
  });

  it("hands over only to an active content or admin member of the edition; a handler moved to logistics loses the contacts", async () => {
    const a = Number((await db.query("select id from public.approaches where edition_id = $1 and speaker_id = $2", [ed, sp.s1])).rows[0].id);
    const handOver = (to: number) =>
      as(db, "authenticated", google(A), (q) => refusal(q("select public.hand_over($1, $2)", [a, to])));
    expect(await handOver(member[PRACTICE])).toBe("bad_member"); // another edition's content member
    expect(await handOver(member[OLD])).toBe("bad_member"); // last year's
    expect(await handOver(member[L])).toBe("bad_member"); // logistics
    expect(await handOver(member[B])).toBe("ok");
    await db.query("update public.members set active = false where id = $1", [member[B]]);
    try {
      expect(await handOver(member[B])).toBe("bad_member");
    } finally {
      await db.query("update public.members set active = true where id = $1", [member[B]]);
    }

    await db.query("update public.members set role = 'logistics' where id = $1", [member[A]]);
    try {
      await as(db, "authenticated", google(A), async (q) => {
        expect((await q("select public.get_speaker_contacts($1) as c", [sp.s1])).rows[0].c).toBeNull();
        expect((await q("select count(*)::int as n from public.speaker_contacts")).rows[0].n).toBe(0);
        expect(await refusal(q("select public.set_speaker_contacts($1, $2, null)", [sp.s1, PHONE]))).toBe("contacts_hidden");
      });
    } finally {
      await db.query("update public.members set role = 'content' where id = $1", [member[A]]);
    }
    await as(db, "authenticated", google(A), async (q) => {
      expect((await q("select public.get_speaker_contacts($1) as c", [sp.s1])).rows[0].c).not.toBeNull();
    });
  });

  it("marks a speaker added from a demo edition synthetic, so unseed_gate.sql takes it with the gate", async () => {
    await as(db, "authenticated", google(DEMO_ADMIN), async (q) => {
      const r = (await q("select public.create_speaker($1, '{\"name\": \"מרצה מן ההדגמה\"}', true, false, true) as r", [demo])).rows[0].r;
      expect((await q("select source from public.speakers where id = $1", [r.speaker_id])).rows[0].source).toBe("synthetic");
    });
    for (const [who, edition] of [[PRACTICE, practice], [A, ed]] as const) {
      await as(db, "authenticated", google(who), async (q) => {
        const r = (await q("select public.create_speaker($1, '{\"name\": \"מרצה מן התרגול\"}', false, false, true) as r", [edition])).rows[0].r;
        expect((await q("select source, vetted from public.speakers where id = $1", [r.speaker_id])).rows[0], who).toEqual({ source: "manual", vetted: "pending" });
      });
    }
  });

  it("two members claiming the same speaker at once: exactly one gets it", async () => {
    const s = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה למירוץ', 'f', 'approved') returning id")).rows[0].id);
    const race = async (sql: (c: pg.Client, who: string) => Promise<unknown>) => {
      const url = new URL(adminUrl());
      url.pathname = `/${dbName}`;
      const [c1, c2] = [new pg.Client({ connectionString: url.toString() }), new pg.Client({ connectionString: url.toString() })];
      await c1.connect();
      await c2.connect();
      try {
        for (const [c, email] of [[c1, A], [c2, B]] as const) {
          await c.query("begin; set local role authenticated");
          await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(email))]);
        }
        await sql(c1, A);
        const second = refusal(sql(c2, B)); // waits on the first one's row
        await new Promise((r) => setTimeout(r, 150));
        await c1.query("commit");
        const out = await second;
        await c2.query(out === "ok" ? "commit" : "rollback");
        return out;
      } finally {
        await c1.end();
        await c2.end();
      }
    };
    expect(await race((c) => c.query("select public.claim_speaker($1, $2)", [ed, s]))).toBe("approach_owned");
    expect((await db.query("select owner_member_id from public.approaches where speaker_id = $1", [s])).rows.map((r) => Number(r.owner_member_id))).toEqual([member[A]]);

    // v14: two people proposing a speaker nobody handles yet, into two cells of different days (two day locks): one takes the speaker,
    // «לפני שיחה», the other is told so — never a bare unique violation
    const t = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה למירוץ בשיבוץ', 'f', 'pending') returning id")).rows[0].id);
    expect(await race((c, who) => c.query("select public.propose($1, $2, null, $3, 510, 600, null)", [ed, t, who === A ? 1 : 2]))).toBe("approach_owned");
    expect((await db.query("select owner_member_id, status, version from public.approaches where speaker_id = $1", [t])).rows).toEqual([{ owner_member_id: String(member[A]), status: "claimed", version: 1 }]);
    expect((await db.query("select p.state from public.pitches p join public.approaches a on a.id = p.approach_id where a.speaker_id = $1", [t])).rows).toEqual([{ state: "candidate" }]);

    // two people adding the same new name: one speaker, one refusal
    expect(await race((c) => c.query("select public.create_speaker($1, '{\"name\": \"מרצה חדשה במירוץ\"}', false, false, true)", [ed]))).toBe("speaker_exists");
    expect((await db.query("select count(*)::int as n from public.speakers where name = 'מרצה חדשה במירוץ'")).rows[0].n).toBe(1);
  });

  it("takes the edition's own titles when its settings list them", async () => {
    await as(db, "authenticated", google(ADMIN), async (q) => {
      await q("update public.editions set settings = settings || '{\"titles\": [\"ד״ר\", \"מורה\"]}' where id = $1", [ed]);
      expect(await refusal(q("select public.create_speaker($1, '{\"name\": \"מרצה עם תואר\", \"title\": \"הרב\"}')", [ed]))).toBe("bad_value");
      expect(await refusal(q("select public.create_speaker($1, '{\"name\": \"מרצה עם תואר\", \"title\": \"מורה\"}')", [ed]))).toBe("ok");
      await q("update public.editions set settings = settings || '{\"titles\": []}' where id = $1", [ed]); // empty: the default four
      expect(await refusal(q("select public.create_speaker($1, '{\"name\": \"מרצה עם תואר ב\", \"title\": \"הרב\"}', false, false, true)", [ed]))).toBe("ok");
    });
  });

  it("leaves vetting to a global admin — an edition's admin may edit a speaker, not approve one", async () => {
    await as(db, "authenticated", google(ED_ADMIN), async (q) => {
      expect(await refusal(q("select public.vet_speakers(array[$1::bigint], 'approved')", [sp.s2]))).toBe("forbidden");
      expect(await refusal(q("select public.create_speaker($1, '{\"name\": \"מרצה מאושרת\"}', false, true)", [ed]))).toBe("forbidden");
      expect(await refusal(q("select public.update_speaker($1, $2, (select version from public.speakers where id = $2), '{\"bio_short\": \"ביו\"}')", [ed, sp.s2]))).toBe("ok");
      expect(await refusal(q("select public.update_speaker($1, $2, (select version from public.speakers where id = $2), '{\"retired\": true}')", [ed, sp.s2]))).toBe("forbidden");
    });
    await as(db, "authenticated", google(ADMIN), async (q) => {
      const r = (await q("select public.create_speaker($1, '{\"name\": \"מרצה מאושרת\"}', false, true) as r", [ed])).rows[0].r;
      const s = (await q("select vetted, vetted_by, vetted_at is not null as at, created_by from public.speakers where id = $1", [r.speaker_id])).rows[0];
      expect([s.vetted, Number(s.vetted_by), s.at, Number(s.created_by)]).toEqual(["approved", member[ADMIN], true, member[ADMIN]]);
    });
  });

  it("load_week carries the pool's new fields — and still no contact detail", async () => {
    await as(db, "authenticated", google(B), async (q) => {
      const w = (await q("select public.load_week($1) as w", [ed])).rows[0].w;
      expect(Object.keys(w.speakers[0]).sort()).toEqual([
        "affiliation", "bio_short", "contact_pref", "disambiguator", "gender", "id", "name", "name_key", "retired", "title", "topics", "version", "vetted", "vetted_by", "vetted_note",
      ]);
      expect(Object.keys(w.approaches[0]).sort()).toEqual(["avail_note", "id", "offered_to", "owner_member_id", "speaker_id", "status", "version"]);
      expect(JSON.stringify(w)).not.toMatch(/synthetic|555 0100|speaker@example/);
    });
  });
});
