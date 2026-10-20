// Outputs and knowledge (v8) in the database, as the roles a browser gets: the
// export snapshots (an edition's admins; the public schedule's keys only; never
// changed), the knowledge base's notes (cross-year by a global admin, an
// edition's by its admins, read by whoever sees them), the milestones (done_at
// is the database's clock), start_edition carrying milestones over, and
// get_contacts_for — never one phone more than get_speaker_contacts shows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SCHEMA, as, dropDatabase, freshDatabase, google, sqlstate } from "./db";

const ADMIN = "admin@example.org"; // every edition
const ED_ADMIN = "edition.admin@example.org";
const ED_ADMIN2 = "second.admin@example.org";
const A = "a@example.org"; // handles speaker 1
const B = "b@example.org"; // handles speaker 2
const L = "logistics@example.org";
const OTHER_ADMIN = "other.admin@example.org"; // admin of another edition
const OTHER = "other@example.org"; // content in another edition
const STRANGER = "stranger@example.org";
// Phone-shaped values no scanner takes for an Israeli number.
const PHONE_1 = "555 0100 11";
const PHONE_2 = "555 0100 22";
const PHONE_3 = "555 0100 33";

const ROW = { lesson_id: 1, kind: "lesson", day: "ראשון", date: "TBD", time: "08:30–09:45", speaker: "מרצה לדוגמה", title: "כותרת לדוגמה", category: "תנ\"ך", room: "בית מדרש", parallel: false };

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message: string };
    return err.code === "P0001" ? err.message : (err.code ?? "error");
  }
}

