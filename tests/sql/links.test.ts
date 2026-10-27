// Links without an account (v9) in the database, as the roles a browser gets:
// who issues, replaces and revokes (an edition's admins only); what a token is
// (128 bits, returned once, only its sha256 kept); the six anon functions —
// every bad, expired, revoked, wrong-scope or rate-limited token, every lesson
// that is not the escort's, refused with the SAME error; the rate limit — an
// escort's link one count, a class link one per caller's address; what the escort's page
// shows and when (the phone from W−7 only, the driver once arranged, never an
// amount, an e-mail, the pickup address or a note — asserted on the JSON's keys
// and text); the ticks; the write-only pickup address; the public schedule.
// מכריכה לכריכה's sign-up link is tests/sql/kk.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SCHEMA, dropDatabase, freshDatabase, google, sqlstate } from "./db";

const ADMIN = "admin@example.org"; // every edition
const ED_ADMIN = "edition.admin@example.org";
const A = "a@example.org"; // content: handles the speakers
const L = "logistics@example.org";
const OTHER_ADMIN = "other.admin@example.org"; // admin of a practice week
const STRANGER = "stranger@example.org";
// Phone-shaped values no scanner takes for an Israeli number, and synthetic words.
const PHONE_1 = "555 0100 11";
const PHONE_2 = "555 0100 22";
const EMAIL_1 = "speaker1@example.org";
const ADDRESS = "כתובת איסוף לבדיקה";
const DRIVER = "נהג/ת לבדיקה";
const SOURCES_NOTE = "הערת מקורות לבדיקה";
const APPROVAL_NOTE = "הערת אישור לבדיקה";

type Run = (who: string, sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

/** The error a call ends in: code, message, detail, hint — to compare two refusals whole. */
interface Refusal {
  code: string;
  message: string;
  detail?: string;
  hint?: string;
}

async function failure(p: Promise<unknown>): Promise<Refusal | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code: string; message: string; detail?: string; hint?: string };
    return { code: err.code, message: err.message, detail: err.detail, hint: err.hint };
  }
}

async function code(p: Promise<unknown>): Promise<string> {
  const f = await failure(p);
  return f === "ok" ? "ok" : f.code === "P0001" ? f.message : f.code;
}

const LINK_INVALID: Refusal = { code: "P0001", message: "link_invalid", detail: undefined, hint: undefined };

