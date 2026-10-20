// The two parts of v12 together, in the database: the archive edition the import of 5786 makes (kind 'archive',
// status 'archived') and the after-the-week functions. The imported year is a past year for «סיכום המחזור»
// (edition_returning), «לימד/ה אצלנו» (speaker_history) and «איך עבר בשנים קודמות» (speaker_reviews); a re-run of
// its label never deletes a review with the lessons it replaces (`archive_reviewed`); the purge of an imported
// archive needs no date and clears what last year's sheet said (lessons.import_note — its transport and payment
// words), as it deletes a live edition's transport details; and start_edition's «previous edition» is the live real
// one — never an import, however new its id. (Engine ≡ SQL for the same: tests/parity, «the import meets after the
// week».) Synthetic people and words only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SCHEMA, dropDatabase, freshDatabase, google } from "./db";

const ADMIN = "admin@example.org"; // every edition
const A = "a@example.org"; // content this year; handles the speaker below
const L = "logistics@example.org";
const NOTE = "הסעה/תשלום: איסוף מתחנה לדוגמה, נהג/ת לדוגמה\nקיבל הודעת סיכום מ: חניך/ה לדוגמה";
const WENT_WELL = "עבר טוב באשתקד";
const LABEL = "תשפ\"ו";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message: string };
    return err.code === "P0001" ? err.message : (err.code ?? "error");
  }
}

