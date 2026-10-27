// After the week (v12) in the database, as the roles a browser gets: «איך עבר» —
// who writes (the handler, an admin; never logistics), when (the handler once the
// lesson's day has passed in Israel time, never while the date is TBD; an admin
// always; an archive its admins only), who reads (the edition's admins and
// content — never logistics, a link, load_week), and across the years (the
// speaker sheet: a live real edition's admins and content, or a global admin;
// past years and that edition only — never a practice week); the summary's
// returning speakers; purge_edition_private (a global admin, after the week or
// in an archive, the label typed; what it deletes and what it keeps; the anon
// functions refuse its links; idempotent; logged with counts only); and the move
// to next year — start_edition's deactivation option and its dry run, which
// writes nothing. (What each command refuses, in order, is tests/parity: the
// engine and the SQL held to one contract.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { reviewOpensOn } from "../../src/domain/reviews";
import { WEEK_KEYS } from "../../src/offline/snapshot";
import { SCHEMA, dropDatabase, freshDatabase, google } from "./db";

const ADMIN = "admin@example.org"; // every edition
const ED_ADMIN = "edition.admin@example.org";
const A = "a@example.org"; // content; handles the speakers below
const B = "b@example.org"; // content
const L = "logistics@example.org";
const OTHER = "other@example.org"; // content in another live real edition
const PRACTICE = "practice@example.org"; // content in a practice week only
const OLD = "old@example.org"; // content in last year's (archived) edition only
const OLD_ADMIN = "old.admin@example.org"; // last year's edition's admin
const STRANGER = "stranger@example.org";
// Synthetic: no scanner takes these for a real phone or address.
const ADDRESS = "כתובת איסוף לבדיקה";
const DRIVER = "נהג/ת לבדיקה";
const PHONE = "555 0100 44";
const WENT_WELL = "השיעור היה ברור והחניכים השתתפו";
const ISSUES = "התחיל באיחור קטן";
const OLD_TEXT = "עבר טוב בשנה הקודמת";
const PRACTICE_TEXT = "נכתב בתרגול בלבד";

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

