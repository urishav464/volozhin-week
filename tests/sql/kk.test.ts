// מכריכה לכריכה (v9) in the database: the sign-up link — what the form shows
// (names only, never who signed up), a sign-up recorded only inside the window,
// in an open group with a capacity entered and a place left, never changing an
// existing one, and the same answer in every case; two sign-ups at once for the
// last place (two connections): exactly one; the staff's groups, leaders,
// placements and book orders, and who may write them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { SCHEMA, adminUrl, dropDatabase, freshDatabase, google, sqlstate } from "./db";

const ADMIN = "admin@example.org";
const ED_ADMIN = "edition.admin@example.org";
const A = "a@example.org";
const L = "logistics@example.org";
const OTHER_ADMIN = "other.admin@example.org";

type Run = (who: string, sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message: string };
    return err.code === "P0001" ? err.message : (err.code ?? "error");
  }
}

describe("מכריכה לכריכה", () => {
  const dbName = `vw_kk_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let other: number;
  let otherRoom: number;
  const r: number[] = []; // the edition's trainees
  let rOther: number;
  let token: string;
  let otherToken: string;
  const g: Record<string, number> = {};

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
          const res = await db.query(sql, params);
          await db.query("release savepoint s");
          return res;
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

  async function commitAs(email: string, sql: string, params: unknown[] = []): Promise<unknown> {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(email))]);
      const res = await db.query(sql, params);
      await db.query("commit");
      return res.rows[0] ? Object.values(res.rows[0])[0] : undefined;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }

  const signups = async (run: Run) =>
    (await run("owner", "select group_id, roster_id, via from public.kk_signups order by roster_id, group_id")).rows.map((x) => [Number(x.group_id), Number(x.roster_id), x.via]);

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', null, 510)"));
    other = Number((await db.query("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id")).rows[0].id);
    otherRoom = Number((await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'חדר אחר', true) returning id", [other])).rows[0].id);
    await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [other]);
    await db.query("insert into public.rooms (edition_id, name, sort) values ($1, 'כיתה', 2)", [ed]);
    for (const [email, role, edition] of [[ED_ADMIN, "admin", ed], [A, "content", ed], [L, "logistics", ed], [OTHER_ADMIN, "admin", other]] as const) {
      await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3)", [email, role, edition]);
    }
    for (const name of ["חניכה א לבדיקה", "חניך ב לבדיקה", "חניכה ג לבדיקה", "חניך ד לבדיקה"]) {
      r.push(Number((await db.query("insert into public.roster (edition_id, full_name) values ($1, $2) returning id", [ed, name])).rows[0].id));
    }
    rOther = Number((await db.query("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה במחזור אחר') returning id", [other])).rows[0].id);
    const add = (day: number, start: number, fields: unknown) => commitAs(ED_ADMIN, "select public.kk_add_group($1, $2, $3, $4)", [ed, day, start, JSON.stringify(fields)]).then(Number);
    const room = Number((await db.query("select id from public.rooms where edition_id = $1 and is_default", [ed])).rows[0].id);
    g.a = await add(1, 1290, { title: " ספר  לבדיקה א ", author: "מחבר/ת לבדיקה", room_id: room, capacity: 2, leaders: [{ kind: "trainee", roster_id: r[3] }, { kind: "staff", label: "צוות לבדיקה" }] });
    g.b = await add(1, 1290, { title: "ספר לבדיקה ב", capacity: 1 });
    g.none = await add(1, 1290, { title: "ספר בלי תפוסה" }); // not offered: no capacity entered
    g.closed = await add(2, 1740, { title: "ספר סגור", capacity: 5, open: false });
    token = ((await commitAs(ED_ADMIN, "select public.issue_link($1, 'kk_signup')", [ed])) as { token: string }).token;
    otherToken = ((await commitAs(OTHER_ADMIN, "select public.issue_link($1, 'kk_signup')", [other])) as { token: string }).token;
    await commitAs(OTHER_ADMIN, "select public.kk_add_group($1, 0, 1290, '{\"title\": \"ספר במחזור אחר\", \"capacity\": 9}')", [other]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  const open = (run: Run) => run(ED_ADMIN, "select public.kk_set_window($1, now() - interval '1 day', now() + interval '3 days')", [ed]);
  const signup = (run: Run, roster: number, group: number, t = token) => run("anon", "select public.kk_signup($1, $2, $3) as v", [t, roster, group]).then((x) => x.rows[0].v);

  describe("the form", () => {
    it("shows the window, the trainees' names only and the groups on offer — whether full, never who is in", async () => {
      await inTx(async (run) => {
        let f = (await run("anon", "select public.kk_form($1) as f", [token])).rows[0].f;
        expect(Object.keys(f).sort()).toEqual(["edition", "open", "roster", "tracks", "window"]);
        expect(f.open).toBe(false);
        expect(f.window).toEqual({ opens_at: null, closes_at: null });
        expect(f.roster.map((x: object) => Object.keys(x).sort())).toEqual(r.map(() => ["full_name", "id"]));
        expect(f.roster.map((x: { id: number }) => x.id).sort()).toEqual([...r].sort());
        expect(f.tracks).toHaveLength(1); // the closed group's track has nothing on offer
        expect(Object.keys(f.tracks[0]).sort()).toEqual(["date", "day", "end_min", "groups", "id", "start_min"]);
        expect(f.tracks[0]).toMatchObject({ day: 1, start_min: 1290, end_min: 1350, date: null });
        expect(f.tracks[0].groups.map((x: { id: number }) => x.id).sort()).toEqual([g.a, g.b].sort());
        const a = f.tracks[0].groups.find((x: { id: number }) => x.id === g.a);
        expect(a).toEqual({
          id: g.a, title: "ספר לבדיקה א", author: "מחבר/ת לבדיקה", room: "בית מדרש", full: false,
          leaders: [{ kind: "trainee", name: "חניך ד לבדיקה" }, { kind: "staff", name: "צוות לבדיקה" }],
        });
        await open(run);
        await run("owner", "insert into public.kk_signups (edition_id, track_id, group_id, roster_id, via) select edition_id, track_id, id, $2, 'staff' from public.kk_groups where id = $1", [g.b, r[0]]);
        f = (await run("anon", "select public.kk_form($1) as f", [token])).rows[0].f;
        expect(f.open).toBe(true);
        expect(f.tracks[0].groups.find((x: { id: number }) => x.id === g.b).full).toBe(true);
        expect(JSON.stringify(f)).not.toContain("via");
        expect(JSON.stringify(f)).not.toContain("roster_id");
      });
    });
  });

  describe("signing up through the link", () => {
    it("answers the same in every case, and records only what may be recorded", async () => {
      await inTx(async (run) => {
        const SAME = { status: "received" };
        expect(await signup(run, r[0], g.a)).toEqual(SAME); // window not set: nothing
        expect(await signups(run)).toEqual([]);
        await open(run);
        expect(await signup(run, r[0], g.a)).toEqual(SAME); // recorded
        expect(await signup(run, r[0], g.b)).toEqual(SAME); // an existing sign-up is never changed through the link
        expect(await signups(run)).toEqual([[g.a, r[0], "link"]]);
        expect(await signup(run, r[0], g.a)).toEqual(SAME); // the same again
        expect(await signup(run, r[1], g.none)).toEqual(SAME); // no capacity entered
        expect(await signup(run, r[1], g.closed)).toEqual(SAME); // a closed group
        expect(await signup(run, rOther, g.a)).toEqual(SAME); // not a trainee of this edition
        expect(await signup(run, -1, g.a)).toEqual(SAME);
        const otherGroup = Number((await run("owner", "select id from public.kk_groups where edition_id = $1", [other])).rows[0].id);
        expect(await signup(run, r[1], otherGroup)).toEqual(SAME); // another edition's group
        expect(await signup(run, r[1], -1)).toEqual(SAME);
        expect(await signups(run)).toEqual([[g.a, r[0], "link"]]);
        expect(await signup(run, r[1], g.b)).toEqual(SAME); // the last place
        expect(await signup(run, r[2], g.b)).toEqual(SAME); // full
        expect(await signup(run, r[2], g.a)).toEqual(SAME);
        expect(await signup(run, r[3], g.a)).toEqual(SAME); // full now
        expect(await signups(run)).toEqual([[g.a, r[0], "link"], [g.b, r[1], "link"], [g.a, r[2], "link"]]);
        // the other edition's link signs up for its own groups only
        expect(await signup(run, rOther, g.a, otherToken)).toEqual(SAME);
        expect((await run("owner", "select count(*)::int as n from public.kk_signups where roster_id = $1", [rOther])).rows[0].n).toBe(0);
      });
    });

    it("records nothing before the window opens; after it closes the link itself has expired", async () => {
      await inTx(async (run) => {
        await run(ED_ADMIN, "select public.kk_set_window($1, now() + interval '1 day', now() + interval '3 days')", [ed]);
        expect(await signup(run, r[0], g.a)).toEqual({ status: "received" });
        expect(await signups(run)).toEqual([]);
        await run(ED_ADMIN, "select public.kk_set_window($1, now() - interval '3 days', now() - interval '1 minute')", [ed]);
        expect(await code(signup(run, r[0], g.a))).toBe("link_invalid");
        expect(await code(run("anon", "select public.kk_form($1)", [token]))).toBe("link_invalid");
      });
    });

    // Two calls through the one class link queue up twice over: on the group's row lock, and on the token's counter row.
    it("two trainees at once for the last place (two connections): exactly one gets it", async () => {
      await commitAs(ED_ADMIN, "select public.kk_set_window($1, now() - interval '1 day', now() + interval '3 days')", [ed]);
      const url = new URL(adminUrl());
      url.pathname = `/${dbName}`;
      const [c1, c2] = [new pg.Client({ connectionString: url.toString() }), new pg.Client({ connectionString: url.toString() })];
      await c1.connect();
      await c2.connect();
      try {
        for (const c of [c1, c2]) await c.query("begin; set local role anon; select set_config('request.jwt.claims', '', true)");
        expect((await c1.query("select public.kk_signup($1, $2, $3) as v", [token, r[0], g.b])).rows[0].v).toEqual({ status: "received" });
        const second = c2.query("select public.kk_signup($1, $2, $3) as v", [token, r[1], g.b]); // waits on the group's row lock
        await new Promise((res) => setTimeout(res, 150));
        await c1.query("commit");
        expect((await second).rows[0].v).toEqual({ status: "received" });
        await c2.query("commit");
        expect((await db.query("select roster_id from public.kk_signups where group_id = $1", [g.b])).rows.map((x) => Number(x.roster_id))).toEqual([r[0]]);
      } finally {
        await c1.end();
        await c2.end();
        await db.query("delete from public.kk_signups");
        await commitAs(ED_ADMIN, "select public.kk_set_window($1, null, null)", [ed]);
      }
    });
  });

  describe("the staff", () => {
    it("add groups on the grid's kk occurrences only, with the database's cleaning", async () => {
      await inTx(async (run) => {
        const add = (day: number, start: number, f: unknown, who = ED_ADMIN) => code(run(who, "select public.kk_add_group($1, $2, $3, $4)", [ed, day, start, JSON.stringify(f)]));
        expect(await add(4, 1290, { title: "x" })).toBe("outside_grid"); // Thursday ends at 19:00
        expect(await add(1, 510, { title: "x" })).toBe("outside_grid"); // a lesson row
        expect(await add(1, 1300, { title: "x" })).toBe("outside_grid");
        expect(await add(7, 1290, { title: "x" })).toBe("outside_grid");
        expect(await add(1, 1290, {})).toBe("title_required");
        expect(await add(1, 1290, { title: "   " })).toBe("title_required");
        expect(await add(1, 1290, { title: "א".repeat(201) })).toBe("bad_value");
        expect(await add(1, 1290, { title: "x", room_id: otherRoom })).toBe("bad_value"); // another edition's room
        expect(await add(1, 1290, { title: "x", capacity: 0 })).toBe("bad_value");
        expect(await add(1, 1290, { title: "x", capacity: 2.5 })).toBe("bad_value");
        expect(await add(1, 1290, { title: "x", capacity: "8" })).toBe("bad_value");
        expect(await add(1, 1290, { title: "x", open: "yes" })).toBe("bad_value");
        expect(await add(1, 1290, { title: "x", leaders: [{ kind: "trainee", roster_id: rOther }] })).toBe("bad_trainee");
        expect(await add(1, 1290, { title: "x", leaders: [{ kind: "staff" }] })).toBe("bad_value");
        expect(await add(1, 1290, { title: "x", leaders: [{ kind: "guest", label: "x" }] })).toBe("bad_value");
        expect(await add(1, 1290, { title: "x", leaders: Array.from({ length: 7 }, (_, i) => ({ kind: "staff", label: `מוביל/ה ${i}` })) })).toBe("bad_value");
        expect(await add(1, 1290, { title: "x" }, A)).toBe("forbidden");
        expect(await add(1, 1290, { title: "x" }, L)).toBe("forbidden");
        expect(await add(1, 1290, { title: "x" }, OTHER_ADMIN)).toBe("not_member");
        expect(await add(3, 1740, { title: "ספר חדש", leaders: [{ kind: "staff", label: "א" }, { kind: "staff", label: " א " }, { kind: "ein_prat", label: "ב" }] })).toBe("ok");
        const t = (await run("owner", "select day, start_min, end_min from public.kk_tracks where edition_id = $1 and day = 3", [ed])).rows;
        expect(t).toEqual([{ day: 3, start_min: 1740, end_min: 1830 }]);
        expect((await run("owner", "select kind, label from public.kk_leaders k join public.kk_groups g on g.id = k.group_id where g.title = 'ספר חדש' order by k.sort")).rows).toEqual([
          { kind: "staff", label: "א" }, { kind: "ein_prat", label: "ב" },
        ]);
      });
    });

    it("edit, place, move and remove sign-ups beyond capacity; delete only an empty group; the kk tables are read-only to a browser", async () => {
      await inTx(async (run) => {
        expect(await code(run(ED_ADMIN, "select public.kk_update_group($1, $2)", [g.b, JSON.stringify({ capacity: 3, author: null, leaders: [{ kind: "trainee", roster_id: r[2] }] })]))).toBe("ok");
        expect((await run("owner", "select capacity, author, title from public.kk_groups where id = $1", [g.b])).rows[0]).toEqual({ capacity: 3, author: null, title: "ספר לבדיקה ב" });
        expect(await code(run(ED_ADMIN, "select public.kk_update_group($1, '{\"title\": \"\"}')", [g.b]))).toBe("title_required");
        expect(await code(run(ED_ADMIN, "select public.kk_update_group(-1, '{}')"))).toBe("stale");
        expect(await code(run(A, "select public.kk_update_group($1, '{}')", [g.b]))).toBe("forbidden");
        await run(ED_ADMIN, "select public.kk_update_group($1, '{\"capacity\": 1}')", [g.b]);
        await run(ED_ADMIN, "select public.kk_place($1, $2)", [g.b, r[0]]);
        await run(ED_ADMIN, "select public.kk_place($1, $2)", [g.b, r[1]]); // over capacity: the staff decide
        expect(await signups(run)).toEqual([[g.b, r[0], "staff"], [g.b, r[1], "staff"]]);
        await run(ED_ADMIN, "select public.kk_place($1, $2)", [g.a, r[0]]); // moved within the track
        expect(await signups(run)).toEqual([[g.a, r[0], "staff"], [g.b, r[1], "staff"]]);
        expect(await code(run(ED_ADMIN, "select public.kk_place($1, $2)", [g.a, rOther]))).toBe("bad_trainee");
        expect(await code(run(A, "select public.kk_place($1, $2)", [g.a, r[2]]))).toBe("forbidden");
        expect(await code(run(ED_ADMIN, "select public.kk_delete_group($1)", [g.b]))).toBe("group_has_signups");
        const track = Number((await run("owner", "select track_id from public.kk_groups where id = $1", [g.b])).rows[0].track_id);
        await run(ED_ADMIN, "select public.kk_unplace($1, $2)", [track, r[1]]);
        expect(await code(run(ED_ADMIN, "select public.kk_delete_group($1)", [g.b]))).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.kk_unplace(-1, 1)"))).toBe("stale");
        // a group whose track then has no group: the track goes too
        expect(await code(run(ED_ADMIN, "select public.kk_delete_group($1)", [g.closed]))).toBe("ok");
        expect((await run("owner", "select count(*)::int as n from public.kk_tracks where edition_id = $1 and day = 2", [ed])).rows[0].n).toBe(0);
        for (const t of ["kk_tracks", "kk_groups", "kk_leaders", "kk_signups", "book_orders"]) {
          expect(await sqlstate(run(ED_ADMIN, `delete from public.${t}`)), t).toBe("42501");
        }
        expect(await sqlstate(run(ED_ADMIN, "insert into public.kk_signups (edition_id, track_id, group_id, roster_id, via) values ($1, $2, $3, $4, 'staff')", [ed, track, g.a, r[3]]))).toBe("42501");
      });
    });

    it("set the window: both bounds, opening first, or neither", async () => {
      await inTx(async (run) => {
        expect(await code(run(ED_ADMIN, "select public.kk_set_window($1, now(), null)", [ed]))).toBe("bad_value");
        expect(await code(run(ED_ADMIN, "select public.kk_set_window($1, now() + interval '1 day', now())", [ed]))).toBe("bad_value");
        expect(await code(run(A, "select public.kk_set_window($1, now(), now() + interval '1 day')", [ed]))).toBe("forbidden");
        await run(ED_ADMIN, "select public.kk_set_window($1, '2027-01-01T08:00:00.5Z', '2027-01-15 22:00+02')", [ed]);
        expect((await run("owner", "select settings -> 'kk_window' as w from public.editions where id = $1", [ed])).rows[0].w).toEqual({
          opens_at: "2027-01-01T08:00:00.500Z", closes_at: "2027-01-15T20:00:00.000Z",
        });
        await run(ED_ADMIN, "select public.kk_set_window($1, null, null)", [ed]);
        expect((await run("owner", "select settings ? 'kk_window' as w from public.editions where id = $1", [ed])).rows[0].w).toBe(false);
      });
    });

    it("book orders: logistics or an admin, the first «ordered» time kept, null removes the line", async () => {
      await inTx(async (run) => {
        expect(await code(run(A, "select public.set_book_order($1, 5, false)", [g.a]))).toBe("forbidden");
        expect(await code(run(L, "select public.set_book_order($1, 5, false)", [g.a]))).toBe("ok");
        expect(await code(run(L, "select public.set_book_order($1, 1001, false)", [g.a]))).toBe("bad_value");
        expect(await code(run(L, "select public.set_book_order($1, null, true)", [g.a]))).toBe("bad_value");
        expect(await code(run(L, "select public.set_book_order($1, 5, null)", [g.a]))).toBe("bad_value");
        await run(L, "select public.set_book_order($1, 6, true)", [g.a]);
        const first = (await run("owner", "select copies, ordered_at from public.book_orders where group_id = $1", [g.a])).rows[0];
        expect(first.copies).toBe(6);
        await run(ED_ADMIN, "select public.set_book_order($1, 7, true)", [g.a]);
        expect((await run("owner", "select copies, ordered_at from public.book_orders where group_id = $1", [g.a])).rows[0]).toEqual({ copies: 7, ordered_at: first.ordered_at });
        await run(L, "select public.set_book_order($1, 7, false)", [g.a]);
        expect((await run("owner", "select ordered_at from public.book_orders where group_id = $1", [g.a])).rows[0].ordered_at).toBeNull();
        await run(L, "select public.set_book_order($1, null, false)", [g.a]);
        expect((await run("owner", "select count(*)::int as n from public.book_orders")).rows[0].n).toBe(0);
      });
    });

    it("load_kk: the edition's members read it all; another edition's, nothing", async () => {
      await inTx(async (run) => {
        await run(ED_ADMIN, "select public.kk_place($1, $2)", [g.a, r[1]]);
        await run(L, "select public.set_book_order($1, 4, false)", [g.a]);
        const k = (await run(A, "select public.load_kk($1) as k", [ed])).rows[0].k;
        expect(Object.keys(k).sort()).toEqual(["groups", "leaders", "orders", "signups", "tracks"]);
        expect(k.groups.map((x: { id: number }) => x.id)).toEqual([g.a, g.b, g.none, g.closed]);
        expect(k.signups).toEqual([expect.objectContaining({ group_id: g.a, roster_id: r[1], via: "staff" })]);
        expect(k.orders).toEqual([{ group_id: g.a, copies: 4, ordered_at: null }]);
        expect((await run(OTHER_ADMIN, "select public.load_kk($1) as k", [ed])).rows[0].k).toBeNull();
        expect((await run(OTHER_ADMIN, "select id from public.kk_groups where edition_id = $1", [ed])).rows).toEqual([]);
      });
    });
  });
});