describe("the import of 5786 meets after the week", () => {
  const dbName = `vw_import_after_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let archive: number;
  const sp: Record<string, number> = {};
  const lesson: Record<string, number> = {};

  /** As a member, COMMITTED; the first column of the first row, or the refusal thrown. */
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
  const owner = async (sql: string, params: unknown[] = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
  const commit = (payload: unknown) => commitAs(ADMIN, "select public.import_commit('tracking', $1::jsonb)", [JSON.stringify(payload)]) as Promise<Record<string, unknown>>;
  const row = (n: number, id: number) => ({ row: n, action: "merge", speaker_id: id, title: null, name: "x", gender: null, affiliation: null, topics: [], phone: null, email: null, notes: null });
  const archiveLesson = (n: number, day: number, start: number, end: number, speakers: number[], extra: Record<string, unknown> = {}) => ({
    row: n, day, start_min: start, end_min: end, room: 0, title: `שיעור לדוגמה ${n}`, category_id: null, audience: null,
    sources_kind: "pending", print_when: "none", sources_note: null, pay_amount: null, import_note: null, speakers, ...extra,
  });
  const payload = (lessons: unknown[]) => ({ label: LABEL, start_date: "2026-02-15", source: "tracking-5786", titles_from: null, speakers: [row(2, sp.taught), row(3, sp.other)], lessons });
  const notes = async () => (await db.query("select import_note from public.lessons where edition_id = $1 order by day, start_min", [archive])).rows.map((r) => r.import_note);

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ז', '2027-02-14', 510)"));
    // this year's own wording and milestones — what a new edition carries over
    await db.query("update public.editions set settings = settings || '{\"confirm_template\": \"נוסח של השנה\"}'::jsonb where id = $1", [ed]);
    await db.query("insert into public.milestones (edition_id, title, days_before) values ($1, 'אבן דרך לדוגמה', 42)", [ed]);
    for (const [email, role] of [[A, "content"], [L, "logistics"]] as const) {
      await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3)", [email, role, ed]);
    }
    sp.taught = Number(await owner("insert into public.speakers (name, gender, vetted) values ('מרצה שלימד/ה אשתקד', 'f', 'approved') returning id"));
    sp.other = Number(await owner("insert into public.speakers (name, gender, vetted) values ('מרצה נוסף/ת', 'm', 'approved') returning id"));
    // last year's sheet, imported: its lessons closed, one with what the sheet said about its transport
    const res = await commit(payload([archiveLesson(2, 0, 510, 600, [0], { import_note: NOTE }), archiveLesson(3, 1, 600, 690, [1], { pay_amount: 250 })]));
    archive = Number(res.edition_id);
    expect(archive).toBeGreaterThan(ed); // the import is the newest edition by id
    lesson.archived = Number(await owner("select id from public.lessons where edition_id = $1 and day = 0", [archive]));
    // this year: A closes a lesson with the speaker who taught last year
    const p = Number(await commitAs(A, "select (public.propose($1, $2, null, 1, 510, 600, null) ->> 'pitch_id')::bigint", [ed, sp.taught]));
    await commitAs(A, "select public.close_lesson($1)", [p]);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  it("the imported year is a past year: «חוזרים» in the summary, «לימד/ה אצלנו», and «איך עבר» across the years", async () => {
    expect(await commitAs(A, "select public.edition_returning($1)", [ed])).toEqual([{ speaker_id: sp.taught, editions: [LABEL] }]);
    expect(await code(commitAs(L, "select public.edition_returning($1)", [ed]))).toBe("forbidden");
    const history = (await commitAs(A, "select public.speaker_history($1)", [sp.taught])) as { edition_label: string; edition_kind: string }[];
    expect(history.map((h) => [h.edition_label, h.edition_kind])).toEqual(expect.arrayContaining([[LABEL, "archive"]]));
    // a global admin writes «איך עבר» on last year's lesson; this year's content team reads it on the speaker's sheet
    expect(await commitAs(ADMIN, "select public.save_lesson_review($1, 0, $2, null, 'yes', false, 5)", [lesson.archived, WENT_WELL])).toBe(1);
    expect(await code(commitAs(A, "select public.save_lesson_review($1, 0, 'x', null, null, false, null)", [lesson.archived]))).toBe("not_member");
    const reviews = (await commitAs(A, "select public.speaker_reviews($1)", [sp.taught])) as Record<string, unknown>[];
    expect(reviews.map((r) => [r.edition_label, r.edition_kind, r.went_well, r.invite_again])).toEqual([[LABEL, "archive", WENT_WELL, "yes"]]);
    expect(reviews.every((r) => !("written_by" in r))).toBe(true);
    expect(await code(commitAs(L, "select public.speaker_reviews($1)", [sp.taught]))).toBe("forbidden");
  });

  it("a re-run of the label is refused once a review is on one of its lessons — nothing is replaced, the review stays", async () => {
    const before = await owner("select count(*)::int from public.lessons where edition_id = $1", [archive]);
    expect(await code(commit(payload([archiveLesson(2, 2, 870, 960, [0])])))).toBe("archive_reviewed");
    expect(await owner("select count(*)::int from public.lessons where edition_id = $1", [archive])).toBe(before);
    expect(await owner("select went_well from public.lesson_reviews where lesson_id = $1", [lesson.archived])).toBe(WENT_WELL);
    expect(await owner("select count(*)::int from public.activity where entity = 'import'")).toBe(1); // the first import only
  });

  it("the purge of the imported archive: no date needed, the sheet's notes cleared — and only its own; everything else kept", async () => {
    expect(await notes()).toEqual([NOTE, null]);
    expect(await code(commitAs(A, "select public.purge_edition_private($1, $2)", [archive, LABEL]))).toBe("forbidden");
    const report = (await commitAs(ADMIN, "select public.purge_edition_private($1, $2)", [archive, LABEL])) as Record<string, unknown>;
    expect({ ...report, purged_at: typeof report.purged_at }).toEqual({ transport_details: 0, import_notes: 1, links_revoked: 0, link_hits: 0, purged_at: "string" });
    expect(await notes()).toEqual([null, null]);
    // kept: the lessons, their amounts and speakers, the review, the speakers' pool; this year's edition untouched
    expect((await db.query("select day, pay_amount, state from public.lessons where edition_id = $1 order by day", [archive])).rows).toEqual([
      { day: 0, pay_amount: null, state: "closed" },
      { day: 1, pay_amount: 250, state: "closed" },
    ]);
    expect(await owner("select count(*)::int from public.lesson_speakers x join public.lessons l on l.id = x.lesson_id where l.edition_id = $1", [archive])).toBe(2);
    expect(await owner("select went_well from public.lesson_reviews where lesson_id = $1", [lesson.archived])).toBe(WENT_WELL);
    expect(await owner("select purged_at is not null from public.editions where id = $1", [archive])).toBe(true);
    expect(await owner("select purged_at from public.editions where id = $1", [ed])).toBeNull();
    // logged with counts only — never the note
    const log = (await db.query("select detail from public.activity where kind = 'purge'")).rows;
    expect(log).toEqual([{ detail: { transport_details: 0, import_notes: 1, links_revoked: 0, link_hits: 0 } }]);
    expect(JSON.stringify((await db.query("select detail from public.activity")).rows)).not.toContain("איסוף");
    // again: nothing more
    const again = (await commitAs(ADMIN, "select public.purge_edition_private($1, $2)", [archive, LABEL])) as Record<string, unknown>;
    expect(again).toEqual({ transport_details: 0, import_notes: 0, links_revoked: 0, link_hits: 0, purged_at: report.purged_at });
  });

  it("start_edition and its dry run take the live real edition as the previous one — never the import, though its id is newer", async () => {
    // the archive given wording of its own: start_edition must not carry it
    await db.query("update public.editions set settings = '{\"confirm_template\": \"נוסח של הארכיון\"}'::jsonb where id = $1", [archive]);
    const preview = (await commitAs(ADMIN, "select public.start_edition_preview(true)")) as Record<string, unknown>;
    expect(preview).toMatchObject({ archive: [{ id: ed, label: "תשפ\"ז" }], carry_from: { id: ed, label: "תשפ\"ז" }, milestones: 1, confirm_template: true, deactivate: 2 });
    const next = Number(await commitAs(ADMIN, "select public.start_edition('תשפ\"ח', null, null, 'בית מדרש', true)"));
    expect((await db.query("select id, kind, status, purged_at is not null as purged from public.editions where id in ($1, $2) order by id", [ed, archive])).rows).toEqual([
      { id: String(ed), kind: "real", status: "archived", purged: false },
      { id: String(archive), kind: "archive", status: "archived", purged: true },
    ]);
    expect(await owner("select settings ->> 'confirm_template' from public.editions where id = $1", [next])).toBe("נוסח של השנה");
    expect((await db.query("select title, days_before from public.milestones where edition_id = $1", [next])).rows).toEqual([{ title: "אבן דרך לדוגמה", days_before: 42 }]);
    expect((await db.query("select email, active from public.members where email in ($1, $2) order by email", [A, L])).rows).toEqual([
      { email: A, active: false },
      { email: L, active: false },
    ]);
    // the next year: the imported year and this one are both earlier — the speaker's lessons there name both
    const history = (await commitAs(ADMIN, "select public.speaker_history($1)", [sp.taught])) as { edition_label: string }[];
    expect(history.map((h) => h.edition_label).sort()).toEqual([LABEL, "תשפ\"ז"].sort());
  });
});
