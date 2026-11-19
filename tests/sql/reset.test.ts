// The reset's data foundation (v18) in the database, as the roles a browser
// gets — a global admin, an edition's admin, the content member who handles the
// speaker, another content member, logistics, the staff of another edition, a
// practice week's, last year's (archived), an inactive member, a stranger, anon:
//   * the days' owners — set_day_owners (an admin of the edition; at most two,
//     each able to handle speakers there; a member who stays keeps their
//     «ראיתי»), mark_day_seen (an owner, their own row), load_week's dayOwners,
//     the table read-only under RLS;
//   * availability written as time ranges — set_availability_ranges: who, every
//     refusal, and the rule itself (a «לא» range touching a row wins, a «יכול/ה»
//     range must cover the row whole, two never add up, the rest, only the days
//     listed are replaced, their notes go, ONE line in the log and no note in it);
//   * the transport details in two parts — set_transport_request (the handler,
//     before the approval) and set_transport_driver (logistics, after it), each
//     only by who may read it back (never a practice week's team, never an
//     archived edition's own admin, before the purge or after it), and
//     who reads a pickup: the handler, the edition's admins, logistics from the
//     request on — through get_transport_details, the table and
//     get_transports_for, for every state of the approval;
//   * lesson_import_notes, which shares that predicate: an archive's as before;
//   * decide_payments by an edition's admin and by its logistics — never a
//     content member, never the staff of another edition;
//   * and the file run again on all of it: nothing changed, nothing lost.
// (What each command does on the engine as well is tests/parity.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { SCHEMA, adminUrl, dropDatabase, freshDatabase, google, sqlstate } from "./db";

const ADMIN = "admin@example.org"; // every edition
const ED_ADMIN = "edition.admin@example.org";
const A = "a@example.org"; // content; handles the speakers below
const B = "b@example.org"; // content — another trainee
const L = "logistics@example.org";
const INACTIVE = "inactive@example.org"; // content of this edition, deactivated
const O_ADMIN = "other.admin@example.org"; // another live, real edition
const O_C = "other.content@example.org";
const O_L = "other.logistics@example.org";
const P_ADMIN = "practice.admin@example.org"; // a practice week
const P_C = "practice.content@example.org";
const OLD_ADMIN = "old.admin@example.org"; // last year's edition, archived
const OLD_C = "old.content@example.org";
const OLD_L = "old.logistics@example.org";
const ARC_ADMIN = "archive.admin@example.org"; // an imported archive
const ARC_C = "archive.content@example.org";
const ARC_L = "archive.logistics@example.org";
const DUAL = "dual@example.org"; // two rows: a content member of this edition, logistics of the other one
const STRANGER = "stranger@example.org";
// Synthetic: no scanner takes these for a real address, name or phone.
const ADDRESS = "כתובת איסוף לדוגמה";
const DRIVER = "נהג/ת לדוגמה";
const PHONE = "555 0100 44";
const NOTE = "הערת זמינות לדוגמה";
const IMPORT_NOTE = "הסעה: מילים לדוגמה מהגיליון";

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

