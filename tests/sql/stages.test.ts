// From placement to arrival (v7) in the database, as the roles a browser gets:
// what tests/parity cannot see — transport details' policy for every role (the
// table and the function agree), the outsiders, the reconfirm trigger on any
// write path, the escort's foreign key under RLS, the log, and the catalog.
// (What each command does, refusal by refusal, is tests/parity: engine and SQL
// held to one contract.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SCHEMA, as, dropDatabase, freshDatabase, google, sqlstate } from "./db";

const ADMIN = "admin@example.org"; // every edition
const ED_ADMIN = "edition.admin@example.org";
const A = "a@example.org"; // handles the speaker
const B = "b@example.org";
const L = "logistics@example.org";
const PRACTICE = "practice@example.org"; // content in a practice edition only
const OLD = "old@example.org"; // logistics in last year's (archived) edition
const STRANGER = "stranger@example.org";
const ADDRESS = "synthetic-address";
const PHONE = "555 0100 99"; // a phone-shaped value no scanner takes for an Israeli number

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message: string };
    return err.code === "P0001" ? err.message : (err.code ?? "error");
  }
}

describe("from placement to arrival", () => {
  const dbName = `vw_stages_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let practice: number;
  let old: number;
  let speaker: number;
  let lesson: number;
  let trainee: number;
  const member: Record<string, number> = {};

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
  const version = async (id: number) => Number((await db.query("select version from public.lessons where id = $1", [id])).rows[0].version);

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', '2027-02-14', 510)"));
    practice = Number((await db.query("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id")).rows[0].id);
    old = Number((await db.query("insert into public.editions (label, kind, status) values ('שנה קודמת', 'real', 'archived') returning id")).rows[0].id);
    for (const e of [practice, old]) await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'בית מדרש', true)", [e]);
    for (const [email, role, edition] of [
      [ED_ADMIN, "admin", ed], [A, "content", ed], [B, "content", ed], [L, "logistics", ed], [PRACTICE, "content", practice], [OLD, "logistics", old],
    ] as const) {
      member[email] = Number((await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3) returning id", [email, role, edition])).rows[0].id);
    }
    member[ADMIN] = Number((await db.query("select id from public.members where email = $1", [ADMIN])).rows[0].id);
    speaker = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה לבדיקה', 'f', 'approved') returning id")).rows[0].id);
    trainee = Number((await db.query("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה לדוגמה') returning id", [ed])).rows[0].id);
    // A closes a lesson and asks for transport; the instructor approves it.
    const p = Number(await commitAs(A, "select (public.propose($1, $2, null, 1, 510, 600, null) ->> 'pitch_id')::bigint", [ed, speaker]));
    await commitAs(A, "select public.close_lesson($1)", [p]);
    lesson = Number((await db.query("select lesson_id from public.pitches where id = $1", [p])).rows[0].lesson_id);
    await commitAs(A, "select public.set_payment($1, $2, null, 'round_trip')", [lesson, await version(lesson)]);
    await commitAs(A, "select public.set_transport_details($1, $2, '07:15', null, null, false)", [lesson, ADDRESS]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  it("exposes the stage RPCs with the contract's parameter names (src/data/supabaseCommands.ts calls them by name)", async () => {
    const sig = async (fn: string) =>
      (await db.query("select pg_get_function_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows.map((r) => r.a);
    expect(await sig("set_payment")).toEqual(["p_lesson bigint, p_version integer, p_pay_amount numeric, p_transport text"]);
    expect(await sig("decide_payments")).toEqual(["p_lessons bigint[], p_versions integer[], p_decision text, p_note text DEFAULT NULL::text"]);
    expect(await sig("mark_confirm_sent")).toEqual(["p_lesson bigint, p_version integer"]);
    expect(await sig("set_escort")).toEqual(["p_lesson bigint, p_version integer, p_roster bigint, p_self_intro boolean, p_note text DEFAULT NULL::text"]);
    expect(await sig("set_sources")).toEqual(["p_lesson bigint, p_version integer, p_kind text, p_print_when text, p_note text, p_url text, p_in_reader boolean"]);
    expect(await sig("set_paid")).toEqual(["p_lesson bigint, p_paid boolean"]);
    expect(await sig("get_transport_details")).toEqual(["p_lesson bigint"]);
    expect(await sig("set_transport_details")).toEqual(["p_lesson bigint, p_pickup_address text, p_pickup_time text, p_driver_name text, p_driver_phone text, p_arranged boolean DEFAULT false"]);
    expect(await sig("set_confirm_template")).toEqual(["p_edition bigint, p_body text"]);
    expect(await sig("set_duty_phrases")).toEqual(["p_edition bigint, p_phrases jsonb"]);
    // whole shekels
    expect((await db.query("select data_type from information_schema.columns where table_name = 'lessons' and column_name = 'pay_amount'")).rows[0].data_type).toBe("integer");
  });

  it("shows transport details to the handler and a global admin; to logistics only once approved; to no one else — the table and the function agree", async () => {
    const read = (email: string) =>
      as(db, "authenticated", google(email), async (q) => {
        const rpc = (await q("select public.get_transport_details($1) as t", [lesson])).rows[0].t;
        const table = (await q("select pickup_address from public.transport_details where lesson_id = $1", [lesson])).rows;
        expect(table.length, email).toBe(rpc == null || rpc.pickup_address == null ? 0 : 1);
        return rpc?.pickup_address ?? (rpc == null ? "hidden" : "empty");
      });
    expect(await read(A)).toBe(ADDRESS);
    expect(await read(ADMIN)).toBe(ADDRESS);
    for (const who of [L, B, ED_ADMIN, PRACTICE, OLD, STRANGER]) expect(await read(who), who).toBe("hidden");

    // the instructor approves: now logistics of THIS edition — not last year's
    await commitAs(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson, await version(lesson)]);
    expect(await read(L)).toBe(ADDRESS);
    for (const who of [B, ED_ADMIN, PRACTICE, OLD, STRANGER]) expect(await read(who), who).toBe("hidden");

    // writing: the same people
    for (const who of [B, ED_ADMIN, PRACTICE, OLD]) {
      await as(db, "authenticated", google(who), async (q) => {
        expect(await refusal(q("select public.set_transport_details($1, null, null, 'x', null)", [lesson])), who).toBe("transport_hidden");
      });
    }
    expect(await refusal(commitAs(L, "select public.set_transport_details($1, $2, '07:15', 'נהג/ת לדוגמה', $3, true)", [lesson, ADDRESS, PHONE]))).toBe("ok");
    await as(db, "authenticated", google(L), async (q) => {
      expect((await q("select public.get_transport_details($1) as t", [lesson])).rows[0].t).toEqual({
        pickup_address: ADDRESS, pickup_time: "07:15", driver_name: "נהג/ת לדוגמה", driver_phone: PHONE, arranged: true,
      });
    });

    // a practice-week member sees no row of the table at all
    await as(db, "authenticated", google(PRACTICE), async (q) => {
      expect((await q("select count(*)::int as n from public.transport_details")).rows[0].n).toBe(0);
    });
  });

  it("keeps transport details out of load_week, the log and every direct write", async () => {
    await as(db, "authenticated", google(A), async (q) => {
      const w = (await q("select public.load_week($1) as w", [ed])).rows[0].w;
      expect(JSON.stringify(w)).not.toMatch(/synthetic-address|555 0100|נהג\/ת/);
      expect(w.roster).toEqual([{ id: trainee, full_name: "חניך/ה לדוגמה", gender: null }]);
      expect(Object.keys(w.lessons[0])).toEqual(expect.arrayContaining(["pay_amount", "approval", "approval_note", "confirm_sent_at", "escort_roster_id", "sources_kind", "presentation_url", "paid_at"]));
    });
    for (const who of [ADMIN, A, L]) {
      await as(db, "authenticated", google(who), async (q) => {
        expect(await sqlstate(q("insert into public.transport_details (lesson_id, pickup_address) values ($1, 'x')", [lesson])), who).toBe("42501");
        expect(await sqlstate(q("update public.transport_details set arranged = false")), who).toBe("42501");
        expect(await sqlstate(q("delete from public.transport_details")), who).toBe("42501");
        expect(await sqlstate(q("update public.lessons set paid_at = now(), approval = 'approved'")), who).toBe("42501");
        expect(await sqlstate(q("select app.lesson_handler($1)", [lesson])), who).toBe("42501");
      });
    }
    const log = (await db.query("select kind, detail from public.activity where entity = 'lessons' and kind = 'transport' order by id")).rows;
    expect(log.map((r) => r.detail)).toEqual([
      { fields: ["pickup_address", "pickup_time"] },
      { fields: ["driver_name", "driver_phone", "arranged"] },
    ]);
    expect(JSON.stringify((await db.query("select detail from public.activity")).rows)).not.toMatch(/synthetic-address|555 0100|נהג/);
  });

  it("refuses a stranger every stage function, and anon all of them", async () => {
    const calls: [string, unknown[]][] = [
      ["select public.set_payment($1, 1, 100, 'none')", [lesson]],
      ["select public.mark_confirm_sent($1, 1)", [lesson]],
      ["select public.set_escort($1, 1, null, false)", [lesson]],
      ["select public.set_sources($1, 1, 'sheet', 'none', null, null, false)", [lesson]],
      ["select public.set_paid($1, true)", [lesson]],
      ["select public.decide_payments(array[$1::bigint], array[1], 'approved')", [lesson]],
      ["select public.set_transport_details($1, 'x', null, null, null)", [lesson]],
      ["select public.set_confirm_template($1, 'x')", [ed]],
      ["select public.set_duty_phrases($1, '[]')", [ed]],
    ];
    await as(db, "authenticated", google(STRANGER), async (q) => {
      for (const [sql, params] of calls) expect(await refusal(q(sql, params)), sql).toBe("not_member");
      expect((await q("select public.get_transport_details($1) as t", [lesson])).rows[0].t).toBeNull();
    });
    // last year's logistics member: a member, but not of this edition
    await as(db, "authenticated", google(OLD), async (q) => {
      expect(await refusal(q("select public.set_paid($1, true)", [lesson]))).toBe("not_member");
      expect(await refusal(q("select public.set_confirm_template($1, 'x')", [ed]))).toBe("not_member");
    });
    await as(db, "authenticated", google(L), async (q) => {
      // logistics reads the schedule, writes paid_at and transport only — no titles, no approvals, no requests
      expect(await refusal(q("select public.update_lesson($1, $2, '{\"title\": \"x\"}')", [lesson, await version(lesson)]))).toBe("forbidden");
      expect(await refusal(q("select public.decide_payments(array[$1::bigint], array[1], 'approved')", [lesson]))).toBe("forbidden");
      expect(await refusal(q("select public.set_payment($1, 1, 100, 'none')", [lesson]))).toBe("forbidden");
      expect(await refusal(q("select public.set_escort($1, 1, null, true)", [lesson]))).toBe("forbidden");
      expect((await q("select count(*)::int as n from public.lessons")).rows[0].n).toBeGreaterThan(0);
    });
    await as(db, "anon", null, async (q) => {
      for (const [sql, params] of calls) expect(await sqlstate(q(sql, params)), sql).toBe("42501");
      expect(await sqlstate(q("select public.get_transport_details($1)", [lesson]))).toBe("42501");
      expect(await sqlstate(q("select * from public.transport_details"))).toBe("42501");
    });
  });

  it("flags «לעדכן את המרצה» on every write path once the message went out — a trigger, not just the commands", async () => {
    const flag = async () => (await db.query("select needs_reconfirm from public.lessons where id = $1", [lesson])).rows[0].needs_reconfirm;
    await commitAs(A, "select public.mark_confirm_sent($1, $2)", [lesson, await version(lesson)]);
    expect(await flag()).toBe(false);
    const sent = (await db.query("select confirm_sent_by, confirm_sent_at is not null as at from public.lessons where id = $1", [lesson])).rows[0];
    expect([Number(sent.confirm_sent_by), sent.at]).toEqual([member[A], true]);
    // paid, escort and sources are not in the message
    await commitAs(A, "select public.set_escort($1, $2, $3, false, 'הערה לדוגמה')", [lesson, await version(lesson), trainee]);
    await commitAs(A, "select public.set_sources($1, $2, 'sheet', 'before', null, null, true)", [lesson, await version(lesson)]);
    expect(await flag()).toBe(false);
    // the SQL Editor (an import, a fix by hand) moves it: still flagged
    await db.query("update public.lessons set start_min = 600, end_min = 690 where id = $1", [lesson]);
    expect(await flag()).toBe(true);
    await commitAs(A, "select public.mark_confirm_sent($1, $2)", [lesson, await version(lesson)]);
    expect(await flag()).toBe(false);
    await db.query("update public.lessons set confirm_sent_at = now() - interval '1 day', title = 'כותרת לדוגמה' where id = $1", [lesson]);
    expect(await flag()).toBe(false); // a new confirm_sent_at is a message re-sent with it
  });

  it("deleting a trainee from the roster leaves their lessons without an escort — under the edition admin's RLS", async () => {
    expect((await db.query("select escort_roster_id from public.lessons where id = $1", [lesson])).rows[0].escort_roster_id).not.toBeNull();
    const fk = (await db.query("select confdeltype from pg_constraint where conname = 'lessons_escort_roster_fk'")).rows[0];
    expect(fk.confdeltype).toBe("n"); // on delete set null
    const before = await version(lesson);
    expect(await refusal(commitAs(ED_ADMIN, "delete from public.roster where id = $1", [trainee]))).toBe("ok");
    const after = (await db.query("select escort_roster_id, version from public.lessons where id = $1", [lesson])).rows[0];
    expect([after.escort_roster_id, Number(after.version)]).toEqual([null, before]);
  });

  it("set_paid: logistics or an admin, once a payment is approved", async () => {
    await commitAs(A, "select public.set_payment($1, $2, 250, 'round_trip')", [lesson, await version(lesson)]);
    await as(db, "authenticated", google(L), async (q) => {
      expect(await refusal(q("select public.set_paid($1, true)", [lesson]))).toBe("payment_not_approved");
    });
    await commitAs(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved', 'נתון לדוגמה')", [lesson, await version(lesson)]);
    const d = (await db.query("select approval, approval_note, approved_by, approved_at is not null as at from public.lessons where id = $1", [lesson])).rows[0];
    expect([d.approval, d.approval_note, Number(d.approved_by), d.at]).toEqual(["approved", "נתון לדוגמה", member[ADMIN], true]);
    await as(db, "authenticated", google(A), async (q) => {
      expect(await refusal(q("select public.set_paid($1, true)", [lesson]))).toBe("forbidden");
    });
    expect(await refusal(commitAs(L, "select public.set_paid($1, true)", [lesson]))).toBe("ok");
    expect((await db.query("select paid_at is not null as p from public.lessons where id = $1", [lesson])).rows[0].p).toBe(true);
    // dropping the transport takes its pickup and driver with it
    await commitAs(A, "select public.set_payment($1, $2, 250, 'none')", [lesson, await version(lesson)]);
    expect((await db.query("select count(*)::int as n from public.transport_details where lesson_id = $1", [lesson])).rows[0].n).toBe(0);
  });

  it("keeps the template and the duty phrases on the edition — never seeded; the next real edition carries them over", async () => {
    expect((await db.query("select settings from public.editions where id = $1", [ed])).rows[0].settings).toEqual({ lesson_minutes: 75, row_minutes: 90 });
    await commitAs(ED_ADMIN, "select public.set_confirm_template($1, $2)", [ed, "נוסח לדוגמה {{פנייה}}"]);
    await commitAs(ED_ADMIN, "select public.set_duty_phrases($1, $2::jsonb)", [ed, JSON.stringify([{ when: "self_intro", text: "ניסוח לדוגמה" }])]);
    await as(db, "authenticated", google(ADMIN), async (q) => {
      const next = Number((await q("select public.start_edition('תשפ\"ח', null) as e")).rows[0].e);
      expect((await q("select settings from public.editions where id = $1", [next])).rows[0].settings).toEqual({
        lesson_minutes: 75, row_minutes: 90, confirm_template: "נוסח לדוגמה {{פנייה}}", duty_phrases: [{ when: "self_intro", text: "ניסוח לדוגמה" }],
      });
    });
  });
});

// The milestone-3 review: the stages are the speaker's. A reopen — by the
// handler while a request only waits, or by an admin after it was approved —
// must leave the next speaker's handler nothing of the last one's: no pickup
// address, no approved amount, no «נשלחה». Money paid is never erased.
describe("a reopen starts the stages over", () => {
  const dbName = `vw_reopen_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  const sp: number[] = [];

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
  const version = async (id: number) => Number((await db.query("select version from public.lessons where id = $1", [id])).rows[0].version);
  const readT = (email: string, lesson: number) =>
    as(db, "authenticated", google(email), async (q) => (await q("select public.get_transport_details($1) as t", [lesson])).rows[0].t);
  const rows = async (lesson: number) => Number((await db.query("select count(*)::int as n from public.transport_details where lesson_id = $1", [lesson])).rows[0].n);
  const stageRow = async (lesson: number) =>
    (await db.query(`select state, pay_amount, transport, approval, approval_note, approved_by, approved_at, paid_at, confirm_sent_at, confirm_sent_by,
                            needs_reconfirm, escort_roster_id, self_intro, escort_note, sources_kind, print_when, sources_note, presentation_url, in_reader
                       from public.lessons where id = $1`, [lesson])).rows[0];
  const FRESH = {
    pay_amount: null, transport: "none", approval: "none", approval_note: null, approved_by: null, approved_at: null, paid_at: null,
    confirm_sent_at: null, confirm_sent_by: null, needs_reconfirm: false, escort_roster_id: null, self_intro: false, escort_note: null,
    sources_kind: "pending", print_when: "none", sources_note: null, presentation_url: null, in_reader: false,
  };
  /** A places speaker `s` at day `day`, asks `amount` + transport, records a pickup; returns the lesson. */
  async function placed(s: number, day: number, amount: number | null): Promise<number> {
    const p = Number(await commitAs(A, "select (public.propose($1, $2, null, $3, 510, 600, null) ->> 'pitch_id')::bigint", [ed, s, day]));
    await commitAs(A, "select public.close_lesson($1)", [p]);
    const lesson = Number((await db.query("select lesson_id from public.pitches where id = $1", [p])).rows[0].lesson_id);
    await commitAs(A, "select public.set_payment($1, $2, $3, 'round_trip')", [lesson, await version(lesson), amount]);
    await commitAs(A, "select public.set_transport_details($1, $2, '07:15', null, null, false)", [lesson, ADDRESS]);
    return lesson;
  }
  /** B places speaker `s` on the reopened draft and closes it. */
  async function closedByB(lesson: number, s: number) {
    const p = Number(await commitAs(B, "select (public.propose($1, $2, $3, null, null, null, null) ->> 'pitch_id')::bigint", [ed, s, lesson]));
    expect(await refusal(commitAs(B, "select public.close_lesson($1)", [p]))).toBe("ok");
  }

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', '2027-02-14', 510)"));
    for (const [email, role] of [[ED_ADMIN, "admin"], [A, "content"], [B, "content"], [L, "logistics"]] as const) {
      await db.query("insert into public.members (email, display_name, role, edition_id, gender) values ($1, $1, $2, $3, 'f')", [email, role, ed]);
    }
    for (const n of ["מרצה לדוגמה א", "מרצה לדוגמה ב", "מרצה לדוגמה ג", "מרצה לדוגמה ד", "מרצה לדוגמה ה"]) {
      sp.push(Number((await db.query("insert into public.speakers (name, gender, vetted) values ($1, 'f', 'approved') returning id", [n])).rows[0].id));
    }
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  it("the handler reopens a pending request: another member's next speaker never reads the last one's pickup", async () => {
    const lesson = await placed(sp[0], 1, 700);
    const trainee = Number((await db.query("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה לדוגמה') returning id", [ed])).rows[0].id);
    await commitAs(A, "select public.set_escort($1, $2, $3, true, 'הערה לדוגמה')", [lesson, await version(lesson), trainee]);
    await commitAs(A, "select public.set_sources($1, $2, 'presentation', 'none', null, 'https://example.org/deck', false)", [lesson, await version(lesson)]);
    expect(await readT(B, lesson)).toBeNull();
    expect(await refusal(commitAs(A, "select public.reopen_lesson($1)", [lesson]))).toBe("ok");
    expect(await rows(lesson)).toBe(0);
    expect(await stageRow(lesson)).toEqual({ state: "draft", ...FRESH });
    await closedByB(lesson, sp[1]);
    expect(await stageRow(lesson)).toEqual({ state: "closed", ...FRESH });
    expect((await readT(B, lesson))?.pickup_address).toBeNull();
    expect(await readT(L, lesson)).toBeNull();
    expect(await readT(A, lesson)).toBeNull();
  });

  it("an admin reopens an approved, sent request: nothing approved, sent or payable passes to the next speaker", async () => {
    const lesson = await placed(sp[2], 2, 900);
    await commitAs(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson, await version(lesson)]);
    await commitAs(A, "select public.mark_confirm_sent($1, $2)", [lesson, await version(lesson)]);
    expect(await refusal(commitAs(A, "select public.reopen_lesson($1)", [lesson]))).toBe("approved_locked");
    expect(await refusal(commitAs(ED_ADMIN, "select public.reopen_lesson($1)", [lesson]))).toBe("ok");
    await closedByB(lesson, sp[3]);
    expect(await stageRow(lesson)).toEqual({ state: "closed", ...FRESH });
    expect(await rows(lesson)).toBe(0);
    expect(await refusal(commitAs(L, "select public.set_paid($1, true)", [lesson]))).toBe("payment_not_approved");
    expect(await readT(L, lesson)).toBeNull();
  });

  it("money paid stays: no reopen and no new amount until «שולם» is undone; a draft's request is no one's to decide", async () => {
    const lesson = await placed(sp[4], 3, 500);
    await commitAs(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson, await version(lesson)]);
    await commitAs(L, "select public.set_paid($1, true)", [lesson]);
    expect(await refusal(commitAs(A, "select public.set_payment($1, $2, 800, 'round_trip')", [lesson, await version(lesson)]))).toBe("paid_locked");
    expect(await refusal(commitAs(A, "select public.set_payment($1, $2, null, 'round_trip')", [lesson, await version(lesson)]))).toBe("paid_locked");
    expect(await refusal(commitAs(ADMIN, "select public.reopen_lesson($1)", [lesson]))).toBe("paid_locked");
    expect(await refusal(commitAs(L, "select public.set_paid($1, false)", [lesson]))).toBe("ok");
    expect(await refusal(commitAs(A, "select public.set_payment($1, $2, 800, 'round_trip')", [lesson, await version(lesson)]))).toBe("ok");
    // a pending request left on a draft (only a hand edit gets there): stale, never approved
    await db.query("update public.lessons set state = 'draft' where id = $1", [lesson]);
    expect(await refusal(commitAs(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson, await version(lesson)]))).toBe("stale");
  });

  it("moving the week's opening date flags every lesson whose message went out (editions_reconfirm); setting a TBD date flags none", async () => {
    const p = Number(await commitAs(A, "select (public.propose($1, $2, null, 4, 510, 600, null) ->> 'pitch_id')::bigint", [ed, sp[0]]));
    await commitAs(A, "select public.close_lesson($1)", [p]);
    const lesson = Number((await db.query("select lesson_id from public.pitches where id = $1", [p])).rows[0].lesson_id);
    await commitAs(A, "select public.mark_confirm_sent($1, $2)", [lesson, await version(lesson)]);
    const flagged = async () => (await db.query("select id from public.lessons where edition_id = $1 and needs_reconfirm order by id", [ed])).rows.map((r) => Number(r.id));
    expect(await flagged()).toEqual([]);
    const before = await version(lesson);
    // the «מחזור» tab writes editions directly, under the global admin's RLS
    await commitAs(ADMIN, "update public.editions set first_day_from = 600 where id = $1", [ed]);
    expect(await flagged()).toEqual([]);
    await commitAs(ADMIN, "update public.editions set start_date = '2027-02-21' where id = $1", [ed]);
    expect(await flagged()).toEqual([lesson]);
    expect(await version(lesson)).toBe(before + 1);
    await commitAs(A, "select public.mark_confirm_sent($1, $2)", [lesson, await version(lesson)]);
    await db.query("update public.editions set start_date = null where id = $1", [ed]);
    expect(await flagged()).toEqual([lesson]); // a date taken away changes the message too
    await commitAs(A, "select public.mark_confirm_sent($1, $2)", [lesson, await version(lesson)]);
    await db.query("update public.editions set start_date = '2027-02-14' where id = $1", [ed]);
    expect(await flagged()).toEqual([]); // TBD → a date: no message had one
  });
});