describe("after the week", () => {
  const dbName = `vw_after_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let old: number;
  let practice: number;
  let other: number;
  const lesson: Record<string, number> = {};
  const speaker: Record<string, number> = {};
  const token: Record<string, string> = {};
  let trainee: number;

  /** One transaction, always rolled back: each statement as the owner, anon (with a caller's address) or a Google member, under its own savepoint. */
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
            await db.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-forwarded-for": "198.51.100.7" })]);
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
        } finally {
          await db.query("reset role");
        }
      };
      return await fn(run);
    } finally {
      await db.query("rollback");
      await db.query("reset role");
    }
  }
  const val = async (run: Run, who: string, sql: string, params: unknown[] = []) => Object.values((await run(who, sql, params)).rows[0] ?? {})[0];

  async function commitAs(who: string, sql: string, params: unknown[] = []): Promise<unknown> {
    await db.query("begin");
    try {
      if (who === "anon") {
        await db.query("set local role anon");
        await db.query("select set_config('request.jwt.claims', '', true)");
        await db.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-forwarded-for": "198.51.100.7" })]);
      } else {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(who))]);
      }
      const r = await db.query(sql, params);
      await db.query("commit");
      return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
  const owner = async (sql: string, params: unknown[] = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
  const lessonVersion = async (id: number) => Number(await owner("select version from public.lessons where id = $1", [id]));
  /** The week opened `days` ago, in Israel (negative: still ahead); null: TBD. */
  const opened = (run: Run, days: number | null) =>
    run("owner", "update public.editions set start_date = case when $2::int is null then null else (now() at time zone 'Asia/Jerusalem')::date - $2::int end where id = $1", [ed, days]);
  const save = (run: Run, who: string, l: number, version: number, fields: { ww?: string | null; is?: string | null; ia?: string | null; ov?: boolean | null; r?: number | null } = {}) =>
    code(run(who, "select public.save_lesson_review($1, $2, $3, $4, $5, $6, $7)", [l, version, fields.ww ?? null, fields.is ?? null, fields.ia ?? null, fields.ov ?? null, fields.r ?? null]));
  /** A closed lesson written straight into a past edition (the owner, as an import would). */
  async function pastLesson(edition: number, speakerId: number, title: string): Promise<number> {
    const room = Number(await owner("select id from public.rooms where edition_id = $1 and is_default", [edition]));
    const id = Number(await owner("insert into public.lessons (edition_id, state, day, start_min, end_min, room_id, title) values ($1, 'closed', 0, 510, 600, $2, $3) returning id", [edition, room, title]));
    await db.query("insert into public.lesson_speakers (lesson_id, speaker_id, role) values ($1, $2, 'lead')", [id, speakerId]);
    return id;
  }
  async function closedLesson(who: string, edition: number, speakerId: number, day: number, start: number, end: number): Promise<number> {
    const p = Number(await commitAs(who, "select (public.propose($1, $2, null, $3, $4, $5, null) ->> 'pitch_id')::bigint", [edition, speakerId, day, start, end]));
    await commitAs(who, "select public.close_lesson($1)", [p]);
    return Number(await owner("select lesson_id from public.pitches where id = $1", [p]));
  }

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', null, 510)"));
    old = Number(await owner("insert into public.editions (label, kind, status, start_date) values ('שנה קודמת', 'real', 'archived', '2026-02-15') returning id"));
    practice = Number(await owner("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id"));
    other = Number(await owner("insert into public.editions (label, kind) values ('מחזור אחר', 'real') returning id"));
    for (const e of [old, practice, other]) {
      await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'בית מדרש', true)", [e]);
      await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [e]);
    }
    for (const [email, role, edition] of [
      [ED_ADMIN, "admin", ed], [A, "content", ed], [B, "content", ed], [L, "logistics", ed], [OTHER, "content", other],
      [PRACTICE, "content", practice], [OLD, "content", old], [OLD_ADMIN, "admin", old],
    ] as const) {
      await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3)", [email, role, edition]);
    }
    for (const [k, g] of [["s1", "f"], ["s2", "m"], ["s3", "f"], ["s4", "m"], ["s5", "f"]] as const) {
      speaker[k] = Number(await owner("insert into public.speakers (name, gender, vetted) values ($1, $2, 'approved') returning id", [`מרצה לבדיקה ${k}`, g]));
    }
    await db.query("insert into public.speaker_contacts (speaker_id, phone) values ($1, $2)", [speaker.s1, PHONE]);
    const fallen = Number(await owner("insert into public.fallen (name) values ('חלל/ה לבדיקה') returning id"));
    await db.query("insert into public.fallen_contacts (fallen_id, contact_name, phone) values ($1, 'איש/אשת קשר לבדיקה', $2)", [fallen, PHONE]);
    trainee = Number(await owner("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה לבדיקה') returning id", [ed]));

    // this year: A handles s1 (Monday 08:30), s2 (Wednesday 14:30), s3 (the night after Monday, 00:30); s4 is only proposed
    lesson.mon = await closedLesson(A, ed, speaker.s1, 1, 510, 600);
    lesson.wed = await closedLesson(A, ed, speaker.s2, 3, 870, 960);
    lesson.night = await closedLesson(A, ed, speaker.s3, 1, 1470, 1560);
    await commitAs(A, "select public.propose($1, $2, null, 2, 510, 600, null)", [ed, speaker.s4]);
    lesson.draft = Number(await owner("select id from public.lessons where edition_id = $1 and day = 2 and start_min = 510", [ed]));
    lesson.slot = Number(await commitAs(ED_ADMIN, "select public.add_memorial_slot($1, 0, 780, 795, null)", [ed]));
    // its transport, approved and arranged; its escort; the edition's links and a tick through one
    await commitAs(A, "select public.set_payment($1, $2, null, 'round_trip')", [lesson.mon, await lessonVersion(lesson.mon)]);
    await commitAs(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson.mon, await lessonVersion(lesson.mon)]);
    await commitAs(A, "select public.set_transport_details($1, $2, '07:15', $3, $4, true)", [lesson.mon, ADDRESS, DRIVER, PHONE]);
    await commitAs(A, "select public.set_escort($1, $2, $3, false, null)", [lesson.mon, await lessonVersion(lesson.mon), trainee]);
    for (const [name, scope, subject] of [["schedule", "schedule", null], ["kk", "kk_signup", null], ["escort", "escort", trainee]] as const) {
      token[name] = String(((await commitAs(ED_ADMIN, "select public.issue_link($1, $2, $3)", [ed, scope, subject])) as { token: string }).token);
    }
    await commitAs("anon", "select public.kk_form($1)", [token.kk]);
    await commitAs("anon", "select public.escort_tick($1, $2, 'met', true)", [token.escort, lesson.mon]);
    const group = Number(await commitAs(ED_ADMIN, "select public.kk_add_group($1, '{\"title\": \"ספר לבדיקה\", \"capacity\": 5}')", [ed]));
    await commitAs(ED_ADMIN, "select public.kk_place($1, $2)", [group, trainee]);
    // another live real edition: a transport and a link of its own (a purge of ed never touches them)
    lesson.other = await closedLesson(OTHER, other, speaker.s5, 1, 510, 600);
    await commitAs(OTHER, "select public.set_payment($1, $2, null, 'one_way')", [lesson.other, await lessonVersion(lesson.other)]);
    await commitAs(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [lesson.other, await lessonVersion(lesson.other)]);
    await commitAs(OTHER, "select public.set_transport_details($1, $2, null, null, null, false)", [lesson.other, ADDRESS]);
    await commitAs(ADMIN, "select public.issue_link($1, 'schedule')", [other]);
    // last year's review of s1 (archived), and a practice week's (never read across the years)
    lesson.old = await pastLesson(old, speaker.s1, "שיעור בשנה הקודמת");
    await db.query("insert into public.lesson_reviews (lesson_id, edition_id, speaker_id, went_well, invite_again, rating) values ($1, $2, $3, $4, 'yes', 5)", [lesson.old, old, speaker.s1, OLD_TEXT]);
    lesson.practice = await pastLesson(practice, speaker.s1, "שיעור בתרגול");
    await db.query("insert into public.lesson_reviews (lesson_id, edition_id, speaker_id, went_well, invite_again) values ($1, $2, $3, $4, 'no')", [lesson.practice, practice, speaker.s1, PRACTICE_TEXT]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  it("exposes the v12 functions with the parameter names the ports send (src/data/supabaseReviews.ts, supabaseSettings.ts)", async () => {
    const sig = async (fn: string) =>
      (await db.query("select pg_get_function_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows.map((r) => r.a);
    expect(await sig("save_lesson_review")).toEqual(["p_lesson bigint, p_version integer, p_went_well text, p_issues text, p_invite_again text, p_overran boolean, p_rating integer"]);
    expect(await sig("load_reviews")).toEqual(["p_edition bigint"]);
    expect(await sig("speaker_reviews")).toEqual(["p_speaker bigint"]);
    expect(await sig("edition_returning")).toEqual(["p_edition bigint"]);
    expect(await sig("purge_edition_private")).toEqual(["p_edition bigint, p_confirm text"]);
    expect(await sig("start_edition_preview")).toEqual(["p_deactivate_team boolean DEFAULT true"]);
    expect(await sig("start_edition")).toEqual([
      "p_label text, p_start_date date, p_first_day_from integer DEFAULT NULL::integer, p_room text DEFAULT 'בית מדרש'::text, p_deactivate_team boolean DEFAULT false",
    ]);
  });

  describe("«איך עבר»: who writes", () => {
    it("the handler and the edition's admins — not another content member, logistics or anyone outside the edition", async () => {
      await inTx(async (run) => {
        await opened(run, 10);
        expect(await save(run, A, lesson.mon, 0, { ww: WENT_WELL, ia: "yes", r: 4 })).toBe("ok");
        expect(Number(await val(run, "owner", "select version from public.lesson_reviews where lesson_id = $1", [lesson.mon]))).toBe(1);
        for (const [who, c] of [[B, "not_handler"], [L, "forbidden"], [OTHER, "not_member"], [PRACTICE, "not_member"], [OLD, "not_member"], [STRANGER, "not_member"]] as const) {
          expect(await save(run, who, lesson.mon, 1, { ww: "x" }), who).toBe(c);
        }
        expect(await save(run, ED_ADMIN, lesson.mon, 1, { ww: WENT_WELL, is: ISSUES, ia: "maybe", ov: true, r: 3 })).toBe("ok");
        expect(await save(run, ADMIN, lesson.wed, 0, { ia: "no" })).toBe("ok");
        const r = (await run("owner", "select lesson_id, edition_id, speaker_id, went_well, issues, invite_again, overran, rating, written_by, version from public.lesson_reviews where lesson_id = $1", [lesson.mon])).rows[0];
        const edAdminId = Number(await val(run, "owner", "select id from public.members where email = $1", [ED_ADMIN]));
        expect({ ...r, lesson_id: Number(r.lesson_id), edition_id: Number(r.edition_id), speaker_id: Number(r.speaker_id), written_by: Number(r.written_by) }).toEqual({
          lesson_id: lesson.mon, edition_id: ed, speaker_id: speaker.s1, went_well: WENT_WELL, issues: ISSUES, invite_again: "maybe", overran: true, rating: 3, written_by: edAdminId, version: 2,
        });
      });
    });

    it("refuses a stale version, nothing at all, a bad answer, a rating outside 1–5, a text over 2000 — and the same answers again change nothing", async () => {
      await inTx(async (run) => {
        await opened(run, 10);
        expect(await save(run, A, lesson.mon, 0, { ww: WENT_WELL })).toBe("ok");
        expect(await save(run, A, lesson.mon, 0, { ww: "שוב" })).toBe("stale");
        expect(await save(run, A, lesson.mon, 2, { ww: "שוב" })).toBe("stale");
        expect(await save(run, A, lesson.mon, 1, { ww: "  ", is: "", ov: false })).toBe("review_empty");
        expect(await save(run, A, lesson.mon, 1, { ia: "always" })).toBe("bad_value");
        expect(await save(run, A, lesson.mon, 1, { r: 6 })).toBe("bad_value");
        expect(await save(run, A, lesson.mon, 1, { r: 0 })).toBe("bad_value");
        expect(await save(run, A, lesson.mon, 1, { ww: "א".repeat(2001) })).toBe("bad_value");
        expect(await save(run, A, lesson.mon, 1, { ww: `  ${WENT_WELL}  ` })).toBe("ok");
        expect(Number(await val(run, "owner", "select version from public.lesson_reviews where lesson_id = $1", [lesson.mon]))).toBe(1);
        expect(await save(run, A, lesson.mon, 1, { ov: true })).toBe("ok"); // an overrun alone is a review
        expect(Number(await val(run, "owner", "select version from public.lesson_reviews where lesson_id = $1", [lesson.mon]))).toBe(2);
      });
    });

    it("only for a closed lesson: never a draft or a memorial slot", async () => {
      await inTx(async (run) => {
        await opened(run, 10);
        expect(await save(run, ED_ADMIN, lesson.draft, 0, { ww: "x" })).toBe("not_closed");
        expect(await save(run, ED_ADMIN, lesson.slot, 0, { ww: "x" })).toBe("not_closed");
        expect(await save(run, ED_ADMIN, 999999, 0, { ww: "x" })).toBe("stale");
      });
    });

    it("never by a direct write, by anyone", async () => {
      await inTx(async (run) => {
        for (const who of [A, ED_ADMIN, ADMIN]) {
          expect(await code(run(who, "insert into public.lesson_reviews (lesson_id, edition_id, went_well) values ($1, $2, 'x')", [lesson.mon, ed])), who).toBe("42501");
        }
        await opened(run, 10);
        await save(run, A, lesson.mon, 0, { ww: WENT_WELL });
        for (const who of [A, ED_ADMIN, ADMIN]) {
          expect(await code(run(who, "update public.lesson_reviews set rating = 1")), who).toBe("42501");
          expect(await code(run(who, "delete from public.lesson_reviews")), who).toBe("42501");
        }
      });
    });
  });

  describe("app.review_opens_on ≡ reviewOpensOn (src/domain/reviews.ts)", () => {
    it("on every slot of the grid — 22:30–24:00 and the night rows among them — and at the edges, across a month's and a year's end", async () => {
      const ends = (await db.query("select distinct end_min from public.grid_template order by 1")).rows.map((r) => Number(r.end_min));
      expect(ends).toContain(1440); // the 22:30–24:00 lesson row: opens the next day, as the panel says
      const diffs: string[] = [];
      for (const start of ["2027-02-14", "2027-02-28", "2026-12-28"]) {
        for (let day = 0; day <= 4; day++) {
          for (const end of [...ends, 1439, 1440, 1441, 2880]) {
            const sql = (await db.query("select app.review_opens_on($1::date, $2, $3)::text as d", [start, day, end])).rows[0].d;
            const ts = reviewOpensOn(start, day, end);
            if (sql !== ts) diffs.push(`${start} d${day} end${end}: sql=${sql} ts=${ts}`);
          }
        }
      }
      expect(diffs).toEqual([]);
    });
  });

  describe("«איך עבר»: when — the handler once the lesson's day has passed in Israel; an admin always", () => {
    it("a Monday lesson opens on Tuesday, Israel time — not on Monday", async () => {
      await inTx(async (run) => {
        await opened(run, 0); // the week opened today: Monday is tomorrow
        expect(await save(run, A, lesson.mon, 0, { ww: "x" })).toBe("review_closed");
        await opened(run, 1); // Monday is today
        expect(await save(run, A, lesson.mon, 0, { ww: "x" })).toBe("review_closed");
        await opened(run, 2); // Monday was yesterday
        expect(await save(run, A, lesson.mon, 0, { ww: "x" })).toBe("ok");
      });
    });

    it("a night lesson in Monday's column (00:30) ends on Tuesday, and opens on Wednesday", async () => {
      await inTx(async (run) => {
        await opened(run, 2);
        expect(await save(run, A, lesson.night, 0, { ww: "x" })).toBe("review_closed");
        await opened(run, 3);
        expect(await save(run, A, lesson.night, 0, { ww: "x" })).toBe("ok");
      });
    });

    it("while the week's date is TBD, closed to the handler; the edition's admins and a global admin write at any time", async () => {
      await inTx(async (run) => {
        await opened(run, null);
        expect(await save(run, A, lesson.mon, 0, { ww: "x" })).toBe("review_closed");
        expect(await save(run, ED_ADMIN, lesson.mon, 0, { ww: "x" })).toBe("ok");
        await opened(run, -30); // the week is a month away
        expect(await save(run, A, lesson.wed, 0, { ww: "x" })).toBe("review_closed");
        expect(await save(run, ADMIN, lesson.wed, 0, { ww: "x" })).toBe("ok");
      });
    });

    it("in an archived edition, only its admins", async () => {
      await inTx(async (run) => {
        await opened(run, 30);
        await run("owner", "update public.editions set status = 'archived' where id = $1", [ed]);
        expect(await save(run, A, lesson.mon, 0, { ww: "x" })).toBe("archived");
        expect(await save(run, L, lesson.mon, 0, { ww: "x" })).toBe("forbidden");
        expect(await save(run, ED_ADMIN, lesson.mon, 0, { ww: "x" })).toBe("ok");
      });
    });
  });

  describe("«איך עבר»: who reads", () => {
    it("the edition's admins and content members — never logistics, nor anyone outside the edition; the table and load_reviews agree", async () => {
      await inTx(async (run) => {
        await opened(run, 10);
        await save(run, A, lesson.mon, 0, { ww: WENT_WELL, ia: "yes" });
        for (const who of [A, B, ED_ADMIN, ADMIN]) {
          const list = (await val(run, who, "select public.load_reviews($1)", [ed])) as { lesson_id: number; went_well: string }[];
          expect(list.map((r) => [Number(r.lesson_id), r.went_well]), who).toEqual([[lesson.mon, WENT_WELL]]);
          expect(Number(await val(run, who, "select count(*) from public.lesson_reviews where edition_id = $1", [ed])), who).toBe(1);
        }
        for (const who of [L, OTHER, PRACTICE, OLD, STRANGER]) {
          expect(await val(run, who, "select public.load_reviews($1)", [ed]), who).toEqual([]);
          expect(Number(await val(run, who, "select count(*) from public.lesson_reviews where edition_id = $1", [ed])), who).toBe(0);
        }
        // a past year's team reads their own year's (as they read its lessons); logistics of no year reads any
        expect(Number(await val(run, OLD, "select count(*) from public.lesson_reviews"))).toBe(1);
        expect(Number(await val(run, L, "select count(*) from public.lesson_reviews"))).toBe(0);
      });
    });

    it("never in load_week (as the offline copy keeps it), a link's page or Realtime", async () => {
      await inTx(async (run) => {
        await opened(run, -3); // the links still open
        await save(run, ED_ADMIN, lesson.mon, 0, { ww: WENT_WELL, is: ISSUES, ia: "no", r: 2 });
        for (const who of [A, L, ED_ADMIN]) {
          const week = (await val(run, who, "select public.load_week($1)", [ed])) as Record<string, unknown>;
          expect(Object.keys(week).sort(), who).toEqual([...WEEK_KEYS].sort());
          expect(JSON.stringify(week), who).not.toContain(WENT_WELL);
          expect(JSON.stringify(week), who).not.toContain(ISSUES);
        }
        for (const [fn, t] of [["escort_view", token.escort], ["schedule_view", token.schedule], ["kk_form", token.kk]] as const) {
          const page = JSON.stringify(await val(run, "anon", `select public.${fn}($1)`, [t]));
          expect(page, fn).not.toContain(WENT_WELL);
          expect(page, fn).not.toMatch(/invite_again|went_well|rating|overran/);
        }
        expect(await val(run, "owner", "select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'lesson_reviews'")).toBe(0);
      });
    });
  });

  describe("«איך עבר» across the years (the speaker sheet)", () => {
    type R = { edition_label: string; went_well: string | null; invite_again: string | null; rating: number | null };
    const labels = (rows: unknown) => (rows as R[]).map((r) => `${r.edition_label}:${r.invite_again}`);

    it("a live real edition's admins and content members read past years' reviews (and their own edition's) — never a practice week's", async () => {
      await inTx(async (run) => {
        await opened(run, 10);
        await save(run, A, lesson.mon, 0, { ww: WENT_WELL, ia: "maybe" });
        expect(labels(await val(run, A, "select public.speaker_reviews($1)", [speaker.s1]))).toEqual(["תשפ\"ז:maybe", "שנה קודמת:yes"]);
        expect(labels(await val(run, ED_ADMIN, "select public.speaker_reviews($1)", [speaker.s1]))).toEqual(["תשפ\"ז:maybe", "שנה קודמת:yes"]);
        expect(labels(await val(run, ADMIN, "select public.speaker_reviews($1)", [speaker.s1]))).toEqual(["תשפ\"ז:maybe", "שנה קודמת:yes"]);
        // another live edition's content member: last year, not this live week
        expect(labels(await val(run, OTHER, "select public.speaker_reviews($1)", [speaker.s1]))).toEqual(["שנה קודמת:yes"]);
        const one = ((await val(run, A, "select public.speaker_reviews($1)", [speaker.s1])) as Record<string, unknown>[])[1];
        expect(Object.keys(one).sort()).toEqual(
          ["day", "edition_id", "edition_kind", "edition_label", "end_min", "invite_again", "issues", "lesson_id", "overran", "rating", "start_date", "start_min", "title", "went_well", "written_at"].sort(),
        );
        expect(one.went_well).toBe(OLD_TEXT);
        expect(JSON.stringify(await val(run, ADMIN, "select public.speaker_reviews($1)", [speaker.s1]))).not.toContain(PRACTICE_TEXT);
      });
    });

    it("never logistics, a practice week's team, last year's team or an outsider", async () => {
      await inTx(async (run) => {
        for (const [who, c] of [[L, "forbidden"], [PRACTICE, "forbidden"], [OLD, "forbidden"], [OLD_ADMIN, "forbidden"], [STRANGER, "not_member"]] as const) {
          expect(await code(run(who, "select public.speaker_reviews($1)", [speaker.s1])), who).toBe(c);
        }
      });
    });
  });

  describe("the summary's returning speakers", () => {
    it("names who taught in an earlier real or archive year — not a practice week — to the edition's admins and content", async () => {
      await inTx(async (run) => {
        await opened(run, 10);
        for (const who of [A, ED_ADMIN, ADMIN]) {
          const list = (await val(run, who, "select public.edition_returning($1)", [ed])) as { speaker_id: number; editions: string[] }[];
          expect(list.map((x) => [Number(x.speaker_id), x.editions]), who).toEqual([[speaker.s1, ["שנה קודמת"]]]);
        }
        expect(await code(run(L, "select public.edition_returning($1)", [ed]))).toBe("forbidden");
        expect(await code(run(STRANGER, "select public.edition_returning($1)", [ed]))).toBe("not_member");
        // a year that started after this one is not «earlier»
        await run("owner", "update public.editions set start_date = (now() at time zone 'Asia/Jerusalem')::date + 400 where id = $1", [old]);
        expect(await val(run, A, "select public.edition_returning($1)", [ed])).toEqual([]);
        // dates unknown: a past year (archived) is earlier than a live one
        await run("owner", "update public.editions set start_date = null where id in ($1, $2)", [old, ed]);
        expect(((await val(run, A, "select public.edition_returning($1)", [ed])) as unknown[]).length).toBe(1);
      });
    });
  });

  describe("purge_edition_private", () => {
    const counts = async (run: Run) => {
      const out: Record<string, number> = {};
      for (const t of ["lessons", "roster", "kk_signups", "kk_groups", "escort_ticks", "speaker_contacts", "fallen_contacts", "lesson_reviews", "members", "share_links", "source_files", "memorial_plans", "approaches", "activity"]) {
        out[t] = Number(await val(run, "owner", `select count(*) from public.${t}`));
      }
      return out;
    };

    it("a global admin's only, the label typed exactly, once the week is over (Friday, Israel time) or the edition archived", async () => {
      await inTx(async (run) => {
        await opened(run, 10);
        for (const who of [ED_ADMIN, A, L, OLD_ADMIN]) expect(await code(run(who, "select public.purge_edition_private($1, 'תשפ\"ז')", [ed])), who).toBe("forbidden");
        expect(await code(run(ADMIN, "select public.purge_edition_private($1, 'תשפז')", [ed]))).toBe("confirm_mismatch");
        expect(await code(run(ADMIN, "select public.purge_edition_private($1, null)", [ed]))).toBe("confirm_mismatch");
        expect(await code(run(ADMIN, "select public.purge_edition_private(999999, 'x')"))).toBe("stale");
        await opened(run, null);
        expect(await code(run(ADMIN, "select public.purge_edition_private($1, ' תשפ\"ז ')", [ed]))).toBe("week_not_over");
        await opened(run, 4); // Thursday — the week's last day
        expect(await code(run(ADMIN, "select public.purge_edition_private($1, 'תשפ\"ז')", [ed]))).toBe("week_not_over");
        await opened(run, 5); // Friday
        expect(await code(run(ADMIN, "select public.purge_edition_private($1, ' תשפ\"ז ')", [ed]))).toBe("ok");
        // an archived edition, its date TBD
        expect(await code(run(ADMIN, "select public.purge_edition_private($1, 'שנה קודמת')", [old]))).toBe("ok");
      });
    });

    it("deletes the transport details and revokes every link of the edition (the anon functions refuse them), deletes their counts — and keeps everything else", async () => {
      await inTx(async (run) => {
        await opened(run, 7);
        // the sign-up link, still within its 30 days, opens before the purge — a fresh tick too
        expect(await code(run("anon", "select public.kk_form($1)", [token.kk]))).toBe("ok");
        const hits = Number(await val(run, "owner", "select count(*) from public.share_link_hits h join public.share_links s on s.token_hash = h.token_hash where s.edition_id = $1", [ed]));
        expect(hits).toBeGreaterThan(0);
        const before = await counts(run);
        const report = (await val(run, ADMIN, "select public.purge_edition_private($1, 'תשפ\"ז')", [ed])) as Record<string, unknown>;
        expect({ ...report, purged_at: typeof report.purged_at }).toEqual({ transport_details: 1, import_notes: 0, links_revoked: 3, link_hits: hits, purged_at: "string" });
        expect(Number(await val(run, "owner", "select count(*) from public.transport_details t join public.lessons l on l.id = t.lesson_id where l.edition_id = $1", [ed]))).toBe(0);
        expect(Number(await val(run, "owner", "select count(*) from public.share_links where edition_id = $1 and revoked_at is null", [ed]))).toBe(0);
        expect(Number(await val(run, "owner", "select count(*) from public.share_link_hits h join public.share_links s on s.token_hash = h.token_hash where s.edition_id = $1", [ed]))).toBe(0);
        for (const [fn, t] of [["escort_view", token.escort], ["schedule_view", token.schedule], ["kk_form", token.kk]] as const) {
          expect(await code(run("anon", `select public.${fn}($1)`, [t])), fn).toBe("link_invalid");
        }
        expect(await code(run("anon", "select public.escort_tick($1, $2, 'gift', true)", [token.escort, lesson.mon]))).toBe("link_invalid");
        // another edition's transport and link are untouched
        expect(Number(await val(run, "owner", "select count(*) from public.transport_details where lesson_id = $1", [lesson.other]))).toBe(1);
        expect(Number(await val(run, "owner", "select count(*) from public.share_links where edition_id = $1 and revoked_at is null", [other]))).toBe(1);
        // kept: the lessons, the trainees' names and sign-ups, the ticks, the pool's and the families' contacts, the reviews, the team, the files, the plans
        const after = await counts(run);
        expect({ ...after, activity: 0 }).toEqual({ ...before, activity: 0 });
        expect(after.activity).toBe(before.activity + 1);
        // logged: the counts, and nothing else
        const log = (await run("owner", "select actor, edition_id, entity, entity_id, kind, detail from public.activity where kind = 'purge'")).rows;
        const adminId = Number(await val(run, "owner", "select id from public.members where email = $1 and edition_id is null", [ADMIN]));
        expect(log.map((r) => ({ ...r, actor: Number(r.actor), edition_id: Number(r.edition_id), entity_id: Number(r.entity_id) }))).toEqual([
          { actor: adminId, edition_id: ed, entity: "editions", entity_id: ed, kind: "purge", detail: { transport_details: 1, import_notes: 0, links_revoked: 3, link_hits: hits } },
        ]);
        expect(JSON.stringify(log)).not.toContain(ADDRESS);
        // the edition's admins read the log row (the archive reads it so)
        expect(Number(await val(run, ED_ADMIN, "select count(*) from public.activity where kind = 'purge'"))).toBe(1);
      });
    });

    it("is idempotent: a second run deletes nothing more, keeps the first time, and is logged again with zeros", async () => {
      await inTx(async (run) => {
        await opened(run, 7);
        const first = (await val(run, ADMIN, "select public.purge_edition_private($1, 'תשפ\"ז')", [ed])) as Record<string, unknown>;
        const at = await val(run, "owner", "select purged_at::text from public.editions where id = $1", [ed]);
        expect(at).not.toBeNull();
        const second = (await val(run, ADMIN, "select public.purge_edition_private($1, 'תשפ\"ז')", [ed])) as Record<string, unknown>;
        expect(second).toEqual({ transport_details: 0, import_notes: 0, links_revoked: 0, link_hits: 0, purged_at: first.purged_at });
        expect(await val(run, "owner", "select purged_at::text from public.editions where id = $1", [ed])).toBe(at);
        expect(Number(await val(run, "owner", "select count(*) from public.activity where kind = 'purge'"))).toBe(2);
      });
    });

    it("purged_at is the purge's alone: a direct write by a global admin leaves it as it was", async () => {
      await inTx(async (run) => {
        expect(await code(run(ADMIN, "update public.editions set purged_at = now() where id = $1", [ed]))).toBe("ok");
        expect(await val(run, "owner", "select purged_at from public.editions where id = $1", [ed])).toBeNull();
        expect(await code(run(ADMIN, "insert into public.editions (label, purged_at) values ('מחזור לבדיקה', now())"))).toBe("ok");
        expect(await val(run, "owner", "select purged_at from public.editions where label = 'מחזור לבדיקה'")).toBeNull();
        await opened(run, 7);
        await run(ADMIN, "select public.purge_edition_private($1, 'תשפ\"ז')", [ed]);
        const at = await val(run, "owner", "select purged_at::text from public.editions where id = $1", [ed]);
        await run(ADMIN, "update public.editions set purged_at = null where id = $1", [ed]);
        expect(await val(run, "owner", "select purged_at::text from public.editions where id = $1", [ed])).toBe(at);
      });
    });
  });

  describe("moving to next year", () => {
    /** Every row of every table in public, by table — what a dry run must leave exactly as it was. */
    const everything = async (run: Run) => {
      const tables = (await run("owner", "select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename as string);
      const out: Record<string, string> = {};
      for (const t of tables) out[t] = String(await val(run, "owner", `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.${t} x`));
      return out;
    };

    it("the dry run: a global admin's; what start_edition would archive, copy and deactivate — and the real thing does exactly that", async () => {
      await inTx(async (run) => {
        for (const who of [ED_ADMIN, A, L]) expect(await code(run(who, "select public.start_edition_preview(true)")), who).toBe("forbidden");
        await run(ED_ADMIN, "insert into public.milestones (edition_id, title, days_before) values ($1, 'אבן דרך לבדיקה', 42)", [ed]);
        await run(ED_ADMIN, "select public.set_duty_phrases($1, '[{\"when\": \"always\", \"text\": \"ניסוח לבדיקה\"}]')", [ed]);
        const preview = (await val(run, ADMIN, "select public.start_edition_preview(true)")) as Record<string, unknown>;
        const nonAdmins = Number(await val(run, "owner", "select count(*) from public.members where active and role <> 'admin' and edition_id in ($1, $2)", [ed, other]));
        expect(preview).toEqual({
          archive: [{ id: ed, label: "תשפ\"ז" }, { id: other, label: "מחזור אחר" }],
          carry_from: { id: other, label: "מחזור אחר" },
          grid_rows: Number(await val(run, "owner", "select count(*) from public.grid_template")),
          milestones: 0,
          confirm_template: false,
          call_template: false,
          duty_phrases: 0,
          deactivate: nonAdmins,
          admins_stay: 1,
          stays: {
            speakers: Number(await val(run, "owner", "select count(*) from public.speakers where not retired")),
            categories: Number(await val(run, "owner", "select count(*) from public.categories where active")),
            fallen: 1,
            notes: 0,
          },
        });
        expect(((await val(run, ADMIN, "select public.start_edition_preview(false)")) as { deactivate: number }).deactivate).toBe(0);
        // the real thing: the same editions archived, the same members deactivated — admins and all-editions rows stay
        const newId = Number(await val(run, ADMIN, "select public.start_edition('תשפ\"ח', null, null, 'בית מדרש', true)"));
        expect((await run("owner", "select id from public.editions where status = 'archived' and id in ($1, $2) order by id", [ed, other])).rows.map((r) => Number(r.id))).toEqual([ed, other]);
        expect(Number(await val(run, "owner", "select count(*) from public.members where not active"))).toBe(nonAdmins);
        expect((await run("owner", "select email from public.members where active")).rows.map((r) => r.email).sort()).toEqual([ADMIN, ED_ADMIN, OLD, OLD_ADMIN, PRACTICE].sort());
        expect(Number(await val(run, "owner", "select count(*) from public.grid_rows where edition_id = $1", [newId]))).toBe(preview.grid_rows);
        // a deactivated member is no longer let in
        expect(((await val(run, A, "select public.whoami()")) as { status: string }).status).toBe("not_member");
      });
    });

    it("the dry run carries over what the live edition has, and the real thing copies the same", async () => {
      await inTx(async (run) => {
        await run("owner", "update public.editions set status = 'archived' where id = $1", [other]); // ed is the live one
        await run(ED_ADMIN, "insert into public.milestones (edition_id, title, days_before) values ($1, 'אבן דרך לבדיקה', 42), ($1, 'עוד אבן דרך', 7)", [ed]);
        await run(ED_ADMIN, "select public.set_duty_phrases($1, '[{\"when\": \"always\", \"text\": \"ניסוח לבדיקה\"}]')", [ed]);
        await run(ED_ADMIN, "select public.set_confirm_template($1, 'נוסח לבדיקה')", [ed]);
        await run(ED_ADMIN, "select public.set_call_template($1, 'נקודות לבדיקה')", [ed]);
        const preview = (await val(run, ADMIN, "select public.start_edition_preview(true)")) as Record<string, unknown>;
        expect(preview).toMatchObject({ archive: [{ id: ed, label: "תשפ\"ז" }], carry_from: { id: ed }, milestones: 2, confirm_template: true, call_template: true, duty_phrases: 1, admins_stay: 1 });
        const newId = Number(await val(run, ADMIN, "select public.start_edition('תשפ\"ח', null)")); // the option off: nobody is deactivated
        expect(Number(await val(run, "owner", "select count(*) from public.milestones where edition_id = $1", [newId]))).toBe(2);
        expect(await val(run, "owner", "select settings ->> 'call_template' from public.editions where id = $1", [newId])).toBe("נקודות לבדיקה");
        expect(Number(await val(run, "owner", "select count(*) from public.members where not active"))).toBe(0);
      });
    });

    it("the dry run writes nothing — it is STABLE, runs in a read-only transaction, and leaves every row as it was", async () => {
      expect(await owner("select provolatile from pg_proc where proname = 'start_edition_preview'")).toBe("s");
      await inTx(async (run) => {
        const before = await everything(run);
        await run(ADMIN, "select public.start_edition_preview(true)");
        await run(ADMIN, "select public.start_edition_preview(false)");
        expect(await everything(run)).toEqual(before);
      });
      await db.query("begin read only");
      try {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(ADMIN))]);
        expect((await db.query("select public.start_edition_preview(true) as p")).rows[0].p.archive).toHaveLength(2);
      } finally {
        await db.query("rollback");
      }
    });
  });
});