describe("the reset's data foundation (v18)", () => {
  const dbName = `vw_reset_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  const edition: Record<string, number> = {};
  const member: Record<string, number> = {};
  const lesson: Record<string, number> = {};
  const sp: Record<string, number> = {};
  /** start_min → grid row id, the lesson rows of `ed`. */
  const row: Record<number, number> = {};

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
            await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(who))]);
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
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(email))]);
      const r = await db.query(sql, params);
      await db.query("commit");
      return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
  const owner = async (sql: string, params: unknown[] = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
  const version = async (id: number) => Number(await owner("select version from public.lessons where id = $1", [id]));

  let speakers = 0;
  const speaker = async () =>
    Number(await owner("insert into public.speakers (name, gender, vetted) values ($1, 'f', 'approved') returning id", [`מרצה לדוגמה ${++speakers}`]));
  /** `email` places a new speaker and closes the lesson; with `transport`, asks for one (the request then waits). */
  async function closedLesson(email: string, e: number, day: number, start: number, transport: "none" | "round_trip", amount: number | null = null): Promise<number> {
    const p = Number(await commitAs(email, "select (public.propose($1, $2, null, $3, $4, $5, null) ->> 'pitch_id')::bigint", [e, await speaker(), day, start, start + 90]));
    await commitAs(email, "select public.close_lesson($1)", [p]);
    const id = Number(await owner("select lesson_id from public.pitches where id = $1", [p]));
    if (transport !== "none" || amount != null) await commitAs(email, "select public.set_payment($1, $2, $3, $4)", [id, await version(id), amount, transport]);
    return id;
  }

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', '2027-02-14', 510)")); // Sunday opens 08:30, Thursday closes 19:00
    for (const [key, label, kind] of [["other", "מחזור אחר", "real"], ["practice", "תרגול", "practice"], ["old", "שנה קודמת", "real"], ["archive", "תשפ\"ו", "archive"]] as const) {
      const id = Number(await owner("insert into public.editions (label, kind) values ($1, $2) returning id", [label, kind]));
      edition[key] = id;
      await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'בית מדרש', true)", [id]);
      await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [id]);
    }
    for (const [email, role, e, active] of [
      [ED_ADMIN, "admin", ed, true], [A, "content", ed, true], [B, "content", ed, true], [L, "logistics", ed, true], [INACTIVE, "content", ed, false],
      [O_ADMIN, "admin", edition.other, true], [O_C, "content", edition.other, true], [O_L, "logistics", edition.other, true],
      [P_ADMIN, "admin", edition.practice, true], [P_C, "content", edition.practice, true],
      [OLD_ADMIN, "admin", edition.old, true], [OLD_C, "content", edition.old, true], [OLD_L, "logistics", edition.old, true],
      [ARC_ADMIN, "admin", edition.archive, true], [ARC_C, "content", edition.archive, true], [ARC_L, "logistics", edition.archive, true],
    ] as const) {
      member[email] = Number(await owner("insert into public.members (email, display_name, role, edition_id, active) values ($1, $1, $2, $3, $4) returning id", [email, role, e, active]));
    }
    member[ADMIN] = Number(await owner("select id from public.members where email = $1", [ADMIN]));
    await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, 'content', $2), ($1, $1, 'logistics', $3)", [DUAL, ed, edition.other]);
    for (const r of (await db.query("select id, start_min from public.grid_rows where edition_id = $1 and kind = 'lesson'", [ed])).rows) row[Number(r.start_min)] = Number(r.id);

    // this edition: A's lesson with a transport request waiting (lesson.t), A's with nothing asked, A's draft,
    // and B's two requests waiting — an amount alone, and an amount with a transport
    lesson.t = await closedLesson(A, ed, 1, 510, "round_trip");
    lesson.plain = await closedLesson(A, ed, 2, 510, "none");
    lesson.draft = Number(await commitAs(A, "select (public.propose($1, $2, null, 3, 510, 600, null) ->> 'lesson_id')::bigint", [ed, await speaker()]));
    lesson.b = await closedLesson(B, ed, 1, 600, "none", 300);
    lesson.b2 = await closedLesson(B, ed, 2, 600, "round_trip", 450);
    // the pickup as the handler asked for it, before any approval
    await commitAs(A, "select public.set_transport_request($1, $2::jsonb)", [lesson.t, JSON.stringify({ pickup_address: ADDRESS, pickup_time: "07:15", pickup_min: 435 })]);
    // another live edition, a practice week, and last year's — each with a request waiting; last year's also an approved one
    lesson.other = await closedLesson(O_C, edition.other, 1, 510, "round_trip");
    lesson.practice = await closedLesson(P_C, edition.practice, 1, 510, "round_trip");
    lesson.old = await closedLesson(OLD_C, edition.old, 1, 510, "round_trip");
    lesson.oldPending = await closedLesson(OLD_C, edition.old, 2, 510, "round_trip");
    await commitAs(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson.old, await version(lesson.old)]);
    await db.query("insert into public.transport_details (lesson_id, pickup_address, pickup_min) values ($1, $2, 435)", [lesson.old, ADDRESS]);
    await db.query("insert into public.transport_details (lesson_id, pickup_address, pickup_min) values ($1, $2, 435)", [lesson.practice, ADDRESS]);
    await commitAs(OLD_ADMIN, "select public.set_day_owners($1, 1, array[$2::bigint])", [edition.old, member[OLD_C]]);
    await db.query("update public.editions set status = 'archived' where id = $1", [edition.old]);
    // the archive: a lesson with what last year's sheet said about its transport — and, by hand, a request left waiting on it
    lesson.archive = Number(await owner(
      "insert into public.lessons (edition_id, state, day, start_min, end_min, room_id, title, transport, approval) select $1, 'closed', 1, 510, 600, id, 'שיעור לדוגמה', 'round_trip', 'pending' from public.rooms where edition_id = $1 returning id",
      [edition.archive],
    ));
    await db.query("insert into public.lesson_import_notes (lesson_id, edition_id, note) values ($1, $2, $3)", [lesson.archive, edition.archive, IMPORT_NOTE]);
    sp.av = await speaker(); // nobody's yet: no approach in any edition
    sp.retired = Number(await owner("insert into public.speakers (name, gender, vetted, retired) values ('מרצה לדוגמה שפרש/ה', 'f', 'approved', true) returning id"));
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  it("exposes the five RPCs with the contract's parameter names (the ports call them by name)", async () => {
    const sig = async (fn: string) =>
      (await db.query("select pg_get_function_arguments(p.oid) as a, pg_get_function_result(p.oid) as r from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows;
    expect(await sig("set_day_owners")).toEqual([{ a: "p_edition bigint, p_day integer, p_members bigint[]", r: "void" }]);
    expect(await sig("mark_day_seen")).toEqual([{ a: "p_edition bigint, p_day integer", r: "void" }]);
    expect(await sig("set_availability_ranges")).toEqual([{ a: "p_edition bigint, p_speaker bigint, p_days integer[], p_ranges jsonb, p_rest text DEFAULT NULL::text", r: "integer" }]);
    expect(await sig("set_transport_request")).toEqual([{ a: "p_lesson bigint, p_fields jsonb", r: "void" }]);
    expect(await sig("set_transport_driver")).toEqual([{ a: "p_lesson bigint, p_fields jsonb", r: "void" }]);
    // the old commands are as they were
    expect(await sig("set_transport_details")).toEqual([{ a: "p_lesson bigint, p_pickup_address text, p_pickup_time text, p_driver_name text, p_driver_phone text, p_arranged boolean DEFAULT false", r: "void" }]);
    expect(await sig("set_slot_availability")).toEqual([{ a: "p_edition bigint, p_speaker bigint, p_day integer, p_row bigint, p_kind text, p_note text DEFAULT NULL::text", r: "void" }]);
    expect(await sig("decide_payments")).toEqual([{ a: "p_lessons bigint[], p_versions integer[], p_decision text, p_note text DEFAULT NULL::text", r: "void" }]);
    expect(await sig("get_transports_for")).toEqual([{ a: "p_edition bigint", r: "jsonb" }]);
    expect((await db.query("select public.schema_version() as v")).rows[0].v).toBe(18);
  });

  // ---------------------------------------------------------------- day owners

  describe("the days' owners", () => {
    const owners = async (run: Run, e = ed) =>
      (await run("owner", "select day, member_id, seen_at from public.day_owners where edition_id = $1 order by day, member_id", [e])).rows.map((r) => ({ day: r.day, member: Number(r.member_id), seen: r.seen_at }));
    const logged = async (run: Run) =>
      (await run("owner", "select actor, edition_id, entity, entity_id, kind, detail from public.activity where kind = 'day_owners' and edition_id = $1 order by id", [ed])).rows.map((r) => ({
        ...r, actor: Number(r.actor), edition_id: Number(r.edition_id), entity_id: Number(r.entity_id),
      }));
    const set = (run: Run, who: string, day: number | null, members: (number | null)[] | null, e = ed) =>
      code(run(who, "select public.set_day_owners($1, $2, $3::bigint[])", [e, day, members]));

    it("set_day_owners: an admin of the edition — a global one too; content, logistics: forbidden; another edition's staff, a deactivated member, a stranger: not a member; anon: no function at all", async () => {
      await inTx(async (run) => {
        expect(await set(run, ED_ADMIN, 1, [member[A], member[B]])).toBe("ok");
        expect(await set(run, ADMIN, 2, [member[A]])).toBe("ok");
        for (const who of [A, B, L]) expect(await set(run, who, 1, [member[A]]), who).toBe("forbidden");
        for (const who of [O_ADMIN, O_C, O_L, P_ADMIN, OLD_ADMIN, INACTIVE, STRANGER]) expect(await set(run, who, 1, [member[A]]), who).toBe("not_member");
        expect(await set(run, "anon", 1, [member[A]])).toBe("42501");
        // the first failure wins: who, before what
        expect(await set(run, A, 9, [member[L]])).toBe("forbidden");
        expect(await set(run, STRANGER, 9, null)).toBe("not_member");
        expect(await set(run, ED_ADMIN, 1, [member[A]], 999999)).toBe("not_member"); // an edition that is not there
        expect(await owners(run)).toEqual([
          { day: 1, member: member[A], seen: null }, { day: 1, member: member[B], seen: null }, { day: 2, member: member[A], seen: null },
        ]);
      });
    });

    it("refuses a day outside the week, more than two, a repeat, a NULL, and anyone who cannot handle speakers in this edition — `bad_value`, nothing written", async () => {
      await inTx(async (run) => {
        for (const day of [null, -1, 5, 7]) expect(await set(run, ED_ADMIN, day, [member[A]]), String(day)).toBe("bad_value");
        expect(await set(run, ED_ADMIN, 1, [member[A], member[B], member[ED_ADMIN]])).toBe("bad_value"); // three
        expect(await set(run, ED_ADMIN, 1, [member[A], member[A]])).toBe("bad_value");
        expect(await set(run, ED_ADMIN, 1, [member[A], null])).toBe("bad_value");
        expect(await set(run, ED_ADMIN, 1, [null])).toBe("bad_value");
        for (const who of [L, INACTIVE, O_C, O_ADMIN, OLD_C]) expect(await set(run, ED_ADMIN, 1, [member[who]]), who).toBe("bad_value"); // logistics, deactivated, another edition's
        expect(await set(run, ED_ADMIN, 1, [999999])).toBe("bad_value"); // nobody
        expect(await set(run, ED_ADMIN, 1, [member[A], member[L]])).toBe("bad_value"); // one bad name spoils the pair
        expect(await owners(run)).toEqual([]);
        expect(await logged(run)).toEqual([]);
        // content, an admin of the edition and a global admin all can
        expect(await set(run, ED_ADMIN, 0, [member[B], member[ED_ADMIN]])).toBe("ok");
        expect(await set(run, ED_ADMIN, 4, [member[ADMIN]])).toBe("ok");
      });
    });

    it("replaces a day's owners: who stays keeps their «ראיתי», a new one starts with none, who is not listed goes; a member may own several days; NULL or {} empties the day", async () => {
      await inTx(async (run) => {
        expect(await set(run, ED_ADMIN, 1, [member[B], member[A]])).toBe("ok");
        expect(await set(run, ED_ADMIN, 3, [member[A]])).toBe("ok");
        await run(A, "select public.mark_day_seen($1, 1)", [ed]);
        await run(B, "select public.mark_day_seen($1, 1)", [ed]);
        expect((await owners(run)).map((o) => [o.day, o.member, o.seen != null])).toEqual([[1, member[A], true], [1, member[B], true], [3, member[A], false]]);
        // A looked a week ago (by hand: inside one transaction every «ראיתי» carries the same now())
        const seenA = new Date("2027-02-07T05:30:00.000Z");
        await run("owner", "update public.day_owners set seen_at = $3 where edition_id = $1 and day = 1 and member_id = $2", [ed, member[A], seenA]);
        // B out, the edition's admin in: A's time is the very same, the newcomer's is empty, B's row is gone
        expect(await set(run, ED_ADMIN, 1, [member[ED_ADMIN], member[A]])).toBe("ok");
        const after = await owners(run);
        expect(after.map((o) => [o.day, o.member])).toEqual([[1, member[ED_ADMIN]], [1, member[A]], [3, member[A]]].sort((x, y) => x[0] - y[0] || x[1] - y[1]));
        expect((after.find((o) => o.day === 1 && o.member === member[A])?.seen as Date).getTime()).toBe(seenA.getTime());
        expect(after.find((o) => o.day === 1 && o.member === member[ED_ADMIN])?.seen).toBeNull();
        expect(after.find((o) => o.day === 3)?.seen).toBeNull(); // Monday's «ראיתי» says nothing of Wednesday
        // B back: a new row, never the old time — and A's is still a week old
        expect(await set(run, ED_ADMIN, 1, [member[A], member[B]])).toBe("ok");
        expect((await owners(run)).find((o) => o.day === 1 && o.member === member[B])?.seen).toBeNull();
        expect(((await owners(run)).find((o) => o.day === 1 && o.member === member[A])?.seen as Date).getTime()).toBe(seenA.getTime());
        // emptied both ways; the other day untouched
        expect(await set(run, ED_ADMIN, 1, null)).toBe("ok");
        expect((await owners(run)).map((o) => o.day)).toEqual([3]);
        expect(await set(run, ED_ADMIN, 3, [])).toBe("ok");
        expect(await owners(run)).toEqual([]);
      });
    });

    it("logs one line per change — the day and the member ids, ascending — under the edition; the same pair again writes and logs nothing", async () => {
      await inTx(async (run) => {
        const [lo, hi] = [member[A], member[B]].sort((x, y) => x - y);
        expect(await set(run, ED_ADMIN, 1, [hi, lo])).toBe("ok");
        expect(await set(run, ED_ADMIN, 1, [lo, hi])).toBe("ok"); // the same pair, the other way round
        expect(await set(run, ADMIN, 1, [hi, lo])).toBe("ok");
        expect(await set(run, ADMIN, 2, null)).toBe("ok"); // an empty day emptied
        expect(await set(run, ADMIN, 1, [lo])).toBe("ok");
        expect(await set(run, ADMIN, 1, [])).toBe("ok");
        expect(await logged(run)).toEqual([
          { actor: member[ED_ADMIN], edition_id: ed, entity: "editions", entity_id: ed, kind: "day_owners", detail: { day: 1, members: [lo, hi] } },
          { actor: member[ADMIN], edition_id: ed, entity: "editions", entity_id: ed, kind: "day_owners", detail: { day: 1, members: [lo] } },
          { actor: member[ADMIN], edition_id: ed, entity: "editions", entity_id: ed, kind: "day_owners", detail: { day: 1, members: [] } },
        ]);
      });
    });

    it("mark_day_seen: one of that day's owners, their own row only; anyone else of the edition `forbidden`; never logged", async () => {
      await inTx(async (run) => {
        const seen = (run: Run, who: string, day: number | null, e = ed) => code(run(who, "select public.mark_day_seen($1, $2)", [e, day]));
        expect(await set(run, ED_ADMIN, 1, [member[A], member[ED_ADMIN]])).toBe("ok");
        expect(await set(run, ED_ADMIN, 2, [member[B]])).toBe("ok");
        const events = Number(await val(run, "owner", "select count(*) from public.activity"));
        expect(await seen(run, A, 1)).toBe("ok");
        expect((await owners(run)).map((o) => [o.day, o.member, o.seen != null])).toEqual(
          [[1, member[ED_ADMIN], false], [1, member[A], true], [2, member[B], false]].sort((x, y) => (x[0] as number) - (y[0] as number) || (x[1] as number) - (y[1] as number)),
        );
        expect(await seen(run, ED_ADMIN, 1)).toBe("ok"); // an admin who is an owner
        // not this day's owner: another trainee, the handler on another day, logistics, a global admin who owns nothing
        expect(await seen(run, B, 1)).toBe("forbidden");
        expect(await seen(run, A, 2)).toBe("forbidden");
        for (const who of [L, ADMIN]) expect(await seen(run, who, 1), who).toBe("forbidden");
        expect(await seen(run, ED_ADMIN, 3)).toBe("forbidden"); // a day with no owners
        for (const who of [O_ADMIN, O_C, O_L, INACTIVE, STRANGER]) expect(await seen(run, who, 1), who).toBe("not_member");
        expect(await seen(run, "anon", 1)).toBe("42501");
        for (const day of [null, -1, 5]) expect(await seen(run, A, day), String(day)).toBe("bad_value");
        expect(await seen(run, STRANGER, 9)).toBe("not_member"); // who, before what
        expect(Number(await val(run, "owner", "select count(*) from public.activity"))).toBe(events);
        // a second look moves the time on, the row is still one
        const first = (await owners(run)).find((o) => o.member === member[A])?.seen as Date;
        await run("owner", "update public.day_owners set seen_at = seen_at - interval '1 hour' where member_id = $1", [member[A]]);
        expect(await seen(run, A, 1)).toBe("ok");
        expect(((await owners(run)).find((o) => o.member === member[A])?.seen as Date).getTime()).toBe(first.getTime()); // now() is the transaction's
      });
    });

    it("load_week gives the edition's whole team the owners — day, member, when they last looked — in order; the table is read-only, and another edition's member reads none", async () => {
      await inTx(async (run) => {
        expect(await set(run, ED_ADMIN, 3, [member[B]])).toBe("ok");
        expect(await set(run, ED_ADMIN, 1, [member[B], member[A]])).toBe("ok");
        await run("owner", "update public.day_owners set seen_at = '2027-02-10T06:05:04.321Z' where edition_id = $1 and day = 1 and member_id = $2", [ed, member[A]]);
        const expected = [
          { day: 1, member_id: member[A], seen_at: "2027-02-10T06:05:04.321Z" },
          { day: 1, member_id: member[B], seen_at: null },
          { day: 3, member_id: member[B], seen_at: null },
        ].sort((x, y) => x.day - y.day || x.member_id - y.member_id);
        for (const who of [ADMIN, ED_ADMIN, A, B, L]) {
          const w = (await val(run, who, "select public.load_week($1)", [ed])) as { dayOwners: unknown[] };
          expect(w.dayOwners, who).toEqual(expected);
          expect((await run(who, "select day from public.day_owners where edition_id = $1", [ed])).rows, who).toHaveLength(3);
        }
        for (const who of [O_ADMIN, O_C, O_L, INACTIVE, STRANGER]) {
          expect(await val(run, who, "select public.load_week($1)", [ed]), who).toBeNull();
          expect((await run(who, "select day from public.day_owners where edition_id = $1", [ed])).rows, who).toEqual([]);
        }
        // an edition with no owners: an empty list, never a missing key
        expect(((await val(run, O_C, "select public.load_week($1)", [edition.other])) as { dayOwners: unknown[] }).dayOwners).toEqual([]);
        // every write is a function's
        for (const who of [ADMIN, ED_ADMIN, A, L]) {
          expect(await sqlstate(run(who, "insert into public.day_owners (edition_id, day, member_id) values ($1, 0, $2)", [ed, member[A]])), who).toBe("42501");
          expect(await sqlstate(run(who, "update public.day_owners set seen_at = now()")), who).toBe("42501");
          expect(await sqlstate(run(who, "delete from public.day_owners")), who).toBe("42501");
        }
        expect(await sqlstate(run("anon", "select * from public.day_owners"))).toBe("42501");
        expect(await sqlstate(run("anon", "select public.load_week($1)", [ed]))).toBe("42501");
      });
    });

    it("an archived edition: its admin still sets owners and an owner still marks; a deleted member's rows go with them; a new edition starts with none", async () => {
      await inTx(async (run) => {
        expect(await set(run, OLD_ADMIN, 2, [member[OLD_C], member[OLD_ADMIN]], edition.old)).toBe("ok");
        for (const who of [OLD_C, OLD_L]) expect(await set(run, who, 2, [member[OLD_C]], edition.old), who).toBe("forbidden");
        expect(await code(run(OLD_C, "select public.mark_day_seen($1, 1)", [edition.old]))).toBe("ok");
        expect(await code(run(OLD_L, "select public.mark_day_seen($1, 1)", [edition.old]))).toBe("forbidden");
        // a member who did nothing else is deleted by the edition's admin: their days are no one's
        const fresh = Number(await val(run, "owner", "insert into public.members (email, display_name, role, edition_id) values ('new.trainee@example.org', 'חניך/ה לדוגמה', 'content', $1) returning id", [ed]));
        expect(await set(run, ED_ADMIN, 4, [fresh, member[A]])).toBe("ok");
        expect(await code(run(ED_ADMIN, "delete from public.members where id = $1", [fresh]))).toBe("ok");
        expect((await owners(run)).map((o) => [o.day, o.member])).toEqual([[4, member[A]]]);
        // next year's edition carries no owners over
        const next = Number(await val(run, ADMIN, "select public.start_edition('תשפ\"ח', null)"));
        expect(await owners(run, next)).toEqual([]);
      });
    });
  });

  // ---------------------------------------------------------------- availability by ranges

  describe("availability written as time ranges", () => {
    type Range = { day: unknown; start: unknown; end: unknown; kind: unknown };
    const ranges = (run: Run, who: string, days: unknown, list: unknown, rest: string | null = null, speakerId = sp.av, e = ed) =>
      run(who, "select public.set_availability_ranges($1, $2, $3::integer[], $4::jsonb, $5) as n", [e, speakerId, days, list === undefined ? null : JSON.stringify(list), rest]);
    const marked = async (run: Run, who: string, days: number[], list: Range[], rest: string | null = null) => Number((await ranges(run, who, days, list, rest)).rows[0].n);
    /** The speaker's marks in an edition: "day start kind note", in order. */
    const slots = async (run: Run, e = ed, speakerId = sp.av) =>
      (await run("owner", `select v.day, r.start_min, v.kind, v.note from public.slot_availability v join public.grid_rows r on r.id = v.row_id
                            where v.edition_id = $1 and v.speaker_id = $2 order by v.day, r.start_min`, [e, speakerId])).rows.map((r) => `${r.day} ${r.start_min} ${r.kind} ${r.note ?? "-"}`);
    const logged = async (run: Run) =>
      (await run("owner", "select actor, edition_id, entity, entity_id, detail from public.activity where kind = 'availability' order by id")).rows.map((r) => ({
        actor: Number(r.actor), edition_id: Number(r.edition_id), entity: r.entity, entity_id: r.entity_id == null ? null : Number(r.entity_id), detail: r.detail,
      }));
    const MONDAY = [390, 510, 600, 690, 870, 960, 1050, 1200, 1350, 1470, 1560, 1650]; // the lesson rows of a whole day

    it("is any editor's, as set_slot_availability: content (the handler or not) and admins; logistics forbidden; outsiders and anon refused; a speaker gone or retired is `speaker_retired`", async () => {
      await inTx(async (run) => {
        for (const who of [A, B, ED_ADMIN, ADMIN]) expect(await code(ranges(run, who, [1], [], "can")), who).toBe("ok");
        expect(await code(ranges(run, L, [1], [], "can"))).toBe("forbidden");
        for (const who of [O_ADMIN, O_C, O_L, P_C, INACTIVE, STRANGER]) expect(await code(ranges(run, who, [1], [], "can")), who).toBe("not_member");
        expect(await code(ranges(run, "anon", [1], [], "can"))).toBe("42501");
        expect(await code(ranges(run, B, [1], [], "can", sp.retired))).toBe("speaker_retired");
        expect(await code(ranges(run, B, [1], [], "can", 999999))).toBe("speaker_retired");
        // the first failure wins: who, then the speaker, then the values
        expect(await code(ranges(run, L, [9], "x", "maybe", sp.retired))).toBe("forbidden");
        expect(await code(ranges(run, B, [9], "x", "maybe", sp.retired))).toBe("speaker_retired");
        // last year's edition: its content members are told it is archived, logistics stay forbidden, its admin still writes
        expect(await code(ranges(run, OLD_C, [1], [], "can", sp.av, edition.old))).toBe("archived");
        expect(await code(ranges(run, OLD_L, [1], [], "can", sp.av, edition.old))).toBe("forbidden");
        expect(await code(ranges(run, OLD_ADMIN, [1], [], "can", sp.av, edition.old))).toBe("ok");
        expect(await code(ranges(run, ADMIN, [1], [], "can", sp.av, edition.old))).toBe("ok");
        // a practice week is its team's to mark, as a single slot is
        expect(await code(ranges(run, P_C, [1], [], "can", sp.av, edition.practice))).toBe("ok");
      });
    });

    it("refuses every malformed day, range and rest with `bad_value` — and writes nothing", async () => {
      await inTx(async (run) => {
        const ok = { day: 1, start: 510, end: 600, kind: "can" };
        const bad = async (days: unknown, list: unknown, rest: string | null, why: string) => expect(await code(ranges(run, B, days, list, rest)), why).toBe("bad_value");
        // the days: one to five, each 0–4, none twice
        await bad(null, [], null, "no days");
        await bad([], [], null, "an empty list of days");
        await bad([0, 1, 2, 3, 4, 0], [], null, "six days");
        await bad([1, 1], [], null, "a day twice");
        await bad([5], [], null, "a sixth day");
        await bad([-1], [], null, "a negative day");
        await bad([1, null], [], null, "a NULL day");
        // the list: an array of at most 40
        await bad([1], {}, null, "an object");
        await bad([1], "x", null, "a string");
        await bad([1], 5, null, "a number");
        await bad([1], Array.from({ length: 41 }, () => ok), null, "41 ranges");
        // each range: an object of exactly day, start, end, kind
        await bad([1], [5], null, "a number for a range");
        await bad([1], [null], null, "a null for a range");
        await bad([1], [[ok]], null, "an array for a range");
        await bad([1], [{ ...ok, note: "x" }], null, "another key");
        for (const key of ["day", "start", "end", "kind"] as const) {
          const { [key]: _gone, ...rest } = ok;
          await bad([1], [rest], null, `no ${key}`);
          await bad([1], [{ ...ok, [key]: null }], null, `a null ${key}`);
        }
        await bad([1], [{ ...ok, day: 2 }], null, "a day that is not one of the days");
        await bad([1], [{ ...ok, day: 1.5 }], null, "half a day");
        await bad([1], [{ ...ok, day: "1" }], null, "a day as text");
        await bad([1], [{ ...ok, day: 5 }], null, "a sixth day");
        await bad([1], [{ ...ok, start: "510" }], null, "a start as text");
        await bad([1], [{ ...ok, start: 510.5 }], null, "half a minute");
        await bad([1], [{ ...ok, start: -5 }], null, "before 00:00");
        await bad([1], [{ ...ok, end: 1831 }], null, "after 30:30");
        await bad([1], [{ ...ok, start: 600 }], null, "an empty range");
        await bad([1], [{ ...ok, start: 700 }], null, "a range backwards");
        await bad([1], [{ ...ok, kind: "maybe" }], null, "another kind");
        await bad([1], [{ ...ok, kind: 1 }], null, "a kind that is not text");
        await bad([1], [ok, { ...ok, kind: "no" }], null, "one bad range among good ones");
        // the rest: can, cannot or NULL
        await bad([1], [ok], "maybe", "another rest");
        await bad([1], [ok], "", "an empty rest");
        expect(await slots(run)).toEqual([]);
        expect(await logged(run)).toEqual([]);
        // what is allowed: no list at all (SQL NULL, JSON null), forty ranges, the ends of the grid's day, five days
        expect(Number((await ranges(run, B, [1], undefined)).rows[0].n)).toBe(0);
        expect(Number((await run(B, "select public.set_availability_ranges($1, $2, array[1], 'null'::jsonb) as n", [ed, sp.av])).rows[0].n)).toBe(0);
        expect(await marked(run, B, [1], Array.from({ length: 40 }, () => ok))).toBe(1);
        expect(await marked(run, B, [4, 3, 2, 1, 0], [{ day: 0, start: 0, end: 1830, kind: "can" }])).toBe(11);
      });
    });

    it("the rule: «לא» wins every row a cannot-range touches at all; «יכול/ה» only a row ONE can-range covers whole — two never add up; what no range decides is the rest", async () => {
      await inTx(async (run) => {
        const list: Range[] = [
          { day: 1, start: 390, end: 780, kind: "can" }, // the whole morning: 06:30, 08:30, 10:00, 11:30
          { day: 1, start: 685, end: 700, kind: "cannot" }, // a quarter of an hour across 11:30 — touches 10:00 and 11:30: «לא» wins both
          { day: 1, start: 500, end: 510, kind: "cannot" }, // ends where 08:30 begins: touches no row
          { day: 1, start: 880, end: 960, kind: "can" }, // all but ten minutes of 14:30: says nothing of the row
          { day: 1, start: 960, end: 1000, kind: "can" }, // two halves of 16:00 —
          { day: 1, start: 1000, end: 1050, kind: "can" }, //   — never one whole
          { day: 1, start: 1050, end: 1140, kind: "can" }, // exactly 17:30
          { day: 1, start: 1289, end: 1351, kind: "cannot" }, // a minute of 20:00 and a minute of 22:30
        ];
        expect(await marked(run, B, [1], list)).toBe(7);
        expect(await slots(run)).toEqual(["1 390 can -", "1 510 can -", "1 600 cannot -", "1 690 cannot -", "1 1050 can -", "1 1200 cannot -", "1 1350 cannot -"]);
        expect((await run("owner", "select distinct updated_by from public.slot_availability where speaker_id = $1", [sp.av])).rows.map((r) => Number(r.updated_by))).toEqual([member[B]]);
        // the same ranges, the rest «לא»: every row of the day has a mark now — the undecided ones the rest's
        expect(await marked(run, A, [1], list, "cannot")).toBe(12);
        expect(await slots(run)).toEqual(MONDAY.map((m) => `1 ${m} ${[390, 510, 1050].includes(m) ? "can" : "cannot"} -`));
        // and the rest «יכול/ה»
        expect(await marked(run, A, [1], list, "can")).toBe(12);
        expect(await slots(run)).toEqual(MONDAY.map((m) => `1 ${m} ${[600, 690, 1200, 1350].includes(m) ? "cannot" : "can"} -`));
        // a range the other way round in the list: the order of the ranges decides nothing
        expect(await marked(run, A, [1], [...list].reverse())).toBe(7);
        expect(await slots(run)).toEqual(["1 390 can -", "1 510 can -", "1 600 cannot -", "1 690 cannot -", "1 1050 can -", "1 1200 cannot -", "1 1350 cannot -"]);
      });
    });

    it("marks only the lesson rows the edition's window allows that day: Sunday from the opening, Thursday to the close, never a meal", async () => {
      await inTx(async (run) => {
        // Sunday opens 08:30: «פתיחת יום» is not a row that day
        expect(await marked(run, B, [0], [{ day: 0, start: 390, end: 780, kind: "can" }])).toBe(3);
        expect(await slots(run)).toEqual(["0 510 can -", "0 600 can -", "0 690 can -"]);
        // Thursday closes 19:00: the rest reaches seven rows, not twelve
        expect(await marked(run, B, [4], [], "cannot")).toBe(7);
        expect((await slots(run)).filter((s) => s.startsWith("4 "))).toEqual([390, 510, 600, 690, 870, 960, 1050].map((m) => `4 ${m} cannot -`));
        // a range over lunch alone (13:15–14:15) decides no row; the rows are lesson rows only
        expect(await marked(run, B, [2], [{ day: 2, start: 795, end: 855, kind: "cannot" }])).toBe(0);
        expect(await marked(run, B, [2], [{ day: 2, start: 0, end: 1830, kind: "cannot" }])).toBe(12);
        expect(Number(await val(run, "owner", "select count(*) from public.slot_availability v join public.grid_rows r on r.id = v.row_id where r.kind <> 'lesson' or r.edition_id <> v.edition_id"))).toBe(0);
      });
    });

    it("replaces only the days it lists — their marks and the notes on them go; the other days, and the same speaker's marks in another edition, stay as they were", async () => {
      await inTx(async (run) => {
        // marks made one slot at a time, each with a note
        await run(A, "select public.set_slot_availability($1, $2, 1, $3, 'can', $4)", [ed, sp.av, row[870], NOTE]);
        await run(A, "select public.set_slot_availability($1, $2, 3, $3, 'cannot', $4)", [ed, sp.av, row[510], NOTE]);
        const otherRow = Number(await val(run, "owner", "select id from public.grid_rows where edition_id = $1 and start_min = 510", [edition.other]));
        await run(O_C, "select public.set_slot_availability($1, $2, 1, $3, 'can', $4)", [edition.other, sp.av, otherRow, NOTE]);
        // Monday alone: its noted mark is gone (no range decided 14:30, and there is no rest); Wednesday's is untouched
        expect(await marked(run, B, [1], [{ day: 1, start: 510, end: 600, kind: "cannot" }])).toBe(1);
        expect(await slots(run)).toEqual(["1 510 cannot -", `3 510 cannot ${NOTE}`]);
        expect(await slots(run, edition.other)).toEqual([`1 510 can ${NOTE}`]);
        // Monday and Wednesday, nothing said and no rest: both days are bare — replacing is also how a day is cleared
        expect(await marked(run, B, [3, 1], [])).toBe(0);
        expect(await slots(run)).toEqual([]);
        expect(await slots(run, edition.other)).toEqual([`1 510 can ${NOTE}`]);
        // a row marked again by a range carries no note of its own
        await run(A, "select public.set_slot_availability($1, $2, 3, $3, 'cannot', $4)", [ed, sp.av, row[510], NOTE]);
        expect(await marked(run, B, [3], [{ day: 3, start: 510, end: 600, kind: "cannot" }])).toBe(1);
        expect(await slots(run)).toEqual(["3 510 cannot -"]);
      });
    });

    it("logs ONE line a call — the days, how many ranges, how many rows, the rest; never a note, never a line per slot — under the speaker's approach when there is one, and speaker_activity finds it", async () => {
      await inTx(async (run) => {
        await run(A, "select public.set_slot_availability($1, $2, 1, $3, 'can', $4)", [ed, sp.av, row[870], NOTE]);
        const before = (await logged(run)).length; // the one slot's own line, in the old shape
        expect(before).toBe(1);
        expect(await marked(run, B, [2, 1], [{ day: 1, start: 390, end: 780, kind: "can" }, { day: 2, start: 600, end: 700, kind: "cannot" }], "can")).toBe(24);
        expect(await marked(run, B, [3], [])).toBe(0); // nothing marked: still one line
        const lines = (await logged(run)).slice(before);
        expect(lines).toEqual([
          { actor: member[B], edition_id: ed, entity: "approaches", entity_id: null, detail: { speaker: sp.av, days: [1, 2], ranges: 2, marked: 24, rest: "can" } },
          { actor: member[B], edition_id: ed, entity: "approaches", entity_id: null, detail: { speaker: sp.av, days: [3], ranges: 0, marked: 0, rest: null } },
        ]);
        // once someone handles the speaker here, the line is their approach's
        const approach = Number(await val(run, A, "select public.claim_speaker($1, $2)", [ed, sp.av]));
        expect(await marked(run, ED_ADMIN, [4], [], "cannot")).toBe(7);
        expect((await logged(run)).at(-1)).toEqual({
          actor: member[ED_ADMIN], edition_id: ed, entity: "approaches", entity_id: approach, detail: { speaker: sp.av, days: [4], ranges: 0, marked: 7, rest: "cannot" },
        });
        // no note anywhere in the log — the replaced slot's included
        expect(JSON.stringify((await run("owner", "select detail from public.activity")).rows)).not.toContain(NOTE);
        // the speaker's sheet reads all three (matched by detail.speaker), newest first, beside the old shape
        const activity = ((await val(run, B, "select public.speaker_activity($1)", [sp.av])) as { kind: string; detail: Record<string, unknown> }[]).filter((x) => x.kind === "availability");
        expect(activity.map((x) => x.detail)).toEqual([
          { speaker: sp.av, days: [4], ranges: 0, marked: 7, rest: "cannot" },
          { speaker: sp.av, days: [3], ranges: 0, marked: 0, rest: null },
          { speaker: sp.av, days: [1, 2], ranges: 2, marked: 24, rest: "can" },
          { speaker: sp.av, day: 1, start: 870, end: 960, kind: "can" },
        ]);
        // set_slot_availability is as it was: one slot, its own line, its note kept on the row
        await run(A, "select public.set_slot_availability($1, $2, 4, $3, 'can', $4)", [ed, sp.av, row[510], NOTE]);
        expect((await slots(run)).filter((s) => s.startsWith("4 510"))).toEqual([`4 510 can ${NOTE}`]);
        expect((await logged(run)).at(-1)?.detail).toEqual({ speaker: sp.av, day: 4, start: 510, end: 600, kind: "can" });
      });
    });
  });

  // ---------------------------------------------------------------- transport in two parts

  describe("the transport details in two parts", () => {
    const request = (run: Run, who: string, id: number, fields: unknown) =>
      code(run(who, "select public.set_transport_request($1, $2::jsonb)", [id, fields === undefined ? null : JSON.stringify(fields)]));
    const driver = (run: Run, who: string, id: number, fields: unknown) =>
      code(run(who, "select public.set_transport_driver($1, $2::jsonb)", [id, fields === undefined ? null : JSON.stringify(fields)]));
    const stored = async (run: Run, id: number) =>
      (await run("owner", "select pickup_address, pickup_time, pickup_min, driver_name, driver_phone, arranged from public.transport_details where lesson_id = $1", [id])).rows[0] ?? null;
    const logged = async (run: Run, id: number) =>
      (await run("owner", "select actor, detail from public.activity where entity = 'lessons' and entity_id = $1 and kind = 'transport' order by id", [id])).rows.map((r) => ({ actor: Number(r.actor), detail: r.detail }));
    const approval = (run: Run, id: number, to: string) => run("owner", "update public.lessons set approval = $2 where id = $1", [id, to]);

    it("set_transport_request: the lesson's handler or an admin of its edition — never another trainee, logistics, or anyone outside; on a closed lesson that asks for transport", async () => {
      await inTx(async (run) => {
        for (const who of [A, ED_ADMIN, ADMIN]) expect(await request(run, who, lesson.t, { pickup_time: `07:${who.length}` }), who).toBe("ok");
        expect(await request(run, B, lesson.t, { pickup_time: "x" })).toBe("not_handler");
        expect(await request(run, L, lesson.t, { pickup_time: "x" })).toBe("forbidden");
        for (const who of [O_ADMIN, O_C, O_L, INACTIVE, STRANGER]) expect(await request(run, who, lesson.t, { pickup_time: "x" }), who).toBe("not_member");
        expect(await request(run, "anon", lesson.t, { pickup_time: "x" })).toBe("42501");
        // which lesson
        expect(await request(run, A, 999999, {})).toBe("stale");
        expect(await request(run, A, lesson.draft, {})).toBe("not_closed");
        expect(await request(run, B, lesson.draft, {})).toBe("not_closed");
        expect(await request(run, A, lesson.plain, {})).toBe("no_transport");
        expect(await request(run, ED_ADMIN, lesson.b, {})).toBe("no_transport"); // an amount asked, no transport
        // the first failure wins: the lesson, who, its state, its transport — and only then the fields
        expect(await request(run, STRANGER, 999999, "x")).toBe("stale");
        expect(await request(run, L, lesson.draft, "x")).toBe("forbidden");
        expect(await request(run, B, lesson.t, "x")).toBe("not_handler");
        expect(await request(run, A, lesson.plain, "x")).toBe("no_transport");
        // last year's edition: content is told it is archived, logistics stay forbidden — and its admin, who reads
        // no pickup there (may_see_transport), writes none either
        expect(await request(run, OLD_C, lesson.old, { pickup_time: "x" })).toBe("archived");
        expect(await request(run, OLD_L, lesson.old, { pickup_time: "x" })).toBe("forbidden");
        expect(await request(run, OLD_ADMIN, lesson.old, { pickup_time: "x" })).toBe("transport_hidden");
        expect(await request(run, OLD_ADMIN, lesson.old, "x")).toBe("transport_hidden"); // who reads, before the fields
      });
    });

    it("writes only what the writer may read back: a practice week's handler and admin, and an archived edition's own admin, are `transport_hidden` — before the purge and after it", async () => {
      await inTx(async (run) => {
        const P_L = "practice.logistics@example.org";
        await run("owner", "insert into public.members (email, display_name, role, edition_id) values ($1, $1, 'logistics', $2)", [P_L, edition.practice]);
        const before = await stored(run, lesson.practice);
        // a practice week: its handler (who asked) and its admin read nothing back, so they write nothing — the old writer's answer
        for (const who of [P_C, P_ADMIN]) {
          expect(await val(run, who, "select public.get_transport_details($1)", [lesson.practice]), who).toBeNull();
          expect(await request(run, who, lesson.practice, { pickup_address: ADDRESS, pickup_time: "07:30", pickup_min: 420 }), who).toBe("transport_hidden");
          expect(await code(run(who, "select public.set_transport_details($1, $2, null, null, null)", [lesson.practice, ADDRESS])), who).toBe("transport_hidden");
          expect(await request(run, who, lesson.practice, { pickup_address: null }), `${who} a blind clear`).toBe("transport_hidden");
        }
        // once the global admin approves it: the practice week's logistics and its admin name no driver
        await run(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson.practice, await val(run, "owner", "select version from public.lessons where id = $1", [lesson.practice])]);
        for (const who of [P_L, P_ADMIN]) {
          expect(await driver(run, who, lesson.practice, { driver_name: DRIVER, driver_phone: PHONE, arranged: true }), who).toBe("transport_hidden");
          expect(await driver(run, who, lesson.practice, { driver_name: null }), `${who} a blind clear`).toBe("transport_hidden");
          expect(await val(run, who, "select public.get_transports_for($1)", [edition.practice]), who).toEqual([]);
        }
        expect(await driver(run, P_C, lesson.practice, { arranged: true })).toBe("forbidden"); // a trainee never arranges a driver
        expect(await stored(run, lesson.practice)).toEqual(before);
        // the global admin reads it, so writes both halves, as before
        expect(await request(run, ADMIN, lesson.practice, { pickup_time: "07:30" })).toBe("ok");
        expect(await driver(run, ADMIN, lesson.practice, { arranged: true })).toBe("ok");
        expect(await stored(run, lesson.practice)).toEqual({ ...before, pickup_time: "07:30", arranged: true });
        expect((await logged(run, lesson.practice)).map((x) => x.actor)).toEqual([member[ADMIN], member[ADMIN]]);

        // last year's edition, archived, then purged: its row is gone and stays gone — its own admin writes none back
        expect(await val(run, ADMIN, "select public.purge_edition_private($1, $2)", [edition.old, "שנה קודמת"])).toMatchObject({ transport_details: 1 });
        expect(await stored(run, lesson.old)).toBeNull();
        const old = (await run("owner", "select approval from public.lessons where id = $1", [lesson.old])).rows[0];
        expect(old.approval).toBe("approved");
        expect(await request(run, OLD_ADMIN, lesson.old, { pickup_address: ADDRESS, pickup_min: 435 })).toBe("transport_hidden");
        expect(await driver(run, OLD_ADMIN, lesson.old, { driver_name: DRIVER, driver_phone: PHONE, arranged: true })).toBe("transport_hidden");
        expect(await code(run(OLD_ADMIN, "select public.set_transport_details($1, $2, null, $3, $4, true)", [lesson.old, ADDRESS, DRIVER, PHONE]))).toBe("transport_hidden");
        expect(await request(run, OLD_C, lesson.old, { pickup_address: ADDRESS })).toBe("archived");
        expect(await driver(run, OLD_L, lesson.old, { driver_name: DRIVER })).toBe("archived");
        expect(await stored(run, lesson.old)).toBeNull();
        expect(await logged(run, lesson.old)).toEqual([]);
        expect(await val(run, "owner", "select purged_at is not null from public.editions where id = $1", [edition.old])).toBe(true);
      });
    });

    it("set_transport_request refuses what is not an object of its three keys, text that is not text, minutes outside the grid's day and a line too long — `bad_value`", async () => {
      await inTx(async (run) => {
        const before = await stored(run, lesson.t);
        const bad = async (fields: unknown, why: string) => expect(await request(run, A, lesson.t, fields), why).toBe("bad_value");
        await bad(undefined, "SQL NULL");
        await bad(null, "JSON null");
        await bad([], "an array");
        await bad("x", "a string");
        await bad(5, "a number");
        await bad({ driver_name: "x" }, "the driver's key");
        await bad({ pickup_address: "x", arranged: true }, "one key of the other part");
        await bad({ pickup_address: 5 }, "an address that is a number");
        await bad({ pickup_address: ["x"] }, "an address that is a list");
        await bad({ pickup_time: true }, "a time that is a boolean");
        await bad({ pickup_min: "600" }, "minutes as text");
        await bad({ pickup_min: 600.5 }, "half a minute");
        await bad({ pickup_min: -1 }, "before 00:00");
        await bad({ pickup_min: 1831 }, "after 30:30");
        await bad({ pickup_min: true }, "minutes that are a boolean");
        await bad({ pickup_address: "א".repeat(201) }, "an address of 201");
        await bad({ pickup_time: "א".repeat(61) }, "a time of 61");
        expect(await stored(run, lesson.t)).toEqual(before);
        // the limits themselves, and the ends of the day
        expect(await request(run, A, lesson.t, { pickup_address: "א".repeat(200), pickup_time: "א".repeat(60), pickup_min: 0 })).toBe("ok");
        expect(await request(run, A, lesson.t, { pickup_min: 1830 })).toBe("ok");
        expect((await stored(run, lesson.t))?.pickup_min).toBe(1830);
      });
    });

    it("patches: a key that is there is written (cleaned; empty → NULL), a key that is not stays; the log names the changed fields in order, never a value; nothing changed, nothing logged — and the lesson's version never moves", async () => {
      await inTx(async (run) => {
        const v = await val(run, "owner", "select version from public.lessons where id = $1", [lesson.t]);
        const base = (await logged(run, lesson.t)).length;
        expect(await stored(run, lesson.t)).toEqual({ pickup_address: ADDRESS, pickup_time: "07:15", pickup_min: 435, driver_name: null, driver_phone: null, arranged: false });
        // nothing to write: an empty object, or the same values again
        expect(await request(run, A, lesson.t, {})).toBe("ok");
        expect(await request(run, A, lesson.t, { pickup_address: `  ${ADDRESS}\n`, pickup_time: "07:15", pickup_min: 435 })).toBe("ok");
        expect(await logged(run, lesson.t)).toHaveLength(base);
        // one key: the other two stay
        expect(await request(run, A, lesson.t, { pickup_time: "  07:45   בבוקר " })).toBe("ok");
        expect(await stored(run, lesson.t)).toMatchObject({ pickup_address: ADDRESS, pickup_time: "07:45 בבוקר", pickup_min: 435 });
        // null and empty text both clear; the edition's admin writes too
        expect(await request(run, ED_ADMIN, lesson.t, { pickup_min: null, pickup_address: "   " })).toBe("ok");
        expect(await stored(run, lesson.t)).toMatchObject({ pickup_address: null, pickup_time: "07:45 בבוקר", pickup_min: null });
        expect(await request(run, A, lesson.t, { pickup_min: 465, pickup_time: null, pickup_address: ADDRESS })).toBe("ok");
        expect(await stored(run, lesson.t)).toEqual({ pickup_address: ADDRESS, pickup_time: null, pickup_min: 465, driver_name: null, driver_phone: null, arranged: false });
        expect((await logged(run, lesson.t)).slice(base)).toEqual([
          { actor: member[A], detail: { fields: ["pickup_time"] } },
          { actor: member[ED_ADMIN], detail: { fields: ["pickup_address", "pickup_min"] } },
          { actor: member[A], detail: { fields: ["pickup_address", "pickup_time", "pickup_min"] } },
        ]);
        expect(JSON.stringify((await run("owner", "select detail from public.activity")).rows)).not.toMatch(/כתובת איסוף|07:45/);
        expect(await val(run, "owner", "select version from public.lessons where id = $1", [lesson.t])).toBe(v);
        // a lesson with no row yet: the first key makes it, the rest empty
        expect(await stored(run, lesson.b2)).toBeNull();
        expect(await request(run, B, lesson.b2, { pickup_address: null })).toBe("ok"); // nothing to say: no row
        expect(await stored(run, lesson.b2)).toBeNull();
        expect(await request(run, B, lesson.b2, { pickup_min: 600 })).toBe("ok");
        expect(await stored(run, lesson.b2)).toEqual({ pickup_address: null, pickup_time: null, pickup_min: 600, driver_name: null, driver_phone: null, arranged: false });
      });
    });

    it("the request is the handler's whatever the approval says — waiting, approved or rejected — and never touches the driver", async () => {
      await inTx(async (run) => {
        for (const state of ["pending", "approved", "rejected"]) {
          await approval(run, lesson.t, state);
          expect(await request(run, A, lesson.t, { pickup_time: `שעה ${state}` }), state).toBe("ok");
        }
        await approval(run, lesson.t, "approved");
        expect(await driver(run, L, lesson.t, { driver_name: DRIVER, driver_phone: PHONE, arranged: true })).toBe("ok");
        expect(await request(run, A, lesson.t, { pickup_address: "כתובת אחרת לדוגמה", pickup_time: null, pickup_min: null })).toBe("ok");
        expect(await stored(run, lesson.t)).toEqual({ pickup_address: "כתובת אחרת לדוגמה", pickup_time: null, pickup_min: null, driver_name: DRIVER, driver_phone: PHONE, arranged: true });
      });
    });

    it("set_transport_driver: logistics or an admin of the lesson's edition, only once the transport is approved — a content member never, the handler included", async () => {
      await inTx(async (run) => {
        // while the request waits, or after a «לא»: nobody arranges a driver
        for (const state of ["pending", "rejected"]) {
          await approval(run, lesson.t, state);
          for (const who of [L, ED_ADMIN, ADMIN]) expect(await driver(run, who, lesson.t, { driver_name: DRIVER }), `${who} ${state}`).toBe("transport_hidden");
          expect(await driver(run, A, lesson.t, { driver_name: DRIVER }), state).toBe("forbidden"); // who, before when
        }
        await approval(run, lesson.t, "approved");
        for (const who of [L, ED_ADMIN, ADMIN]) expect(await driver(run, who, lesson.t, { driver_name: `${DRIVER} ${who.length}` }), who).toBe("ok");
        for (const who of [A, B]) expect(await driver(run, who, lesson.t, { driver_name: DRIVER }), who).toBe("forbidden");
        for (const who of [O_ADMIN, O_C, O_L, INACTIVE, STRANGER]) expect(await driver(run, who, lesson.t, { driver_name: DRIVER }), who).toBe("not_member");
        expect(await driver(run, "anon", lesson.t, { driver_name: DRIVER })).toBe("42501");
        // which lesson: gone; nothing asked; an amount approved with no transport
        expect(await driver(run, L, 999999, {})).toBe("stale");
        expect(await driver(run, L, lesson.plain, {})).toBe("no_transport");
        await approval(run, lesson.b, "approved");
        expect(await driver(run, L, lesson.b, {})).toBe("no_transport");
        // last year's edition (its lesson approved): logistics is told it is archived, content stays forbidden — its
        // admin reads no driver there (may_see_transport), so writes none; the global admin does
        expect(await driver(run, OLD_L, lesson.old, { driver_name: DRIVER })).toBe("archived");
        expect(await driver(run, OLD_C, lesson.old, { driver_name: DRIVER })).toBe("forbidden");
        expect(await driver(run, OLD_ADMIN, lesson.old, { driver_name: DRIVER })).toBe("transport_hidden");
        expect(await driver(run, OLD_ADMIN, lesson.old, "x")).toBe("transport_hidden"); // who reads, before the fields
        expect(await driver(run, ADMIN, lesson.old, { driver_name: DRIVER })).toBe("ok");
      });
    });

    it("set_transport_driver patches its three keys: `bad_value` for anything else, `bad_phone` for a phone of fewer than six digits; the log names the fields, never a name or a number", async () => {
      await inTx(async (run) => {
        await approval(run, lesson.t, "approved");
        const base = (await logged(run, lesson.t)).length;
        const bad = async (fields: unknown, why: string) => expect(await driver(run, L, lesson.t, fields), why).toBe("bad_value");
        await bad(undefined, "SQL NULL");
        await bad(null, "JSON null");
        await bad([], "an array");
        await bad("x", "a string");
        await bad({ pickup_address: "x" }, "the request's key");
        await bad({ driver_name: "x", pickup_min: 5 }, "one key of the other part");
        await bad({ driver_name: 5 }, "a name that is a number");
        await bad({ driver_phone: true }, "a phone that is a boolean");
        await bad({ driver_phone: 5550100 }, "a phone that is a number");
        await bad({ arranged: "yes" }, "arranged as text");
        await bad({ arranged: null }, "arranged as null");
        await bad({ arranged: 1 }, "arranged as a number");
        await bad({ driver_name: "א".repeat(81) }, "a name of 81");
        await bad({ driver_phone: "5".repeat(41) }, "a phone of 41");
        expect(await driver(run, L, lesson.t, { driver_phone: "12345" })).toBe("bad_phone");
        expect(await driver(run, L, lesson.t, { driver_phone: "אין" })).toBe("bad_phone");
        expect(await driver(run, L, lesson.t, { driver_phone: "x", arranged: "x" })).toBe("bad_value"); // the shape before the values
        expect(await logged(run, lesson.t)).toHaveLength(base);
        // the patch: each key by itself; the pickup stays where the handler left it
        expect(await driver(run, L, lesson.t, {})).toBe("ok");
        expect(await driver(run, L, lesson.t, { arranged: false, driver_name: null })).toBe("ok"); // as it is already
        expect(await logged(run, lesson.t)).toHaveLength(base);
        expect(await driver(run, L, lesson.t, { driver_name: `  ${DRIVER} `, driver_phone: ` ${PHONE} ` })).toBe("ok");
        expect(await driver(run, ED_ADMIN, lesson.t, { arranged: true })).toBe("ok");
        expect(await stored(run, lesson.t)).toEqual({ pickup_address: ADDRESS, pickup_time: "07:15", pickup_min: 435, driver_name: DRIVER, driver_phone: PHONE, arranged: true });
        expect(await driver(run, L, lesson.t, { driver_phone: "" })).toBe("ok");
        expect(await driver(run, L, lesson.t, { arranged: false, driver_name: DRIVER })).toBe("ok");
        expect(await stored(run, lesson.t)).toEqual({ pickup_address: ADDRESS, pickup_time: "07:15", pickup_min: 435, driver_name: DRIVER, driver_phone: null, arranged: false });
        expect((await logged(run, lesson.t)).slice(base)).toEqual([
          { actor: member[L], detail: { fields: ["driver_name", "driver_phone"] } },
          { actor: member[ED_ADMIN], detail: { fields: ["arranged"] } },
          { actor: member[L], detail: { fields: ["driver_phone"] } },
          { actor: member[L], detail: { fields: ["arranged"] } },
        ]);
        expect(JSON.stringify((await run("owner", "select detail from public.activity")).rows)).not.toMatch(/נהג|555 0100/);
        // a lesson with no row yet: the driver's key makes it
        await approval(run, lesson.b2, "approved");
        expect(await driver(run, L, lesson.b2, { arranged: true })).toBe("ok");
        expect(await stored(run, lesson.b2)).toEqual({ pickup_address: null, pickup_time: null, pickup_min: null, driver_name: null, driver_phone: null, arranged: true });
      });
    });

    it("set_transport_details is as it was — all five replaced, the pickup's minutes left alone — and now also the edition's admin's, and logistics' on a request that waits", async () => {
      await inTx(async (run) => {
        expect(await code(run(L, "select public.set_transport_details($1, $2, '08:00', $3, $4, true)", [lesson.t, ADDRESS, DRIVER, PHONE]))).toBe("ok");
        expect(await stored(run, lesson.t)).toEqual({ pickup_address: ADDRESS, pickup_time: "08:00", pickup_min: 435, driver_name: DRIVER, driver_phone: PHONE, arranged: true });
        expect(await code(run(ED_ADMIN, "select public.set_transport_details($1, null, null, null, null)", [lesson.t]))).toBe("ok");
        expect(await stored(run, lesson.t)).toEqual({ pickup_address: null, pickup_time: null, pickup_min: 435, driver_name: null, driver_phone: null, arranged: false });
        expect(await code(run(B, "select public.set_transport_details($1, 'x', null, null, null)", [lesson.t]))).toBe("transport_hidden");
        await approval(run, lesson.t, "rejected");
        expect(await code(run(L, "select public.set_transport_details($1, 'x', null, null, null)", [lesson.t]))).toBe("transport_hidden");
        // no transport any more: the whole row goes, its minutes with it
        await run(A, "select public.set_payment($1, $2, null, 'none')", [lesson.t, await val(run, "owner", "select version from public.lessons where id = $1", [lesson.t])]);
        expect(await stored(run, lesson.t)).toBeNull();
      });
    });
  });

  // ---------------------------------------------------------------- who reads a pickup

  describe("who reads a pickup", () => {
    const KEYS = ["arranged", "driver_name", "driver_phone", "pickup_address", "pickup_time"];
    /** What `who` gets of the lesson: through the function, through the table, and in the edition's list. */
    async function sees(run: Run, who: string, id: number, e = ed) {
      const one = (await val(run, who, "select public.get_transport_details($1)", [id])) as Record<string, unknown> | null;
      const table = (await run(who, "select pickup_address, pickup_min from public.transport_details where lesson_id = $1", [id])).rows;
      const list = ((await val(run, who, "select public.get_transports_for($1)", [e])) as Record<string, unknown>[] | null) ?? [];
      const listed = list.find((r) => Number(r.lesson_id) === id) ?? null;
      // the function and the table agree; the function never carries the minutes
      expect(table.length, `${who} table`).toBe(one == null ? 0 : 1);
      if (one != null) expect(Object.keys(one).sort(), who).toEqual(KEYS);
      if (listed != null) {
        const { lesson_id: _l, approval: _a, pickup_min: _m, ...five } = listed;
        expect(five, `${who} list`).toEqual(one); // never more than get_transport_details shows
        expect(listed.pickup_min, `${who} minutes`).toBe(table[0]?.pickup_min ?? null);
      }
      return { details: one != null && one.pickup_address === ADDRESS, listed: listed != null, approval: listed?.approval ?? null };
    }

    it("the matrix: the handler and the edition's admins always; logistics while the request waits or is approved — not before one is asked, not after a «לא»; another trainee never", async () => {
      // [who, sees it when the approval is none / pending / approved / rejected]
      const MATRIX: [string, boolean, boolean, boolean, boolean][] = [
        [A, true, true, true, true], // handles the speaker
        [B, false, false, false, false], // another trainee
        [ED_ADMIN, true, true, true, true], // v18: handles none of it
        [L, false, true, true, false], // v18: from the request, not only after the approval
        [ADMIN, true, true, true, true],
        [O_ADMIN, false, false, false, false], [O_C, false, false, false, false], [O_L, false, false, false, false],
        [P_ADMIN, false, false, false, false], [OLD_L, false, false, false, false], [INACTIVE, false, false, false, false], [STRANGER, false, false, false, false],
      ];
      await inTx(async (run) => {
        for (const [i, state] of (["none", "pending", "approved", "rejected"] as const).entries()) {
          // by hand, so that only the approval differs: the row and the transport asked stay
          await run("owner", "update public.lessons set approval = $2 where id = $1", [lesson.t, state]);
          for (const [who, ...may] of MATRIX) {
            const got = await sees(run, who, lesson.t);
            expect(got.details, `${who} ${state}`).toBe(may[i]);
            // the list holds requests that wait or were approved — and only for who may read the pickup
            expect(got.listed, `${who} ${state} listed`).toBe(may[i] && (state === "pending" || state === "approved"));
            if (got.listed) expect(got.approval, `${who} ${state}`).toBe(state);
          }
        }
      });
    });

    it("through the commands themselves: nothing asked, a request, the «כן», a «לא», asked again — logistics follows the request", async () => {
      await inTx(async (run) => {
        const v = async () => val(run, "owner", "select version from public.lessons where id = $1", [lesson.t]);
        const who = async () => {
          const out: Record<string, boolean> = {};
          for (const w of [A, B, ED_ADMIN, L]) out[w] = (await sees(run, w, lesson.t)).details; // one connection: one at a time
          return out;
        };
        expect(await who()).toEqual({ [A]: true, [B]: false, [ED_ADMIN]: true, [L]: true }); // waiting
        await run(L, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'rejected', 'נימוק לדוגמה')", [lesson.t, await v()]);
        expect(await who()).toEqual({ [A]: true, [B]: false, [ED_ADMIN]: true, [L]: false }); // «לא»: logistics no more
        await run(A, "select public.set_payment($1, $2, null, 'round_trip')", [lesson.t, await v()]); // asked again
        expect(await who()).toEqual({ [A]: true, [B]: false, [ED_ADMIN]: true, [L]: true });
        await run(ED_ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson.t, await v()]);
        expect(await who()).toEqual({ [A]: true, [B]: false, [ED_ADMIN]: true, [L]: true });
        // a lesson that asks for nothing: the handler and the admin read an empty row, logistics nothing
        for (const [w, expected] of [[A, "empty"], [ED_ADMIN, "empty"], [ADMIN, "empty"], [L, "hidden"], [B, "hidden"]] as const) {
          const one = (await val(run, w, "select public.get_transport_details($1)", [lesson.plain])) as Record<string, unknown> | null;
          expect(one == null ? "hidden" : "empty", w).toBe(expected);
          if (one != null) expect(one).toEqual({ pickup_address: null, pickup_time: null, driver_name: null, driver_phone: null, arranged: false });
        }
        // an amount approved with no transport is a payment, never logistics' to read as a transport
        await run("owner", "update public.lessons set approval = 'approved' where id = $1", [lesson.b]);
        expect(await val(run, L, "select public.get_transport_details($1)", [lesson.b])).toBeNull();
        // another trainee takes the speaker over: the pickup is theirs to read now, no longer the first one's
        const approach = Number(await val(run, "owner", "select a.id from public.approaches a join public.lesson_speakers x on x.speaker_id = a.speaker_id where x.lesson_id = $1 and a.edition_id = $2", [lesson.t, ed]));
        await run("owner", "update public.approaches set owner_member_id = $2 where id = $1", [approach, member[B]]);
        expect(await who()).toEqual({ [A]: false, [B]: true, [ED_ADMIN]: true, [L]: true });
      });
    });

    it("get_transports_for: the closed lessons whose transport waits or is approved, each with its approval and pickup minutes — per person, per edition; a draft, a rejected one and an amount alone are never in it", async () => {
      await inTx(async (run) => {
        const ids = async (who: string, e = ed) => (((await val(run, who, "select public.get_transports_for($1)", [e])) as { lesson_id: number }[] | null) ?? []).map((r) => Number(r.lesson_id));
        // lesson.t (A's) and lesson.b2 (B's) wait; lesson.b asks an amount alone; lesson.plain nothing; lesson.draft is a draft
        expect(await ids(ADMIN)).toEqual([lesson.t, lesson.b2]);
        expect(await ids(ED_ADMIN)).toEqual([lesson.t, lesson.b2]);
        expect(await ids(L)).toEqual([lesson.t, lesson.b2]);
        expect(await ids(A)).toEqual([lesson.t]);
        expect(await ids(B)).toEqual([lesson.b2]);
        for (const who of [O_ADMIN, O_C, O_L, P_ADMIN, INACTIVE, STRANGER]) expect(await ids(who), who).toEqual([]);
        expect(await sqlstate(run("anon", "select public.get_transports_for($1)", [ed]))).toBe("42501");
        expect(await val(run, L, "select public.get_transports_for($1)", [ed])).toEqual([
          { lesson_id: lesson.t, pickup_address: ADDRESS, pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: false, approval: "pending", pickup_min: 435 },
          { lesson_id: lesson.b2, pickup_address: null, pickup_time: null, driver_name: null, driver_phone: null, arranged: false, approval: "pending", pickup_min: null },
        ]);
        // one approved and arranged, the other rejected: the first says so, the second is gone
        await run(L, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson.t, await val(run, "owner", "select version from public.lessons where id = $1", [lesson.t])]);
        await run(L, "select public.set_transport_driver($1, $2::jsonb)", [lesson.t, JSON.stringify({ driver_name: DRIVER, driver_phone: PHONE, arranged: true })]);
        await run(ED_ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'rejected')", [lesson.b2, await val(run, "owner", "select version from public.lessons where id = $1", [lesson.b2])]);
        expect(await val(run, L, "select public.get_transports_for($1)", [ed])).toEqual([
          { lesson_id: lesson.t, pickup_address: ADDRESS, pickup_time: "07:15", driver_name: DRIVER, driver_phone: PHONE, arranged: true, approval: "approved", pickup_min: 435 },
        ]);
        expect(await ids(B)).toEqual([]);
        // the other editions: their own staff, by the same rule; a practice week and last year give their team nothing
        expect(await ids(O_L, edition.other)).toEqual([lesson.other]);
        expect(await ids(O_ADMIN, edition.other)).toEqual([lesson.other]);
        expect(await ids(L, edition.other)).toEqual([]);
        for (const who of [P_ADMIN, P_C]) expect(await ids(who, edition.practice), who).toEqual([]);
        for (const who of [OLD_ADMIN, OLD_C, OLD_L]) expect(await ids(who, edition.old), who).toEqual([]);
        expect(await ids(ADMIN, edition.practice)).toEqual([lesson.practice]); // a global admin reads all
        expect(await ids(ADMIN, edition.old)).toEqual([lesson.old, lesson.oldPending]);
      });
    });

    it("a practice week and last year's edition show their own team no pickup at all — handler, admin or logistics; and the minutes are never in load_week", async () => {
      await inTx(async (run) => {
        for (const [who, id] of [[P_ADMIN, lesson.practice], [P_C, lesson.practice], [OLD_ADMIN, lesson.old], [OLD_C, lesson.old], [OLD_L, lesson.old]] as const) {
          expect(await val(run, who, "select public.get_transport_details($1)", [id]), who).toBeNull();
          expect((await run(who, "select 1 from public.transport_details")).rows, who).toEqual([]);
        }
        for (const id of [lesson.practice, lesson.old]) expect(((await val(run, ADMIN, "select public.get_transport_details($1)", [id])) as { pickup_address: string }).pickup_address).toBe(ADDRESS);
        for (const who of [ADMIN, ED_ADMIN, A, L]) {
          const week = JSON.stringify(await val(run, who, "select public.load_week($1)", [ed]));
          expect(week, who).not.toMatch(/pickup|driver_/);
          expect(week, who).not.toContain(ADDRESS);
        }
        // no direct write, for anyone
        for (const who of [ADMIN, ED_ADMIN, A, L]) {
          expect(await sqlstate(run(who, "update public.transport_details set pickup_min = 1")), who).toBe("42501");
          expect(await sqlstate(run(who, "insert into public.transport_details (lesson_id, pickup_min) values ($1, 1)", [lesson.plain])), who).toBe("42501");
        }
        // the column itself: a whole number of minutes inside the grid's day, or nothing
        for (const bad of [-1, 1831]) expect(await sqlstate(run("owner", "update public.transport_details set pickup_min = $1", [bad])), String(bad)).toBe("23514");
      });
    });

    it("an imported lesson's note keeps the rule it had: an archive's is a global admin's alone — not its admin's, not logistics' on a request that waits", async () => {
      await inTx(async (run) => {
        // the archive's lesson has a transport request waiting (by hand) — the very state that opens a live edition's pickup to logistics
        expect((await run("owner", "select transport, approval from public.lessons where id = $1", [lesson.archive])).rows[0]).toEqual({ transport: "round_trip", approval: "pending" });
        expect(await val(run, ADMIN, "select public.get_import_note($1)", [lesson.archive])).toBe(IMPORT_NOTE);
        expect((await run(ADMIN, "select note from public.lesson_import_notes")).rows).toEqual([{ note: IMPORT_NOTE }]);
        for (const who of [ARC_ADMIN, ARC_C, ARC_L, ED_ADMIN, A, L, O_ADMIN, STRANGER]) {
          expect(await val(run, who, "select public.get_import_note($1)", [lesson.archive]), who).toBeNull();
          expect((await run(who, "select note from public.lesson_import_notes")).rows, who).toEqual([]);
          expect(await val(run, who, "select public.get_transport_details($1)", [lesson.archive]), who).toBeNull();
        }
        for (const state of ["approved", "rejected", "none"]) {
          await run("owner", "update public.lessons set approval = $2 where id = $1", [lesson.archive, state]);
          for (const who of [ARC_ADMIN, ARC_L, ARC_C]) expect(await val(run, who, "select public.get_import_note($1)", [lesson.archive]), `${who} ${state}`).toBeNull();
        }
        // an archive made by archiving (last year's real edition): the same
        await run("owner", "insert into public.lesson_import_notes (lesson_id, edition_id, note) values ($1, $2, $3)", [lesson.old, edition.old, IMPORT_NOTE]);
        for (const who of [OLD_ADMIN, OLD_C, OLD_L]) expect(await val(run, who, "select public.get_import_note($1)", [lesson.old]), who).toBeNull();
        expect(await val(run, ADMIN, "select public.get_import_note($1)", [lesson.old])).toBe(IMPORT_NOTE);
        expect(await sqlstate(run("anon", "select public.get_import_note($1)", [lesson.archive]))).toBe("42501");
      });
    });
  });

  // ---------------------------------------------------------------- approvals

  describe("decide_payments by the staff of both teams", () => {
    const decide = (run: Run, who: string, ids: number[], versions: (number | null)[], decision: string | null = "approved", note: string | null = null) =>
      code(run(who, "select public.decide_payments($1::bigint[], $2::integer[], $3, $4)", [ids, versions, decision, note]));
    const state = async (run: Run, id: number) => {
      const r = (await run("owner", "select approval, approval_note, approved_by, approved_at is not null as at, updated_by, version from public.lessons where id = $1", [id])).rows[0];
      return { approval: r.approval, note: r.approval_note, by: r.approved_by == null ? null : Number(r.approved_by), at: r.at, updated_by: Number(r.updated_by), version: Number(r.version) };
    };
    const v = async (run: Run, id: number) => Number(await val(run, "owner", "select version from public.lessons where id = $1", [id]));

    it("an admin of the lesson's edition approves, logistics of it rejects with a note — one decision is enough, and it carries their own member row", async () => {
      await inTx(async (run) => {
        const before = await v(run, lesson.b);
        expect(await decide(run, ED_ADMIN, [lesson.b], [before])).toBe("ok");
        expect(await state(run, lesson.b)).toEqual({ approval: "approved", note: null, by: member[ED_ADMIN], at: true, updated_by: member[ED_ADMIN], version: before + 1 });
        expect(await decide(run, L, [lesson.b2], [await v(run, lesson.b2)], "rejected", "  נימוק   לדוגמה ")).toBe("ok");
        expect(await state(run, lesson.b2)).toMatchObject({ approval: "rejected", note: "נימוק לדוגמה", by: member[L], at: true, updated_by: member[L] });
        // decided once: nobody decides it again, not even the instructor
        for (const who of [L, ED_ADMIN, ADMIN]) expect(await decide(run, who, [lesson.b], [await v(run, lesson.b)]), who).toBe("stale");
        // logistics marks the approved amount paid, as before
        expect(await code(run(L, "select public.set_paid($1, true)", [lesson.b]))).toBe("ok");
      });
      await inTx(async (run) => {
        // logistics approves a batch — an amount and a transport — and the global admin still does, as their all-editions row
        expect(await decide(run, L, [lesson.b2, lesson.b], [await v(run, lesson.b2), await v(run, lesson.b)])).toBe("ok");
        for (const id of [lesson.b, lesson.b2]) expect(await state(run, id)).toMatchObject({ approval: "approved", by: member[L] });
        expect(await decide(run, ADMIN, [lesson.t], [await v(run, lesson.t)])).toBe("ok");
        expect(await state(run, lesson.t)).toMatchObject({ approval: "approved", by: member[ADMIN], updated_by: member[ADMIN] });
      });
    });

    it("refuses a content member — the handler too — and the staff of another edition: `forbidden`; a stranger and a deactivated member: not a member; anon: no function", async () => {
      await inTx(async (run) => {
        const ver = await v(run, lesson.b);
        for (const who of [A, B]) expect(await decide(run, who, [lesson.b], [ver]), who).toBe("forbidden");
        expect(await decide(run, B, [lesson.b], [ver], "maybe")).toBe("forbidden"); // who, before what
        expect(await decide(run, O_C, [lesson.other], [await v(run, lesson.other)])).toBe("forbidden"); // content, even in their own edition
        // logistics and an admin of ANOTHER edition: staff, but not this lesson's
        for (const who of [O_L, O_ADMIN]) expect(await decide(run, who, [lesson.b], [ver]), who).toBe("forbidden");
        for (const who of [STRANGER, INACTIVE]) expect(await decide(run, who, [lesson.b], [ver]), who).toBe("not_member");
        expect(await decide(run, "anon", [lesson.b], [ver])).toBe("42501");
        expect(await state(run, lesson.b)).toMatchObject({ approval: "pending", by: null, version: ver });
        // …while each decides its own edition's
        expect(await decide(run, O_L, [lesson.other], [await v(run, lesson.other)])).toBe("ok");
        expect(await state(run, lesson.other)).toMatchObject({ approval: "approved", by: member[O_L] });
      });
    });

    it("goes by the role in the LESSON's edition: logistics of one edition who is a content member of another decides only the first's", async () => {
      await inTx(async (run) => {
        expect(await decide(run, DUAL, [lesson.b], [await v(run, lesson.b)])).toBe("forbidden"); // content here
        expect(await decide(run, DUAL, [lesson.other, lesson.b], [await v(run, lesson.other), await v(run, lesson.b)])).toBe("forbidden");
        for (const id of [lesson.b, lesson.other]) expect((await state(run, id)).approval).toBe("pending");
        expect(await decide(run, DUAL, [lesson.other], [await v(run, lesson.other)], "rejected")).toBe("ok"); // logistics there
        const dualThere = Number(await val(run, "owner", "select id from public.members where email = $1 and edition_id = $2", [DUAL, edition.other]));
        expect(await state(run, lesson.other)).toMatchObject({ approval: "rejected", by: dualThere, updated_by: dualThere });
        // and the same person's reading follows each edition's role: nothing of this edition's pickup, the other's from the request
        expect(await val(run, DUAL, "select public.get_transport_details($1)", [lesson.t])).toBeNull();
        await run(O_C, "select public.set_payment($1, $2, null, 'round_trip')", [lesson.other, await v(run, lesson.other)]); // asked again
        expect(await val(run, DUAL, "select public.get_transport_details($1)", [lesson.other])).not.toBeNull();
      });
    });

    it("is all or nothing: one lesson of another edition in the batch, or one stale version, and none is decided", async () => {
      await inTx(async (run) => {
        expect(await decide(run, L, [lesson.b, lesson.other], [await v(run, lesson.b), await v(run, lesson.other)])).toBe("forbidden");
        expect(await decide(run, L, [lesson.b, lesson.b2], [await v(run, lesson.b), (await v(run, lesson.b2)) + 1])).toBe("stale");
        expect(await decide(run, L, [lesson.b, 999999], [await v(run, lesson.b), 1])).toBe("stale"); // a lesson that is gone
        expect(await decide(run, L, [lesson.b, lesson.plain], [await v(run, lesson.b), await v(run, lesson.plain)])).toBe("stale"); // nothing asked there
        expect(await decide(run, L, [lesson.draft], [await v(run, lesson.draft)])).toBe("stale");
        for (const id of [lesson.b, lesson.b2]) expect((await state(run, id)).approval).toBe("pending");
        // the values, as before: a decision that is none, lists of two lengths, a note too long
        expect(await decide(run, L, [lesson.b], [await v(run, lesson.b)], "maybe")).toBe("bad_value");
        expect(await decide(run, L, [lesson.b], [await v(run, lesson.b)], null)).toBe("bad_value");
        expect(await decide(run, L, [lesson.b, lesson.b2], [await v(run, lesson.b)])).toBe("bad_value");
        expect(await decide(run, ED_ADMIN, [lesson.b], [await v(run, lesson.b)], "approved", "א".repeat(301))).toBe("bad_value");
        expect(await decide(run, ED_ADMIN, [], [])).toBe("ok"); // nothing to decide
      });
    });

    it("only a real edition that is still live gives its staff the decision: a practice week's admin and last year's admin and logistics are refused; the global admin decides anywhere, as before", async () => {
      await inTx(async (run) => {
        expect(await decide(run, P_ADMIN, [lesson.practice], [await v(run, lesson.practice)])).toBe("forbidden");
        for (const who of [OLD_ADMIN, OLD_L, OLD_C]) expect(await decide(run, who, [lesson.oldPending], [await v(run, lesson.oldPending)]), who).toBe("forbidden");
        for (const id of [lesson.practice, lesson.oldPending]) expect((await state(run, id)).approval).toBe("pending");
        for (const id of [lesson.practice, lesson.oldPending]) {
          expect(await decide(run, ADMIN, [id], [await v(run, id)])).toBe("ok");
          expect(await state(run, id)).toMatchObject({ approval: "approved", by: member[ADMIN] });
        }
      });
    });
  });

  // ---------------------------------------------------------------- two connections

  describe("two connections at once", () => {
    async function two(): Promise<[pg.Client, pg.Client]> {
      const url = new URL(adminUrl());
      url.pathname = `/${dbName}`;
      const cs: [pg.Client, pg.Client] = [new pg.Client({ connectionString: url.toString() }), new pg.Client({ connectionString: url.toString() })];
      for (const c of cs) await c.connect();
      return cs;
    }
    async function begin(c: pg.Client, email: string) {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(email))]);
    }
    /** The first's command, then the second's — which must wait for it — then both commit, in that order. */
    async function oneAfterTheOther(first: [string, string, unknown[]], second: [string, string, unknown[]]): Promise<string> {
      const [c1, c2] = await two();
      try {
        await begin(c1, first[0]);
        await begin(c2, second[0]);
        await c1.query(first[1], first[2]);
        let done = false;
        const got = code(c2.query(second[1], second[2])).finally(() => (done = true));
        await new Promise((r) => setTimeout(r, 300));
        expect(done, "the second waits for the first").toBe(false);
        await c1.query("commit");
        const answer = await got;
        await c2.query(answer === "ok" ? "commit" : "rollback");
        return answer;
      } finally {
        await c1.end();
        await c2.end();
      }
    }

    it("two admins set one day's owners: the second waits and replaces the first's pair — a day never ends with both", async () => {
      const got = await oneAfterTheOther(
        [ED_ADMIN, "select public.set_day_owners($1, 3, $2::bigint[])", [ed, [member[A], member[B]]]],
        [ADMIN, "select public.set_day_owners($1, 3, $2::bigint[])", [ed, [member[ED_ADMIN], member[ADMIN]]]],
      );
      expect(got).toBe("ok");
      const rows = (await db.query("select member_id from public.day_owners where edition_id = $1 and day = 3 order by member_id", [ed])).rows.map((r) => Number(r.member_id));
      expect(rows).toEqual([member[ED_ADMIN], member[ADMIN]].sort((x, y) => x - y));
      await commitAs(ED_ADMIN, "select public.set_day_owners($1, 3, null)", [ed]);
    });

    it("two members write one speaker's ranges for one day: the second waits, and the day is the second's alone — never a mix, never PostgreSQL's unique-violation", async () => {
      const got = await oneAfterTheOther(
        [A, "select public.set_availability_ranges($1, $2, array[2], null, 'can')", [ed, sp.av]],
        [B, "select public.set_availability_ranges($1, $2, array[2], $3::jsonb, null)", [ed, sp.av, JSON.stringify([{ day: 2, start: 510, end: 600, kind: "cannot" }])]],
      );
      expect(got).toBe("ok");
      const rows = (await db.query("select r.start_min, v.kind, v.updated_by from public.slot_availability v join public.grid_rows r on r.id = v.row_id where v.edition_id = $1 and v.speaker_id = $2 and v.day = 2", [ed, sp.av])).rows;
      expect(rows.map((r) => [r.start_min, r.kind, Number(r.updated_by)])).toEqual([[510, "cannot", member[B]]]);
      await commitAs(B, "select public.set_availability_ranges($1, $2, array[2], null)", [ed, sp.av]);
    });

    it("one slot marked, with a note, while the ranges of that day are written: the ranges wait for it and their verdict stands — without the slot's note, never a unique-violation", async () => {
      const got = await oneAfterTheOther(
        [A, "select public.set_slot_availability($1, $2, 2, $3, 'can', $4)", [ed, sp.av, row[510], NOTE]],
        [B, "select public.set_availability_ranges($1, $2, array[2], $3::jsonb, null)", [ed, sp.av, JSON.stringify([{ day: 2, start: 510, end: 600, kind: "cannot" }])]],
      );
      expect(got).toBe("ok");
      const rows = (await db.query("select r.start_min, v.kind, v.note, v.updated_by from public.slot_availability v join public.grid_rows r on r.id = v.row_id where v.edition_id = $1 and v.speaker_id = $2 and v.day = 2", [ed, sp.av])).rows;
      expect(rows.map((r) => [r.start_min, r.kind, r.note, Number(r.updated_by)])).toEqual([[510, "cannot", null, member[B]]]);
      await commitAs(B, "select public.set_availability_ranges($1, $2, array[2], null)", [ed, sp.av]);
    });
  });

  // ---------------------------------------------------------------- the file, run again

  it("running schema.sql again on a v18 database changes nothing and loses nothing: owners and their «ראיתי», marks, pickups and their minutes, the log", async () => {
    await commitAs(ED_ADMIN, "select public.set_day_owners($1, 1, $2::bigint[])", [ed, [member[A], member[B]]]);
    await commitAs(A, "select public.mark_day_seen($1, 1)", [ed]);
    await commitAs(B, "select public.set_availability_ranges($1, $2, array[1, 4], $3::jsonb, 'can')", [ed, sp.av, JSON.stringify([{ day: 1, start: 600, end: 700, kind: "cannot" }])]);
    await commitAs(L, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson.t, await version(lesson.t)]);
    await commitAs(L, "select public.set_transport_driver($1, $2::jsonb)", [lesson.t, JSON.stringify({ driver_name: DRIVER, driver_phone: PHONE, arranged: true })]);
    const snapshot = async () => ({
      owners: (await db.query("select edition_id, day, member_id, seen_at from public.day_owners order by 1, 2, 3")).rows,
      slots: (await db.query("select id, edition_id, speaker_id, day, row_id, kind, note, updated_by, updated_at from public.slot_availability order by id")).rows,
      transport: (await db.query("select * from public.transport_details order by lesson_id")).rows,
      lessons: (await db.query("select id, approval, approved_by, approved_at, version from public.lessons order by id")).rows,
      log: (await db.query("select id, actor, edition_id, entity, entity_id, kind, detail from public.activity order by id")).rows,
    });
    const before = await snapshot();
    expect(before.owners.filter((o) => Number(o.edition_id) === ed).map((o) => [o.day, Number(o.member_id), o.seen_at != null])).toEqual(
      [[1, member[A], true], [1, member[B], false]].sort((x, y) => (x[1] as number) - (y[1] as number)),
    );
    expect(before.slots).toHaveLength(12 + 7);
    expect(before.transport.find((t) => Number(t.lesson_id) === lesson.t)).toEqual({
      lesson_id: String(lesson.t), pickup_address: ADDRESS, pickup_time: "07:15", driver_name: DRIVER, driver_phone: PHONE, arranged: true, pickup_min: 435,
    });
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    expect(await snapshot()).toEqual(before);
    expect((await db.query("select public.schema_version() as v")).rows[0].v).toBe(18);
    // and it all still answers as before
    await inTx(async (run) => {
      expect(((await val(run, B, "select public.load_week($1)", [ed])) as { dayOwners: unknown[] }).dayOwners).toHaveLength(2);
      expect(await code(run(A, "select public.mark_day_seen($1, 1)", [ed]))).toBe("ok");
      expect(await code(run("anon", "select public.mark_day_seen($1, 1)", [ed]))).toBe("42501");
    });
  });
});
