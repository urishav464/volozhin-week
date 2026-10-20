// Memorial times and the logistics screen's one read (v11) in the database, as
// the roles a browser gets: the fallen (a global admin writes; any admin and the
// team of an edition with a plan read), a family's contact person (ADMINS ONLY:
// a global admin, or an admin of a real, live edition with a plan for that
// fallen — never content, logistics, a sandbox's admin, last year's, anon),
// memorial plans (the edition's admins write, its whole team reads, in
// load_week without a contact), memorial slots (made in a memorial row, never
// dragged or swallowed by a merge), placing a plan (the liaison goes with it),
// the liaison as the slot's escort and what the escort's link shows of it, the
// slot's materials (uploads to a placed slot, each file remembering its fallen),
// the memorial policy, and get_transports_for against get_transport_details.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { assertWeekOnly, WEEK_KEYS } from "../../src/offline/snapshot";
import { SCHEMA, dropDatabase, freshDatabase, google, sqlstate, type Claims } from "./db";

const ADMIN = "admin@example.org"; // every edition
const ED_ADMIN = "edition.admin@example.org";
const A = "a@example.org"; // content; handles a speaker
const B = "b@example.org"; // content; handles another
const L = "logistics@example.org";
const OTHER = "other@example.org"; // content in another real edition
const SANDBOX_ADMIN = "sandbox.admin@example.org"; // admin of a practice week
const SANDBOX = "sandbox@example.org"; // content in the practice week
const STRANGER = "stranger@example.org";
// Synthetic: no scanner takes these for a real phone or address.
const FAMILY_PHONE = "555 0100 77";
const FAMILY_EMAIL = "family1@example.org";
const FAMILY_NAME = "איש/אשת קשר לבדיקה";
const RELATION = "קרבה לבדיקה";
const FAMILY_NOTE = "הערה משפחתית לבדיקה";
const PHONE_T = "555 0100 33";
const ADDRESS = "כתובת איסוף לבדיקה";
const PDF = "application/pdf";

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

/** A Google session with a sub of its own per address — the Storage API writes it as an object's owner_id. */
function claims(email: string): Claims {
  const hex = Buffer.from(email).toString("hex").padEnd(12, "0").slice(0, 12);
  return { ...google(email), sub: `00000000-0000-4000-8000-${hex}` };
}

