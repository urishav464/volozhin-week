// The import of 5786 (v12) in the database, as the roles a browser gets: only a global admin; every row or none;
// a re-run adds no second speaker and no second copy of the archive's lessons; phones and e-mails only in
// speaker_contacts (never in a speaker's row, a lesson or the log); the archive edition's kind and status, and
// «לימד/ה אצלנו» from it (speaker_history). What each refusal is, row by row, is also tests/parity (engine ≡ SQL).
// Synthetic people and numbers only — no phone here has a real shape.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { jsonbText, labelKey } from "../../src/data/importRules";
import { DIGIT_ZEROS, EMAIL_RUN, FORMAT_RANGES, foldContact, hasContact, PG_DIGITS_FROM, PG_DIGITS_TO, PG_FORMAT_CLASS, PHONE, phoneKey, scrubContacts, stripContacts } from "../../src/import/phone";
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
          // a phone the pool has, another name: the preview showed «אותו טלפון כמו …», and the row comes as a merge
          row(4, "שם אחר לגמרי", { action: "merge", speaker_id: sp.full, phone: "+972 (0)00 000 0001" }),
          // chosen by the admin («עמום» → this one)
          row(5, "מרצה רקה", { action: "merge", speaker_id: sp.bare, title: "ד״ר", affiliation: "מוסד לדוגמה" }),
        ],
      });
      expect(res).toMatchObject({ created: 1, merged: 3, filled: 1, contacts: 2, notes: 1, lessons: 0, edition_id: null });
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
        { kind: "candidates", detail: { rows: 4, created: 1, merged: 3, filled: 1, contacts: 2, notes: 1, lessons: 0, replaced: 0, source: "brainstorm-5786" } },
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
      const ls = (
        await db.query(
          `select l.*, r.name as room, n.note as import_note from public.lessons l join public.rooms r on r.id = l.room_id
             left join public.lesson_import_notes n on n.lesson_id = l.id where l.edition_id = $1 order by l.day, l.start_min, r.sort`,
          [e.id],
        )
      ).rows;
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
      // the archive's own week (its last_day_until, 19:00): nothing on Thursday after it ended — the server holds it, not only the browser
      expect(await refusal(one(lesson(13, 4, 1080, 1170, [1])))).toBe("import_bad_row 13:bad_shape");
      expect(await refusal(one(lesson(14, 4, 1470, 1560, [1])))).toBe("import_bad_row 14:bad_shape");
      expect(
        await refusal(commit("tracking", { ...archive(LESSONS, { label: "בדיקה" }), speakers: [row(2, "מרצה לדוגמה 1"), row(3, "x", { phone: "1" }), row(4, "y")] })),
      ).toBe("import_bad_row 3:bad_phone");
      expect([await count("select count(*) as n from public.editions"), await count("select count(*) as n from public.lessons"), await count("select count(*) as n from public.speakers")]).toEqual(before);
    });
  });

  describe("(c) the escorts' file", () => {
    it("fills contact_pref and the secretary note (the admin's own) only where empty — never over what is there", async () => {
      await db.query("update public.speaker_contacts set secretary_note = 'נתון קיים' where speaker_id = $1", [sp.full]);
      const res = await commit("escorts", {
        rows: [
          { row: 2, speaker_id: sp.bare, channel: "secretary", note: "בבוקר" },
          { row: 3, speaker_id: sp.full, channel: "whatsapp", note: "רק בערב" },
        ],
      });
      expect(res).toMatchObject({ created: 0, merged: 2, filled: 2, contacts: 1 });
      expect((await db.query("select s.contact_pref, c.secretary_note from public.speakers s left join public.speaker_contacts c on c.speaker_id = s.id where s.id = $1", [sp.bare])).rows[0]).toEqual({ contact_pref: "secretary", secretary_note: "בבוקר" });
      expect((await db.query("select s.contact_pref, c.secretary_note from public.speakers s left join public.speaker_contacts c on c.speaker_id = s.id where s.id = $1", [sp.full])).rows[0]).toEqual({ contact_pref: "whatsapp", secretary_note: "נתון קיים" });
      // again: nothing more to fill
      expect(await commit("escorts", { rows: [{ row: 2, speaker_id: sp.bare, channel: "phone", note: "אחר" }] })).toMatchObject({ filled: 0, contacts: 0 });
      expect((await db.query("select contact_pref from public.speakers where id = $1", [sp.bare])).rows[0].contact_pref).toBe("secretary");
    });

    it("a speaker that is not there, or a channel that is not on the list, refuses the whole import", async () => {
      expect(await refusal(commit("escorts", { rows: [{ row: 2, speaker_id: sp.bare, channel: "other", note: null }, { row: 3, speaker_id: 999999, channel: "phone", note: null }] }))).toBe("import_bad_row 3:stale");
      expect(await refusal(commit("escorts", { rows: [{ row: 4, speaker_id: sp.bare, channel: "sms", note: null }] }))).toBe("import_bad_row 4:bad_value");
      expect(await refusal(commit("escorts", { rows: [{ row: 5, speaker_id: sp.bare, note: "בבוקר" }] }))).toBe("import_bad_row 5:bad_value");
      expect(await refusal(commit("escorts", { rows: [{ row: 6, speaker_id: sp.bare, channel: "phone", note: { x: 1 } }] }))).toBe("import_bad_row 6:bad_value");
    });

    it("סבב רביעי: no field for the file's text — a row with any other key is refused before anything is read; nothing is written", async () => {
      const was = await count("select count(*) as n from public.speaker_contacts where secretary_note is not null");
      for (const extra of [{ secretary_note: "דרך המזכירה" }, { contact_pref: "phone" }, { phrases: ["דרך המזכירה"] }, { text: "x" }]) {
        expect(await refusal(commit("escorts", { rows: [{ row: 2, speaker_id: sp.bare, channel: "phone", note: null }, { row: 7, speaker_id: 999999, channel: "phone", ...extra }] })), JSON.stringify(extra)).toBe(
          "import_bad_row 7:bad_value", // before the speaker (999999: stale) is even looked up
        );
      }
      expect(await count("select count(*) as n from public.speaker_contacts where secretary_note is not null")).toBe(was);
    });
  });

  // the review of the import and milestone 6 (DECISIONS «ביקורת: ייבוא ואבן דרך 6»)
  describe("what the review found", () => {
    const speakerByName = async (name: string) => (await db.query("select s.*, c.phone, c.email, c.notes from public.speakers s left join public.speaker_contacts c on c.speaker_id = s.id where s.name = $1", [name])).rows;

    it("two names on one line are two people: a 'new' row never completes a speaker by a phone alone", async () => {
      const res = await commit("candidates", {
        source: "brainstorm-5786",
        titles_from: null,
        rows: [
          row(2, "בודק אלף", { title: "הרב", gender: "m", phone: "000-000-0077" }),
          row(3, "בודקת בית", { title: "הרבנית", gender: "f", phone: "+972 (0)00 000 0077", email: "beit@example.org", notes: "רק בבוקר", topics: ["נושא ב"] }),
        ],
      });
      expect(res).toMatchObject({ created: 2, merged: 0 });
      const [a] = await speakerByName("בודק אלף");
      const [b] = await speakerByName("בודקת בית");
      expect([a.title, a.gender, a.topics, a.phone, a.email, a.notes]).toEqual(["הרב", "m", [], "000-000-0077", null, null]);
      expect([b.title, b.gender, b.topics, b.phone, b.email, b.notes]).toEqual(["הרבנית", "f", ["נושא ב"], "+972 (0)00 000 0077", "beit@example.org", "רק בבוקר"]);
    });

    it("a phone an earlier row's merge just gave a pool speaker does not take a 'new' row of another name", async () => {
      const veteran = Number((await db.query("insert into public.speakers (name, vetted) values ('מרצה ותיק/ה לבדיקה', 'approved') returning id")).rows[0].id);
      const res = await commit("candidates", {
        source: "brainstorm-5786",
        titles_from: null,
        rows: [row(2, "מרצה ותיק/ה לבדיקה", { action: "merge", speaker_id: veteran, phone: "0000000088" }), row(3, "אדם אחר לגמרי", { phone: "0000000088", email: "other.person@example.org" })],
      });
      expect(res).toMatchObject({ created: 1, merged: 1 });
      expect((await speakerByName("מרצה ותיק/ה לבדיקה"))[0]).toMatchObject({ phone: "0000000088", email: null });
      expect((await speakerByName("אדם אחר לגמרי"))[0]).toMatchObject({ phone: "0000000088", email: "other.person@example.org" });
    });

    it("the tracking sheet too: two speakers with one phone keep their own lessons", async () => {
      const res = await commit("tracking", {
        label: "בדיקת טלפון משותף", start_date: null, source: "tracking-5786", titles_from: null,
        speakers: [row(2, "בודק גימל", { phone: "000-000-0066" }), row(3, "בודקת דלת", { phone: "0000000066" })],
        lessons: [
          { row: 2, day: 0, start_min: 510, end_min: 600, room: 0, title: "שיעור בדיקה 2", category_id: null, audience: null, sources_kind: "pending", print_when: "none", sources_note: null, pay_amount: null, import_note: null, speakers: [0] },
          { row: 3, day: 1, start_min: 510, end_min: 600, room: 0, title: "שיעור בדיקה 3", category_id: null, audience: null, sources_kind: "pending", print_when: "none", sources_note: null, pay_amount: null, import_note: null, speakers: [1] },
        ],
      });
      expect(res).toMatchObject({ created: 2, merged: 0, lessons: 2 });
      const who = (
        await db.query(
          `select l.title, s.name from public.lessons l join public.lesson_speakers x on x.lesson_id = l.id join public.speakers s on s.id = x.speaker_id
            where l.edition_id = $1 order by l.title`,
          [res.edition_id],
        )
      ).rows;
      expect(who).toEqual([{ title: "שיעור בדיקה 2", name: "בודק גימל" }, { title: "שיעור בדיקה 3", name: "בודקת דלת" }]);
    });

    it("never fills a gender the speaker's own title contradicts — a title that says none (ד״ר) still takes the row's", async () => {
      const id = async (name: string, title: string) => Number((await db.query("insert into public.speakers (title, name, vetted) values ($1, $2, 'approved') returning id", [title, name])).rows[0].id);
      const f = await id("מרצה בתואר הרבנית", "הרבנית");
      const g = await id("מרצה בתואר הרבנית ב", "הרבנית");
      const dr = await id("מרצה בתואר דוקטור", "ד״ר");
      const res = await commit("candidates", {
        source: "brainstorm-5786",
        titles_from: null,
        rows: [
          row(2, "מרצה בתואר הרבנית", { title: "הרב", gender: "m" }), // by its name key
          row(3, "מרצה בתואר הרבנית ב", { action: "merge", speaker_id: g, title: "הרב", gender: "m" }), // chosen («עמום»)
          row(4, "מרצה בתואר דוקטור", { title: "הרב", gender: "m" }),
        ],
      });
      expect(res).toMatchObject({ created: 0, merged: 3, filled: 1 });
      const read = async (x: number) => (await db.query("select title, gender from public.speakers where id = $1", [x])).rows[0];
      expect([await read(f), await read(g), await read(dr)]).toEqual([
        { title: "הרבנית", gender: null },
        { title: "הרבנית", gender: null },
        { title: "ד״ר", gender: "m" },
      ]);
    });

    it("the mirror: never fills a title that says the other gender than the speaker's — by name key and chosen; one of the same gender is", async () => {
      const id = async (name: string, gender: string) => Number((await db.query("insert into public.speakers (name, gender, vetted) values ($1, $2, 'approved') returning id", [name, gender])).rows[0].id);
      const f = await id("מרצה ראי בלי תואר א", "f");
      const m = await id("מרצה ראי בלי תואר ב", "m");
      const same = await id("מרצה ראי בלי תואר ג", "m");
      const res = await commit("candidates", {
        source: "brainstorm-5786",
        titles_from: null,
        rows: [
          row(2, "מרצה ראי בלי תואר א", { title: "הרב", gender: "m" }), // by its name key
          row(3, "שם אחר לגמרי", { action: "merge", speaker_id: m, title: "הרבנית", gender: "f", phone: "000-000-0099" }), // chosen (a pool phone)
          row(4, "מרצה ראי בלי תואר ג", { title: "הרב", gender: "m" }),
        ],
      });
      expect(res).toMatchObject({ created: 0, merged: 3, filled: 1, contacts: 1 });
      const read = async (x: number) => (await db.query("select title, gender from public.speakers where id = $1", [x])).rows[0];
      expect([await read(f), await read(m), await read(same)]).toEqual([
        { title: null, gender: "f" },
        { title: null, gender: "m" },
        { title: "הרב", gender: "m" },
      ]);
      // the log names no field it did not fill
      const fields = (await db.query("select detail from public.activity where entity = 'speakers' and entity_id = any ($1::bigint[]) and kind = 'update'", [[f, m]])).rows;
      expect(fields).toEqual([]);
    });

    it("a match keeps the speaker's own title and gender while it fills an empty field — never overwrites them", async () => {
      const x = Number((await db.query("insert into public.speakers (title, name, gender, vetted) values ('ד״ר', 'מרצה עם תואר ומגדר', 'f', 'approved') returning id")).rows[0].id);
      const read = async () => (await db.query("select title, gender, affiliation, topics, version from public.speakers where id = $1", [x])).rows[0];
      await commit("candidates", { source: "brainstorm-5786", titles_from: null, rows: [row(2, "מרצה עם תואר ומגדר", { title: "הרב", gender: "m", affiliation: "מוסד לבדיקה" })] });
      expect(await read()).toEqual({ title: "ד״ר", gender: "f", affiliation: "מוסד לבדיקה", topics: [], version: 2 });
      await commit("candidates", { source: "brainstorm-5786", titles_from: null, rows: [row(2, "אחר", { action: "merge", speaker_id: x, title: "הרבנית", gender: "f", topics: ["נושא לבדיקה"] })] });
      expect(await read()).toEqual({ title: "ד״ר", gender: "f", affiliation: "מוסד לבדיקה", topics: ["נושא לבדיקה"], version: 3 });
    });

    it("counts a phone or an e-mail apart from a note: a note alone is no contact detail", async () => {
      const res = await commit("candidates", {
        source: "brainstorm-5786",
        titles_from: null,
        rows: [row(2, "מרצה עם הערה בלבד", { notes: "טווח ימים: נסגר" }), row(3, "מרצה עם טלפון בלבד", { phone: "0000000042" })],
      });
      expect(res).toMatchObject({ created: 2, contacts: 1, notes: 1 });
    });

    it("an imported lesson's note is not the lesson's: its own table, read one lesson at a time under the transport details' rule", async () => {
      const archive = Number((await db.query("select id from public.editions where label = 'תשפ\"ו'")).rows[0].id);
      const noted = Number((await db.query("select n.lesson_id from public.lesson_import_notes n where n.edition_id = $1", [archive])).rows[0].lesson_id);
      const NOTE = "קיבל הודעת סיכום מ: חניך/ה לדוגמה";
      // a global admin reads it — in the lesson panel, never in the Week
      expect(await commitAs(ADMIN, "select public.get_import_note($1)", [noted])).toBe(NOTE);
      const week = JSON.stringify(await commitAs(ADMIN, "select public.load_week($1)", [archive]));
      expect(week).not.toContain("import_note");
      expect(week).not.toContain(NOTE);
      // anyone else: nothing — this year's team, an all-editions content member, a content member of the archive itself
      const EVERY = "every.content@example.org";
      const OLD = "archive.content@example.org";
      await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, 'content', null), ($2, $2, 'content', $3)", [EVERY, OLD, archive]);
      for (const who of [A, ED_ADMIN, EVERY, OLD]) {
        expect(await commitAs(who, "select public.get_import_note($1)", [noted]), who).toBeNull();
        expect(await commitAs(who, "select count(*)::int from public.lesson_import_notes"), who).toBe(0);
      }
      await db.query("delete from public.members where email in ($1, $2)", [EVERY, OLD]);
    });

    it("an archive's label is one archive whatever its quote marks: «תשפ״ו» and «תשפ”ו» replace «תשפ\"ו», a live edition's is refused", async () => {
      const sample = ["תשפ\"ו", "תשפ״ו", "תשפ”ו", "תשפ“ו", "  תשפ׳ו  ב ", "שנה ‘א’", "תשפ″ו", ""];
      const r = await db.query("select x, app.label_key(x) as k from unnest($1::text[]) as x", [sample]);
      expect(r.rows.map((x) => [x.x, x.k])).toEqual(sample.map((x) => [x, labelKey(x)]));
      const editions = async () => (await db.query("select label from public.editions where app.label_key(label) = 'תשפ\"ו'")).rows.map((x) => x.label);
      const lessons = (title: string) => [{ row: 2, day: 2, start_min: 870, end_min: 960, room: 0, title, category_id: null, audience: null, sources_kind: "pending", print_when: "none", sources_note: null, pay_amount: null, import_note: null, speakers: [0] }];
      const payload = (label: string, title: string) => ({ label, start_date: null, source: "tracking-5786", titles_from: null, speakers: [row(2, "מרצה לדוגמה 1")], lessons: lessons(title) });
      const before = await count("select count(*) as n from public.lessons l join public.editions e on e.id = l.edition_id where e.label = 'תשפ\"ו'");
      expect(await commit("tracking", payload("תשפ״ו", "בגרשיים"))).toMatchObject({ lessons: 1, replaced: before });
      expect(await commit("tracking", payload(" תשפ”ו ", "במירכאות מעוגלות"))).toMatchObject({ lessons: 1, replaced: 1 });
      expect(await editions()).toEqual(["תשפ\"ו"]);
      // the live edition, typed with gershayim: still the live edition's label
      expect(await refusal(commit("tracking", payload("תשפ״ז", "x")))).toBe("edition_exists");
      // a new archive is stored in the key's form
      const made = await commit("tracking", payload("ארכיון ״בדיקה״", "x"));
      expect((await db.query("select label from public.editions where id = $1", [made.edition_id])).rows[0].label).toBe("ארכיון \"בדיקה\"");
      // an edition stored with gershayim (made before the key, or by start_edition): found by its key all the same
      await db.query("insert into public.editions (label, kind, status) values ('ארכיון ״ישן״', 'archive', 'archived'), ('תרגול ״ישן״', 'practice', 'planning')");
      expect(await commit("tracking", payload('ארכיון "ישן"', "x"))).toMatchObject({ lessons: 1, replaced: 0 });
      expect((await db.query("select count(*)::int as n from public.editions where app.label_key(label) = 'ארכיון \"ישן\"'")).rows[0].n).toBe(1);
      expect(await refusal(commit("tracking", payload('תרגול "ישן"', "x")))).toBe("edition_exists");
      // two editions that already answer to one key (made before it) are not guessed between
      await db.query("insert into public.editions (label, kind, status) values ('כפול\"ה', 'archive', 'archived'), ('כפול״ה', 'archive', 'archived')");
      expect(await refusal(commit("tracking", payload("כפול\"ה", "x")))).toBe("label_ambiguous");
    });

    it("the engine measures the payload as the database does: the bytes of its jsonb text", async () => {
      const samples: unknown[] = [
        { a: 1, b: [1, 2] },
        { rows: [{ row: 2, action: "new", name: "שם עם \"מירכאות\" ו\\לוכסן", notes: "שורה\nשנייה\tטאב", topics: [], phone: null, ok: true }], source: "x" },
        { e: {}, f: [], g: -5, h: 300, i: 1.5, j: "😀 ✓", k: [null, false, [{}]] },
      ];
      for (const x of samples) {
        const pg = Number((await db.query("select octet_length($1::jsonb::text) as n", [JSON.stringify(x)])).rows[0].n);
        expect(Buffer.byteLength(jsonbText(x)), JSON.stringify(x)).toBe(pg);
      }
    });
  });

  describe("סבב שלישי: a phone or an e-mail only in phone and e-mail — app.has_contact, the browser's hasContact", () => {
    it("is written with the browser's very expressions — and answers as it does, string for string (fixed cases and 10,000 seeded ones)", async () => {
      const def = String((await db.query("select pg_get_functiondef('app.has_contact(text)'::regprocedure) as d")).rows[0].d);
      for (const part of [PHONE, EMAIL_RUN]) expect(def).toContain(part);
      const fold = String((await db.query("select pg_get_functiondef('app.contact_fold(text)'::regprocedure) as d")).rows[0].d);
      for (const part of [PG_FORMAT_CLASS, PG_DIGITS_FROM, PG_DIGITS_TO]) expect(fold).toContain(part);
      const fixed = [
        "", "שלום", "000-000-0001", "+972-00-000-0002", "(000) 000-0003", "000 000 0004", "0000000005", "טל' 000-000-0006", "[000-000-0007]",
        "000\u200f-\u200f000\u200f-0008", "000\u2011000\u20110009", "000\u00a0000\u00a00010", "000-000\n0011", "000 / 000", "123456", "1234567",
        "12.3.2026", "12.3.2026 20:00", "12.3.26", "1948-1967", "1948 - 1967", "1948\u200f-\u200f1967", "8.30-10.00", "08.30 – 10.00", "2025-2026",
        "someone@example.org", "mailto:someone@example.org", "<a@b.c>", "a @ b.c", "a@b", "פלוני@מוסד.ישראל", "(a@b.c)", "@", "x@y.z w",
        "\ufeff000-000-0012\ufeff", "\u2003000\u2003000\u20030013", "000\u00ad000\u00ad0014", "תש״ח 1948-1967, 12.3.2026", "עמ' 12-15", "300 ₪",
        // סבב רביעי: the reviewers' forms — other separators, other digits, what shows nothing, the e-mail spaced
        "000/000/0091", "000 / 000 / 0092", "000·000·0093", "000•000•0094", "000,000,0095", "000_000_0096", "000‧000‧0097", "000:000:0098",
        "０００－０００－００９９", "٠٠٠-٠٠٠-٠١٠٠", "۰۰۰-۰۰۰-۰۱۰۱", "𝟎𝟎𝟎𝟎𝟎𝟎𝟎𝟏𝟎𝟐", "000\u180e000\u180e0103", "000\u0085000\u00850104", "000\u2063000\u{e0020}0105",
        "someone @example.org", "someone@ example.org", "someone@example .org", "someone@@example.org", "someone＠example.org", "someone @ example . org", "פלוני@@מוסד.ישראל", "פלוני＠מוסד.ישראל",
        "(00) 0000211", "000/0000212", "20:00 (000-000-0106)", "8:30, 9:45, 10:15", "8:30,9:45,10:15", "12.3.2026 20:00", "שעה 20:00 ו-21:30",
        // …and what is no phone: years, dates and chapters — never cut from a title
        "1948-1967-1973", "1948, 1967, 1973", "1948/1967", "14.2-18.2.2027", "14.2.2027-18.2.2027", "12.3-15.3.2026", "1-2-3-4-5-6-7", "1, 2, 3, 4, 5, 6, 7",
        "1,2,3,4,5,6,7", "12-13-14-15", "פרקים 12, 13, 14, 15", "05-21-23-45-67", "12/3", "8 @ 10.30", "a @ b. c",
        // סבב חמישי: by the numbering plan — Israeli numbers (built here, so no number is written in this file), abroad, beside a word…
        ...[["052", "1234567"], ["03", "1234567"], ["077", "1234567"], ["1", "800", "123456"], ["972", "52", "1234567"], ["+44", "20", "79460958"], ["00", "33", "123456789"]].flatMap((p) => [p.join(""), p.join("-"), p.join(" / "), `שם ${p.join(" ")} שם`]),
        ["052", "123", "4567"].join("|"), ["052", "123", "4567"].join(";"), ["052", "123", "4567"].join(":"), ["02", "123", "4567"].join(":"), ["052", "1234567"].join(".").concat(".12"),
        "טל' 1234567", "נייד: 1234567", "בטלפון 1234567", "tel 1234567", "☎ 1234567", "📞1234567", "1234567 (נייד)", "טל' *2345", "2345* טלפון", "*2345", "2345*", "טל' 123456",
        "טל 1234567", "Tel Aviv 1234567", "telephone: 12345678", "פקס 12345678", "📱 +1234567",
        // …and what is text: verses, dates and times in every form (the xlsx reader's ISO too), pages, prices, years
        "תהלים 119:1-176", "ישעיהו 40:1-41:10", "בראשית 28:10-32:3", "12.3 20:00", "12/3 20:00", "14.2 08:30", "12.3.2026 10:00-11:30", "12.3 10:00-11:30",
        "14-18/2/2027", "14-18.2.2027", "2026-02-10", "2026-02-10 08:30", "05.10.2026 08:30", "05-10-2026 20:00", "05-10-2026 20", "05.10-07.10.26", "05/10/2026 08:30",
        "עמ' 112,134,156", "עמ' 1203-1305", "1 • 2 • 3 • 4 • 5 • 6 • 7", "1,500,000 ₪", "1,000,000,000", "1948 1967 1973", "1948-67-73", "5786-5787", "ISBN 978-965-000-000-0",
        "20:00-21:00-22:00", "18:00-19:00 20:00-21:00", "טל' 1234567 12.3.2026", "טל' 1234567 05-10-2026 08:30", "טל' 1234567 2026-02-10 08:30",
        // the residuals (DECISIONS «סבב חמישי»): six digits, «at», no 0 and no word, an e-mail with no TLD or a comma for its dot
        "123456", "someone(at)example.org", "521234567", "someone@example", "someone@example,org",
        // סבב שישי: a two-digit-year date (dashes or spaces) is text, never a phone's start — at its day, its month or its
        // year — and pairs that go on past it are a number; +972 and 00972 of a fixed length, an amount after them text
        "05-10-26", "03 11 25", "04-05-26", "31-12-25", "1-1-26", "05-10-26 - 07-10-26", "07-03-26 - 09-03-26", "32-01-26", "05-13-26",
        ...["03-11-25", "04-05-26", "03 11 25", "09-01-26"].flatMap((d) => [" ", "\n", " (", " - "].flatMap((sep) => [`אישר ${d}${sep}${["052", "1234567"].join("-")}`, `אישר ${d}${sep}${["072", "123", "4567"].join(" ")}`])),
        ["03", "12", "34", "56", "7"].join("-"), ["03", "12", "34", "56", "7"].join(" "), ["02", "12", "34", "567"].join("-"), ["05", "01", "23", "45", "67"].join(" "),
        `06 09 44 ${["04", "123", "4567"].join(" ")}`, `17 09 11 ${["07", "12", "34", "56", "78"].join("-")}`, `16 11 09 ${["1", "599", "123", "456"].join("-")}`,
        ...[" - 400 ₪", "\n350 ₪", " 1,500 ₪", " 2 נוסעים", " 1948-1949", " 40,000"].flatMap((after) => [`${["+972", "52", "123", "4567"].join(" ")}${after}`, `${["00972", "52", "1234567"].join("-")}${after}`]),
        ["+972", "1", "2345", "6789"].join(" "), ["00972", "12345678"].join(""),
      ];
      // seeded strings of digits, separators, marks, letters and @ — the corners where two engines could part
      const ALPHABET = [
        ..."0123456789 -.()+/:@,ab\n\t\u00a0\u200f\u200b\u2011\u2013\u2003\ufeff\u00ad\u05beאב<>·•‧_\u0085\u180e\u2028\u200d\u2060\u2066＠oz|;*",
        "\u{e0020}", "\u{1d7ce}", "\u{1d7d9}",
        // סבב חמישי: the numbering plan's corners — its prefixes, the words that say a phone, a date's and a time's shapes
        "05", "07", "02", "972", "+972", "00", "1-800-", "טל' ", "נייד ", "טלפון: ", "tel:", "☎", "📞", "2026-", "12.3.", ":30",
      ];
      // a digit: ASCII mostly — Arabic-Indic, Persian, fullwidth, Devanagari now and then
      const DIGITS = [0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x660, 0x6f0, 0xff10, 0x966];
      let a = 7;
      const next = () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296);
      const digit = () => String.fromCodePoint(DIGITS[Math.floor(next() * DIGITS.length)] + Math.floor(next() * 10));
      const random = Array.from({ length: 6000 }, () => Array.from({ length: Math.floor(next() * 24) }, () => (next() < 0.55 ? digit() : ALPHABET[Math.floor(next() * ALPHABET.length)])).join(""));
      // …and 4,000 built of the numbering plan's own pieces (סבב חמישי): numbers by the plan — and a digit short or long —
      // with every separator, beside dates, times, verses, prices and the words that say a phone
      const ds = (n: number) => Array.from({ length: n }, () => digit()).join("");
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
      const SEPS = ["", "-", " ", ".", "/", " / ", ":", ",", ", ", "|", ";", "·", "_", "\u200f-\u200f", "\n", "(", ") "];
      const number = () => {
        const head = pick(["05", "07", "02", "03", "04", "08", "09", "06", "01", "00", "1-800", "1700", "972", "+972", "+44", "+1", "0", ""]);
        const parts = [head + ds(Math.floor(next() * 3)), ds(1 + Math.floor(next() * 4)), ds(1 + Math.floor(next() * 5))];
        return parts.join(pick(SEPS));
      };
      const piece = () =>
        pick([
          number, number, number,
          () => `${ds(2)}.${ds(1)}.20${ds(2)}`, () => `20${ds(2)}-${ds(2)}-${ds(2)} ${ds(2)}:${ds(2)}`, () => `${ds(2)}:${ds(2)}-${ds(2)}:${ds(2)}`, () => `${ds(3)}:${ds(1)}-${ds(3)}`,
          () => `${ds(1)},${ds(3)},${ds(3)}`, () => `19${ds(2)}-19${ds(2)}`, () => `*${ds(4)}`, () => `${ds(4)}*`,
          () => `${ds(2)}-${ds(2)}-${ds(2)}`, () => `${ds(2)} ${ds(2)} ${ds(2)}`, () => `00972${pick(SEPS)}${ds(2)}`,
          () => pick(["טל' ", "נייד ", "טלפון: ", "בטלפון ", "tel ", "☎", "📞", "פקס ", " (נייד)", "טל ", "Tel Aviv ", "שם ", "עמ' ", "₪", "@", "a@example.org"]),
        ])();
      const built = Array.from({ length: 4000 }, () => Array.from({ length: 1 + Math.floor(next() * 4) }, piece).join(pick([" ", "", ", ", "\n", " - "])));
      const sample = [...fixed, ...random, ...built];
      const r = await db.query("select o, app.has_contact(x) as h from unnest($1::text[]) with ordinality as u(x, o) order by o", [sample]);
      const differ = r.rows.filter((x) => x.h !== hasContact(sample[Number(x.o) - 1])).map((x) => JSON.stringify(sample[Number(x.o) - 1]));
      expect(differ).toEqual([]);
      expect(r.rows.filter((x) => x.h).length).toBeGreaterThan(1000); // not vacuous: many hold one
      expect(r.rows.filter((x) => !x.h).length).toBeGreaterThan(1000);
      // the fold, character for character (every format character and every digit of the lists, and beside them)
      const edges = [...FORMAT_RANGES.flatMap(([lo, hi]) => [lo - 1, lo, hi, hi + 1]), ...DIGIT_ZEROS.flatMap((z) => [z - 1, z, z + 9, z + 10])].filter((cp) => cp > 0 && (cp < 0xd800 || cp > 0xdfff));
      const chars = edges.map((cp) => `a${String.fromCodePoint(cp)}b`);
      const f = await db.query("select o, app.contact_fold(x) as f from unnest($1::text[]) with ordinality as u(x, o) order by o", [chars]);
      expect(f.rows.filter((x) => x.f !== foldContact(chars[Number(x.o) - 1])).map((x) => chars[Number(x.o) - 1].codePointAt(1)!.toString(16))).toEqual([]);
      // the lists are this runtime's Unicode: every format character and every decimal digit it knows
      for (let cp = 0; cp <= 0x10ffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        const ch = String.fromCodePoint(cp);
        if (/\p{Cf}/u.test(ch)) expect(foldContact(ch), cp.toString(16)).toBe("");
        else if (/\p{Nd}/u.test(ch)) expect(foldContact(ch), cp.toString(16)).toMatch(/^[0-9]$/);
      }
      // and what the browser scrubs or strips never holds one
      for (const x of sample) {
        expect(hasContact(scrubContacts(x).text), JSON.stringify(x)).toBe(false);
        expect(hasContact(stripContacts(x).text), JSON.stringify(x)).toBe(false);
      }
    });

    it("a contact in any other field of the payload refuses the whole import, naming the row; nothing is written", async () => {
      const before = async () => [await count("select count(*) as n from public.speakers"), await count("select count(*) as n from public.lessons"), await count("select count(*) as n from public.speaker_contacts")];
      const was = await before();
      const cand = (bad: Record<string, unknown>) => commit("candidates", { source: "brainstorm-5786", titles_from: null, rows: [row(2, "מרצה תקין/ה לבדיקה"), row(5, "מרצה לבדיקה", bad)] });
      expect(await refusal(cand({ name: "מרצה לבדיקה 000-000-0071" }))).toBe("import_bad_row 5:contact_in_text");
      expect(await refusal(cand({ affiliation: "מוסד\n000-000-0072" }))).toBe("import_bad_row 5:contact_in_text");
      expect(await refusal(cand({ affiliation: "someone@example.org" }))).toBe("import_bad_row 5:contact_in_text");
      expect(await refusal(cand({ topics: ["תנ״ך", "+972-00-000-0073"] }))).toBe("import_bad_row 5:contact_in_text");
      expect(await refusal(cand({ notes: "להתקשר: 000\u200f-\u200f000\u200f-0074" }))).toBe("import_bad_row 5:contact_in_text");
      expect(await refusal(commit("candidates", { source: "a@example.org", titles_from: null, rows: [row(2, "מרצה תקין/ה לבדיקה")] }))).toBe("contact_in_text");
      const lesson = (extra: Record<string, unknown>) => ({ row: 7, day: 1, start_min: 510, end_min: 600, room: 0, title: null, category_id: null, audience: null, sources_kind: "pending", print_when: "none", sources_note: null, pay_amount: null, import_note: null, speakers: [0], ...extra });
      const arch = (extra: Record<string, unknown>, label = "בדיקת מספר בטקסט") => commit("tracking", { label, start_date: null, source: "tracking-5786", titles_from: null, speakers: [row(2, "מרצה תקין/ה לבדיקה")], lessons: [lesson({ row: 6, day: 0 }), lesson(extra)] });
      for (const bad of [{ title: "שיעור 000-000-0076" }, { audience: "someone@example.org" }, { sources_kind: "other", sources_note: "000-000-0077" }, { import_note: "נהג (000) 000-0078" }]) {
        expect(await refusal(arch(bad)), JSON.stringify(bad)).toBe("import_bad_row 7:contact_in_text");
      }
      expect(await refusal(arch({}, "ארכיון 000-000-0079"))).toBe("contact_in_text");
      expect(await refusal(commit("escorts", { rows: [{ row: 2, speaker_id: sp.bare, channel: "other", note: "בבוקר" }, { row: 3, speaker_id: sp.bare, channel: "phone", note: "בבוקר 000-000-0081" }] }))).toBe(
        "import_bad_row 3:contact_in_text",
      );
      for (const note of ["בערב ٠٠٠-٠٠٠-٠٠٨٢", "בערב 000/000/0083", "someone @example.org", "000\u0085000\u00850084"]) {
        expect(await refusal(commit("escorts", { rows: [{ row: 4, speaker_id: sp.bare, channel: "phone", note }] })), note).toBe("import_bad_row 4:contact_in_text");
      }
      expect(await before()).toEqual(was);
      expect(await count("select count(*) as n from public.editions where label in ('בדיקת מספר בטקסט', 'ארכיון 000-000-0079')")).toBe(0);
      // what is no phone is accepted: a date, a range of years or of times
      expect(await commit("candidates", { source: "brainstorm-5786", titles_from: null, rows: [row(2, "מרצה עם תאריכים", { affiliation: "מוסד 1948-1967", notes: "נקבע 12.3.2026 20:00, 8.30-10.00" })] })).toMatchObject({ created: 1 });
    });

    it("סבב חמישי: by the numbering plan — a realistic number refused in any field; verses, dates and times, pages, prices stored whole", async () => {
      // every number is built here from its parts: no phone is written in this file
      const n = (...parts: string[]) => parts.join("");
      const cand = (bad: Record<string, unknown>) => commit("candidates", { source: "brainstorm-5786", titles_from: null, rows: [row(5, "מרצה לבדיקה", bad)] });
      for (const bad of [{ name: `מרצה לבדיקה ${n("052", "-", "1234567")}` }, { affiliation: `מכון ${n("03", " ", "1234567")}` }, { topics: [n("+44", " 20 ", "7946 0958")] }, { notes: `טל' ${n("123", "-", "4567")}` }, { notes: `${n("1-800", "-123-", "456")} (מוקד)` }]) {
        expect(await refusal(cand(bad)), JSON.stringify(bad)).toBe("import_bad_row 5:contact_in_text");
      }
      const text = { title: "עיון בתהלים 119:1-176", sources_kind: "other", sources_note: "ישעיהו 40:1-41:10, עמ' 112,134,156", import_note: "אושר בתאריך: 2026-02-10 08:30\nהסעה: 1,500,000 ₪ (לא באמת), 05.10.2026 08:30" };
      const lesson = { row: 2, day: 0, start_min: 510, end_min: 600, room: 0, category_id: null, audience: null, print_when: "none", pay_amount: null, speakers: [0], ...text };
      await commit("tracking", { label: "ארכיון סבב חמישי", start_date: null, source: "tracking-5786", titles_from: null, speakers: [row(2, "מרצה עם פסוקים")], lessons: [lesson] });
      const stored = (await db.query("select l.title, l.sources_note, n.note from public.lessons l join public.editions e on e.id = l.edition_id left join public.lesson_import_notes n on n.lesson_id = l.id where e.label = 'ארכיון סבב חמישי'")).rows;
      expect(stored).toEqual([{ title: text.title, sources_note: text.sources_note, note: text.import_note }]);
    });
  });
});