describe("outputs and knowledge", () => {
  const dbName = `vw_outputs_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let other: number;
  const member: Record<string, number> = {};
  const lessons: number[] = [];
  const speakers: number[] = [];
  let otherLesson: number;

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
    other = Number((await db.query("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id")).rows[0].id);
    await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'בית מדרש', true)", [other]);
    await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [other]);
    for (const [email, role, edition] of [
      [ED_ADMIN, "admin", ed], [ED_ADMIN2, "admin", ed], [A, "content", ed], [B, "content", ed], [L, "logistics", ed], [OTHER_ADMIN, "admin", other], [OTHER, "content", other],
    ] as const) {
      member[email] = Number((await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3) returning id", [email, role, edition])).rows[0].id);
    }
    member[ADMIN] = Number((await db.query("select id from public.members where email = $1", [ADMIN])).rows[0].id);
    for (const [i, phone] of [PHONE_1, PHONE_2, PHONE_3].entries()) {
      const s = Number((await db.query("insert into public.speakers (name, gender, vetted) values ($1, 'f', 'approved') returning id", [`מרצה לבדיקה ${i + 1}`])).rows[0].id);
      speakers.push(s);
      await db.query("insert into public.speaker_contacts (speaker_id, phone, email) values ($1, $2, $3)", [s, phone, `speaker${i + 1}@example.org`]);
    }
    // A closes speaker 1 (08:30), B speaker 2 (10:00); the admin closes speaker 3 (11:30); speaker 3 also teaches in the practice week.
    const close = async (email: string, edition: number, speaker: number, start: number, end: number) => {
      const p = Number(await commitAs(email, "select (public.propose($1, $2, null, 1, $3, $4, null) ->> 'pitch_id')::bigint", [edition, speaker, start, end]));
      await commitAs(email, "select public.close_lesson($1)", [p]);
      return Number((await db.query("select lesson_id from public.pitches where id = $1", [p])).rows[0].lesson_id);
    };
    lessons.push(await close(A, ed, speakers[0], 510, 600));
    lessons.push(await close(B, ed, speakers[1], 600, 690));
    lessons.push(await close(ADMIN, ed, speakers[2], 690, 780));
    otherLesson = await close(OTHER, other, speakers[0], 510, 600);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  it("exposes get_contacts_for with the contract's parameter name, to signed-in members only", async () => {
    const sig = (await db.query("select pg_get_function_arguments(p.oid) as a, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_contacts_for'")).rows;
    expect(sig).toEqual([{ a: "p_lessons bigint[]", prosecdef: false }]); // invoker: the policies decide
    await as(db, "anon", null, async (q) => {
      expect(await sqlstate(q("select public.get_contacts_for($1::bigint[])", [lessons]))).toBe("42501");
    });
  });

  describe("get_contacts_for", () => {
    const phones = (email: string, ids: number[]) =>
      as(db, "authenticated", google(email), async (q) => (await q("select public.get_contacts_for($1::bigint[]) as c", [ids])).rows[0].c as { lesson_id: number; speaker_id: number; phone: string }[]);

    it("gives each person exactly the phones the contacts policy lets them see", async () => {
      const all = [...lessons, otherLesson];
      const got = async (email: string) => (await phones(email, all)).map((r) => [Number(r.lesson_id), r.phone]);
      expect(await got(A)).toEqual([[lessons[0], PHONE_1]]);
      expect(await got(B)).toEqual([[lessons[1], PHONE_2]]);
      expect(await got(ADMIN)).toEqual([
        [lessons[0], PHONE_1], [lessons[1], PHONE_2], [lessons[2], PHONE_3], [otherLesson, PHONE_1],
      ]);
      // the edition's admin who handles nobody, logistics, a practice week's handler of speaker 1, outsiders: none
      for (const who of [ED_ADMIN, L, OTHER, OTHER_ADMIN, STRANGER]) expect(await got(who), who).toEqual([]);
    });

    it("never returns more than get_speaker_contacts would, for anyone, for any lesson", async () => {
      const leads = new Map<number, number>();
      for (const id of [...lessons, otherLesson]) {
        leads.set(id, Number((await db.query("select speaker_id from public.lesson_speakers where lesson_id = $1", [id])).rows[0].speaker_id));
      }
      for (const who of [ADMIN, ED_ADMIN, A, B, L, OTHER, OTHER_ADMIN, STRANGER]) {
        await as(db, "authenticated", google(who), async (q) => {
          for (const id of [...lessons, otherLesson]) {
            const batch = (await q("select public.get_contacts_for(array[$1::bigint]) as c", [id])).rows[0].c as { speaker_id: number; phone: string }[];
            for (const r of batch) {
              const one = (await q("select public.get_speaker_contacts($1) as c", [r.speaker_id])).rows[0].c;
              expect(one, `${who} lesson ${id}`).not.toBeNull();
              expect(one.phone, `${who} lesson ${id}`).toBe(r.phone);
            }
            // and, of a lesson the caller sees, nothing get_speaker_contacts shows is left out
            const sees = (await q("select 1 from public.lesson_speakers where lesson_id = $1", [id])).rows.length > 0;
            const one = (await q("select public.get_speaker_contacts($1) as c", [leads.get(id)])).rows[0].c;
            expect(batch.length, `${who} lesson ${id}`).toBe(sees && one?.phone ? 1 : 0);
          }
        });
      }
    });

    it("returns phones only — no e-mail, no notes — and nothing for an empty or null list", async () => {
      const r = await phones(ADMIN, [lessons[0]]);
      expect(Object.keys(r[0]).sort()).toEqual(["lesson_id", "phone", "speaker_id"]);
      expect(await phones(ADMIN, [])).toEqual([]);
      await as(db, "authenticated", google(ADMIN), async (q) => {
        expect((await q("select public.get_contacts_for(null) as c")).rows[0].c).toEqual([]);
      });
    });
  });

  describe("export snapshots", () => {
    const insert = (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>, edition: number, payload: unknown) =>
      q("insert into public.export_snapshots (edition_id, kind, payload) values ($1, 'designer', $2) returning id, created_by, created_at", [edition, JSON.stringify(payload)]);

    it("are the edition's admins' to save and read — the author and the time are the database's", async () => {
      for (const who of [ED_ADMIN, ADMIN]) {
        await as(db, "authenticated", google(who), async (q) => {
          const r = (await insert(q, ed, [ROW])).rows[0];
          expect(Number(r.created_by), who).toBe(member[who]);
          expect(Math.abs(new Date(r.created_at).getTime() - Date.now())).toBeLessThan(60_000);
          expect((await q("select payload from public.export_snapshots where edition_id = $1", [ed])).rows.map((x) => x.payload)).toEqual([[ROW]]);
          // never an author or a time of the browser's choosing
          expect(await sqlstate(q("insert into public.export_snapshots (edition_id, kind, payload, created_by) values ($1, 'designer', '[]', 1)", [ed]))).toBe("42501");
          expect(await sqlstate(q("insert into public.export_snapshots (edition_id, kind, payload, created_at) values ($1, 'designer', '[]', now())", [ed]))).toBe("42501");
        });
      }
    });

    it("are hidden from, and refused to, everyone else", async () => {
      await commitAs(ED_ADMIN, "insert into public.export_snapshots (edition_id, kind, payload) values ($1, 'designer', $2)", [ed, JSON.stringify([ROW])]);
      for (const who of [A, L, OTHER_ADMIN, OTHER, STRANGER]) {
        await as(db, "authenticated", google(who), async (q) => {
          expect((await q("select id from public.export_snapshots")).rows, who).toEqual([]);
          expect(await sqlstate(insert(q, ed, [ROW])), who).toBe("42501");
        });
      }
      // the other edition's admin saves for their own edition only
      await as(db, "authenticated", google(OTHER_ADMIN), async (q) => {
        expect(await sqlstate(insert(q, other, []))).toBe("ok");
      });
    });

    it("are never changed or deleted, not even by an admin", async () => {
      await as(db, "authenticated", google(ADMIN), async (q) => {
        expect(await sqlstate(q("update public.export_snapshots set payload = '[]'"))).toBe("42501");
        expect(await sqlstate(q("delete from public.export_snapshots"))).toBe("42501");
      });
    });

    it("hold the public schedule only: a contact, an amount or a note has no key to travel in", async () => {
      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        expect(await refusal(insert(q, ed, [{ ...ROW, phone: PHONE_1 }]))).toBe("bad_value");
        expect(await refusal(insert(q, ed, [{ ...ROW, pay_amount: 500 }]))).toBe("bad_value");
        expect(await refusal(insert(q, ed, [{ ...ROW, speaker: { phone: PHONE_1 } }]))).toBe("bad_value");
        expect(await refusal(insert(q, ed, { rows: [ROW] }))).toBe("bad_value");
        expect(await refusal(insert(q, ed, ["a row as a string"]))).toBe("bad_value");
        expect(await refusal(q("insert into public.export_snapshots (edition_id, kind, payload) values ($1, 'poster', '[]')", [ed]))).toBe("23514");
        expect(await refusal(insert(q, ed, []))).toBe("ok");
      });
    });
  });

  describe("notes", () => {
    let crossYear: number;
    let mine: number;
    let theirs: number;

    beforeAll(async () => {
      crossYear = Number(await commitAs(ADMIN, "insert into public.notes (section, title, body_md) values ('process', 'הערה לכל השנים', 'גוף **לדוגמה**') returning id"));
      mine = Number(await commitAs(ED_ADMIN, "insert into public.notes (edition_id, section, title, body_md) values ($1, 'lessons_learned', '  הערה   של המחזור  ', '') returning id", [ed]));
      theirs = Number(await commitAs(OTHER_ADMIN, "insert into public.notes (edition_id, section, title) values ($1, 'challenges', 'הערה של מחזור אחר') returning id", [other]));
    });

    it("are read by every member who sees them: the cross-year ones by all, an edition's by its own", async () => {
      const seen = (email: string) => as(db, "authenticated", google(email), async (q) => (await q("select id from public.notes order by id")).rows.map((r) => Number(r.id)));
      for (const who of [A, B, L, ED_ADMIN]) expect(await seen(who), who).toEqual([crossYear, mine]);
      for (const who of [OTHER, OTHER_ADMIN]) expect(await seen(who), who).toEqual([crossYear, theirs]);
      expect(await seen(ADMIN)).toEqual([crossYear, mine, theirs]);
      expect(await seen(STRANGER)).toEqual([]);
    });

    it("are written by admins only: cross-year by a global admin, an edition's by its admins", async () => {
      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        expect(await sqlstate(q("insert into public.notes (section, title) values ('process', 'x')"))).toBe("42501"); // cross-year: not an edition admin's
        expect(await sqlstate(q("insert into public.notes (edition_id, section, title) values ($1, 'process', 'x')", [other]))).toBe("42501");
        expect((await q("update public.notes set title = 'x' where id = $1 returning id", [crossYear])).rows).toEqual([]);
        expect((await q("delete from public.notes where id = $1 returning id", [theirs])).rows).toEqual([]);
      });
      for (const who of [A, L]) {
        await as(db, "authenticated", google(who), async (q) => {
          expect(await sqlstate(q("insert into public.notes (edition_id, section, title) values ($1, 'process', 'x')", [ed])), who).toBe("42501");
          expect((await q("update public.notes set title = 'x' where id = $1 returning id", [mine])).rows, who).toEqual([]);
          expect((await q("delete from public.notes where id = $1 returning id", [mine])).rows, who).toEqual([]);
        });
      }
    });

    it("stamp who and when, clean the title, and move the version on every save — an edition or an author never changes", async () => {
      const row = (await db.query("select * from public.notes where id = $1", [mine])).rows[0];
      expect(row.title).toBe("הערה של המחזור");
      expect([Number(row.created_by), Number(row.updated_by), row.version]).toEqual([member[ED_ADMIN], member[ED_ADMIN], 1]);
      await as(db, "authenticated", google(ED_ADMIN2), async (q) => {
        const r = (await q("update public.notes set body_md = 'גוף חדש' where id = $1 and version = 1 returning version, created_by, updated_by", [mine])).rows[0];
        expect([r.version, Number(r.created_by), Number(r.updated_by)]).toEqual([2, member[ED_ADMIN], member[ED_ADMIN2]]);
        // a save at the version someone else already moved on: nothing
        expect((await q("update public.notes set body_md = 'ישן' where id = $1 and version = 1 returning id", [mine])).rows).toEqual([]);
        expect(await sqlstate(q("update public.notes set edition_id = null where id = $1", [mine]))).toBe("42501");
        expect(await sqlstate(q("update public.notes set created_by = 1 where id = $1", [mine]))).toBe("42501");
        expect(await sqlstate(q("update public.notes set version = 9 where id = $1", [mine]))).toBe("42501");
        expect(await refusal(q("update public.notes set title = '   ' where id = $1", [mine]))).toBe("title_required");
        expect(await refusal(q("update public.notes set body_md = $2 where id = $1", [mine, "א".repeat(20001)]))).toBe("bad_value");
        expect(await refusal(q("update public.notes set section = 'gossip' where id = $1", [mine]))).toBe("23514");
      });
    });

    it("count as history: an admin who wrote one is deactivated, not deleted", async () => {
      await commitAs(ED_ADMIN2, "insert into public.notes (edition_id, section, title) values ($1, 'templates', 'הערה לדוגמה')", [ed]);
      await as(db, "authenticated", google(ADMIN), async (q) => {
        expect(await refusal(q("delete from public.members where email = $1", [ED_ADMIN2]))).toBe("member_has_history");
      });
    });
  });

  describe("milestones", () => {
    let m: number;

    beforeAll(async () => {
      m = Number(await commitAs(ED_ADMIN, "insert into public.milestones (edition_id, title, days_before) values ($1, 'אבן דרך לדוגמה', 42) returning id", [ed]));
      await commitAs(ED_ADMIN, "insert into public.milestones (edition_id, title, days_before) values ($1, 'אחרי השבוע (לדוגמה)', -7)", [ed]);
    });

    it("are read by the edition's members and written by its admins only", async () => {
      const seen = (email: string) => as(db, "authenticated", google(email), async (q) => (await q("select title from public.milestones order by days_before desc")).rows.map((r) => r.title));
      for (const who of [A, L, ED_ADMIN, ADMIN]) expect(await seen(who), who).toEqual(["אבן דרך לדוגמה", "אחרי השבוע (לדוגמה)"]);
      for (const who of [OTHER, OTHER_ADMIN, STRANGER]) expect(await seen(who), who).toEqual([]);
      for (const who of [A, L, OTHER_ADMIN]) {
        await as(db, "authenticated", google(who), async (q) => {
          expect(await sqlstate(q("insert into public.milestones (edition_id, title, days_before) values ($1, 'x', 1)", [ed])), who).toBe("42501");
          expect((await q("update public.milestones set done_at = now() where id = $1 returning id", [m])).rows, who).toEqual([]);
          expect((await q("delete from public.milestones where id = $1 returning id", [m])).rows, who).toEqual([]);
        });
      }
    });

    it("are done on the database's clock, by whoever marked them; clearing it clears both", async () => {
      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        expect(await sqlstate(q("insert into public.milestones (edition_id, title, days_before, done_at) values ($1, 'x', 1, now())", [ed]))).toBe("42501");
        const r = (await q("update public.milestones set done_at = '2000-01-01' where id = $1 returning done_at, done_by", [m])).rows[0];
        expect(new Date(r.done_at).getFullYear()).toBeGreaterThan(2000);
        expect(Number(r.done_by)).toBe(member[ED_ADMIN]);
        // marking it again keeps the first time
        const again = (await q("update public.milestones set done_at = '2001-01-01' where id = $1 returning done_at", [m])).rows[0];
        expect(again.done_at).toEqual(r.done_at);
        expect((await q("update public.milestones set done_at = null where id = $1 returning done_at, done_by", [m])).rows[0]).toEqual({ done_at: null, done_by: null });
        expect(await refusal(q("update public.milestones set days_before = 400 where id = $1", [m]))).toBe("23514");
        expect(await refusal(q("update public.milestones set title = '' where id = $1", [m]))).toBe("title_required");
        expect(await sqlstate(q("update public.milestones set edition_id = $2 where id = $1", [m, other]))).toBe("42501");
      });
    });

    it("carry over to the next real edition — titles and W−n, none of them done", async () => {
      await commitAs(ED_ADMIN, "update public.milestones set done_at = now() where id = $1", [m]);
      await as(db, "authenticated", google(ADMIN), async (q) => {
        const next = Number((await q("select public.start_edition('תשפ\"ח', null) as e")).rows[0].e);
        const rows = (await q("select title, days_before, done_at, done_by from public.milestones where edition_id = $1 order by days_before desc", [next])).rows;
        expect(rows).toEqual([
          { title: "אבן דרך לדוגמה", days_before: 42, done_at: null, done_by: null },
          { title: "אחרי השבוע (לדוגמה)", days_before: -7, done_at: null, done_by: null },
        ]);
      });
    });
  });
});
