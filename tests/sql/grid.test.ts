// Phase 1 in the database: who can read what, contact details, the activity
// log, and two people dropping into the same cell at the same moment. (What
// each command does is tests/parity — engine and SQL held to one contract.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { SCHEMA, adminUrl, as, dropDatabase, freshDatabase, google, sqlstate } from "./db";

const ADMIN = "admin@example.org";
const A = "a@example.org";
const B = "b@example.org";
const OTHER = "other.edition@example.org";
const STRANGER = "stranger@example.org";

describe("the grid's tables and functions", () => {
  const dbName = `vw_grid_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let otherEd: number;
  let speaker: number;

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = await asAdmin("select public.start_edition('תשפ\"ז', '2027-02-14', 510) as v");
    otherEd = Number((await db.query("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id")).rows[0].id);
    await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'בית מדרש', true)", [otherEd]);
    for (const [email, edition] of [[A, ed], [B, ed], [OTHER, otherEd]] as const) {
      await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, 'content', $2)", [email, edition]);
    }
    speaker = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה לבדיקה', 'f', 'approved') returning id")).rows[0].id);
    await db.query("insert into public.speaker_contacts (speaker_id, phone) values ($1, 'synthetic-phone')", [speaker]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  async function asAdmin(sql: string): Promise<number> {
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(ADMIN))]);
    const v = Number((await db.query(sql)).rows[0].v);
    await db.query("commit");
    return v;
  }

  it("exposes the RPCs with exactly the contract's parameter names (src/data/supabasePort.ts calls them by name)", async () => {
    const sig = async (fn: string) =>
      (await db.query("select pg_get_function_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows[0]?.a;
    expect(await sig("load_week")).toBe("p_edition bigint");
    expect(await sig("propose")).toBe("p_edition bigint, p_speaker bigint, p_lesson bigint, p_day integer, p_start integer, p_end integer, p_room bigint, p_mode text DEFAULT 'self'::text");
    expect(await sig("unpropose")).toBe("p_pitch bigint");
    expect(await sig("set_pitch")).toBe("p_pitch bigint, p_state text");
    expect(await sig("close_lesson")).toBe("p_pitch bigint");
    expect(await sig("reopen_lesson")).toBe("p_lesson bigint");
    expect(await sig("move_lesson")).toBe("p_lesson bigint, p_day integer, p_start integer, p_end integer, p_room bigint");
    expect(await sig("reshape")).toBe("p_edition bigint, p_day integer, p_row_start integer, p_op text, p_count integer DEFAULT NULL::integer, p_reason text DEFAULT NULL::text, p_parts integer[] DEFAULT NULL::integer[]");
    expect(await sig("update_lesson")).toBe("p_lesson bigint, p_version integer, p_patch jsonb");
  });

  it("start_edition copies the 2026 grid and makes one default room; only an admin may", async () => {
    const rows = (await db.query("select kind, count(*)::int as n from public.grid_rows where edition_id = $1 group by kind order by kind", [ed])).rows;
    expect(rows).toEqual([
      { kind: "fixed", n: 5 },
      { kind: "kk", n: 2 },
      { kind: "lesson", n: 12 },
      { kind: "memorial", n: 2 },
    ]);
    await as(db, "authenticated", google(A), async (q) => {
      expect(await sqlstate(q("select public.start_edition('x', null)"))).toBe("P0001");
    });
  });

  it("seeds the ten approved categories once", async () => {
    expect((await db.query("select count(*)::int as n from public.categories")).rows[0].n).toBe(10);
    await db.query(SCHEMA);
    expect((await db.query("select count(*)::int as n from public.categories")).rows[0].n).toBe(10);
    expect((await db.query("select count(*)::int as n from public.grid_template")).rows[0].n).toBe(21);
  });

  it("refuses every direct write from a browser — writes go through the functions", async () => {
    await as(db, "authenticated", google(A), async (q) => {
      expect(await sqlstate(q("insert into public.speakers (name) values ('x')"))).toBe("42501");
      expect(await sqlstate(q("update public.lessons set state = 'closed'"))).toBe("42501");
      expect(await sqlstate(q("delete from public.pitches"))).toBe("42501");
      expect(await sqlstate(q("insert into public.activity (entity, kind) values ('x', 'note')"))).toBe("42501");
    });
  });

  it("shows a member their own edition only, and a stranger nothing", async () => {
    await as(db, "authenticated", google(A), async (q) => {
      await q("select public.propose($1, $2, null, 1, 510, 600, null, 'self')", [ed, speaker]);
      expect((await q("select count(*)::int as n from public.lessons")).rows[0].n).toBe(1);
    });
    await db.query("begin; set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(A))]);
    await db.query("select public.propose($1, $2, null, 1, 510, 600, null, 'self')", [ed, speaker]);
    await db.query("commit");

    await as(db, "authenticated", google(OTHER), async (q) => {
      expect((await q("select * from public.lessons")).rows).toEqual([]);
      expect((await q("select public.load_week($1) as w", [ed])).rows[0].w).toBeNull();
      expect(await sqlstate(q("select public.propose($1, $2, null, 1, 600, 690, null, 'self')", [ed, speaker]))).toBe("P0001");
    });
    await as(db, "authenticated", google(STRANGER), async (q) => {
      for (const t of ["lessons", "pitches", "approaches", "speakers", "grid_rows", "rooms", "categories", "activity", "speaker_contacts"]) {
        expect((await q(`select * from public.${t}`)).rows, t).toEqual([]);
      }
      expect((await q("select public.load_week($1) as w", [ed])).rows[0].w).toBeNull();
    });
  });

  it("load_week returns the whole Week shape, without contact details", async () => {
    await as(db, "authenticated", google(B), async (q) => {
      const w = (await q("select public.load_week($1) as w", [ed])).rows[0].w;
      expect(Object.keys(w).sort()).toEqual(["approaches", "availability", "categories", "edition", "lessonSpeakers", "lessons", "pitches", "rooms", "rows", "speakers", "team"]);
      expect(w.rows).toHaveLength(21);
      expect(w.lessons).toHaveLength(1);
      expect(JSON.stringify(w)).not.toContain("synthetic-phone");
      expect(Object.keys(w.team[0]).sort()).toEqual(["display_name", "gender", "id", "role"]);
    });
  });

  it("shows contact details to the speaker's handler and the admin — not to the rest of the team", async () => {
    const phone = async (email: string) =>
      as(db, "authenticated", google(email), async (q) => (await q("select phone from public.speaker_contacts")).rows.map((r) => r.phone));
    expect(await phone(A)).toEqual(["synthetic-phone"]);
    expect(await phone(ADMIN)).toEqual(["synthetic-phone"]);
    expect(await phone(B)).toEqual([]);
  });

  it("takes contact details away from last year's handler once a new edition archives theirs — the admin keeps them", async () => {
    // One transaction, rolled back: the archive must not leak into the tests below.
    await as(db, "authenticated", google(ADMIN), async (q) => {
      const phoneAs = async (email: string) => {
        await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(email))]);
        return (await q("select phone from public.speaker_contacts")).rows.map((r) => r.phone);
      };
      await q("select public.start_edition('תשפ\"ח', '2028-02-13', 510)");
      expect((await q("select status from public.editions where id = $1", [ed])).rows[0].status).toBe("archived");
      // A is still an active member of the archived edition, and still owns the approach there.
      const owned = await q(
        `select count(*)::int as n from public.approaches a join public.members m on m.id = a.owner_member_id
          where a.edition_id = $1 and a.speaker_id = $2 and m.email = $3 and m.active`,
        [ed, speaker, A],
      );
      expect(owned.rows[0].n).toBe(1);
      expect(await phoneAs(A)).toEqual([]);
      expect(await phoneAs(ADMIN)).toEqual(["synthetic-phone"]);
    });
  });

  it("gives no contact details through a practice edition — claiming a real speaker there reads nothing", async () => {
    // One transaction, rolled back. The practice edition gets the template's grid, as a sandbox would.
    // A handles this speaker in the real edition; OTHER is content in the practice edition only.
    const memberOther = Number((await db.query("select id from public.members where email = $1", [OTHER])).rows[0].id);
    await db.query("begin");
    try {
      await db.query(
        "insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template",
        [otherEd],
      );
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(OTHER))]);
      await db.query("select public.propose($1, $2, null, 1, 510, 600, null, 'self')", [otherEd, speaker]);
      const owner = await db.query("select owner_member_id from public.approaches where edition_id = $1 and speaker_id = $2", [otherEd, speaker]);
      expect(owner.rows.map((r) => Number(r.owner_member_id))).toEqual([memberOther]);
      expect((await db.query("select phone from public.speaker_contacts")).rows).toEqual([]);
    } finally {
      await db.query("rollback");
    }
  });

  it("logs every change, with ids and states only", async () => {
    const rows = (await db.query("select entity, kind, actor, detail from public.activity where edition_id = $1 order by id", [ed])).rows;
    expect(rows.map((r) => `${r.entity}:${r.kind}`)).toEqual(["lessons:insert", "approaches:insert", "pitches:insert"]);
    const memberA = Number((await db.query("select id from public.members where email = $1", [A])).rows[0].id);
    expect(rows.every((r) => Number(r.actor) === memberA)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/synthetic-phone|@/);
  });

  it("two members dropping into the same empty cell at once get one draft", async () => {
    const s2 = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה שנייה', 'm', 'approved') returning id")).rows[0].id);
    const s3 = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה שלישית', 'f', 'approved') returning id")).rows[0].id);
    const url = new URL(adminUrl());
    url.pathname = `/${dbName}`;
    const c1 = new pg.Client({ connectionString: url.toString() });
    const c2 = new pg.Client({ connectionString: url.toString() });
    await c1.connect();
    await c2.connect();
    try {
      for (const [c, email] of [[c1, A], [c2, B]] as const) {
        await c.query("begin; set local role authenticated");
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(email))]);
      }
      await c1.query("select public.propose($1, $2, null, 2, 870, 960, null, 'self')", [ed, s2]);
      const second = c2.query("select public.propose($1, $2, null, 2, 870, 960, null, 'self')", [ed, s3]); // waits on the day lock
      await new Promise((r) => setTimeout(r, 150));
      await c1.query("commit");
      await second;
      await c2.query("commit");
    } finally {
      await c1.end();
      await c2.end();
    }
    const lessons = (await db.query("select id from public.lessons where edition_id = $1 and day = 2 and start_min = 870", [ed])).rows;
    expect(lessons).toHaveLength(1);
    expect((await db.query("select count(*)::int as n from public.pitches where lesson_id = $1", [lessons[0].id])).rows[0].n).toBe(2);
  });
});
