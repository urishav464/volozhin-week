// The import of 5786 (v12) in the database, as the roles a browser gets: only a global admin; every row or none;
// a re-run adds no second speaker and no second copy of the archive's lessons; phones and e-mails only in
// speaker_contacts (never in a speaker's row, a lesson or the log); the archive edition's kind and status, and
// «לימד/ה אצלנו» from it (speaker_history). What each refusal is, row by row, is also tests/parity (engine ≡ SQL).
// Synthetic people and numbers only — no phone here has a real shape.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { phoneKey } from "../../src/import/phone";
import { SCHEMA, as, dropDatabase, freshDatabase, google } from "./db";

const ADMIN = "admin@example.org"; // every edition
const ED_ADMIN = "edition.admin@example.org"; // admin of this year's edition only
const A = "a@example.org"; // content this year
const STRANGER = "stranger@example.org";

/** The message of a P0001 refusal and its detail («import_bad_row 3:bad_phone»), else the SQLSTATE. */
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string };
    return err.code === "P0001" ? `${err.message}${err.detail ? ` ${err.detail}` : ""}` : (err.code ?? "error");
  }
}

describe("the import of 5786", () => {
  const dbName = `vw_import_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  const sp: Record<string, number> = {};

  /** As a member, COMMITTED (the next test sees it); the first column, or a refusal thrown. */
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
  const commit = (kind: string, payload: unknown, who = ADMIN) => commitAs(who, "select public.import_commit($1, $2::jsonb)", [kind, JSON.stringify(payload)]) as Promise<Record<string, unknown>>;
  const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);

  const row = (n: number, name: string, extra: Record<string, unknown> = {}) => ({
    row: n, action: "new", speaker_id: null, title: null, name, gender: null, affiliation: null, topics: [], phone: null, email: null, notes: null, ...extra,
  });

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', '2027-02-14', 510)"));
    for (const [email, role] of [[ED_ADMIN, "admin"], [A, "content"]] as const) {
      await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3)", [email, role, ed]);
    }
    // the pool before the import: one with an affiliation and a phone, one with nothing
    sp.full = Number((await db.query("insert into public.speakers (name, affiliation, topics, vetted) values ('מרצה קיים/ת', 'מוסד קיים', '{נושא קיים}', 'approved') returning id")).rows[0].id);
    sp.bare = Number((await db.query("insert into public.speakers (name, vetted) values ('מרצה ריק/ה', 'approved') returning id")).rows[0].id);
    await db.query("insert into public.speaker_contacts (speaker_id, phone, notes) values ($1, '000-000-0001', 'הערה קיימת')", [sp.full]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  describe("who may", () => {
    it("only a global admin: an edition's admin and a content member are refused, a stranger is not a member, anon cannot call it", async () => {
      const payload = { source: "brainstorm-5786", titles_from: null, rows: [row(2, "מרצה לבדיקת הרשאות")] };
      for (const who of [ED_ADMIN, A]) expect(await refusal(commit("candidates", payload, who))).toBe("forbidden");
      expect(await refusal(commit("candidates", payload, STRANGER))).toBe("not_member");
      for (const who of [ED_ADMIN, A]) {
        expect(await refusal(commitAs(who, "select public.import_lookup($1, $2)", [[sp.full], ["0000000001"]]))).toBe("forbidden");
      }
      await as(db, "anon", null, async (q) => {
        expect(await refusal(q("select public.import_commit('candidates', '{}'::jsonb)"))).toBe("42501");
        expect(await refusal(q("select public.import_lookup('{}', '{}')"))).toBe("42501");
      });
      expect(await count("select count(*) as n from public.speakers where name = 'מרצה לבדיקת הרשאות'")).toBe(0);
    });

    it("the helpers are no API role's to run", async () => {
      for (const role of ["anon", "authenticated"]) {
        const r = await db.query(
          `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('phone_key', 'title_gender', 'import_speaker', 'import_speakers', 'import_room', 'require_global_admin', 'refuse_row', 'jint', 'jlen')
              and has_function_privilege($1, p.oid, 'EXECUTE')`,
          [role],
        );
        expect(r.rows, role).toEqual([]);
      }
    });
  });

  describe("the lookup", () => {
    it("finds a pool speaker by a phone's key, and says which contact fields are filled — never their values", async () => {
      const r = (await commitAs(ADMIN, "select public.import_lookup($1, $2)", [[sp.bare], [phoneKey("+972 (0)00 000 0001") ?? "", "1111111111"]])) as Record<string, unknown>;
      expect(r).toEqual({
        phones: [{ key: "0000000001", speaker_id: sp.full }],
        contacts: [
          { speaker_id: sp.full, phone: true, email: false, secretary_note: false, notes: true },
          { speaker_id: sp.bare, phone: false, email: false, secretary_note: false, notes: false },
        ],
      });
      expect(JSON.stringify(r)).not.toMatch(/000-000|הערה קיימת/);
    });

    it("app.phone_key is the browser's phoneKey, value for value", async () => {
      const sample = ["011-111-1111", "+972 11 111 1111", "+972 (0)00 000 0001", "00972-11-1111111", "+972 (0)11 111 1111", "111111111", "11111111", "1111111111", "12345", "טלפון לדוגמה", "", "בבית 011-111-1111", "+1 111 111 1111"];
      const r = await db.query("select x, app.phone_key(x) as k from unnest($1::text[]) as x", [sample]);
      expect(r.rows.map((x) => [x.x, x.k])).toEqual(sample.map((x) => [x, phoneKey(x)]));
    });
  });

  describe("(a) the candidates", () => {
    it("adds new speakers (pending, the source as typed), completes the ones the pool has — filling only what is empty", async () => {
      const res = await commit("candidates", {
        source: "brainstorm-5786",
        titles_from: null,
        rows: [
          row(2, "מרצה לדוגמה 1", { title: "הרב", gender: "m", affiliation: "מוסד לדוגמה", topics: ["תנ\"ך"], phone: "0000000002", email: "someone@example.org", notes: "טווח ימים: א-ב" }),
          // the same name key as a pool speaker: completes it — never a second «מרצה קיים/ת»
          row(3, "מרצה  קיים/ת", { affiliation: "מוסד אחר", topics: ["נושא אחר"], phone: "0000000009", notes: "הערה חדשה", email: "other@example.org" }),
          // a phone the pool has, another name: completes that speaker
          row(4, "שם אחר לגמרי", { phone: "+972 (0)00 000 0001" }),
          // chosen by the admin («עמום» → this one)
          row(5, "מרצה רקה", { action: "merge", speaker_id: sp.bare, title: "ד״ר", affiliation: "מוסד לדוגמה" }),
        ],
      });
      expect(res).toMatchObject({ created: 1, merged: 3, filled: 1, contacts: 2, lessons: 0, edition_id: null });
      const created = (await db.query("select * from public.speakers where name = 'מרצה לדוגמה 1'")).rows[0];
      expect(created).toMatchObject({ title: "הרב", gender: "m", affiliation: "מוסד לדוגמה", topics: ["תנ\"ך"], vetted: "pending", source: "brainstorm-5786", vetted_by: null });
      const admin = Number((await db.query("select id from public.members where email = $1 and edition_id is null", [ADMIN])).rows[0].id);
      expect(Number(created.created_by)).toBe(admin);
      // the pool speaker that had an affiliation, topics, a phone and notes: nothing of it overwritten — its e-mail filled
      expect((await db.query("select affiliation, topics, version from public.speakers where id = $1", [sp.full])).rows[0]).toEqual({ affiliation: "מוסד קיים", topics: ["נושא קיים"], version: 1 });
      expect((await db.query("select phone, email, notes from public.speaker_contacts where speaker_id = $1", [sp.full])).rows[0]).toEqual({ phone: "000-000-0001", email: "other@example.org", notes: "הערה קיימת" });
      // the empty one: filled
      expect((await db.query("select title, affiliation, version from public.speakers where id = $1", [sp.bare])).rows[0]).toEqual({ title: "ד״ר", affiliation: "מוסד לדוגמה", version: 2 });
      expect(await count("select count(*) as n from public.speakers where name_key in ('מרצה קיים/ת', 'שם אחר לגמרי')")).toBe(1);
    });

    it("keeps phones and e-mails in speaker_contacts only — not in a speaker's row, and never in the log", async () => {
      const id = Number((await db.query("select id from public.speakers where name = 'מרצה לדוגמה 1'")).rows[0].id);
      expect((await db.query("select phone, email, notes from public.speaker_contacts where speaker_id = $1", [id])).rows[0]).toEqual({ phone: "0000000002", email: "someone@example.org", notes: "טווח ימים: א-ב" });
      const speakerRow = JSON.stringify((await db.query("select * from public.speakers where id = $1", [id])).rows[0]);
      expect(speakerRow).not.toMatch(/0000000002|someone@|טווח ימים/);
      const log = JSON.stringify((await db.query("select detail from public.activity where entity in ('speakers', 'import')")).rows);
      expect(log).not.toMatch(/0000000002|0000000009|example\.org|טווח ימים|הערה|מרצה/);
      expect((await db.query("select kind, detail from public.activity where entity = 'import'")).rows).toEqual([
        { kind: "candidates", detail: { rows: 4, created: 1, merged: 3, filled: 1, contacts: 2, lessons: 0, replaced: 0, source: "brainstorm-5786" } },
      ]);
    });

    it("re-running the same rows adds no one: the second time everything is «תואם»", async () => {
      const before = await count("select count(*) as n from public.speakers");
      const payload = { source: "brainstorm-5786", titles_from: null, rows: [row(2, "מרצה לדוגמה 1", { title: "הרב", gender: "m", phone: "0000000002" }), row(3, "מרצה קיים/ת")] };
      expect(await commit("candidates", payload)).toMatchObject({ created: 0, merged: 2 });
      expect(await commit("candidates", payload)).toMatchObject({ created: 0, merged: 2 });
      expect(await count("select count(*) as n from public.speakers")).toBe(before);
    });

    it("all or nothing: a bad row refuses the whole import, naming the row and why", async () => {
      const before = [await count("select count(*) as n from public.speakers"), await count("select count(*) as n from public.speaker_contacts")];
      const bad = (r: Record<string, unknown>) => commit("candidates", { source: "brainstorm-5786", titles_from: null, rows: [row(2, "מרצה תקין/ה 1"), row(3, "מרצה תקין/ה 2", { phone: "0000000003" }), r] });
      expect(await refusal(bad(row(4, "מרצה עם טלפון שגוי", { phone: "12-34" })))).toBe("import_bad_row 4:bad_phone");
      expect(await refusal(bad(row(5, "מרצה", { title: "ד״ר", gender: "f" })))).toBe("import_bad_row 5:bad_value"); // gender only as the title says
      expect(await refusal(bad(row(6, "מרצה", { title: "מר" })))).toBe("import_bad_row 6:bad_value");
      expect(await refusal(bad(row(7, "  ")))).toBe("import_bad_row 7:name_required");
      expect(await refusal(bad(row(8, "מרצה", { action: "merge", speaker_id: 999999 })))).toBe("import_bad_row 8:stale");
      expect(await refusal(bad(row(9, "מרצה", { email: "לא מייל" })))).toBe("import_bad_row 9:bad_contact_email");
      expect([await count("select count(*) as n from public.speakers"), await count("select count(*) as n from public.speaker_contacts")]).toEqual(before);
      expect(await count("select count(*) as n from public.speakers where name like 'מרצה תקין/ה%'")).toBe(0);
    });

    it("refuses an unknown kind, a missing source, and a payload past its size", async () => {
      expect(await refusal(commit("other", { rows: [] }))).toBe("bad_value");
      expect(await refusal(commit("candidates", { source: " ", rows: [] }))).toBe("bad_value");
      expect(await refusal(commit("candidates", { source: "x", rows: "not rows" }))).toBe("bad_value");
      const many = Array.from({ length: 1001 }, (_, i) => row(i + 2, `מרצה ${i}`));
      expect(await refusal(commit("candidates", { source: "x", titles_from: null, rows: many }))).toBe("import_too_big");
      expect(await refusal(commit("candidates", { source: "x", titles_from: null, rows: [row(2, "מרצה", { notes: "א".repeat(1_000_001) })] }))).toBe("import_too_big");
    });
  });

  describe("(b) the tracking sheet → an archive edition", () => {
    const lesson = (n: number, day: number, start: number, end: number, speakers: number[], extra: Record<string, unknown> = {}) => ({
      row: n, day, start_min: start, end_min: end, room: 0, title: `שיעור לדוגמה ${n}`, category_id: null, audience: null,
      sources_kind: "pending", print_when: "none", sources_note: null, pay_amount: null, import_note: null, speakers, ...extra,
    });
    const archive = (lessons: unknown[], extra: Record<string, unknown> = {}) => ({
      label: "תשפ\"ו", start_date: null, source: "tracking-5786", titles_from: null,
      speakers: [row(2, "מרצה לדוגמה 1", { title: "הרב", gender: "m" }), row(3, "מרצה קיים/ת", { phone: "0000000001" }), row(4, "מרצה לדוגמה 3")],
      lessons, ...extra,
    });
    const LESSONS = [
      lesson(2, 0, 510, 600, [0], { pay_amount: 300, sources_kind: "sheet", import_note: "קיבל הודעת סיכום מ: חניך/ה לדוגמה" }),
      lesson(3, 0, 510, 600, [1], { room: 1, sources_kind: "sheet_video" }),
      lesson(4, 1, 600, 780, [2, 0, 1], { audience: "שיעור להורים", print_when: "before", sources_kind: "sheet" }),
    ];

    it("makes an archive edition (kind archive, status archived) from the template, its lessons closed, rooms for the parallel ones", async () => {
      const res = await commit("tracking", archive(LESSONS));
      expect(res).toMatchObject({ created: 1, merged: 2, lessons: 3, replaced: 0 });
      const e = (await db.query("select * from public.editions where label = 'תשפ\"ו'")).rows[0];
      expect(e).toMatchObject({ kind: "archive", status: "archived", start_date: null });
      expect(Number(res.edition_id)).toBe(Number(e.id));
      expect(await count("select count(*) as n from public.grid_rows where edition_id = $1", [e.id])).toBe(await count("select count(*) as n from public.grid_template"));
      expect((await db.query("select name, is_default from public.rooms where edition_id = $1 order by sort", [e.id])).rows).toEqual([
        { name: "בית מדרש", is_default: true },
        { name: "מקביל 2", is_default: false },
      ]);
      const ls = (await db.query("select l.*, r.name as room from public.lessons l join public.rooms r on r.id = l.room_id where l.edition_id = $1 order by l.day, l.start_min, r.sort", [e.id])).rows;
      expect(ls.map((l) => [l.state, l.kind, l.day, l.start_min, l.end_min, l.room, l.pay_amount, l.sources_kind, l.print_when, l.audience, l.import_note])).toEqual([
        ["closed", "lesson", 0, 510, 600, "בית מדרש", 300, "sheet", "none", null, "קיבל הודעת סיכום מ: חניך/ה לדוגמה"],
        ["closed", "lesson", 0, 510, 600, "מקביל 2", null, "sheet_video", "none", null, null],
        ["closed", "lesson", 1, 600, 780, "בית מדרש", null, "sheet", "before", "שיעור להורים", null],
      ]);
      // the merged lesson: its speakers, the first leading
      const who = (await db.query("select s.name, x.role from public.lesson_speakers x join public.speakers s on s.id = x.speaker_id where x.lesson_id = $1 order by x.role desc, s.name", [ls[2].id])).rows;
      expect(who).toEqual([
        { name: "מרצה לדוגמה 3", role: "lead" },
        { name: "מרצה לדוגמה 1", role: "co" },
        { name: "מרצה קיים/ת", role: "co" },
      ]);
      expect((await db.query("select detail from public.activity where entity = 'import' and kind = 'tracking'")).rows[0].detail).toMatchObject({ lessons: 3, replaced: 0, source: "tracking-5786" });
    });

    it("«לימד/ה אצלנו»: the archive's lessons are in every member's speaker_history", async () => {
      const h = await as(db, "authenticated", google(A), async (q) => (await q("select public.speaker_history($1) as h", [sp.full])).rows[0].h);
      expect(h.map((x: Record<string, unknown>) => [x.edition_label, x.edition_kind, x.day, x.start_min, x.role])).toEqual([
        ["תשפ\"ו", "archive", 0, 510, "lead"],
        ["תשפ\"ו", "archive", 1, 600, "co"],
      ]);
    });

    it("the same label again replaces that edition's lessons — never a second copy, never a second speaker", async () => {
      const speakers = await count("select count(*) as n from public.speakers");
      const res = await commit("tracking", archive(LESSONS.slice(0, 2), { start_date: "2026-02-15" }));
      expect(res).toMatchObject({ created: 0, merged: 3, lessons: 2, replaced: 3 });
      expect(await count("select count(*) as n from public.editions where label = 'תשפ\"ו'")).toBe(1);
      expect(await count("select count(*) as n from public.lessons l join public.editions e on e.id = l.edition_id where e.label = 'תשפ\"ו'")).toBe(2);
      expect(await count("select count(*) as n from public.speakers")).toBe(speakers);
      expect(String((await db.query("select to_char(start_date, 'YYYY-MM-DD') as d from public.editions where label = 'תשפ\"ו'")).rows[0].d)).toBe("2026-02-15");
    });

    it("refuses a label of a live edition, no label, a date not a Sunday — and a lesson that cannot be, naming it; nothing written", async () => {
      const before = [await count("select count(*) as n from public.editions"), await count("select count(*) as n from public.lessons"), await count("select count(*) as n from public.speakers")];
      expect(await refusal(commit("tracking", archive(LESSONS, { label: "תשפ\"ז" })))).toBe("edition_exists");
      expect(await refusal(commit("tracking", archive(LESSONS, { label: "  " })))).toBe("label_required");
      expect(await refusal(commit("tracking", archive(LESSONS, { label: "בדיקה", start_date: "2026-02-16" })))).toBe("not_sunday");
      expect(await refusal(commit("tracking", archive(LESSONS, { label: "בדיקה", start_date: "2026-02-30" })))).toBe("bad_value");
      const one = (l: unknown) => commit("tracking", archive([LESSONS[0], l], { label: "בדיקה" }));
      expect(await refusal(one(lesson(7, 0, 515, 600, [1])))).toBe("import_bad_row 7:room_taken"); // the same room, overlapping
      expect(await refusal(one(lesson(8, 0, 540, 600, [0], { room: 1 })))).toBe("import_bad_row 8:speaker_busy"); // the same speaker, twice at once
      expect(await refusal(one(lesson(9, 0, 512, 600, [1], { room: 2 })))).toBe("import_bad_row 9:bad_shape");
      expect(await refusal(one(lesson(10, 2, 510, 600, [3])))).toBe("import_bad_row 10:bad_value"); // no such speaker row
      expect(await refusal(one(lesson(11, 2, 510, 600, [1], { pay_amount: 0 })))).toBe("import_bad_row 11:bad_amount");
      expect(await refusal(one(lesson(12, 2, 510, 600, [1], { category_id: 999999 })))).toBe("import_bad_row 12:bad_value");
      expect(
        await refusal(commit("tracking", { ...archive(LESSONS, { label: "בדיקה" }), speakers: [row(2, "מרצה לדוגמה 1"), row(3, "x", { phone: "1" }), row(4, "y")] })),
      ).toBe("import_bad_row 3:bad_phone");
      expect([await count("select count(*) as n from public.editions"), await count("select count(*) as n from public.lessons"), await count("select count(*) as n from public.speakers")]).toEqual(before);
    });
  });

  describe("(c) the escorts' file", () => {
    it("fills contact_pref and the secretary note only where empty — never over what is there", async () => {
      await db.query("update public.speaker_contacts set secretary_note = 'נתון קיים' where speaker_id = $1", [sp.full]);
      const res = await commit("escorts", {
        rows: [
          { row: 2, speaker_id: sp.bare, contact_pref: "secretary", secretary_note: "דרך המזכירה" },
          { row: 3, speaker_id: sp.full, contact_pref: "whatsapp", secretary_note: "רק בוואטסאפ" },
        ],
      });
      expect(res).toMatchObject({ created: 0, merged: 2, filled: 2, contacts: 1 });
      expect((await db.query("select s.contact_pref, c.secretary_note from public.speakers s left join public.speaker_contacts c on c.speaker_id = s.id where s.id = $1", [sp.bare])).rows[0]).toEqual({ contact_pref: "secretary", secretary_note: "דרך המזכירה" });
      expect((await db.query("select s.contact_pref, c.secretary_note from public.speakers s left join public.speaker_contacts c on c.speaker_id = s.id where s.id = $1", [sp.full])).rows[0]).toEqual({ contact_pref: "whatsapp", secretary_note: "נתון קיים" });
      // again: nothing more to fill
      expect(await commit("escorts", { rows: [{ row: 2, speaker_id: sp.bare, contact_pref: "phone", secretary_note: "אחר" }] })).toMatchObject({ filled: 0, contacts: 0 });
      expect((await db.query("select contact_pref from public.speakers where id = $1", [sp.bare])).rows[0].contact_pref).toBe("secretary");
    });

    it("a speaker that is not there, or a channel that is not one, refuses the whole import", async () => {
      expect(await refusal(commit("escorts", { rows: [{ row: 2, speaker_id: sp.bare, contact_pref: null, secretary_note: null }, { row: 3, speaker_id: 999999, contact_pref: null, secretary_note: null }] }))).toBe(
        "import_bad_row 3:stale",
      );
      expect(await refusal(commit("escorts", { rows: [{ row: 4, speaker_id: sp.bare, contact_pref: "sms", secretary_note: null }] }))).toBe("import_bad_row 4:bad_value");
    });
  });
});
