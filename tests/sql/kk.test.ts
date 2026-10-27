// מכריכה לכריכה by the week (v15) in the database: the sign-up link — what the
// form shows (the trainees who lead no group, names only; the week's sessions
// from the grid; the groups on offer: a book, a capacity, open), a sign-up
// recorded only inside the window, for a trainee who leads no group, in a group
// on offer with a place left, and only once a week, with the same answer in
// every case; the staff's groups (leaders before the book, one place each, a
// trainee leading one group and never signed up), placements and book orders,
// and who may write them; races on two connections, each queued by the
// edition's kk lock; the two residuals of the CONTRACT.
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

const NAMES = ["חניכה א לבדיקה", "חניך ב לבדיקה", "חניכה ג לבדיקה", "חניך ד לבדיקה", "חניכה ה לבדיקה", "חניך ו לבדיקה"];

describe("מכריכה לכריכה", () => {
  const dbName = `vw_kk_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let other: number;
  // r[0..3] take part; r[4] leads the group with no book yet, r[5] leads group a
  const r: number[] = [];
  let rOther: number;
  let token: string;
  let otherToken: string;
  let otherGroup: number;
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
  const leaders = async (run: Run, group: number) =>
    (await run("owner", "select kind, roster_id, label from public.kk_leaders where group_id = $1 order by sort, id", [group])).rows.map((x) => ({
      ...x, roster_id: x.roster_id == null ? null : Number(x.roster_id),
    }));
  const form = async (run: Run, t = token) => (await run("anon", "select public.kk_form($1) as f", [t])).rows[0].f;

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', null, 510)"));
    other = Number((await db.query("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id")).rows[0].id);
    await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'חדר אחר', true)", [other]);
    await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [other]);
    for (const [email, role, edition] of [[ED_ADMIN, "admin", ed], [A, "content", ed], [L, "logistics", ed], [OTHER_ADMIN, "admin", other]] as const) {
      await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3)", [email, role, edition]);
    }
    for (const name of NAMES) {
      r.push(Number((await db.query("insert into public.roster (edition_id, full_name) values ($1, $2) returning id", [ed, name])).rows[0].id));
    }
    rOther = Number((await db.query("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה במחזור אחר') returning id", [other])).rows[0].id);
    const add = (fields: unknown) => commitAs(ED_ADMIN, "select public.kk_add_group($1, $2)", [ed, JSON.stringify(fields)]).then(Number);
    g.a = await add({ title: " ספר  לבדיקה א ", author: "מחבר/ת לבדיקה", place: " הדשא ", capacity: 2, leaders: [{ kind: "trainee", roster_id: r[5] }, { kind: "staff", label: "צוות לבדיקה" }] });
    g.b = await add({ title: "ספר לבדיקה ב", place: "הספרייה", capacity: 1 });
    g.none = await add({ title: "ספר בלי תפוסה" }); // not offered: no capacity entered
    g.closed = await add({ title: "ספר סגור", capacity: 5, open: false });
    g.nobook = await add({ capacity: 5, leaders: [{ kind: "trainee", roster_id: r[4] }, { kind: "ein_prat", label: "מעין פרת לדוגמה" }] }); // the leaders first, the book later
    token = ((await commitAs(ED_ADMIN, "select public.issue_link($1, 'kk_signup')", [ed])) as { token: string }).token;
    otherToken = ((await commitAs(OTHER_ADMIN, "select public.issue_link($1, 'kk_signup')", [other])) as { token: string }).token;
    otherGroup = Number(await commitAs(OTHER_ADMIN, "select public.kk_add_group($1, '{\"title\": \"ספר במחזור אחר\", \"capacity\": 9}')", [other]));
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  const open = (run: Run) => run(ED_ADMIN, "select public.kk_set_window($1, now() - interval '1 day', now() + interval '3 days')", [ed]);
  const signup = (run: Run, roster: number, group: number, t = token) => run("anon", "select public.kk_signup($1, $2, $3) as v", [t, roster, group]).then((x) => x.rows[0].v);
  const place = (run: Run, group: number, roster: number, who = ED_ADMIN) => code(run(who, "select public.kk_place($1, $2)", [group, roster]));
  const update = (run: Run, group: number, patch: unknown, who = ED_ADMIN) => code(run(who, "select public.kk_update_group($1, $2)", [group, JSON.stringify(patch)]));
  const trainee = (id: number) => ({ kind: "trainee", roster_id: id });

  describe("the form", () => {
    it("shows the window, the names of the trainees who lead no group, and the groups on offer — whether full, never who is in", async () => {
      await inTx(async (run) => {
        let f = await form(run);
        expect(Object.keys(f).sort()).toEqual(["edition", "groups", "open", "roster", "sessions", "window"]);
        expect(f.open).toBe(false);
        expect(f.window).toEqual({ opens_at: null, closes_at: null });
        expect(f.edition).toEqual({ label: 'תשפ"ז', start_date: null });
        // the leaders are part of their groups: r[5] leads one on offer, r[4] one with no book yet
        expect(f.roster.map((x: object) => Object.keys(x).sort())).toEqual(r.slice(0, 4).map(() => ["full_name", "id"]));
        expect(f.roster.map((x: { id: number }) => x.id).sort()).toEqual(r.slice(0, 4).sort());
        expect(f.groups.map((x: { id: number }) => x.id).sort()).toEqual([g.a, g.b].sort()); // no capacity, closed, no book: not on offer
        const a = f.groups.find((x: { id: number }) => x.id === g.a);
        expect(a).toEqual({
          id: g.a, title: "ספר לבדיקה א", author: "מחבר/ת לבדיקה", place: "הדשא", full: false,
          leaders: [{ kind: "trainee", name: NAMES[5] }, { kind: "staff", name: "צוות לבדיקה" }],
        });
        expect(f.groups.find((x: { id: number }) => x.id === g.b)).toMatchObject({ author: null, leaders: [] });
        await open(run);
        await run("owner", "insert into public.kk_signups (edition_id, group_id, roster_id, via) values ($1, $2, $3, 'staff')", [ed, g.b, r[0]]);
        f = await form(run);
        expect(f.open).toBe(true);
        expect(f.groups.find((x: { id: number }) => x.id === g.b).full).toBe(true);
        for (const word of ["via", "roster_id", "capacity", "place_key"]) expect(JSON.stringify(f)).not.toContain(word);
      });
    });

    it("offers a group with a book, a capacity entered and «פתוחה להרשמה» — all three", async () => {
      await inTx(async (run) => {
        const offered = async () => (await form(run)).groups.map((x: { id: number }) => x.id).sort();
        expect(await update(run, g.nobook, { title: "הספר שנבחר" })).toBe("ok");
        expect(await offered()).toEqual([g.a, g.b, g.nobook].sort());
        expect(await update(run, g.nobook, { capacity: null })).toBe("ok");
        expect(await offered()).toEqual([g.a, g.b].sort());
        expect(await update(run, g.nobook, { capacity: 3, open: false })).toBe("ok");
        expect(await offered()).toEqual([g.a, g.b].sort());
        expect(await update(run, g.nobook, { open: true, title: "   " })).toBe("ok"); // blank: no book again
        expect(await offered()).toEqual([g.a, g.b].sort());
        // r[4] leads it all along — offered or not, never in the roster
        expect((await form(run)).roster.map((x: { id: number }) => x.id)).not.toContain(r[4]);
      });
    });

    it("lists the week's sessions from the grid: 8 by default, every group in each — Sunday's 21:30 gone once Sunday opens at 22:30", async () => {
      await inTx(async (run) => {
        let s = (await form(run)).sessions;
        expect(s.map((x: object) => Object.keys(x).sort())).toEqual(s.map(() => ["date", "day", "end_min", "start_min"]));
        expect(s.map((x: { day: number; start_min: number; end_min: number }) => `${x.day} ${x.start_min}-${x.end_min}`)).toEqual([
          "0 1290-1350", "0 1740-1830", "1 1290-1350", "1 1740-1830", "2 1290-1350", "2 1740-1830", "3 1290-1350", "3 1740-1830",
        ]); // Thursday ends at 19:00: neither of its kk rows
        expect(s.every((x: { date: string | null }) => x.date === null)).toBe(true); // the week's date is TBD
        await run("owner", "update public.editions set start_date = '2027-02-14', first_day_from = 1350 where id = $1", [ed]);
        s = (await form(run)).sessions;
        expect(s).toHaveLength(7);
        expect(s[0]).toEqual({ day: 0, date: "2027-02-14", start_min: 1740, end_min: 1830 });
        expect(s[6]).toEqual({ day: 3, date: "2027-02-17", start_min: 1740, end_min: 1830 });
        // the sessions are information: no group is tied to one
        expect((await form(run)).groups.map((x: { id: number }) => x.id).sort()).toEqual([g.a, g.b].sort());
      });
    });
  });

  describe("signing up through the link", () => {
    it("answers the same in every case, and records only what may be recorded — one book a week", async () => {
      await inTx(async (run) => {
        const SAME = { status: "received" };
        expect(await signup(run, r[0], g.a)).toEqual(SAME); // window not set: nothing
        expect(await signups(run)).toEqual([]);
        await open(run);
        expect(await signup(run, r[0], g.a)).toEqual(SAME); // recorded
        expect(await signup(run, r[0], g.b)).toEqual(SAME); // a second book this week: nothing — an existing sign-up is never changed through the link
        expect(await signups(run)).toEqual([[g.a, r[0], "link"]]);
        expect(await signup(run, r[0], g.a)).toEqual(SAME); // the same again
        expect(await signup(run, r[1], g.none)).toEqual(SAME); // no capacity entered
        expect(await signup(run, r[1], g.closed)).toEqual(SAME); // a closed group
        expect(await signup(run, r[1], g.nobook)).toEqual(SAME); // no book yet
        expect(await signup(run, r[5], g.b)).toEqual(SAME); // a leader (of a)
        expect(await signup(run, r[4], g.a)).toEqual(SAME); // a leader (of a group not on offer)
        expect(await signup(run, rOther, g.a)).toEqual(SAME); // not a trainee of this edition
        expect(await signup(run, -1, g.a)).toEqual(SAME);
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

    // The residual the review found (anon-attack, security, code): «full» is the one fact the form gives about the
    // sign-ups, and it can tell, through a real sign-up, whether a named trainee already had one this week, for any
    // book — sign them up for a group with one place left, then read the form: still not full → they had one (the
    // link never changes a sign-up). One bit per probe, only where a group has exactly one place left, and the probe
    // is a sign-up the staff see on /kk («בקישור»). Accepted and documented (CONTRACT «kkForm», privacy page):
    // without «full», trainees would pick full groups blind. These tests pin it so a change is a choice.
    it("RESIDUAL, accepted: a sign-up then «full» tells whether a named trainee already signed up this week", async () => {
      await inTx(async (run) => {
        await open(run);
        expect(await place(run, g.none, r[0])).toBe("ok"); // the staff put r[0] in a group not on offer
        const fullB = async () => (await form(run)).groups.find((x: { id: number }) => x.id === g.b).full;
        expect(await fullB()).toBe(false); // b has one place
        expect(await signup(run, r[0], g.b)).toEqual({ status: "received" });
        expect(await fullB()).toBe(false); // → r[0] already had a sign-up this week
        expect(await signup(run, r[1], g.b)).toEqual({ status: "received" });
        expect(await fullB()).toBe(true); // → r[1] had none — and is now signed up, «בקישור», for the staff to see
        expect(await signups(run)).toEqual([[g.none, r[0], "staff"], [g.b, r[1], "link"]]);
      });
    });

    it("RESIDUAL, accepted: the same through a group that already has someone in it", async () => {
      await inTx(async (run) => {
        await open(run);
        await signup(run, r[0], g.a); // g.a has capacity 2: one place left
        expect(await place(run, g.b, r[1])).toBe("ok"); // r[1] already has a book
        const full = async () => (await form(run)).groups.find((x: { id: number }) => x.id === g.a).full;
        expect(await signup(run, r[1], g.a)).toEqual({ status: "received" });
        expect(await full()).toBe(false);
        expect(await signup(run, r[2], g.a)).toEqual({ status: "received" });
        expect(await full()).toBe(true);
      });
    });

    // The second residual: the roster leaves out every trainee who leads a group — one not on offer too, whose
    // leaders the form does not otherwise show. A leader's name is no secret from the class (CONTRACT «kkForm»).
    it("RESIDUAL, accepted: a name missing from the roster leads a group — perhaps one not on offer yet", async () => {
      await inTx(async (run) => {
        const f = await form(run);
        expect(f.roster.map((x: { full_name: string }) => x.full_name)).not.toContain(NAMES[4]);
        expect(JSON.stringify(f.groups)).not.toContain(NAMES[4]); // the group r[4] leads is not on offer
        expect(f.groups.map((x: { id: number }) => x.id)).not.toContain(g.nobook);
      });
    });
  });

  describe("the staff", () => {
    it("add groups — leaders first, the book later — with the database's cleaning, then the rules between groups, in the CONTRACT's order", async () => {
      await inTx(async (run) => {
        const add = (f: unknown, who = ED_ADMIN, edition = ed) => code(run(who, "select public.kk_add_group($1, $2)", [edition, JSON.stringify(f)]));
        expect(await add({ title: "x" }, A)).toBe("forbidden");
        expect(await add({ title: "x" }, L)).toBe("forbidden");
        expect(await add({ title: "x" }, OTHER_ADMIN)).toBe("not_member");
        expect(await add({ title: "x" }, ED_ADMIN, -1)).toBe("not_member");
        expect(await add({ capacity: 0 }, A)).toBe("forbidden"); // the admin before the fields
        expect(await code(run(ED_ADMIN, "select public.kk_add_group($1, '[]')", [ed]))).toBe("bad_value");
        expect(await add({ title: "א".repeat(201) })).toBe("bad_value");
        expect(await add({ title: 5 })).toBe("bad_value");
        expect(await add({ author: "א".repeat(121) })).toBe("bad_value");
        expect(await add({ place: "א".repeat(81) })).toBe("bad_value");
        expect(await add({ place: ["הדשא"] })).toBe("bad_value");
        expect(await add({ capacity: 0 })).toBe("bad_value");
        expect(await add({ capacity: 2.5 })).toBe("bad_value");
        expect(await add({ capacity: "8" })).toBe("bad_value");
        expect(await add({ open: "yes" })).toBe("bad_value");
        expect(await add({ leaders: [trainee(rOther)] })).toBe("bad_trainee");
        // a roster id that is no whole number, or none a bigint holds — refused as cleanLeaders does, never a cast error
        for (const id of [1.5, "1", 1e20, -1e20]) expect(await add({ leaders: [{ kind: "trainee", roster_id: id }] }), String(id)).toBe("bad_trainee");
        expect(await add({ leaders: [{ kind: "staff" }] })).toBe("bad_value");
        expect(await add({ leaders: [{ kind: "guest", label: "x" }] })).toBe("bad_value");
        expect(await add({ leaders: Array.from({ length: 7 }, (_, i) => ({ kind: "staff", label: `מעביר/ה ${i}` })) })).toBe("bad_value");
        // between groups: a place taken (as names compare: spaces, case, dashes, geresh and niqqud alike), a trainee who
        // leads another group, a trainee signed up for a book — in that order, and only after the fields
        expect(await add({ place: "הדשא", capacity: 0 })).toBe("bad_value");
        for (const taken of ["הדשא", "  הדשא", "הַדֶּשֶׁא", "הספריי׳ה", "הספרי״יה"]) expect(await add({ place: taken }), taken).toBe("place_taken");
        expect(await add({ place: "Lab 1" })).toBe("ok");
        for (const taken of ["lab  1", "LAB-1", "Lab–1"]) expect(await add({ place: taken }), taken).toBe("place_taken");
        expect(await add({ leaders: [trainee(r[5])] })).toBe("leader_elsewhere"); // r[5] leads a
        expect(await place(run, g.b, r[0])).toBe("ok");
        expect(await add({ leaders: [trainee(r[0])] })).toBe("leader_signed_up");
        expect(await add({ place: "הדשא", leaders: [trainee(r[5])] })).toBe("place_taken");
        expect(await add({ leaders: [trainee(r[0]), trainee(r[5])] })).toBe("leader_elsewhere");
        // no place never clashes, nor a place with nothing to compare (a dash alone)
        expect(await add({})).toBe("ok");
        expect(await add({ place: null })).toBe("ok");
        expect(await add({ place: "-" })).toBe("ok");
        expect(await add({ place: " - " })).toBe("ok");
        const n = await run(ED_ADMIN, "select public.kk_add_group($1, $2) as id", [ed, JSON.stringify({
          title: "   ", place: " חדר  העיון ", leaders: [{ kind: "staff", label: "א" }, { kind: "staff", label: " א " }, { kind: "ein_prat", label: "ב" }, trainee(r[1]), trainee(r[1])],
        })]);
        const id = Number(n.rows[0].id);
        expect((await run("owner", "select title, author, place, place_key, capacity, open from public.kk_groups where id = $1", [id])).rows[0]).toEqual({
          title: null, author: null, place: "חדר העיון", place_key: "חדר העיון", capacity: null, open: true,
        });
        expect(await leaders(run, id)).toEqual([
          { kind: "staff", roster_id: null, label: "א" }, { kind: "ein_prat", roster_id: null, label: "ב" }, { kind: "trainee", roster_id: r[1], label: null },
        ]);
        expect(await add({ place: "חדר העיון" })).toBe("place_taken");
      });
    });

    it("edit a group: a book not taken from a group someone signed up for; its own place and leaders kept; the rules between groups", async () => {
      await inTx(async (run) => {
        expect(await update(run, g.b, { capacity: 3, author: null, leaders: [trainee(r[2])] })).toBe("ok");
        expect((await run("owner", "select capacity, author, title, place from public.kk_groups where id = $1", [g.b])).rows[0]).toEqual({ capacity: 3, author: null, title: "ספר לבדיקה ב", place: "הספרייה" });
        expect(await leaders(run, g.b)).toEqual([{ kind: "trainee", roster_id: r[2], label: null }]);
        expect(await update(run, -1, {})).toBe("stale");
        expect(await update(run, g.b, {}, A)).toBe("forbidden");
        expect(await update(run, g.b, { capacity: 0 }, A)).toBe("forbidden");
        expect(await update(run, g.b, { capacity: 0 })).toBe("bad_value");
        expect(await update(run, otherGroup, {})).toBe("not_member");
        // the title: cleared while nobody is signed up — fine; while someone is — refused
        expect(await update(run, g.none, { title: "" })).toBe("ok");
        expect((await run("owner", "select title from public.kk_groups where id = $1", [g.none])).rows[0].title).toBeNull();
        expect(await place(run, g.a, r[0])).toBe("ok");
        expect(await update(run, g.a, { title: null })).toBe("group_has_signups");
        expect(await update(run, g.a, { title: "  " })).toBe("group_has_signups");
        expect(await update(run, g.a, { title: "ספר אחר לבדיקה" })).toBe("ok"); // another book: the screen warns once ordered
        // a group with no book yet, someone placed in it by the staff: its title stays null as it was — no refusal
        expect(await place(run, g.nobook, r[3])).toBe("ok");
        expect(await update(run, g.nobook, { title: null, capacity: 4 })).toBe("ok");
        // the place: another group's refused, its own kept as typed again
        expect(await update(run, g.b, { place: " הַדֶּשֶׁא " })).toBe("place_taken");
        expect(await update(run, otherGroup, { place: "הדשא" }, OTHER_ADMIN)).toBe("ok"); // unique per edition: another edition's group may meet there
        expect(await update(run, g.a, { place: "הדשא " })).toBe("ok");
        expect(await update(run, g.a, { place: null })).toBe("ok");
        expect(await update(run, g.b, { place: "הדשא" })).toBe("ok"); // free now
        // the leaders: its own trainee kept; another group's refused; anyone signed up — for this group too — refused
        expect(await update(run, g.a, { leaders: [trainee(r[5]), { kind: "staff", label: "צוות לבדיקה" }] })).toBe("ok");
        expect(await update(run, g.b, { leaders: [trainee(r[5])] })).toBe("leader_elsewhere");
        expect(await update(run, g.a, { leaders: [trainee(r[0])] })).toBe("leader_signed_up"); // r[0] is signed up for a itself
        expect(await update(run, g.b, { leaders: [trainee(r[0])] })).toBe("leader_signed_up");
        // in the CONTRACT's order: the title, the place, then the leaders
        expect(await update(run, g.a, { title: null, place: "הדשא", leaders: [trainee(r[4])] })).toBe("group_has_signups");
        expect(await update(run, g.a, { place: "הדשא", leaders: [trainee(r[4])] })).toBe("place_taken");
        expect(await update(run, g.a, { leaders: [trainee(r[0]), trainee(r[4])] })).toBe("leader_elsewhere");
        // a trainee moves from one group's leaders to another's once the first lets them go
        expect(await update(run, g.a, { leaders: [] })).toBe("ok");
        expect(await update(run, g.b, { leaders: [trainee(r[5])] })).toBe("ok");
      });
    });

    it("place, move and remove sign-ups beyond the capacity and the offer — never a leader; delete only an empty group; the kk tables are read-only to a browser", async () => {
      await inTx(async (run) => {
        await run(ED_ADMIN, "select public.kk_update_group($1, '{\"capacity\": 1}')", [g.b]);
        expect(await place(run, -1, r[0])).toBe("stale");
        expect(await place(run, g.a, r[5], A)).toBe("forbidden");
        expect(await place(run, otherGroup, r[0])).toBe("not_member");
        expect(await place(run, g.a, rOther)).toBe("bad_trainee"); // another edition's trainee
        expect(await code(run(ED_ADMIN, "select public.kk_place($1, null)", [g.a]))).toBe("bad_trainee");
        expect(await place(run, g.b, r[5])).toBe("is_leader"); // r[5] leads a
        expect(await place(run, g.nobook, r[4])).toBe("is_leader"); // their own group too
        expect(await place(run, g.b, r[0])).toBe("ok");
        expect(await place(run, g.b, r[1])).toBe("ok"); // over capacity: the staff decide
        expect(await place(run, g.nobook, r[2])).toBe("ok"); // no book yet, not on offer: the staff decide
        expect(await signups(run)).toEqual([[g.b, r[0], "staff"], [g.b, r[1], "staff"], [g.nobook, r[2], "staff"]]);
        expect(await place(run, g.a, r[0])).toBe("ok"); // moved to another book: still one this week
        expect(await signups(run)).toEqual([[g.a, r[0], "staff"], [g.b, r[1], "staff"], [g.nobook, r[2], "staff"]]);
        // a link's sign-up placed where it is already: nothing changes, «בקישור» stays
        await open(run);
        await signup(run, r[3], g.a);
        expect(await place(run, g.a, r[3])).toBe("ok");
        expect((await signups(run)).find((x) => x[1] === r[3])).toEqual([g.a, r[3], "link"]);
        // removed by edition and trainee
        expect(await code(run(A, "select public.kk_unplace($1, $2)", [ed, r[1]]))).toBe("forbidden");
        expect(await code(run(ED_ADMIN, "select public.kk_unplace($1, $2)", [other, rOther]))).toBe("not_member");
        expect(await code(run(ED_ADMIN, "select public.kk_unplace(-1, $1)", [r[1]]))).toBe("not_member");
        // this edition's unplace takes nothing of another's: that edition's trainee keeps their sign-up there
        expect(await place(run, otherGroup, rOther, OTHER_ADMIN)).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.kk_unplace($1, $2)", [ed, rOther]))).toBe("ok");
        expect((await run("owner", "select group_id from public.kk_signups where roster_id = $1", [rOther])).rows.map((x) => Number(x.group_id))).toEqual([otherGroup]);
        expect(await code(run(OTHER_ADMIN, "select public.kk_unplace($1, $2)", [other, rOther]))).toBe("ok"); // by its own edition's admin: gone
        expect((await run("owner", "select count(*)::int as n from public.kk_signups where roster_id = $1", [rOther])).rows[0].n).toBe(0);
        expect(await code(run(ED_ADMIN, "select public.kk_delete_group($1)", [g.b]))).toBe("group_has_signups");
        expect(await code(run(ED_ADMIN, "select public.kk_unplace($1, $2)", [ed, r[1]]))).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.kk_unplace($1, $2)", [ed, r[1]]))).toBe("ok"); // none left: nothing
        expect(await code(run(ED_ADMIN, "select public.kk_unplace($1, $2)", [ed, r[5]]))).toBe("ok");
        expect((await signups(run)).map((x) => x[1])).toEqual([r[0], r[2], r[3]]);
        await run(L, "select public.set_book_order($1, 3, false)", [g.b]);
        expect(await code(run(ED_ADMIN, "select public.kk_delete_group($1)", [g.b]))).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.kk_delete_group($1)", [g.b]))).toBe("stale");
        expect(await code(run(A, "select public.kk_delete_group($1)", [g.none]))).toBe("forbidden");
        // its leaders and its order go with a group
        expect(await code(run(ED_ADMIN, "select public.kk_unplace($1, $2)", [ed, r[0]]))).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.kk_unplace($1, $2)", [ed, r[3]]))).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.kk_delete_group($1)", [g.a]))).toBe("ok");
        expect((await run("owner", "select count(*)::int as n from public.kk_leaders where group_id = $1", [g.a])).rows[0].n).toBe(0);
        expect((await run("owner", "select count(*)::int as n from public.book_orders")).rows[0].n).toBe(0);
        // a trainee deleted: their leader row and their sign-up go too
        await run("owner", "delete from public.roster where id in ($1, $2)", [r[4], r[2]]);
        expect(await leaders(run, g.nobook)).toEqual([{ kind: "ein_prat", roster_id: null, label: "מעין פרת לדוגמה" }]);
        expect(await signups(run)).toEqual([]);
        for (const t of ["kk_groups", "kk_leaders", "kk_signups", "book_orders"]) {
          expect(await sqlstate(run(ED_ADMIN, `delete from public.${t}`)), t).toBe("42501");
        }
        expect(await sqlstate(run(ED_ADMIN, "insert into public.kk_signups (edition_id, group_id, roster_id, via) values ($1, $2, $3, 'staff')", [ed, g.none, r[1]]))).toBe("42501");
        expect(await sqlstate(run(ED_ADMIN, "update public.kk_groups set title = 'x'"))).toBe("42501");
        // the group and the trainee of a sign-up are of its edition (the composite keys)
        expect(await sqlstate(run("owner", "insert into public.kk_signups (edition_id, group_id, roster_id, via) values ($1, $2, $3, 'staff')", [ed, otherGroup, r[1]]))).toBe("23503");
        expect(await sqlstate(run("owner", "insert into public.kk_signups (edition_id, group_id, roster_id, via) values ($1, $2, $3, 'staff')", [ed, g.none, rOther]))).toBe("23503");
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

    it("book orders: logistics or an admin, a group with a book, the first «ordered» time kept, null removes the line", async () => {
      await inTx(async (run) => {
        expect(await code(run(L, "select public.set_book_order(-1, 5, false)"))).toBe("stale");
        expect(await code(run(A, "select public.set_book_order($1, 5, false)", [g.a]))).toBe("forbidden");
        expect(await code(run(OTHER_ADMIN, "select public.set_book_order($1, 5, false)", [g.a]))).toBe("not_member");
        expect(await code(run(L, "select public.set_book_order($1, 5, false)", [g.a]))).toBe("ok");
        expect(await code(run(L, "select public.set_book_order($1, 1001, false)", [g.a]))).toBe("bad_value");
        expect(await code(run(L, "select public.set_book_order($1, null, true)", [g.a]))).toBe("bad_value");
        expect(await code(run(L, "select public.set_book_order($1, 5, null)", [g.a]))).toBe("bad_value");
        // no book yet: nothing to order — the cleaning first, and removing a line always may
        expect(await code(run(L, "select public.set_book_order($1, 1001, false)", [g.nobook]))).toBe("bad_value");
        expect(await code(run(L, "select public.set_book_order($1, 5, false)", [g.nobook]))).toBe("no_book");
        expect(await code(run(L, "select public.set_book_order($1, 0, false)", [g.nobook]))).toBe("no_book");
        expect(await code(run(L, "select public.set_book_order($1, null, false)", [g.nobook]))).toBe("ok");
        // the book taken back after an order: the line stays, takes no more copies, and is removable
        await run(L, "select public.set_book_order($1, 2, false)", [g.none]);
        expect(await update(run, g.none, { title: "" })).toBe("ok");
        expect((await run("owner", "select copies from public.book_orders where group_id = $1", [g.none])).rows).toEqual([{ copies: 2 }]);
        expect(await code(run(L, "select public.set_book_order($1, 2, true)", [g.none]))).toBe("no_book");
        expect(await code(run(L, "select public.set_book_order($1, null, false)", [g.none]))).toBe("ok");
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

    it("load_kk: the edition's members read it all, in order; another edition's, nothing", async () => {
      await inTx(async (run) => {
        expect(await place(run, g.a, r[1])).toBe("ok");
        expect(await place(run, g.nobook, r[0])).toBe("ok");
        await run(L, "select public.set_book_order($1, 4, false)", [g.a]);
        const k = (await run(A, "select public.load_kk($1) as k", [ed])).rows[0].k;
        expect(Object.keys(k).sort()).toEqual(["groups", "leaders", "orders", "signups"]);
        expect(k.groups.map((x: { id: number }) => x.id)).toEqual([g.a, g.b, g.none, g.closed, g.nobook]);
        expect(k.groups[0]).toEqual({ id: g.a, title: "ספר לבדיקה א", author: "מחבר/ת לבדיקה", place: "הדשא", capacity: 2, open: true });
        expect(k.groups[4]).toEqual({ id: g.nobook, title: null, author: null, place: null, capacity: 5, open: true });
        expect(k.leaders.map((x: { group_id: number; kind: string }) => [x.group_id, x.kind])).toEqual([[g.a, "trainee"], [g.a, "staff"], [g.nobook, "trainee"], [g.nobook, "ein_prat"]]);
        expect(Object.keys(k.leaders[0]).sort()).toEqual(["group_id", "id", "kind", "label", "roster_id"]);
        expect(k.signups.map((x: object) => Object.keys(x).sort())).toEqual(k.signups.map(() => ["created_at", "group_id", "id", "roster_id", "via"]));
        expect(k.signups.map((x: { group_id: number; roster_id: number; via: string }) => [x.group_id, x.roster_id, x.via])).toEqual([[g.a, r[1], "staff"], [g.nobook, r[0], "staff"]]);
        expect(k.signups[0].created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        expect(k.orders).toEqual([{ group_id: g.a, copies: 4, ordered_at: null }]);
        expect((await run(OTHER_ADMIN, "select public.load_kk($1) as k", [ed])).rows[0].k).toBeNull();
        expect((await run(OTHER_ADMIN, "select id from public.kk_groups where edition_id = $1", [ed])).rows).toEqual([]);
        expect((await run(OTHER_ADMIN, "select id from public.kk_signups where edition_id = $1", [ed])).rows).toEqual([]);
      });
    });
  });

  // Two connections, as two browsers: each anon one from its own address, so each has its own count
  // (app.link_client) and nothing but the edition's kk lock stands between them. The second waits on the lock
  // (seen in pg_locks: the two-key advisory form, objsubid 2) until the first commits, then sees what it wrote.
  describe("at the same moment (two connections)", () => {
    const twoConnections = async (fn: (c1: pg.Client, c2: pg.Client) => Promise<void>) => {
      await commitAs(ED_ADMIN, "select public.kk_set_window($1, now() - interval '1 day', now() + interval '3 days')", [ed]);
      const url = new URL(adminUrl());
      url.pathname = `/${dbName}`;
      const [c1, c2] = [new pg.Client({ connectionString: url.toString() }), new pg.Client({ connectionString: url.toString() })];
      await c1.connect();
      await c2.connect();
      try {
        await fn(c1, c2);
      } finally {
        await c1.end();
        await c2.end();
        // back to the fixture: no sign-ups, no group but its own, its leaders and places as they were
        await db.query("delete from public.kk_signups");
        await db.query("delete from public.kk_groups where edition_id = $1 and not (id = any ($2))", [ed, Object.values(g)]);
        await db.query("delete from public.kk_leaders where group_id = any ($1)", [[g.b, g.none, g.closed]]);
        await db.query("update public.kk_groups set place = null where id = any ($1)", [[g.none, g.closed]]);
        await commitAs(ED_ADMIN, "select public.kk_set_window($1, null, null)", [ed]);
      }
    };
    const asAnon = (c: pg.Client, address: string) =>
      c.query("begin; set local role anon; select set_config('request.jwt.claims', '', true); select set_config('request.headers', $$" + JSON.stringify({ "x-forwarded-for": address }) + "$$, true)");
    const asMember = (c: pg.Client, email: string) =>
      c.query("begin; set local role authenticated; select set_config('request.jwt.claims', $$" + JSON.stringify(google(email)) + "$$, true)");
    /** Resolves once a connection waits on this edition's kk lock. */
    const waiting = async () => {
      for (let i = 0; i < 200; i++) {
        const n = (await db.query(
          `select count(*)::int as n from pg_locks
            where locktype = 'advisory' and objsubid = 2 and objid = $1 and not granted
              and database = (select oid from pg_database where datname = current_database())`,
          [ed],
        )).rows[0].n;
        if (n > 0) return;
        await new Promise((res) => setTimeout(res, 10));
      }
      throw new Error("nobody waited on the edition's kk lock");
    };
    const outcome = (p: Promise<pg.QueryResult>) => p.then((x) => x.rows[0].v ?? "ok", (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : e.code));
    const leadersOf = async (roster: number) => (await db.query("select group_id from public.kk_leaders where roster_id = $1", [roster])).rows.map((x) => Number(x.group_id));
    const signedUp = async (roster: number) => (await db.query("select group_id from public.kk_signups where roster_id = $1", [roster])).rows.map((x) => Number(x.group_id));
    /** An empty group on offer, of its own, for a race that changes or deletes it: the fixture's stay as they are. */
    const raceGroup = () => commitAs(ED_ADMIN, "select public.kk_add_group($1, $2)", [ed, JSON.stringify({ title: "ספר למרוץ", capacity: 3 })]).then(Number);

    it("two trainees at once for the last place: exactly one gets it", async () => {
      await twoConnections(async (c1, c2) => {
        await asAnon(c1, "198.51.100.1");
        await asAnon(c2, "198.51.100.2");
        expect((await c1.query("select public.kk_signup($1, $2, $3) as v", [token, r[0], g.b])).rows[0].v).toEqual({ status: "received" });
        const second = outcome(c2.query("select public.kk_signup($1, $2, $3) as v", [token, r[1], g.b]));
        await waiting();
        await c1.query("commit");
        expect(await second).toEqual({ status: "received" });
        await c2.query("commit");
        expect((await db.query("select roster_id from public.kk_signups where group_id = $1", [g.b])).rows.map((x) => Number(x.roster_id))).toEqual([r[0]]);
      });
    });

    it("one trainee through the link for two books at once: one sign-up for the week", async () => {
      await twoConnections(async (c1, c2) => {
        await asAnon(c1, "198.51.100.4");
        await asAnon(c2, "198.51.100.5");
        await c1.query("select public.kk_signup($1, $2, $3)", [token, r[0], g.a]);
        const second = outcome(c2.query("select public.kk_signup($1, $2, $3) as v", [token, r[0], g.b]));
        await waiting();
        await c1.query("commit");
        expect(await second).toEqual({ status: "received" });
        await c2.query("commit");
        expect(await signedUp(r[0])).toEqual([g.a]);
      });
    });

    it("the staff placing someone in the last place while a trainee signs up through the link: the link waits, then records nothing", async () => {
      await twoConnections(async (c1, c2) => {
        await asMember(c1, ED_ADMIN);
        await c1.query("select public.kk_place($1, $2)", [g.b, r[0]]); // not committed yet
        await asAnon(c2, "198.51.100.3");
        const link = outcome(c2.query("select public.kk_signup($1, $2, $3) as v", [token, r[1], g.b]));
        await waiting();
        await c1.query("commit");
        expect(await link).toEqual({ status: "received" });
        await c2.query("commit");
        expect((await db.query("select roster_id, via from public.kk_signups where group_id = $1", [g.b])).rows.map((x) => [Number(x.roster_id), x.via])).toEqual([[r[0], "staff"]]);
      });
    });

    it("two admins making the same trainee a leader of two groups: one gets leader_elsewhere", async () => {
      await twoConnections(async (c1, c2) => {
        await asMember(c1, ED_ADMIN);
        await c1.query("select public.kk_update_group($1, $2)", [g.b, JSON.stringify({ leaders: [trainee(r[0])] })]);
        await asMember(c2, ADMIN);
        const second = outcome(c2.query("select public.kk_update_group($1, $2)", [g.closed, JSON.stringify({ leaders: [trainee(r[0])] })]));
        await waiting();
        await c1.query("commit");
        expect(await second).toBe("leader_elsewhere");
        await c2.query("rollback");
        expect(await leadersOf(r[0])).toEqual([g.b]);
      });
    });

    it("a new group's leader at once with another group's: one gets leader_elsewhere", async () => {
      await twoConnections(async (c1, c2) => {
        await asMember(c1, ADMIN);
        await c1.query("select public.kk_add_group($1, $2)", [ed, JSON.stringify({ leaders: [trainee(r[1])] })]);
        await asMember(c2, ED_ADMIN);
        const second = outcome(c2.query("select public.kk_update_group($1, $2)", [g.none, JSON.stringify({ leaders: [trainee(r[1])] })]));
        await waiting();
        await c1.query("commit");
        expect(await second).toBe("leader_elsewhere");
        await c2.query("rollback");
        expect(await leadersOf(r[1])).toHaveLength(1);
        expect(await leadersOf(r[1])).not.toContain(g.none);
      });
    });

    it("a trainee made a leader while signing up through the link: the link waits, then records nothing", async () => {
      await twoConnections(async (c1, c2) => {
        await asMember(c1, ED_ADMIN);
        await c1.query("select public.kk_update_group($1, $2)", [g.b, JSON.stringify({ leaders: [trainee(r[2])] })]);
        await asAnon(c2, "198.51.100.6");
        const link = outcome(c2.query("select public.kk_signup($1, $2, $3) as v", [token, r[2], g.a]));
        await waiting();
        await c1.query("commit");
        expect(await link).toEqual({ status: "received" });
        await c2.query("commit");
        expect([await leadersOf(r[2]), await signedUp(r[2])]).toEqual([[g.b], []]); // a leader, never also a participant
      });
    });

    it("a trainee signing up through the link while made a leader: the staff wait, then get leader_signed_up", async () => {
      await twoConnections(async (c1, c2) => {
        await asAnon(c1, "198.51.100.7");
        await c1.query("select public.kk_signup($1, $2, $3)", [token, r[2], g.a]);
        await asMember(c2, ED_ADMIN);
        const staff = outcome(c2.query("select public.kk_update_group($1, $2)", [g.b, JSON.stringify({ leaders: [trainee(r[2])] })]));
        await waiting();
        await c1.query("commit");
        expect(await staff).toBe("leader_signed_up");
        await c2.query("rollback");
        expect([await leadersOf(r[2]), await signedUp(r[2])]).toEqual([[], [g.a]]);
      });
    });

    it("two groups taking the same place at once: one gets place_taken", async () => {
      await twoConnections(async (c1, c2) => {
        await asMember(c1, ED_ADMIN);
        await c1.query("select public.kk_update_group($1, $2)", [g.none, JSON.stringify({ place: "חדר העיון" })]);
        await asMember(c2, ADMIN);
        const second = outcome(c2.query("select public.kk_add_group($1, $2)", [ed, JSON.stringify({ title: "ספר חדש לבדיקה", place: " חדר  העיון " })]));
        await waiting();
        await c1.query("commit");
        expect(await second).toBe("place_taken");
        await c2.query("rollback");
        expect((await db.query("select id from public.kk_groups where place_key = 'חדר העיון'")).rows.map((x) => Number(x.id))).toEqual([g.none]);
      });
    });

    // kk_signup reads the group only under the lock: what it waited on decides, never what it saw before
    it("a group's book cleared, its sign-up closed or the group deleted while a trainee signs up through the link: the link waits, then records nothing", async () => {
      const changes: [string, string][] = [
        ["the book cleared", "select public.kk_update_group($1, '{\"title\": null}')"],
        ["closed", "select public.kk_update_group($1, '{\"open\": false}')"],
        ["deleted", "select public.kk_delete_group($1)"],
      ];
      for (const [i, [change, sql]] of changes.entries()) {
        await twoConnections(async (c1, c2) => {
          const group = await raceGroup();
          await asMember(c1, ED_ADMIN);
          await c1.query(sql, [group]); // not committed yet
          await asAnon(c2, `198.51.100.${8 + i}`);
          const link = outcome(c2.query("select public.kk_signup($1, $2, $3) as v", [token, r[0], group]));
          await waiting();
          await c1.query("commit");
          expect(await link, change).toEqual({ status: "received" }); // the same answer — never a key error for a group gone
          await c2.query("commit");
          expect(await signedUp(r[0]), change).toEqual([]);
        });
      }
    });

    // app.kk_locked_group reads the group again under the lock
    it("a group deleted while another member's command on it waits: stale — never «saved» for a group that is gone, nor a raw key error", async () => {
      const commands: [string, string, unknown[]][] = [
        [ADMIN, "select public.kk_update_group($1, $2)", [JSON.stringify({ capacity: 3 })]],
        [ADMIN, "select public.kk_update_group($1, $2)", [JSON.stringify({ leaders: [trainee(r[0])] })]],
        [ADMIN, "select public.kk_place($1, $2)", [r[0]]],
        [L, "select public.set_book_order($1, 4, false)", []],
      ];
      for (const [who, sql, rest] of commands) {
        await twoConnections(async (c1, c2) => {
          const group = await raceGroup();
          await asMember(c1, ED_ADMIN);
          await c1.query("select public.kk_delete_group($1)", [group]); // not committed yet
          await asMember(c2, who);
          const second = outcome(c2.query(sql, [group, ...rest]));
          await waiting();
          await c1.query("commit");
          expect(await second, `${sql} ${JSON.stringify(rest)}`).toBe("stale");
          await c2.query("rollback");
        });
      }
    });
  });

  // The unique indexes are the backstop of the checks: were two writes ever to pass them together, a place or a
  // trainee leader twice is still refused, with the CONTRACT's code (kk_add_group, kk_update_group,
  // app.kk_write_leaders). The checks are taken out of the way here, inside the test's transaction.
  it("maps a unique violation of the place or of a trainee leader to place_taken / leader_elsewhere", async () => {
    await inTx(async (run) => {
      await run("owner", "create or replace function app.kk_between_groups(p_edition bigint, p_group bigint, p_f jsonb) returns void language plpgsql set search_path = '' as $$ begin end $$");
      expect(await code(run(ED_ADMIN, "select public.kk_add_group($1, $2)", [ed, JSON.stringify({ place: "הדשא" })]))).toBe("place_taken");
      expect(await update(run, g.b, { place: "הַדֶּשֶׁא" })).toBe("place_taken");
      expect(await code(run(ED_ADMIN, "select public.kk_add_group($1, $2)", [ed, JSON.stringify({ leaders: [trainee(r[5])] })]))).toBe("leader_elsewhere");
      expect(await update(run, g.b, { leaders: [trainee(r[5])] })).toBe("leader_elsewhere");
      expect((await run("owner", "select count(*)::int as n from public.kk_groups where edition_id = $1", [ed])).rows[0].n).toBe(5);
    });
  });
});