describe("memorial times and the logistics screen's transports", () => {
  const dbName = `vw_memorial_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let other: number;
  let sandbox: number;
  const fallen: number[] = [];
  const slot: Record<string, number> = {};
  const plan: Record<string, number> = {};
  const roster: Record<string, number> = {};
  const transport: Record<string, number> = {};

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
            await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims(who))]);
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
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims(email))]);
      const r = await db.query(sql, params);
      await db.query("commit");
      return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
  const owner = async (sql: string, params: unknown[] = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];

  let speakers = 0;
  async function closedLesson(email: string, edition: number, day: number, start: number, end: number): Promise<number> {
    const s = Number(await owner("insert into public.speakers (name, gender, vetted) values ($1, 'f', 'approved') returning id", [`מרצה לבדיקה ${++speakers}`]));
    const p = Number(await commitAs(email, "select (public.propose($1, $2, null, $3, $4, $5, null) ->> 'pitch_id')::bigint", [edition, s, day, start, end]));
    await commitAs(email, "select public.close_lesson($1)", [p]);
    return Number(await owner("select lesson_id from public.pitches where id = $1", [p]));
  }
  const version = async (table: string, id: number) => Number(await owner(`select version from public.${table} where id = $1`, [id]));

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', '2027-02-14', 510)"));
    other = Number(await owner("insert into public.editions (label, kind) values ('מחזור אחר', 'real') returning id"));
    sandbox = Number(await owner("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id"));
    for (const e of [other, sandbox]) {
      await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'בית מדרש', true)", [e]);
      await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [e]);
    }
    for (const [email, role, edition] of [
      [ED_ADMIN, "admin", ed], [A, "content", ed], [B, "content", ed], [L, "logistics", ed], [OTHER, "content", other],
      [SANDBOX_ADMIN, "admin", sandbox], [SANDBOX, "content", sandbox],
    ] as const) {
      await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3)", [email, role, edition]);
    }
    roster.liaison = Number(await owner("insert into public.roster (edition_id, full_name) values ($1, 'חניך/ה לבדיקה') returning id", [ed]));
    for (let i = 1; i <= 4; i++) fallen.push(Number(await commitAs(ADMIN, "select public.save_fallen(null, $1, null, null, true)", [`חלל/ה לבדיקה ${i}`])));
    await commitAs(ADMIN, "select public.set_fallen_contacts($1, $2, $3, $4, $5, $6)", [fallen[0], FAMILY_NAME, RELATION, FAMILY_PHONE, FAMILY_EMAIL, FAMILY_NOTE]);
    await commitAs(ADMIN, "select public.set_fallen_contacts($1, $2, null, $3, null, null)", [fallen[2], FAMILY_NAME, FAMILY_PHONE]);
    // ed: a slot on Sunday 13:00 holding fallen 1's plan; a slot on Monday 13:00 free; fallen 2's plan unplaced.
    slot.sun = Number(await commitAs(ED_ADMIN, "select public.add_memorial_slot($1, 0, 780, 795, null)", [ed]));
    slot.mon = Number(await commitAs(ED_ADMIN, "select public.add_memorial_slot($1, 1, 780, 795, null)", [ed]));
    plan.f1 = Number(await commitAs(ED_ADMIN, "select public.add_memorial_plan($1, $2)", [ed, fallen[0]]));
    plan.f2 = Number(await commitAs(ED_ADMIN, "select public.add_memorial_plan($1, $2)", [ed, fallen[1]]));
    await commitAs(ED_ADMIN, "select public.place_memorial_plan($1, 1, $2)", [plan.f1, slot.sun]);
    // the practice week plans for fallen 3 (its admin gets no family contact for it)
    plan.sandbox = Number(await commitAs(SANDBOX_ADMIN, "select public.add_memorial_plan($1, $2)", [sandbox, fallen[2]]));

    // transports: A's lesson approved, B's approved, A's second still pending; the practice week's approved too
    transport.a = await closedLesson(A, ed, 1, 510, 600);
    transport.b = await closedLesson(B, ed, 1, 600, 690);
    transport.pending = await closedLesson(A, ed, 2, 510, 600);
    transport.sandbox = await closedLesson(SANDBOX, sandbox, 1, 510, 600);
    for (const [who, l] of [[A, transport.a], [B, transport.b], [A, transport.pending], [SANDBOX, transport.sandbox]] as const) {
      await commitAs(who, "select public.set_payment($1, $2, null, 'round_trip')", [l, await version("lessons", l)]);
    }
    // B's second lesson: an amount approved, no transport — a payment, never a logistics transport
    transport.payOnly = await closedLesson(B, ed, 3, 600, 690);
    await commitAs(B, "select public.set_payment($1, $2, 300, 'none')", [transport.payOnly, await version("lessons", transport.payOnly)]);
    for (const l of [transport.a, transport.b, transport.sandbox, transport.payOnly]) {
      await commitAs(ADMIN, "select public.decide_payments(array[$1::bigint], array[$2::integer], 'approved')", [l, await version("lessons", l)]);
    }
    await commitAs(A, "select public.set_transport_details($1, $2, '07:15', 'נהג/ת לבדיקה', $3, true)", [transport.a, ADDRESS, PHONE_T]);
    await commitAs(B, "select public.set_transport_details($1, null, '08:00', null, null, false)", [transport.b]);
    await commitAs(A, "select public.set_transport_details($1, $2, null, null, null, false)", [transport.pending, ADDRESS]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  describe("the fallen", () => {
    it("are written by a global admin only: a name, a gender never guessed, a note; one with plans is not deleted", async () => {
      await inTx(async (run) => {
        for (const who of [ED_ADMIN, A, L, SANDBOX_ADMIN]) expect(await code(run(who, "select public.save_fallen(null, 'חלל/ה', null, null, true)")), who).toBe("forbidden");
        expect(await code(run(STRANGER, "select public.save_fallen(null, 'חלל/ה', null, null, true)"))).toBe("not_member");
        expect(await code(run(ADMIN, "select public.save_fallen(null, '  ', null, null, true)"))).toBe("name_required");
        expect(await code(run(ADMIN, "select public.save_fallen(null, 'חלל/ה', 'x', null, true)"))).toBe("bad_value");
        expect(await code(run(ADMIN, "select public.save_fallen(null, $1, null, null, true)", ["א".repeat(121)]))).toBe("bad_value");
        expect(await code(run(ADMIN, "select public.save_fallen(null, 'חלל/ה', null, null, null)"))).toBe("bad_value");
        expect(await code(run(ADMIN, "select public.save_fallen(999999, 'חלל/ה', null, null, true)"))).toBe("stale");
        expect(await val(run, ADMIN, "select public.save_fallen($1, '  חלל/ה   לבדיקה 4 ', 'f', 'הערה', false)", [fallen[3]])).toBe(String(fallen[3]));
        expect((await run("owner", "select name, gender, note, active from public.fallen where id = $1", [fallen[3]])).rows[0]).toEqual({ name: "חלל/ה לבדיקה 4", gender: "f", note: "הערה", active: false });
        expect(await code(run(ED_ADMIN, "select public.delete_fallen($1)", [fallen[3]]))).toBe("forbidden");
        expect(await code(run(ADMIN, "select public.delete_fallen($1)", [fallen[0]]))).toBe("in_use");
        expect(await code(run(ADMIN, "select public.delete_fallen($1)", [fallen[3]]))).toBe("ok");
        expect(await code(run(ADMIN, "select public.delete_fallen($1)", [fallen[3]]))).toBe("stale");
      });
    });

    it("are read by any admin (to plan) and by the team of an edition with a plan for them — nobody else", async () => {
      await inTx(async (run) => {
        const seen = async (who: string) => (await run(who, "select id from public.fallen order by id")).rows.map((r) => Number(r.id));
        for (const who of [ADMIN, ED_ADMIN, SANDBOX_ADMIN]) expect(await seen(who), who).toEqual(fallen);
        for (const who of [A, L]) expect(await seen(who), who).toEqual([fallen[0], fallen[1]]);
        expect(await seen(SANDBOX)).toEqual([fallen[2]]);
        for (const who of [OTHER, STRANGER]) expect(await seen(who), who).toEqual([]);
        expect(await sqlstate(run("anon", "select * from public.fallen"))).toBe("42501");
      });
    });
  });

  describe("a family's contact person", () => {
    const row = (who: string, f: number) =>
      inTx(async (run) => [(await run(who, "select * from public.fallen_contacts where fallen_id = $1", [f])).rows.length, await val(run, who, "select public.get_fallen_contacts($1)", [f])]);

    it("is an admin's only: a global admin, or an admin of a real, live edition with a plan for that fallen", async () => {
      expect(await row(ADMIN, fallen[0])).toEqual([1, { contact_name: FAMILY_NAME, relation: RELATION, phone: FAMILY_PHONE, email: FAMILY_EMAIL, note: FAMILY_NOTE }]);
      expect(await row(ADMIN, fallen[2])).toEqual([1, { contact_name: FAMILY_NAME, relation: null, phone: FAMILY_PHONE, email: null, note: null }]);
      expect(await row(ED_ADMIN, fallen[0])).toEqual([1, expect.objectContaining({ phone: FAMILY_PHONE })]);
      // a plan but no row yet: five nulls; no plan in the admin's edition: nothing
      expect(await row(ED_ADMIN, fallen[1])).toEqual([0, { contact_name: null, relation: null, phone: null, email: null, note: null }]);
      expect(await row(ED_ADMIN, fallen[2])).toEqual([0, null]);
      // a practice week's admin with a plan for fallen 3: no access (a sandbox gives none)
      expect(await row(SANDBOX_ADMIN, fallen[2])).toEqual([0, null]);
      for (const who of [A, B, L, SANDBOX, OTHER, STRANGER]) {
        for (const f of [fallen[0], fallen[2]]) expect(await row(who, f), `${who} ${f}`).toEqual([0, null]);
      }
      await inTx(async (run) => {
        expect(await sqlstate(run("anon", "select * from public.fallen_contacts"))).toBe("42501");
        expect(await sqlstate(run("anon", "select public.get_fallen_contacts($1)", [fallen[0]]))).toBe("42501");
      });
    });

    it("goes when the edition is archived — last year's admin does not keep a family's phone", async () => {
      await inTx(async (run) => {
        await run("owner", "update public.editions set status = 'archived' where id = $1", [ed]);
        expect(await val(run, ED_ADMIN, "select public.get_fallen_contacts($1)", [fallen[0]])).toBeNull();
        expect((await run(ED_ADMIN, "select * from public.fallen_contacts")).rows).toEqual([]);
        expect(await val(run, ADMIN, "select public.get_fallen_contacts($1)", [fallen[0]])).not.toBeNull();
      });
    });

    it("is written by the same people only — all five fields, a phone of 6 digits, an e-mail's shape; the log names fields, never values", async () => {
      await inTx(async (run) => {
        for (const who of [A, L, SANDBOX_ADMIN, OTHER]) {
          expect(await code(run(who, "select public.set_fallen_contacts($1, 'x', null, null, null, null)", [fallen[0]])), who).toBe("contacts_hidden");
        }
        expect(await code(run(ED_ADMIN, "select public.set_fallen_contacts($1, 'x', null, null, null, null)", [fallen[2]]))).toBe("contacts_hidden");
        expect(await code(run(ED_ADMIN, "select public.set_fallen_contacts($1, null, null, '12-34', null, null)", [fallen[1]]))).toBe("bad_phone");
        expect(await code(run(ED_ADMIN, "select public.set_fallen_contacts($1, null, null, null, 'not-an-email', null)", [fallen[1]]))).toBe("bad_contact_email");
        expect(await code(run(ED_ADMIN, "select public.set_fallen_contacts(999999, null, null, null, null, null)"))).toBe("stale");
        expect(await code(run(ED_ADMIN, "select public.set_fallen_contacts($1, $2, null, $3, null, null)", [fallen[1], FAMILY_NAME, FAMILY_PHONE]))).toBe("ok");
        const log = (await run("owner", "select detail from public.activity where entity = 'fallen' and entity_id = $1", [fallen[1]])).rows.map((r) => r.detail);
        expect(log).toEqual([{ fields: ["contact_name", "phone"] }]);
      });
    });

    it("is logged in the edition whose plan gave access, as the admin who changed it — readable there, in the archive's rows", async () => {
      await inTx(async (run) => {
        const edAdminId = Number(await val(run, "owner", "select id from public.members where email = $1", [ED_ADMIN]));
        const adminId = Number(await val(run, "owner", "select id from public.members where email = $1", [ADMIN]));
        expect(await code(run(ED_ADMIN, "select public.set_fallen_contacts($1, $2, null, $3, null, null)", [fallen[1], FAMILY_NAME, FAMILY_PHONE]))).toBe("ok");
        const rows = async (f: number) =>
          (await run("owner", "select actor, edition_id from public.activity where entity = 'fallen' and entity_id = $1 order by id", [f])).rows.map((r) => [Number(r.actor), r.edition_id == null ? null : Number(r.edition_id)]);
        expect(await rows(fallen[1])).toEqual([[edAdminId, ed]]);
        // what the archive reads (activity where edition_id = ed), through activity_read
        for (const who of [ED_ADMIN, ADMIN]) {
          expect((await run(who, "select entity_id from public.activity where entity = 'fallen' and edition_id = $1", [ed])).rows.map((r) => Number(r.entity_id)), who).toEqual([fallen[1]]);
        }
        // a global admin's change for a fallen no live edition plans for (only the practice week): no edition, their own id
        expect(await rows(fallen[2])).toEqual([[adminId, null]]);
        // the helper is not the browser's to call
        expect(await sqlstate(run(ED_ADMIN, "select app.fallen_contacts_edition($1)", [fallen[0]]))).toBe("42501");
      });
    });
  });

  describe("memorial plans", () => {
    it("are read by the edition's whole team, in load_week with the names of their fallen — never a family's contact", async () => {
      await inTx(async (run) => {
        for (const who of [A, L, ED_ADMIN]) {
          expect((await run(who, "select id from public.memorial_plans order by id")).rows.map((r) => Number(r.id)), who).toEqual(
            who === ED_ADMIN ? [plan.f1, plan.f2] : [plan.f1, plan.f2],
          );
          const w = (await val(run, who, "select public.load_week($1)", [ed])) as Record<string, unknown>;
          const plans = w.memorialPlans as Record<string, unknown>[];
          expect(plans.map((p) => Number(p.id))).toEqual([plan.f1, plan.f2]);
          expect(Object.keys(plans[0]).sort()).toEqual(["fallen_id", "family_status", "hard_stop", "id", "lesson_id", "materials_note", "planned_minutes", "speaker_text", "version"]);
          expect(Number(plans[0].lesson_id)).toBe(slot.sun);
          expect(w.fallen).toEqual([{ id: fallen[0], name: "חלל/ה לבדיקה 1", gender: null }, { id: fallen[1], name: "חלל/ה לבדיקה 2", gender: null }]);
          const text = JSON.stringify(w);
          for (const secret of [FAMILY_PHONE, FAMILY_EMAIL, FAMILY_NAME, RELATION, FAMILY_NOTE]) expect(text, `${who}: ${secret}`).not.toContain(secret);
          // the week a device keeps for a day without internet (src/offline/snapshot.ts): exactly the Week's keys, and
          // no personal key anywhere inside — the memorial plans and the fallen's names go with it, a family's contact never
          expect(Object.keys(w).sort(), who).toEqual([...WEEK_KEYS].sort());
          expect(() => assertWeekOnly(w), who).not.toThrow();
        }
        for (const who of [OTHER, SANDBOX, STRANGER]) expect((await run(who, "select id from public.memorial_plans where edition_id = $1", [ed])).rows, who).toEqual([]);
        expect(await sqlstate(run("anon", "select * from public.memorial_plans"))).toBe("42501");
      });
    });

    it("are written by the edition's admins only, one per fallen, for an active fallen", async () => {
      await inTx(async (run) => {
        for (const who of [A, L]) expect(await code(run(who, "select public.add_memorial_plan($1, $2)", [ed, fallen[2]])), who).toBe("forbidden");
        expect(await code(run(OTHER, "select public.add_memorial_plan($1, $2)", [ed, fallen[2]]))).toBe("not_member");
        expect(await code(run(ED_ADMIN, "select public.add_memorial_plan($1, $2)", [ed, fallen[0]]))).toBe("duplicate");
        await run("owner", "update public.fallen set active = false where id = $1", [fallen[2]]);
        expect(await code(run(ED_ADMIN, "select public.add_memorial_plan($1, $2)", [ed, fallen[2]]))).toBe("bad_value");
        expect(await code(run(ED_ADMIN, "select public.add_memorial_plan($1, 999999)", [ed]))).toBe("bad_value");
        for (const who of [A, L]) {
          expect(await code(run(who, "select public.update_memorial_plan($1, 1, '{\"hard_stop\": true}')", [plan.f2])), who).toBe("forbidden");
          expect(await code(run(who, "select public.place_memorial_plan($1, 1, $2)", [plan.f2, slot.mon])), who).toBe("forbidden");
          expect(await code(run(who, "select public.delete_memorial_plan($1)", [plan.f2])), who).toBe("forbidden");
        }
      });
    });

    it("are logged when added and deleted — a plan is what opens a family's contact to the edition's admins", async () => {
      await inTx(async (run) => {
        const edAdminId = Number(await val(run, "owner", "select id from public.members where email = $1", [ED_ADMIN]));
        const id = Number(await val(run, ED_ADMIN, "select public.add_memorial_plan($1, $2)", [ed, fallen[3]]));
        expect(await code(run(ED_ADMIN, "select public.get_fallen_contacts($1)", [fallen[3]]))).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.delete_memorial_plan($1)", [id]))).toBe("ok");
        const log = (await run(ED_ADMIN, "select actor, edition_id, kind, detail from public.activity where entity = 'memorial_plans' and entity_id = $1 order by id", [id])).rows;
        expect(log.map((r) => [Number(r.actor), Number(r.edition_id), r.kind, r.detail])).toEqual([
          [edAdminId, ed, "insert", { fallen: fallen[3] }],
          [edAdminId, ed, "delete", { fallen: fallen[3] }],
        ]);
      });
    });

    it("change at the version on screen, the keys present, each checked", async () => {
      await inTx(async (run) => {
        const upd = (patch: unknown, v = 1) => code(run(ED_ADMIN, "select public.update_memorial_plan($1, $2, $3)", [plan.f2, v, JSON.stringify(patch)]));
        expect(await upd({ hard_stop: true }, 7)).toBe("stale");
        expect(await upd({ family_status: "maybe" })).toBe("bad_value");
        for (const m of [0, 181, 1.5, "10"]) expect(await upd({ planned_minutes: m }), String(m)).toBe("bad_value");
        expect(await upd({ hard_stop: "yes" })).toBe("bad_value");
        expect(await upd({ speaker_text: "א".repeat(201) })).toBe("bad_value");
        expect(await upd({ materials_note: 5 })).toBe("bad_value");
        expect(await upd(["x"])).toBe("bad_value");
        expect(await upd({ family_status: "confirmed", speaker_text: "  דובר/ת   לבדיקה ", planned_minutes: 12, hard_stop: true, materials_note: "הערה\r\nלמקראה ", other: 1 })).toBe("ok");
        expect((await run("owner", "select family_status, speaker_text, planned_minutes, hard_stop, materials_note, version from public.memorial_plans where id = $1", [plan.f2])).rows[0]).toEqual({
          family_status: "confirmed", speaker_text: "דובר/ת לבדיקה", planned_minutes: 12, hard_stop: true, materials_note: "הערה\nלמקראה", version: 2,
        });
        expect(await upd({ planned_minutes: 12 }, 2)).toBe("ok"); // nothing changed: no new version
        expect(Number(await val(run, "owner", "select version from public.memorial_plans where id = $1", [plan.f2]))).toBe(2);
        expect(await upd({ planned_minutes: null, speaker_text: null }, 2)).toBe("ok");
        expect((await run("owner", "select speaker_text, planned_minutes, version from public.memorial_plans where id = $1", [plan.f2])).rows[0]).toEqual({ speaker_text: null, planned_minutes: null, version: 3 });
      });
    });
  });

  describe("memorial slots", () => {
    it("are made by the edition's admins inside a memorial row of the day, in a room of the edition", async () => {
      await inTx(async (run) => {
        for (const who of [A, L]) expect(await code(run(who, "select public.add_memorial_slot($1, 2, 780, 795, null)", [ed])), who).toBe("forbidden");
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 2, 510, 600, null)", [ed]))).toBe("outside_grid"); // a lesson row
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 2, 780, 800, null)", [ed]))).toBe("outside_grid"); // past the row
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 2, 780, 783, null)", [ed]))).toBe("bad_shape");
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 0, 780, 790, null)", [ed]))).toBe("room_taken"); // Sunday's slot is there
        const other_room = Number(await val(run, "owner", "select id from public.rooms where edition_id = $1", [other]));
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 2, 780, 795, $2)", [ed, other_room]))).toBe("bad_shape");
        const id = Number(await val(run, ED_ADMIN, "select public.add_memorial_slot($1, 2, 855, 865, null)", [ed]));
        expect((await run("owner", "select kind, state, day, start_min, end_min, title from public.lessons where id = $1", [id])).rows[0]).toEqual({
          kind: "memorial", state: "draft", day: 2, start_min: 855, end_min: 865, title: null,
        });
      });
    });

    it("are made only in the memorial rows the edition's window leaves on the grid (app.memorial_rows)", async () => {
      await inTx(async (run) => {
        // Sunday opens at 14:00: its 13:00 row is off the grid, the 14:15 one is not; Thursday closes at 13:20: the reverse
        await run("owner", "update public.editions set first_day_from = 840, last_day_until = 800 where id = $1", [ed]);
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 0, 785, 790, null)", [ed]))).toBe("outside_grid");
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 0, 855, 860, null)", [ed]))).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 4, 855, 860, null)", [ed]))).toBe("outside_grid");
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 4, 780, 785, null)", [ed]))).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 2, 780, 785, null)", [ed]))).toBe("ok"); // a middle day: both rows
        expect(await code(run(ED_ADMIN, "select public.add_memorial_slot($1, 2, 855, 860, null)", [ed]))).toBe("ok");
      });
    });

    it("are removed without a plan on them only (memorial_placed), and never moved by drag", async () => {
      await inTx(async (run) => {
        expect(await code(run(A, "select public.remove_memorial_slot($1)", [slot.mon]))).toBe("forbidden");
        expect(await code(run(ED_ADMIN, "select public.remove_memorial_slot($1)", [slot.sun]))).toBe("memorial_placed");
        expect(await code(run(ED_ADMIN, "select public.remove_memorial_slot($1)", [transport.a]))).toBe("stale"); // a lesson is not a slot
        for (const who of [ED_ADMIN, A]) {
          // its title would reach the anon links (schedule_view, escort_view): not written through update_lesson either
          expect(await code(run(who, "select public.update_lesson($1, (select version from public.lessons where id = $1), $2)", [slot.mon, JSON.stringify({ title: "כותרת לבדיקה" })])), who).toBe("memorial_slot");
          expect(await code(run(who, "select public.move_lesson($1, 1, 510, 525, (select room_id from public.lessons where id = $1))", [slot.mon])), who).toBe("memorial_slot");
        }
        expect(await code(run(ED_ADMIN, "select public.remove_memorial_slot($1)", [slot.mon]))).toBe("ok");
      });
    });

    it("are never swallowed by a merge — 11:30 merged into 14:30 crosses lunch and both memorial rows", async () => {
      await inTx(async (run) => {
        expect(await code(run(ED_ADMIN, "select public.reshape($1, 0, 690, 'merge_next')", [ed]))).toBe("merge_blocked");
        expect(await code(run(A, "select public.reshape($1, 1, 690, 'merge_next')", [ed]))).toBe("merge_blocked"); // Monday's free slot too
        expect(Number(await val(run, "owner", "select count(*) from public.lessons where kind = 'memorial' and edition_id = $1", [ed]))).toBe(2);
        expect(await code(run(A, "select public.reshape($1, 3, 690, 'merge_next')", [ed]))).toBe("ok"); // Wednesday has none
      });
    });
  });

  describe("placing a plan, and its liaison", () => {
    it("places on a memorial slot of the plan's edition that holds no other plan", async () => {
      await inTx(async (run) => {
        const place = (p: number, l: number | null, v = 1) => code(run(ED_ADMIN, "select public.place_memorial_plan($1, $2, $3)", [p, v, l]));
        expect(await place(plan.f2, slot.mon, 5)).toBe("stale");
        expect(await place(plan.f2, transport.a)).toBe("bad_value"); // a lesson
        const otherSlot = Number(await val(run, "owner", "insert into public.lessons (edition_id, kind, day, start_min, end_min, room_id) select $1, 'memorial', 0, 780, 795, id from public.rooms where edition_id = $1 returning id", [other]));
        expect(await place(plan.f2, otherSlot)).toBe("bad_value"); // another edition's
        expect(await place(plan.f2, slot.sun)).toBe("memorial_taken");
        expect(await place(plan.f2, slot.mon)).toBe("ok");
        expect(await place(plan.f2, slot.mon, 2)).toBe("ok"); // the same slot again: nothing
        expect(Number(await val(run, "owner", "select version from public.memorial_plans where id = $1", [plan.f2]))).toBe(2);
        expect(await code(run(ED_ADMIN, "select public.delete_memorial_plan($1)", [plan.f2]))).toBe("memorial_placed");
        expect(await place(plan.f2, null, 2)).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.delete_memorial_plan($1)", [plan.f2]))).toBe("ok");
        expect(await code(run(ED_ADMIN, "select public.delete_memorial_plan($1)", [plan.f2]))).toBe("stale");
      });
    });

    it("sets the liaison as the slot's escort — an admin, on a slot with a plan, never a self-introduction — and it goes with the plan", async () => {
      await inTx(async (run) => {
        const escort = (who: string, l: number, roster: number | null, self = false) =>
          code(run(who, "select public.set_escort($1, (select version from public.lessons where id = $1), $2, $3, 'הערה למלווה')", [l, roster, self]));
        expect(await escort(A, slot.sun, roster.liaison)).toBe("forbidden");
        expect(await escort(L, slot.sun, roster.liaison)).toBe("forbidden");
        expect(await escort(ED_ADMIN, slot.mon, roster.liaison)).toBe("no_plan");
        expect(await escort(ED_ADMIN, slot.sun, roster.liaison, true)).toBe("bad_value");
        expect(await escort(ED_ADMIN, slot.sun, roster.liaison)).toBe("ok");
        const of = async (l: number) => (await run("owner", "select escort_roster_id, escort_note from public.lessons where id = $1", [l])).rows[0];
        expect(await of(slot.sun)).toEqual({ escort_roster_id: String(roster.liaison), escort_note: "הערה למלווה" });
        // moved: the liaison goes with the plan
        expect(await code(run(ED_ADMIN, "select public.place_memorial_plan($1, (select version from public.memorial_plans where id = $1), $2)", [plan.f1, slot.mon]))).toBe("ok");
        expect(await of(slot.sun)).toEqual({ escort_roster_id: null, escort_note: null });
        expect(await of(slot.mon)).toEqual({ escort_roster_id: String(roster.liaison), escort_note: "הערה למלווה" });
        // taken off: the liaison leaves with it
        expect(await code(run(ED_ADMIN, "select public.place_memorial_plan($1, (select version from public.memorial_plans where id = $1), null)", [plan.f1]))).toBe("ok");
        expect(await of(slot.mon)).toEqual({ escort_roster_id: null, escort_note: null });
      });
    });

    it("shows the slot on the liaison's link as the escorts' page always showed one — never the fallen, the plan or a family's contact", async () => {
      await inTx(async (run) => {
        await run(ED_ADMIN, "select public.update_memorial_plan($1, (select version from public.memorial_plans where id = $1), $2)", [plan.f1, JSON.stringify({ speaker_text: "דובר/ת סודי/ת לבדיקה", materials_note: "חומרים לבדיקה" })]);
        await run(ED_ADMIN, "select public.set_escort($1, (select version from public.lessons where id = $1), $2, false, null)", [slot.sun, roster.liaison]);
        const token = ((await val(run, ED_ADMIN, "select public.issue_link($1, 'escort', $2)", [ed, roster.liaison])) as { token: string }).token;
        const view = (await val(run, "anon", "select public.escort_view($1)", [token])) as { lessons: Record<string, unknown>[] };
        expect(view.lessons.map((l) => [l.kind, Number(l.lesson_id)])).toEqual([["memorial", slot.sun]]);
        expect(view.lessons[0]).toMatchObject({ speaker: null, phone: null, transport: false, driver: null, self_intro: false, start_min: 780, end_min: 795 });
        const text = JSON.stringify(view);
        for (const secret of ["חלל/ה לבדיקה", "דובר/ת סודי/ת", "חומרים לבדיקה", FAMILY_PHONE, FAMILY_EMAIL, FAMILY_NAME, "family_status", "fallen"]) expect(text, secret).not.toContain(secret);
        expect(await code(run("anon", "select public.escort_tick($1, $2, 'reminded', true)", [token, slot.sun]))).toBe("ok");
        // off its slot, the plan's liaison has nothing there any more
        await run(ED_ADMIN, "select public.place_memorial_plan($1, (select version from public.memorial_plans where id = $1), null)", [plan.f1]);
        expect(((await val(run, "anon", "select public.escort_view($1)", [token])) as { lessons: unknown[] }).lessons).toEqual([]);
        expect(await code(run("anon", "select public.escort_tick($1, $2, 'met', true)", [token, slot.sun]))).toBe("link_invalid");
        expect(Number(await val(run, "owner", "select count(*) from public.escort_ticks where lesson_id = $1", [slot.sun]))).toBe(0);
      });
    });
  });

  describe("the slot's materials for the reader", () => {
    /** The Storage API's permission probe: an INSERT into storage.objects as the caller (the policies decide). */
    async function upload(run: Run, who: string, name: string): Promise<string> {
      return code(run(who, "insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('sources', $1, $2, $3, $4)", [
        name, claims(who).sub, claims(who).sub, { mimetype: PDF, size: 2048 },
      ]));
    }
    const path = (l: number) => `${ed}/${l}/${randomUUID()}-materials.pdf`;

    it("go up to a slot with a plan (content and admins), never to one without, never by logistics", async () => {
      await inTx(async (run) => {
        expect(await upload(run, A, path(slot.mon))).toBe("42501");
        expect(await upload(run, L, path(slot.sun))).toBe("42501");
        expect(await upload(run, OTHER, path(slot.sun))).toBe("42501");
        expect(await upload(run, "anon", path(slot.sun))).toBe("42501");
        const before = (await run("owner", "select sources_kind, in_reader, version from public.lessons where id = $1", [slot.sun])).rows[0];
        const name = path(slot.sun);
        expect(await upload(run, A, name)).toBe("ok");
        const row = (await val(run, A, "select public.register_source_file($1, $2, $3, 'עמוד זיכרון.pdf', 2)", [ed, slot.sun, name])) as Record<string, unknown>;
        expect(row).toMatchObject({ lesson_id: slot.sun, speaker_id: null, fallen_id: fallen[0], page_count: 2 });
        // a memorial slot is always in the reader: its sources columns stay as they were
        expect((await run("owner", "select sources_kind, in_reader, version from public.lessons where id = $1", [slot.sun])).rows[0]).toEqual(before);
        expect(await upload(run, ED_ADMIN, path(slot.sun))).toBe("ok");
      });
    });
  });

  describe("the memorial policy", () => {
    it("is the staff meeting's, written by the edition's admins, each part absent until decided — never seeded", async () => {
      expect(await owner("select settings ? 'memorial' from public.editions where id = $1", [ed])).toBe(false);
      await inTx(async (run) => {
        for (const who of [A, L]) expect(await code(run(who, "select public.set_memorial_policy($1, 'x', null, null)", [ed])), who).toBe("forbidden");
        for (const m of [0, 181]) expect(await code(run(ED_ADMIN, "select public.set_memorial_policy($1, null, $2, null)", [ed, m]))).toBe("bad_value");
        await run(ED_ADMIN, "select public.set_memorial_policy($1, ' ליד הארוחה? ', 10, null)", [ed]);
        expect(await val(run, "owner", "select settings -> 'memorial' from public.editions where id = $1", [ed])).toEqual({ placement: "ליד הארוחה?", max_minutes: 10 });
        await run(ED_ADMIN, "select public.set_memorial_policy($1, null, null, false)", [ed]);
        expect(await val(run, "owner", "select settings -> 'memorial' from public.editions where id = $1", [ed])).toEqual({ warn_adjacent_meal: false });
        await run(ED_ADMIN, "select public.set_memorial_policy($1, '', null, null)", [ed]);
        expect(await val(run, "owner", "select settings ? 'memorial' from public.editions where id = $1", [ed])).toBe(false);
      });
    });
  });

  describe("get_transports_for", () => {
    it("is invoker, with the contract's parameter name, for signed-in members only", async () => {
      const sig = (await db.query("select pg_get_function_arguments(p.oid) as a, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_transports_for'")).rows;
      expect(sig).toEqual([{ a: "p_edition bigint", prosecdef: false }]);
      await inTx(async (run) => expect(await sqlstate(run("anon", "select public.get_transports_for($1)", [ed]))).toBe("42501"));
    });

    it("lists each person's approved transports with exactly what get_transport_details shows them", async () => {
      const ids = (who: string, edition: number) =>
        inTx(async (run) => ((await val(run, who, "select public.get_transports_for($1)", [edition])) as { lesson_id: number }[]).map((r) => Number(r.lesson_id)));
      // the pending one is not a logistics item, nor B's approved amount with no transport
      expect(await ids(ADMIN, ed)).toEqual([transport.a, transport.b]);
      expect(await ids(A, ed)).toEqual([transport.a]);
      expect(await ids(B, ed)).toEqual([transport.b]);
      await inTx(async (run) => expect((await run("owner", "select state, transport, approval, pay_amount from public.lessons where id = $1", [transport.payOnly])).rows[0]).toEqual({ state: "closed", transport: "none", approval: "approved", pay_amount: 300 }));
      expect(await ids(L, ed)).toEqual([transport.a, transport.b]);
      expect(await ids(ADMIN, sandbox)).toEqual([transport.sandbox]); // a global admin sees all
      for (const who of [ED_ADMIN, OTHER, STRANGER]) expect(await ids(who, ed), who).toEqual([]); // the edition's admin who handles none
      for (const who of [SANDBOX, SANDBOX_ADMIN]) expect(await ids(who, sandbox), who).toEqual([]); // a practice week gives none
      const a = await inTx(async (run) => (await val(run, L, "select public.get_transports_for($1)", [ed])) as Record<string, unknown>[]);
      expect(a).toEqual([
        { lesson_id: transport.a, pickup_address: ADDRESS, pickup_time: "07:15", driver_name: "נהג/ת לבדיקה", driver_phone: PHONE_T, arranged: true },
        { lesson_id: transport.b, pickup_address: null, pickup_time: "08:00", driver_name: null, driver_phone: null, arranged: false },
      ]);
    });

    it("never returns more than get_transport_details would, for anyone, any lesson, any edition — and leaves out none it shows", async () => {
      const all = [transport.a, transport.b, transport.pending, transport.sandbox, transport.payOnly];
      for (const who of [ADMIN, ED_ADMIN, A, B, L, OTHER, SANDBOX, SANDBOX_ADMIN, STRANGER]) {
        await inTx(async (run) => {
          for (const edition of [ed, sandbox, other]) {
            const got = ((await val(run, who, "select public.get_transports_for($1)", [edition])) as Record<string, unknown>[]) ?? [];
            for (const r of got) {
              const one = await val(run, who, "select public.get_transport_details($1)", [r.lesson_id]);
              const { lesson_id: _l, ...rest } = r;
              expect(one, `${who} ${r.lesson_id}`).toEqual(rest);
            }
            for (const l of all) {
              const one = await val(run, who, "select public.get_transport_details($1)", [l]);
              const listed = got.some((r) => Number(r.lesson_id) === l);
              const approved = (await run("owner", "select edition_id, approval, transport from public.lessons where id = $1", [l])).rows[0];
              const due = one != null && Number(approved.edition_id) === edition && approved.approval === "approved" && approved.transport !== "none";
              expect(listed, `${who} ${edition} ${l}`).toBe(due);
            }
          }
        });
      }
    });
  });
});
