// The «הגדרות» writes under RLS, as the roles a browser gets: who may change
// the team, the roster, the rooms and the categories — and the rules a single
// write could otherwise break (history, self-lockout, the default room, a used
// category). src/data/demoSettings.test.ts holds the demo to the same refusals.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { nameKey } from "../../src/domain/nameKey";
import { SCHEMA, as, dropDatabase, freshDatabase, google, sqlstate } from "./db";

const ADMIN = "admin@example.org"; // all editions
const ED_ADMIN = "edition.admin@example.org";
const PEER_ADMIN = "peer.admin@example.org";
const CONTENT = "content@example.org";
const LOGISTICS = "logistics@example.org";
const OTHER = "other.edition@example.org";

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

describe("settings writes", () => {
  const dbName = `vw_settings_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let otherEd: number;
  const id: Record<string, number> = {};

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number((await db.query("insert into public.editions (label) values ('תשפ\"ז') returning id")).rows[0].id);
    otherEd = Number((await db.query("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id")).rows[0].id);
    for (const [email, role, edition] of [
      [ED_ADMIN, "admin", ed],
      [PEER_ADMIN, "admin", ed],
      [CONTENT, "content", ed],
      [LOGISTICS, "logistics", ed],
      [OTHER, "content", otherEd],
    ] as const) {
      id[email] = Number(
        (await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3) returning id", [email, role, edition])).rows[0].id,
      );
    }
    id[ADMIN] = Number((await db.query("select id from public.members where email = $1", [ADMIN])).rows[0].id);
    await db.query("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה לדוגמה 01'), ($1, 'חניך/ה לדוגמה 02'), ($2, 'חניך/ה לדוגמה 99')", [ed, otherEd]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  describe("roster", () => {
    it("is read by the edition's members — logistics too — and by no one else", async () => {
      for (const who of [ADMIN, ED_ADMIN, CONTENT, LOGISTICS]) {
        await as(db, "authenticated", google(who), async (q) => {
          expect((await q("select full_name from public.roster where edition_id = $1 order by 1", [ed])).rows.map((r) => r.full_name), who).toEqual([
            "חניך/ה לדוגמה 01",
            "חניך/ה לדוגמה 02",
          ]);
        });
      }
      await as(db, "authenticated", google(OTHER), async (q) => {
        expect((await q("select full_name from public.roster")).rows.map((r) => r.full_name)).toEqual(["חניך/ה לדוגמה 99"]);
        expect((await q("select * from public.roster where edition_id = $1", [ed])).rows).toEqual([]);
      });
      await as(db, "authenticated", google("stranger@example.org"), async (q) => {
        expect((await q("select * from public.roster")).rows).toEqual([]);
      });
      await as(db, "anon", null, async (q) => {
        expect(await sqlstate(q("select * from public.roster"))).toBe("42501");
      });
    });

    it("is written by the edition's admin and a global admin — not by content or logistics, not across editions", async () => {
      for (const who of [ADMIN, ED_ADMIN]) {
        await as(db, "authenticated", google(who), async (q) => {
          expect(await sqlstate(q("insert into public.roster (edition_id, full_name, gender) values ($1, 'חניך/ה לדוגמה 03', 'f')", [ed])), who).toBe("ok");
          expect((await q("update public.roster set gender = 'm' where edition_id = $1 returning id", [ed])).rows, who).toHaveLength(3);
          expect((await q("delete from public.roster where full_name = 'חניך/ה לדוגמה 03' returning id")).rows, who).toHaveLength(1);
        });
      }
      for (const who of [CONTENT, LOGISTICS]) {
        await as(db, "authenticated", google(who), async (q) => {
          expect(await sqlstate(q("insert into public.roster (edition_id, full_name) values ($1, 'x')", [ed])), who).toBe("42501");
          expect((await q("update public.roster set gender = 'm' returning id")).rows, who).toEqual([]);
          expect((await q("delete from public.roster returning id")).rows, who).toEqual([]);
        });
      }
      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        expect(await sqlstate(q("insert into public.roster (edition_id, full_name) values ($1, 'x')", [otherEd]))).toBe("42501");
        expect((await q("delete from public.roster where edition_id = $1 returning id", [otherEd])).rows).toEqual([]);
        // the key is the database's, never the browser's (a generated column)
        expect(await sqlstate(q("insert into public.roster (edition_id, full_name, name_key) values ($1, 'y', 'z')", [ed]))).toBe("428C9");
        expect(await sqlstate(q("update public.roster set edition_id = $1 where edition_id = $2", [otherEd, ed]))).toBe("42501");
      });
    });

    it("refuses the same name twice in an edition, by name key (spacing, dashes, gershayim)", async () => {
      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        expect(await sqlstate(q("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה  לדוגמה-01')", [ed]))).toBe("23505");
        // what SupabasePort sends for a paste: the duplicates are skipped, the new name added
        const r = await q(
          "insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה לדוגמה 01'), ($1, 'חניך/ה לדוגמה 04') on conflict (edition_id, name_key) do nothing returning full_name",
          [ed],
        );
        expect(r.rows.map((x) => x.full_name)).toEqual(["חניך/ה לדוגמה 04"]);
      });
    });

    it("computes the same name key as the browser (src/domain/nameKey.ts)", async () => {
      const samples = [
        "חניך/ה לדוגמה 01", "  הרב  פלוני-אלמוני ", 'ד"ר פלונית אלמונית', "פרופ׳ פלוני", "פרופ. פלוני", "הרבנית פלונית",
        "שָׁלוֹם עֲלֵיכֶם", "בן־ציון", "א–ב", "Some Name", "רבי \"נחמן\" מ'ברסלב", "",
      ];
      const r = await db.query("select s, app.name_key(s) as k from unnest($1::text[]) as s", [samples]);
      for (const row of r.rows) expect(nameKey(row.s), JSON.stringify(row.s)).toBe(row.k);
    });
  });

  describe("rooms", () => {
    let room2: number;
    let room3: number;

    it("an edition's first room becomes its default; an admin adds and renames, content cannot", async () => {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(ED_ADMIN))]);
      const a = await db.query("insert into public.rooms (edition_id, name, sort) values ($1, 'בית מדרש', 1) returning id, is_default", [ed]);
      const b = await db.query("insert into public.rooms (edition_id, name, sort) values ($1, 'חדר לדוגמה 2', 2) returning id, is_default", [ed]);
      const c = await db.query("insert into public.rooms (edition_id, name, sort) values ($1, 'חדר לדוגמה 3', 3) returning id, is_default", [ed]);
      await db.query("commit");
      expect([a.rows[0].is_default, b.rows[0].is_default, c.rows[0].is_default]).toEqual([true, false, false]);
      room2 = Number(b.rows[0].id);
      room3 = Number(c.rows[0].id);

      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        expect((await q("update public.rooms set name = 'חדר לדוגמה ב' where id = $1 returning id", [room2])).rows).toHaveLength(1);
        expect(await sqlstate(q("update public.rooms set name = 'בית מדרש' where id = $1", [room2]))).toBe("23505");
        // the default moves only through set_default_room, and no room changes edition
        expect(await sqlstate(q("update public.rooms set is_default = true where id = $1", [room2]))).toBe("42501");
        expect(await sqlstate(q("update public.rooms set edition_id = $2 where id = $1", [room2, otherEd]))).toBe("42501");
        expect(await sqlstate(q("insert into public.rooms (edition_id, name, is_default) values ($1, 'x', true)", [ed]))).toBe("42501");
        expect(await sqlstate(q("insert into public.rooms (edition_id, name) values ($1, 'x')", [otherEd]))).toBe("42501");
      });
      for (const who of [CONTENT, LOGISTICS, OTHER]) {
        await as(db, "authenticated", google(who), async (q) => {
          expect(await sqlstate(q("insert into public.rooms (edition_id, name) values ($1, 'x')", [ed])), who).toBe("42501");
          expect((await q("update public.rooms set name = 'x' returning id")).rows, who).toEqual([]);
          expect((await q("delete from public.rooms returning id")).rows, who).toEqual([]);
          expect(await refusal(q("select public.set_default_room($1)", [room2])), who).toBe("forbidden");
        });
      }
    });

    it("set_default_room moves the one default; the default and a used room are never deleted", async () => {
      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        await q("select public.set_default_room($1)", [room2]);
        expect((await q("select id from public.rooms where edition_id = $1 and is_default", [ed])).rows.map((r) => Number(r.id))).toEqual([room2]);
        expect(await refusal(q("delete from public.rooms where id = $1", [room2]))).toBe("room_default");
        expect(await refusal(q("delete from public.rooms where id = $1", [room3]))).toBe("ok");
      });
      // a lesson in room 3 (written as the owner, like a command would)
      const lesson = await db.query("insert into public.lessons (edition_id, day, start_min, end_min, room_id) values ($1, 0, 510, 600, $2) returning id", [ed, room3]);
      await as(db, "authenticated", google(ADMIN), async (q) => {
        expect(await refusal(q("delete from public.rooms where id = $1", [room3]))).toBe("room_in_use");
      });
      await db.query("delete from public.lessons where id = $1", [lesson.rows[0].id]);
    });
  });

  describe("categories", () => {
    it("only a global admin writes them; a used one is deactivated, never deleted; colours are #rrggbb", async () => {
      for (const who of [ED_ADMIN, CONTENT, LOGISTICS]) {
        await as(db, "authenticated", google(who), async (q) => {
          expect(await sqlstate(q("insert into public.categories (name, color) values ('x', '#123456')")), who).toBe("42501");
          expect((await q("update public.categories set active = false returning id")).rows, who).toEqual([]);
          expect((await q("delete from public.categories returning id")).rows, who).toEqual([]);
        });
      }
      const room = Number((await db.query("select id from public.rooms where edition_id = $1 and is_default", [ed])).rows[0].id);
      const used = Number((await db.query("select id from public.categories order by sort limit 1")).rows[0].id);
      const lesson = await db.query("insert into public.lessons (edition_id, day, start_min, end_min, room_id, category_id) values ($1, 1, 510, 600, $2, $3) returning id", [ed, room, used]);
      await as(db, "authenticated", google(ADMIN), async (q) => {
        const added = await q("insert into public.categories (name, color, sort) values ('קטגוריה לדוגמה', '#a23b3b', 11) returning id");
        expect((await q("update public.categories set color = '#1f6f8b', sort = 12 where id = $1 returning id", [added.rows[0].id])).rows).toHaveLength(1);
        expect(await refusal(q("update public.categories set color = 'red' where id = $1", [added.rows[0].id]))).toBe("bad_color");
        expect(await refusal(q("insert into public.categories (name, color) values ('קטגוריה לדוגמה ב', 'blue')"))).toBe("bad_color");
        expect(await sqlstate(q("insert into public.categories (name, color) values ('תנ\"ך', '#123456')"))).toBe("23505");
        expect(await sqlstate(q("insert into public.categories (id, name) overriding system value values (999, 'x')"))).toBe("42501");
        expect(await refusal(q("delete from public.categories where id = $1", [used]))).toBe("category_in_use");
        expect((await q("update public.categories set active = false where id = $1 returning id", [used])).rows).toHaveLength(1);
        expect(await refusal(q("delete from public.categories where id = $1", [added.rows[0].id]))).toBe("ok");
      });
      await db.query("delete from public.lessons where id = $1", [lesson.rows[0].id]);
    });

    it("a colour typed in the SQL Editor before the palette does not freeze its category", async () => {
      // written as the owner with the triggers off, like a row from before v5
      await db.query("begin");
      await db.query("set local session_replication_role = replica");
      const legacy = Number((await db.query("insert into public.categories (name, color, sort) values ('קטגוריה ישנה לדוגמה', 'red', 20) returning id")).rows[0].id);
      await db.query("commit");
      await db.query(SCHEMA); // the file still runs over it
      await as(db, "authenticated", google(ADMIN), async (q) => {
        expect((await q("update public.categories set active = false where id = $1 returning id", [legacy])).rows).toHaveLength(1);
        expect((await q("update public.categories set sort = 21, name = 'קטגוריה ישנה ב' where id = $1 returning id", [legacy])).rows).toHaveLength(1);
        expect((await q("update public.categories set color = color where id = $1 returning id", [legacy])).rows).toHaveLength(1);
        expect(await refusal(q("update public.categories set color = 'blue' where id = $1", [legacy]))).toBe("bad_color");
        expect((await q("update public.categories set color = '#1f6f8b' where id = $1 returning id", [legacy])).rows).toHaveLength(1);
      });
      await db.query("delete from public.categories where id = $1", [legacy]);
    });
  });

  describe("members", () => {
    it("an admin sets their own name and gender — on every row of theirs — and nothing else; a trainee cannot", async () => {
      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        await q("select public.set_my_profile('  מנהל/ת לדוגמה ', 'f')");
        expect((await q("select display_name, gender, role from public.members where email = $1", [ED_ADMIN])).rows).toEqual([
          { display_name: "מנהל/ת לדוגמה", gender: "f", role: "admin" },
        ]);
        expect((await q("select public.whoami() as w")).rows[0].w.display_name).toBe("מנהל/ת לדוגמה");
        expect(await refusal(q("select public.set_my_profile(' ', null)"))).toBe("name_required");
        expect(await refusal(q("select public.set_my_profile('x', 'x')"))).toBe("bad_value");
        expect(await refusal(q("select public.set_my_profile(repeat('א', 81), null)"))).toBe("bad_value");
        expect(await refusal(q("select public.set_my_profile(repeat('א', 2000000), null)"))).toBe("bad_value");
        // an edition's admin still cannot touch their own admin row directly
        expect((await q("update public.members set display_name = 'x' where email = $1 returning id", [ED_ADMIN])).rows).toEqual([]);
      });
      // a trainee's name is the admins' to set (the screen is theirs) — nobody renames themselves into the instructor
      for (const who of [CONTENT, LOGISTICS]) {
        await as(db, "authenticated", google(who), async (q) => {
          expect(await refusal(q("select public.set_my_profile('המדריכה', 'f')")), who).toBe("forbidden");
        });
      }
      await as(db, "authenticated", google("stranger@example.org"), async (q) => {
        expect(await refusal(q("select public.set_my_profile('x', null)"))).toBe("not_member");
      });
    });

    it("an edition's admin manages content and logistics rows, never an admin row", async () => {
      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        expect((await q("update public.members set display_name = 'שם לדוגמה', gender = 'm' where id = $1 returning id", [id[CONTENT]])).rows).toHaveLength(1);
        expect((await q("update public.members set active = false where id = $1 returning id", [id[LOGISTICS]])).rows).toHaveLength(1);
        expect((await q("update public.members set display_name = 'x' where id = $1 returning id", [id[PEER_ADMIN]])).rows).toEqual([]);
        expect((await q("delete from public.members where id = $1 returning id", [id[PEER_ADMIN]])).rows).toEqual([]);
        expect(await sqlstate(q("update public.members set role = 'admin' where id = $1", [id[CONTENT]]))).toBe("42501");
        // a row's address and edition are fixed: no re-pointing someone's history (and the contacts they handle) to another account
        expect(await sqlstate(q("update public.members set email = 'sock@example.org' where id = $1", [id[CONTENT]]))).toBe("42501");
        expect(await sqlstate(q("update public.members set edition_id = $2 where id = $1", [id[CONTENT], otherEd]))).toBe("42501");
        expect(await sqlstate(q("insert into public.members (email, role, edition_id) values ('x@example.org', 'admin', $1)", [ed]))).toBe("42501");
        expect(await sqlstate(q("insert into public.members (email, role, edition_id) values ($1, 'logistics', $2)", [CONTENT, ed]))).toBe("23505");
        expect((await q("select email from public.members where edition_id is null")).rows).toEqual([]); // the global rows are not theirs to see
        expect((await q("select * from public.team($1)", [ed])).rows.map((r) => r.role)).toContain("admin"); // names only, through team()
      });
    });

    it("deletes a member with no history; one who has done anything is deactivated instead", async () => {
      // CONTENT proposes once, so the activity log names them.
      const room = Number((await db.query("select id from public.rooms where edition_id = $1 and is_default", [ed])).rows[0].id);
      await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind) values ($1, 870, 960, 'lesson')", [ed]);
      const speaker = Number((await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה לדוגמה', 'f', 'approved') returning id")).rows[0].id);
      await db.query("begin; set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(CONTENT))]);
      await db.query("select public.propose($1, $2, null, 2, 870, 960, $3, 'self')", [ed, speaker, room]);
      await db.query("commit");

      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        expect(await refusal(q("delete from public.members where id = $1", [id[CONTENT]]))).toBe("member_has_history");
        expect((await q("update public.members set active = false where id = $1 returning id", [id[CONTENT]])).rows).toHaveLength(1);
        expect(await refusal(q("delete from public.members where id = $1", [id[LOGISTICS]]))).toBe("ok");
      });
    });

    it("no admin locks themselves out", async () => {
      await as(db, "authenticated", google(ADMIN), async (q) => {
        expect(await refusal(q("update public.members set active = false where id = $1", [id[ADMIN]]))).toBe("self_lockout");
        expect(await refusal(q("update public.members set role = 'content' where id = $1", [id[ADMIN]]))).toBe("self_lockout");
        expect(await sqlstate(q("update public.members set email = 'else@example.org' where id = $1", [id[ADMIN]]))).toBe("42501"); // no address changes at all
        expect(await sqlstate(q("update public.members set email = 'else@example.org' where id = $1", [id[PEER_ADMIN]]))).toBe("42501");
        expect(await refusal(q("delete from public.members where id = $1", [id[ADMIN]]))).toBe("self_lockout");
        // a global admin may still change another admin
        expect((await q("update public.members set display_name = 'מנהל/ת נוסף/ת' where id = $1 returning id", [id[PEER_ADMIN]])).rows).toHaveLength(1);
      });
      // the SQL Editor (no address) is not stopped
      expect((await db.query("update public.members set display_name = display_name where id = $1 returning id", [id[ADMIN]])).rows).toHaveLength(1);
    });

    it("deleting a whole edition still takes its team, rooms and roster with it (unseed_gate.sql)", async () => {
      await db.query("begin");
      try {
        await db.query("delete from public.editions where id = $1", [ed]);
        for (const t of ["members", "rooms", "roster"]) {
          expect((await db.query(`select count(*)::int as n from public.${t} where edition_id = $1`, [ed])).rows[0].n, t).toBe(0);
        }
      } finally {
        await db.query("rollback");
      }
    });
  });

  describe("editions", () => {
    it("a global admin edits the date and Sunday's opening; an edition's admin cannot; a duplicate label is refused", async () => {
      await as(db, "authenticated", google(ADMIN), async (q) => {
        expect((await q("update public.editions set start_date = '2027-02-14', first_day_from = 510 where id = $1 returning id", [ed])).rows).toHaveLength(1);
        expect((await q("update public.editions set start_date = null, first_day_from = null where id = $1 returning id", [ed])).rows).toHaveLength(1);
        expect(await sqlstate(q("select public.start_edition('תשפ\"ז', null, null)"))).toBe("23505");
      });
      await as(db, "authenticated", google(ED_ADMIN), async (q) => {
        expect((await q("update public.editions set start_date = '2027-02-14' where id = $1 returning id", [ed])).rows).toEqual([]);
        expect(await refusal(q("select public.start_edition('x', null, null)"))).toBe("forbidden");
      });
    });
  });
});