/** Every key anywhere in a JSON value. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.add(k), keysOf(x, out));
  return out;
}

const NEVER_KEYS = [
  "pay_amount", "amount", "approval", "approval_note", "approved_by", "paid_at", "email", "pickup_address", "pickup_time", "notes", "secretary_note",
  "sources_note", "presentation_url", "audience", "confirm_sent_at", "needs_reconfirm", "escort_roster_id", "token", "token_hash", "member", "contact",
];

describe("links without an account", () => {
  const dbName = `vw_links_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let other: number;
  const roster: Record<string, number> = {};
  const lesson: Record<string, number> = {};
  const token: Record<string, string> = {};

  /** One transaction, always rolled back: each statement as the owner ('owner'), anon ('anon') or a Google member, under its own savepoint. */
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

  /** The request's headers as PostgREST passes them: an address (as X-Forwarded-For, behind a proxy), headers as given, or none. */
  const from = (run: Run, who: string | null | Record<string, string>) =>
    run("owner", "select set_config('request.headers', $1, true)", [JSON.stringify(who == null ? {} : typeof who === "string" ? { "x-forwarded-for": `${who}, 192.0.2.1` } : who)]);
  const version = async (id: number) => Number((await db.query("select version from public.lessons where id = $1", [id])).rows[0].version);
  const israelDay = "(now() at time zone 'Asia/Jerusalem')::date";

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', null, 510)"));
    other = Number((await db.query("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id")).rows[0].id);
    await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'בית מדרש', true)", [other]);
    await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [other]);
    for (const [email, role, edition] of [[ED_ADMIN, "admin", ed], [A, "content", ed], [L, "logistics", ed], [OTHER_ADMIN, "admin", other]] as const) {
      await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3)", [email, role, edition]);
    }
    for (const [key, name, gender, edition] of [["r1", "חניכה לבדיקה", "f", ed], ["r2", "חניך לבדיקה", "m", ed], ["r3", "חניך/ה שלישי/ת", null, ed], ["ro", "חניך/ה במחזור אחר", null, other]] as const) {
      roster[key] = Number((await db.query("insert into public.roster (edition_id, full_name, gender) values ($1, $2, $3) returning id", [edition, name, gender])).rows[0].id);
    }
    const s: number[] = [];
    for (const [i, title] of [null, "ד״ר", null].entries()) {
      s.push(Number((await db.query("insert into public.speakers (name, title, gender, vetted) values ($1, $2, 'f', 'approved') returning id", [`מרצה לבדיקה ${i + 1}`, title])).rows[0].id));
    }
    await db.query("insert into public.speaker_contacts (speaker_id, phone, email) values ($1, $2, $3)", [s[0], PHONE_1, EMAIL_1]);
    const close = async (email: string, edition: number, speaker: number, day: number, start: number, end: number) => {
      const p = Number(await commitAs(email, "select (public.propose($1, $2, null, $3, $4, $5, null) ->> 'pitch_id')::bigint", [edition, speaker, day, start, end]));
      await commitAs(email, "select public.close_lesson($1)", [p]);
      return Number((await db.query("select lesson_id from public.pitches where id = $1", [p])).rows[0].lesson_id);
    };
    lesson.L1 = await close(A, ed, s[0], 1, 510, 600);
    lesson.L2 = await close(A, ed, s[1], 1, 600, 690);
    lesson.L3 = await close(A, ed, s[2], 2, 510, 600);
    lesson.other = await close(OTHER_ADMIN, other, s[0], 1, 510, 600);
    lesson.draft = Number(await commitAs(A, "select (public.propose($1, $2, null, 3, 510, 600, null) ->> 'lesson_id')::bigint", [ed, s[2]]));
    await commitAs(A, "select public.set_escort($1, $2, $3, false, 'הערה למלווה')", [lesson.L1, await version(lesson.L1), roster.r1]);
    await commitAs(A, "select public.set_escort($1, $2, $3, false)", [lesson.L2, await version(lesson.L2), roster.r1]);
    await commitAs(A, "select public.set_escort($1, $2, $3, true)", [lesson.L3, await version(lesson.L3), roster.r2]);
    await commitAs(OTHER_ADMIN, "select public.set_escort($1, $2, $3, false)", [lesson.other, await version(lesson.other), roster.ro]);
    await commitAs(A, "select public.set_sources($1, $2, 'sheet', 'before', $3, null, true)", [lesson.L1, await version(lesson.L1), SOURCES_NOTE]);
    await commitAs(A, "select public.set_payment($1, $2, 500, 'round_trip')", [lesson.L2, await version(lesson.L2)]);
    await commitAs(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved', $3)", [lesson.L2, await version(lesson.L2), APPROVAL_NOTE]);
    await commitAs(A, "select public.set_transport_details($1, $2, '07:15', $3, $4, true)", [lesson.L2, ADDRESS, DRIVER, PHONE_2]);
    await commitAs(ED_ADMIN, "select public.set_duty_phrases($1, $2)", [ed, JSON.stringify([{ when: "always", text: "ניסוח לדוגמה לכל שיעור" }, { when: "transport", text: "ניסוח לדוגמה להסעה" }])]);
    const issue = async (email: string, edition: number, scope: string, subject: number | null) =>
      ((await commitAs(email, "select public.issue_link($1, $2, $3)", [edition, scope, subject])) as { token: string }).token;
    token.e1 = await issue(ED_ADMIN, ed, "escort", roster.r1);
    token.e2 = await issue(ED_ADMIN, ed, "escort", roster.r2);
    token.k = await issue(ED_ADMIN, ed, "kk_signup", null);
    token.s = await issue(ED_ADMIN, ed, "schedule", null);
    token.o = await issue(OTHER_ADMIN, other, "escort", roster.ro);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  describe("issuing, replacing, revoking", () => {
    it("is an edition admin's alone — not content, logistics, another edition's admin or an outsider", async () => {
      for (const [who, want] of [[A, "forbidden"], [L, "forbidden"], [OTHER_ADMIN, "not_member"], [STRANGER, "not_member"], [ED_ADMIN, "ok"], [ADMIN, "ok"]] as const) {
        await inTx(async (run) => {
          expect(await code(run(who, "select public.issue_link($1, 'schedule')", [ed])), who).toBe(want);
          expect(await code(run(who, "select public.issue_link($1, 'escort', $2)", [ed, roster.r3])), who).toBe(want);
        });
      }
      await inTx(async (run) => {
        const id = Number((await run("owner", "select id from public.share_links where revoked_at is null and scope = 'schedule' and edition_id = $1", [ed])).rows[0].id);
        for (const who of [A, L, OTHER_ADMIN]) expect(await code(run(who, "select public.revoke_link($1)", [id])), who).toMatch(/^(forbidden|not_member)$/);
        expect(await code(run(ED_ADMIN, "select public.revoke_link(-1)"))).toBe("stale");
      });
    });

    it("returns a 128-bit base64url token once; the database keeps only its sha256", async () => {
      await inTx(async (run) => {
        const r = (await run(ED_ADMIN, "select public.issue_link($1, 'escort', $2) as l", [ed, roster.r3])).rows[0].l;
        expect(r.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(Object.keys(r).sort()).toEqual(["expires_at", "link_id", "token"]);
        const row = (await run("owner", "select * from public.share_links where id = $1", [r.link_id])).rows[0];
        expect(row.token_hash.equals((await run("owner", "select extensions.digest($1, 'sha256') as h", [r.token])).rows[0].h)).toBe(true);
        expect(JSON.stringify(row)).not.toContain(r.token);
        expect((await run("owner", "select count(*)::int as n from public.share_links t where t::text like '%' || $1 || '%'", [r.token])).rows[0].n).toBe(0);
      });
    });

    it("names a trainee of the edition for an escort, nobody for the others", async () => {
      await inTx(async (run) => {
        expect(await code(run(ED_ADMIN, "select public.issue_link($1, 'escort', $2)", [ed, roster.ro]))).toBe("bad_escort");
        expect(await code(run(ED_ADMIN, "select public.issue_link($1, 'escort', null)", [ed]))).toBe("bad_escort");
        expect(await code(run(ED_ADMIN, "select public.issue_link($1, 'kk_signup', $2)", [ed, roster.r1]))).toBe("bad_value");
        expect(await code(run(ED_ADMIN, "select public.issue_link($1, 'poster')", [ed]))).toBe("bad_value");
      });
    });

    it("replaces: a new link revokes the subject's live one; revoking refuses the token", async () => {
      await inTx(async (run) => {
        const fresh = (await run(ED_ADMIN, "select public.issue_link($1, 'escort', $2) as l", [ed, roster.r1])).rows[0].l.token;
        expect(await failure(run("anon", "select public.escort_view($1)", [token.e1]))).toEqual(LINK_INVALID);
        expect(await code(run("anon", "select public.escort_view($1)", [fresh]))).toBe("ok");
        expect((await run("owner", "select count(*)::int as n from public.share_links where edition_id = $1 and subject_id = $2 and revoked_at is null", [ed, roster.r1])).rows[0].n).toBe(1);
        const id = Number((await run(ED_ADMIN, "select id from public.share_links where revoked_at is null and subject_id = $1", [roster.r1])).rows[0].id);
        expect(await code(run(ED_ADMIN, "select public.revoke_link($1)", [id]))).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.revoke_link($1)", [id]))).toBe("ok"); // already revoked: nothing
        expect(await failure(run("anon", "select public.escort_view($1)", [fresh]))).toEqual(LINK_INVALID);
      });
    });

    it("are listed to the edition's admins without the hash — nobody else sees a row", async () => {
      await inTx(async (run) => {
        const cols = "id, edition_id, scope, subject_id, created_by, created_at, expires_at, revoked_at";
        expect((await run(ED_ADMIN, `select ${cols} from public.share_links where edition_id = $1`, [ed])).rows.length).toBeGreaterThanOrEqual(4);
        expect(await sqlstate(run(ED_ADMIN, "select token_hash from public.share_links"))).toBe("42501");
        expect(await sqlstate(run(ED_ADMIN, "select * from public.share_links"))).toBe("42501");
        for (const who of [A, L, STRANGER]) expect((await run(who, `select ${cols} from public.share_links`)).rows, who).toEqual([]);
        expect((await run(OTHER_ADMIN, `select edition_id from public.share_links`)).rows.map((r) => Number(r.edition_id))).toEqual([other]);
        expect(await sqlstate(run(ED_ADMIN, "insert into public.share_links (edition_id, scope, token_hash, expires_at) values ($1, 'schedule', '\\x00', now())", [ed]))).toBe("42501");
        expect(await sqlstate(run(ED_ADMIN, "update public.share_links set revoked_at = null"))).toBe("42501");
      });
    });

    it("expire with the week (Friday 00:00 Israel), 30 days after issue while TBD, the sign-up link with its window — and follow the date", async () => {
      await inTx(async (run) => {
        const exp = async (t: string) => (await run("owner", "select expires_at, created_at from public.share_links where token_hash = extensions.digest($1, 'sha256')", [t])).rows[0];
        const tbd = await exp(token.s);
        expect(new Date(tbd.expires_at).getTime() - new Date(tbd.created_at).getTime()).toBe(720 * 3_600_000);
        await run("owner", "update public.editions set start_date = '2027-02-14' where id = $1", [ed]);
        expect(new Date((await exp(token.s)).expires_at).toISOString()).toBe("2027-02-18T22:00:00.000Z"); // 19.2 00:00 in Israel (UTC+2)
        expect(new Date((await exp(token.e1)).expires_at).toISOString()).toBe("2027-02-18T22:00:00.000Z");
        await run("owner", "update public.editions set start_date = '2027-06-13' where id = $1", [ed]);
        expect(new Date((await exp(token.e1)).expires_at).toISOString()).toBe("2027-06-17T21:00:00.000Z"); // summer time: UTC+3
        await run(ED_ADMIN, "select public.kk_set_window($1, '2027-01-01T08:00:00Z', '2027-01-15T20:00:00Z')", [ed]);
        expect(new Date((await exp(token.k)).expires_at).toISOString()).toBe("2027-01-15T20:00:00.000Z");
      });
    });

    it("are refused when the week is over or the window closed (link_past), and in an archived edition", async () => {
      await inTx(async (run) => {
        await run("owner", `update public.editions set start_date = ${israelDay} - 10 where id = $1`, [ed]);
        expect(await code(run(ED_ADMIN, "select public.issue_link($1, 'schedule')", [ed]))).toBe("link_past");
        await run(ED_ADMIN, "select public.kk_set_window($1, now() - interval '3 days', now() - interval '1 day')", [ed]);
        expect(await code(run(ED_ADMIN, "select public.issue_link($1, 'kk_signup')", [ed]))).toBe("link_past");
        await run("owner", "update public.editions set start_date = null, status = 'archived' where id = $1", [ed]);
        expect(await code(run(ADMIN, "select public.issue_link($1, 'schedule')", [ed]))).toBe("archived");
      });
    });

    it("count as a member's history", async () => {
      await inTx(async (run) => {
        expect(await code(run(ADMIN, "delete from public.members where email = $1", [ED_ADMIN]))).toBe("member_has_history");
      });
    });
  });

  describe("the anon functions refuse alike", () => {
    // Each function with a valid token of its own scope, and the arguments to make it succeed.
    const calls: [string, string, (t: string) => unknown[]][] = [
      ["escort_view", "select public.escort_view($1)", (t) => [t]],
      ["escort_tick", "select public.escort_tick($1, $2, 'met', true)", (t) => [t, lesson.L1]],
      ["escort_pickup", "select public.escort_pickup($1, $2, 'כתובת')", (t) => [t, lesson.L2]],
      ["kk_form", "select public.kk_form($1)", (t) => [t]],
      ["kk_signup", "select public.kk_signup($1, $2, -1)", (t) => [t, roster.r1]],
      ["schedule_view", "select public.schedule_view($1)", (t) => [t]],
    ];
    const own = (fn: string) => (fn.startsWith("escort") ? token.e1 : fn.startsWith("kk") ? token.k : token.s);
    const wrong = (fn: string) => (fn.startsWith("escort") ? token.s : fn.startsWith("kk") ? token.e1 : token.k);

    it("answer a valid token", async () => {
      await inTx(async (run) => {
        for (const [fn, sql, args] of calls) expect(await code(run("anon", sql, args(own(fn)))), fn).toBe("ok");
      });
    });

    it("give a garbage, short, missing, wrong-scope, revoked, expired or archived edition's token the very same error", async () => {
      for (const [fn, sql, args] of calls) {
        await inTx(async (run) => {
          const same = async (label: string, t: unknown) => expect(await failure(run("anon", sql, args(t as string))), `${fn}: ${label}`).toEqual(LINK_INVALID);
          await same("garbage", "x".repeat(22));
          await same("a token of another database", "AAAAAAAAAAAAAAAAAAAAAA");
          await same("short", "abc");
          await same("too long", "y".repeat(65));
          await same("missing", null);
          await same("another scope's valid token", wrong(fn));
          await run("owner", "update public.share_links set expires_at = now() - interval '1 minute' where token_hash = extensions.digest($1, 'sha256')", [own(fn)]);
          await same("expired", own(fn));
          await run("owner", "update public.share_links set expires_at = now() + interval '1 day', revoked_at = now() where token_hash = extensions.digest($1, 'sha256')", [own(fn)]);
          await same("revoked", own(fn));
          await run("owner", "update public.share_links set revoked_at = null where token_hash = extensions.digest($1, 'sha256')", [own(fn)]);
          expect(await code(run("anon", sql, args(own(fn)))), fn).toBe("ok");
          await run("owner", "update public.editions set status = 'archived' where id = $1", [ed]);
          await same("an archived edition's", own(fn));
        });
      }
    });

    it("refuse a lesson that is not the escort's — another escort's, another edition's, a draft, none — with the same error", async () => {
      await inTx(async (run) => {
        for (const id of [lesson.L3, lesson.other, lesson.draft, -1, 999999]) {
          expect(await failure(run("anon", "select public.escort_tick($1, $2, 'met', true)", [token.e1, id])), `tick ${id}`).toEqual(LINK_INVALID);
          expect(await failure(run("anon", "select public.escort_pickup($1, $2, 'כתובת')", [token.e1, id])), `pickup ${id}`).toEqual(LINK_INVALID);
        }
        // the other edition's escort, on this edition's lesson
        expect(await failure(run("anon", "select public.escort_tick($1, $2, 'met', true)", [token.o, lesson.L1]))).toEqual(LINK_INVALID);
      });
    });

    it("stop answering a token past its rate limit (60 in 10 minutes for an escort's link) with the same error — and answer again after the window", async () => {
      await inTx(async (run) => {
        for (let i = 0; i < 60; i++) expect(await code(run("anon", "select public.escort_view($1)", [token.e2])), `call ${i + 1}`).toBe("ok");
        expect(await failure(run("anon", "select public.escort_view($1)", [token.e2]))).toEqual(LINK_INVALID);
        expect(await failure(run("anon", "select public.escort_tick($1, $2, 'met', true)", [token.e2, lesson.L3]))).toEqual(LINK_INVALID);
        // another link is counted apart
        expect(await code(run("anon", "select public.escort_view($1)", [token.e1]))).toBe("ok");
        await run("owner", "update public.share_link_hits set window_start = now() - interval '11 minutes' where token_hash = extensions.digest($1, 'sha256')", [token.e2]);
        expect(await code(run("anon", "select public.escort_view($1)", [token.e2]))).toBe("ok");
      });
    });

    it("count an escort's link as one, whatever address the calls come from", async () => {
      await inTx(async (run) => {
        await from(run, "198.51.100.7");
        for (let i = 0; i < 60; i++) await run("anon", "select public.escort_view($1)", [token.e2]);
        await from(run, "203.0.113.9");
        expect(await failure(run("anon", "select public.escort_view($1)", [token.e2]))).toEqual(LINK_INVALID);
      });
    });

    it("count a class link per caller's address — 1200 in 10 minutes each — so one holder using up their count leaves the others in", async () => {
      await inTx(async (run) => {
        const hits = (who: string, n: number) =>
          run("owner", "insert into public.share_link_hits (token_hash, client_hash, window_start, hits) values (extensions.digest($1, 'sha256'), extensions.digest($2, 'sha256'), now(), $3)", [token.s, who, n]);
        await hits("198.51.100.7", 1199);
        await from(run, "198.51.100.7");
        expect(await code(run("anon", "select public.schedule_view($1)", [token.s]))).toBe("ok");
        expect(await failure(run("anon", "select public.schedule_view($1)", [token.s]))).toEqual(LINK_INVALID);
        await from(run, "203.0.113.9"); // someone else holding the same link
        expect(await code(run("anon", "select public.schedule_view($1)", [token.s]))).toBe("ok");
        await from(run, null); // no address reported (not through the API): a count of its own
        expect(await code(run("anon", "select public.schedule_view($1)", [token.s]))).toBe("ok");
        // the address is Cloudflare's cf-connecting-ip, else X-Forwarded-For's first entry
        await from(run, { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9" });
        expect(await failure(run("anon", "select public.schedule_view($1)", [token.s]))).toEqual(LINK_INVALID);
        await from(run, { "x-forwarded-for": " 198.51.100.7 , 10.0.0.1" });
        expect(await failure(run("anon", "select public.schedule_view($1)", [token.s]))).toEqual(LINK_INVALID);
        await run("owner", "select set_config('request.headers', 'not json', true)");
        expect(await code(run("anon", "select public.schedule_view($1)", [token.s]))).toBe("ok");
        // only the hash of an address is kept, and a passed window's counts are cleared by the next call
        const kept = (await run("owner", "select client_hash from public.share_link_hits where token_hash = extensions.digest($1, 'sha256')", [token.s])).rows;
        expect(kept.every((r) => r.client_hash.length === 32)).toBe(true);
        expect(JSON.stringify(kept)).not.toContain("198.51.100.7");
        await run("owner", "update public.share_link_hits set window_start = now() - interval '11 minutes' where token_hash = extensions.digest($1, 'sha256')", [token.s]);
        await from(run, "192.0.2.50");
        expect(await code(run("anon", "select public.schedule_view($1)", [token.s]))).toBe("ok");
        expect((await run("owner", "select count(*)::int as n from public.share_link_hits where token_hash = extensions.digest($1, 'sha256')", [token.s])).rows[0].n).toBe(1);
      });
    });

    // The review's attack (anon-attack, «DoS: one holder of the class's kk link burns its 600-call budget…»): the
    // class link was one count for everyone, so one holder's loop of cheap reads closed the sign-up — and the
    // schedule — for the whole class, and the page sent them to ask for a new link. Now each address has its own.
    it("ATTACK, closed: one holder's loop through the class's links does not lock the class out", async () => {
      await inTx(async (run) => {
        await run(ED_ADMIN, "select public.kk_set_window($1, now() - interval '1 day', now() + interval '3 days')", [ed]);
        const group = Number(await run(ED_ADMIN, "select public.kk_add_group($1, '{\"title\": \"ספר לבדיקה\", \"capacity\": 5}') as id", [ed]).then((x) => x.rows[0].id));
        await from(run, "198.51.100.66"); // the attacker
        for (let i = 0; i < 1200; i++) await run("anon", "select public.kk_form($1)", [token.k]);
        expect(await failure(run("anon", "select public.kk_form($1)", [token.k]))).toEqual(LINK_INVALID); // their own count is used up
        for (let i = 0; i < 1200; i++) await run("anon", "select public.schedule_view($1)", [token.s]);
        await from(run, "203.0.113.20"); // a trainee
        expect(await code(run("anon", "select public.kk_form($1)", [token.k]))).toBe("ok");
        expect((await run("anon", "select public.kk_signup($1, $2, $3) as v", [token.k, roster.r2, group])).rows[0].v).toEqual({ status: "received" });
        expect((await run("owner", "select roster_id from public.kk_signups where group_id = $1", [group])).rows.map((x) => Number(x.roster_id))).toEqual([roster.r2]);
        expect(await code(run("anon", "select public.schedule_view($1)", [token.s]))).toBe("ok");
      });
    }, 120_000);

    it("are anon's alone among the API roles, and anon reaches nothing else", async () => {
      await inTx(async (run) => {
        expect(await sqlstate(run(A, "select public.escort_view($1)", [token.e1]))).toBe("42501");
        expect(await sqlstate(run("anon", "select public.load_week($1)", [ed]))).toBe("42501");
        expect(await sqlstate(run("anon", "select public.issue_link($1, 'schedule')", [ed]))).toBe("42501");
        expect(await sqlstate(run("anon", "select * from public.share_links"))).toBe("42501");
        expect(await sqlstate(run("anon", "select * from public.transport_details"))).toBe("42501");
      });
    });
  });

  describe("the escort's page", () => {
    const view = (run: Run, t = token.e1) => run("anon", "select public.escort_view($1) as v", [t]).then((r) => r.rows[0].v);

    it("shows that trainee's closed lessons only, in grid order, with exactly these keys", async () => {
      await inTx(async (run) => {
        const v = await view(run);
        expect(Object.keys(v).sort()).toEqual(["edition", "escort", "lessons", "phones_from"]);
        expect(v.escort).toEqual({ full_name: "חניכה לבדיקה", gender: "f" });
        expect(v.lessons.map((l: { lesson_id: number }) => l.lesson_id)).toEqual([lesson.L1, lesson.L2]);
        for (const l of v.lessons) {
          expect(Object.keys(l).sort()).toEqual([
            "date", "day", "driver", "duty_notes", "end_min", "escort_note", "kind", "lesson_id", "phone", "room", "self_intro", "speaker", "start_min", "ticks", "title", "transport",
          ]);
        }
        expect(v.lessons[0]).toMatchObject({ day: 1, date: null, start_min: 510, end_min: 585, room: "בית מדרש", escort_note: "הערה למלווה", self_intro: false });
        expect(v.lessons[1].speaker).toEqual({ name: "ד״ר מרצה לבדיקה 2", gender: "f" });
        const v2 = await view(run, token.e2);
        expect(v2.lessons.map((l: { lesson_id: number }) => l.lesson_id)).toEqual([lesson.L3]);
      });
    });

    it("never carries an amount, an approval, an e-mail, the pickup address or a note — not as a key, not as a value", async () => {
      await inTx(async (run) => {
        await run("owner", `update public.editions set start_date = ${israelDay} + 3 where id = $1`, [ed]); // phones shown: the most it ever shows
        for (const t of [token.e1, token.e2]) {
          const v = await view(run, t);
          const keys = keysOf(v);
          for (const k of NEVER_KEYS) expect(keys.has(k), k).toBe(false);
          const text = JSON.stringify(v);
          for (const s of [EMAIL_1, ADDRESS, SOURCES_NOTE, APPROVAL_NOTE, "500", "round_trip", "approved", "pending"]) expect(text, s).not.toContain(s);
        }
      });
    });

    it("composes the duty notes by the rule of src/domain/escorts.ts", async () => {
      await inTx(async (run) => {
        const v = await view(run);
        expect(v.lessons.map((l: { duty_notes: string[] }) => l.duty_notes)).toEqual([["ניסוח לדוגמה לכל שיעור"], ["ניסוח לדוגמה לכל שיעור", "ניסוח לדוגמה להסעה"]]);
      });
    });

    it("shows the speaker's phone only from W−7 (Israel time), only where the lead speaker has one, never while the date is TBD", async () => {
      await inTx(async (run) => {
        const phones = async () => (await view(run)).lessons.map((l: { phone: string | null }) => l.phone);
        expect(await phones()).toEqual([null, null]); // TBD
        expect((await view(run)).phones_from).toBeNull();
        await run("owner", `update public.editions set start_date = ${israelDay} + 8 where id = $1`, [ed]);
        expect(await phones()).toEqual([null, null]); // W−8: not yet
        const from = (await run("owner", `select (${israelDay} + 1)::text as d`)).rows[0].d;
        expect((await view(run)).phones_from).toBe(from);
        await run("owner", `update public.editions set start_date = ${israelDay} + 7 where id = $1`, [ed]);
        expect(await phones()).toEqual([PHONE_1, null]); // W−7: the lead speaker of L1 has a phone, L2's has none
        await run("owner", `update public.editions set start_date = ${israelDay} - 2 where id = $1`, [ed]);
        expect(await phones()).toEqual([PHONE_1, null]); // during the week
      });
    });

    it("never shows a phone in a practice week, whatever the date", async () => {
      await inTx(async (run) => {
        await run("owner", `update public.editions set start_date = ${israelDay} + 3 where id = $1`, [other]);
        const v = await view(run, token.o);
        expect(v.lessons.map((l: { phone: string | null }) => l.phone)).toEqual([null]);
        expect(v.phones_from).toBeNull();
      });
    });

    it("shows the driver once the transport is approved and arranged — and says transport only then", async () => {
      await inTx(async (run) => {
        const l2 = async () => (await view(run)).lessons[1];
        expect((await l2()).driver).toEqual({ name: DRIVER, phone: PHONE_2 });
        expect((await l2()).transport).toBe(true);
        expect((await view(run)).lessons[0]).toMatchObject({ driver: null, transport: false });
        await run("owner", "update public.transport_details set arranged = false where lesson_id = $1", [lesson.L2]);
        expect((await l2()).driver).toBeNull();
        await run("owner", "update public.transport_details set arranged = true where lesson_id = $1", [lesson.L2]);
        await run("owner", "update public.lessons set approval = 'pending' where id = $1", [lesson.L2]);
        expect(await l2()).toMatchObject({ driver: null, transport: false });
      });
    });

    it("ticks: on keeps the first time, off clears; the escort and the team see them; a new escort starts clean", async () => {
      await inTx(async (run) => {
        const t1 = (await run("anon", "select public.escort_tick($1, $2, 'met', true) as t", [token.e1, lesson.L1])).rows[0].t;
        expect(Object.keys(t1).sort()).toEqual(["gift", "introduced", "met", "reminded"]);
        expect(t1.met).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        const t2 = (await run("anon", "select public.escort_tick($1, $2, 'met', true) as t", [token.e1, lesson.L1])).rows[0].t;
        expect(t2.met).toBe(t1.met);
        await run("anon", "select public.escort_tick($1, $2, 'gift', true)", [token.e1, lesson.L1]);
        await run("anon", "select public.escort_tick($1, $2, 'gift', false)", [token.e1, lesson.L1]);
        expect((await view(run)).lessons[0].ticks).toEqual({ reminded: null, met: t1.met, introduced: null, gift: null });
        expect(await code(run("anon", "select public.escort_tick($1, $2, 'hug', true)", [token.e1, lesson.L1]))).toBe("bad_value");
        expect(await code(run("anon", "select public.escort_tick($1, $2, 'met', null)", [token.e1, lesson.L1]))).toBe("bad_value");
        // the team: in load_week, for whoever sees the edition
        const w = (await run(L, "select public.load_week($1) as w", [ed])).rows[0].w;
        expect(w.escortTicks).toEqual([{ lesson_id: lesson.L1, item: "met", at: t1.met }]);
        expect((await run(OTHER_ADMIN, "select lesson_id from public.escort_ticks")).rows).toEqual([]);
        expect(await sqlstate(run(A, "insert into public.escort_ticks (lesson_id, item) values ($1, 'gift')", [lesson.L1]))).toBe("42501");
        // another escort: the last one's ticks go
        const v = Number((await run("owner", "select version from public.lessons where id = $1", [lesson.L1])).rows[0].version);
        await run(A, "select public.set_escort($1, $2, $3, false)", [lesson.L1, v, roster.r3]);
        expect((await run("owner", "select count(*)::int as n from public.escort_ticks where lesson_id = $1", [lesson.L1])).rows[0].n).toBe(0);
        expect(await failure(run("anon", "select public.escort_tick($1, $2, 'met', true)", [token.e1, lesson.L1]))).toEqual(LINK_INVALID);
      });
    });

    it("lose their ticks when the lesson is reopened or the trainee deleted", async () => {
      await inTx(async (run) => {
        await run("anon", "select public.escort_tick($1, $2, 'reminded', true)", [token.e2, lesson.L3]);
        await run(ADMIN, "select public.reopen_lesson($1)", [lesson.L3]);
        expect((await run("owner", "select count(*)::int as n from public.escort_ticks")).rows[0].n).toBe(0);
      });
      await inTx(async (run) => {
        await run("anon", "select public.escort_tick($1, $2, 'reminded', true)", [token.e2, lesson.L3]);
        await run(ED_ADMIN, "delete from public.roster where id = $1", [roster.r2]);
        expect((await run("owner", "select count(*)::int as n from public.escort_ticks")).rows[0].n).toBe(0);
        // the trainee's link went with them
        expect((await run("owner", "select count(*)::int as n from public.share_links where subject_id = $1", [roster.r2])).rows[0].n).toBe(0);
        expect(await failure(run("anon", "select public.escort_view($1)", [token.e2]))).toEqual(LINK_INVALID);
      });
    });

    it("writes the pickup address and never reads it back; only where transport was approved; the log names the field, never the value", async () => {
      await inTx(async (run) => {
        const r = await run("anon", "select public.escort_pickup($1, $2, '  רחוב לדוגמה  1 ') as v", [token.e1, lesson.L2]);
        expect(r.fields[0].dataTypeID).toBe(2278); // void: nothing comes back
        expect(r.rows[0].v).toBe("");
        const t = (await run("owner", "select * from public.transport_details where lesson_id = $1", [lesson.L2])).rows[0];
        expect(t).toMatchObject({ pickup_address: "רחוב לדוגמה 1", driver_name: DRIVER, driver_phone: PHONE_2, arranged: true });
        expect(JSON.stringify(await view(run))).not.toContain("רחוב לדוגמה");
        const log = (await run("owner", "select actor, detail from public.activity where entity = 'lessons' and entity_id = $1 and kind = 'transport' order by id desc limit 1", [lesson.L2])).rows[0];
        expect(log).toEqual({ actor: null, detail: { fields: ["pickup_address"], via: "escort_link" } });
        expect(await code(run("anon", "select public.escort_pickup($1, $2, 'כתובת')", [token.e1, lesson.L1]))).toBe("no_transport");
        expect(await code(run("anon", "select public.escort_pickup($1, $2, '   ')", [token.e1, lesson.L2]))).toBe("bad_value");
        expect(await code(run("anon", "select public.escort_pickup($1, $2, $3)", [token.e1, lesson.L2, "א".repeat(201)]))).toBe("bad_value");
      });
    });
  });

  describe("the schedule link", () => {
    it("shows closed lessons and memorial slots only — no draft, no contact, no amount, no note", async () => {
      await inTx(async (run) => {
        await run("owner", "insert into public.lessons (edition_id, kind, day, start_min, end_min, room_id, title) select $1, 'memorial', 0, 780, 795, id, null from public.rooms where edition_id = $1 and is_default", [ed]);
        await run("owner", `update public.editions set start_date = ${israelDay} + 3 where id = $1`, [ed]);
        const v = (await run("anon", "select public.schedule_view($1) as v", [token.s])).rows[0].v;
        expect(Object.keys(v).sort()).toEqual(["edition", "rows"]);
        expect(v.rows.map((r: { kind: string; day: number; start_min: number }) => [r.kind, r.day, r.start_min])).toEqual([
          ["memorial", 0, 780], ["lesson", 1, 510], ["lesson", 1, 600], ["lesson", 2, 510],
        ]);
        for (const r of v.rows) expect(Object.keys(r).sort()).toEqual(["category", "date", "day", "end_min", "kind", "parallel", "room", "speaker", "start_min", "title"]);
        expect(v.rows[2]).toMatchObject({ speaker: "ד״ר מרצה לבדיקה 2", end_min: 675, parallel: false, category: "" });
        const keys = keysOf(v);
        for (const k of NEVER_KEYS) expect(keys.has(k), k).toBe(false);
        const text = JSON.stringify(v);
        for (const s of [PHONE_1, PHONE_2, EMAIL_1, ADDRESS, DRIVER, SOURCES_NOTE, APPROVAL_NOTE, "הערה למלווה", "500"]) expect(text, s).not.toContain(s);
      });
    });
  });
});
