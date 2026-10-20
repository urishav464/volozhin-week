// The sources' files (v10) in the database, as the roles a browser gets: the
// private bucket, the policies on storage.objects for every role, edition,
// sandbox and anon (with the Storage stub of tests/sql/bootstrap.sql: an
// upload is the Storage API's permission probe — an INSERT as the caller — and
// a delete runs as the caller too), register_source_file / remove_source_file
// and their rules, the path convention, the reader's settings, and Realtime.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { SCHEMA, adminUrl, as, dropDatabase, freshDatabase, type Claims } from "./db";

const ADMIN = "admin@example.org"; // every edition
const ED_ADMIN = "edition.admin@example.org";
const A = "a@example.org"; // handles the speaker of the lesson
const B = "b@example.org"; // another content member
const L = "logistics@example.org";
const PRACTICE = "practice@example.org"; // content in a practice edition only
const OLD = "old@example.org"; // content in last year's (archived) edition
const STRANGER = "stranger@example.org";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MB = 1024 * 1024;

/** A Google session with a sub of its own per address — the Storage API writes it as the object's owner_id. */
function claims(email: string): Claims {
  const hex = Buffer.from(email).toString("hex").padEnd(12, "0").slice(0, 12);
  return { sub: `00000000-0000-4000-8000-${hex}`, role: "authenticated", email, app_metadata: { provider: "google", providers: ["google"] } };
}
const sub = (email: string) => claims(email).sub as string;

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message: string };
    return err.code === "P0001" ? err.message : (err.code ?? "error");
  }
}

const path = (edition: number, lesson: number | "cover", name = "sources.pdf") => `${edition}/${lesson}/${randomUUID()}-${name}`;

describe("the sources' files", () => {
  const dbName = `vw_sources_${process.pid}`;
  let db: pg.Client;
  let ed: number;
  let practice: number;
  let old: number;
  let speaker: number;
  let speaker2: number;
  let lesson: number; // closed, A's speaker
  let draft: number; // a draft (B pitched someone)
  let memorial: number; // a memorial slot, closed
  let practiceLesson: number; // closed, in the practice week
  let oldLesson: number; // closed, in last year's archived week
  const member: Record<string, number> = {};

  /** One committed statement as `email` (role authenticated, its own sub). */
  async function commitAs(email: string, sql: string, params: unknown[] = []): Promise<pg.QueryResult> {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims(email))]);
      const r = await db.query(sql, params);
      await db.query("commit");
      return r;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
  const one = async (email: string, sql: string, params: unknown[] = []) => Object.values((await commitAs(email, sql, params)).rows[0] ?? {})[0];

  /**
   * An upload, as the Storage API makes it: the permission probe INSERTs the row as the caller (the policies
   * decide), then the row stays with the caller's sub as owner_id and the file's type and size in metadata.
   */
  async function upload(email: string | null, name: string, mime = PDF, size = 2048): Promise<string> {
    await db.query("begin");
    try {
      await db.query(`set local role ${email ? "authenticated" : "anon"}`);
      await db.query("select set_config('request.jwt.claims', $1, true)", [email ? JSON.stringify(claims(email)) : ""]);
      await db.query("insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('sources', $1, $2, $3, $4)", [
        name, email ? sub(email) : null, email ? sub(email) : null, { mimetype: mime, size },
      ]);
      await db.query("commit");
      return "ok";
    } catch (e) {
      await db.query("rollback");
      return (e as { code?: string }).code ?? "error";
    }
  }
  /** A delete through the Storage API: as the caller (SELECT + DELETE policies), with its delete switch on. Returns rows deleted. */
  async function remove(email: string | null, name: string): Promise<number> {
    await db.query("begin");
    try {
      await db.query(`set local role ${email ? "authenticated" : "anon"}`);
      await db.query("select set_config('request.jwt.claims', $1, true)", [email ? JSON.stringify(claims(email)) : ""]);
      await db.query("select set_config('storage.allow_delete_query', 'true', true)");
      const r = await db.query("delete from storage.objects where bucket_id = 'sources' and name = $1 returning name", [name]);
      await db.query("commit");
      return r.rowCount ?? 0;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
  const register = (email: string, edition: number, lessonId: number | null, name: string, display = "דף מקורות.pdf", pages: number | null = 3) =>
    one(email, "select public.register_source_file($1, $2, $3, $4, $5)", [edition, lessonId, name, display, pages]) as Promise<Record<string, unknown>>;
  let speakers = 0;
  /** A new vetted speaker of known gender (each closed lesson below has its own: no handler or time clashes). */
  const newSpeaker = async () =>
    Number((await db.query("insert into public.speakers (name, gender, vetted) values ($1, 'f', 'approved') returning id", [`מרצה לבדיקה ${"אבגדהוזחטיכלמנסעפצקרשת"[speakers++]}`])).rows[0].id);
  /** `email` proposes a speaker into the lesson row at (day, start) of the edition and closes it. */
  async function closedLesson(email: string, day: number, start: number, edition = ed, spk?: number): Promise<{ lesson: number; pitch: number; speaker: number }> {
    const s2 = spk ?? (await newSpeaker());
    const rows = (await db.query("select end_min from public.grid_rows where edition_id = $1 and start_min = $2 and kind = 'lesson'", [edition, start])).rows;
    const p = Number(await one(email, "select (public.propose($1, $2, null, $3, $4, $5, null) ->> 'pitch_id')::bigint", [edition, s2, day, start, rows[0].end_min]));
    await commitAs(email, "select public.close_lesson($1)", [p]);
    return { lesson: Number((await db.query("select lesson_id from public.pitches where id = $1", [p])).rows[0].lesson_id), pitch: p, speaker: s2 };
  }
  /** A connection of its own, in an open transaction as `email` — for two callers at once (it rolls back when ended). */
  async function session(email: string): Promise<pg.Client> {
    const c = new pg.Client({ connectionString: Object.assign(new URL(adminUrl()), { pathname: `/${dbName}` }).toString() });
    await c.connect();
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims(email))]);
    return c;
  }
  /** Until that connection's statement waits on a lock another transaction holds. */
  async function waitingOnALock(c: pg.Client): Promise<void> {
    const pid = (c as unknown as { processID: number }).processID;
    for (let i = 0; i < 500; i++) {
      if ((await db.query("select wait_event_type from pg_stat_activity where pid = $1", [pid])).rows[0]?.wait_event_type === "Lock") return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("the second caller never waited on the lock");
  }
  const lessonRow = async (id: number) => (await db.query("select sources_kind, in_reader, version from public.lessons where id = $1", [id])).rows[0];
  const visible = (email: string | null, name: string) =>
    as(db, email ? "authenticated" : "anon", email ? claims(email) : null, async (q) => (await q("select count(*)::int as n from storage.objects where name = $1", [name])).rows[0].n as number);

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query(SCHEMA);
    await db.query("select app.add_admin($1)", [ADMIN]);
    ed = Number(await one(ADMIN, "select public.start_edition('תשפ\"ז', '2027-02-14', 510)"));
    practice = Number((await db.query("insert into public.editions (label, kind) values ('תרגול', 'practice') returning id")).rows[0].id);
    old = Number((await db.query("insert into public.editions (label, kind, status) values ('שנה קודמת', 'real', 'archived') returning id")).rows[0].id);
    for (const e of [practice, old]) {
      await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, 'בית מדרש', true)", [e]);
      await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [e]);
    }
    for (const [email, role, edition] of [
      [ED_ADMIN, "admin", ed], [A, "content", ed], [B, "content", ed], [L, "logistics", ed], [PRACTICE, "content", practice], [OLD, "content", old],
    ] as const) {
      member[email] = Number((await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $1, $2, $3) returning id", [email, role, edition])).rows[0].id);
    }
    member[ADMIN] = Number((await db.query("select id from public.members where email = $1", [ADMIN])).rows[0].id);
    speaker = await newSpeaker();
    speaker2 = await newSpeaker();
    lesson = (await closedLesson(A, 1, 510, ed, speaker)).lesson;
    practiceLesson = (await closedLesson(PRACTICE, 1, 510, practice, speaker2)).lesson;
    const p = Number(await one(B, "select (public.propose($1, $2, null, 2, 510, 600, null) ->> 'pitch_id')::bigint", [ed, await newSpeaker()]));
    draft = Number((await db.query("select lesson_id from public.pitches where id = $1", [p])).rows[0].lesson_id);
    const room = async (e: number) => Number((await db.query("select id from public.rooms where edition_id = $1 and is_default", [e])).rows[0].id);
    memorial = Number((await db.query("insert into public.lessons (edition_id, kind, state, day, start_min, end_min, room_id, title) values ($1, 'memorial', 'closed', 0, 780, 795, $2, 'זמן זיכרון') returning id", [ed, await room(ed)])).rows[0].id);
    oldLesson = Number((await db.query("insert into public.lessons (edition_id, state, day, start_min, end_min, room_id) values ($1, 'closed', 1, 510, 600, $2) returning id", [old, await room(old)])).rows[0].id);
  });

  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  describe("the bucket", () => {
    it("is private, 25 MB, PDF / Word / PNG / JPEG — and a re-run makes it private again without touching the rest", async () => {
      const b = (await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'sources'")).rows[0];
      expect(b).toEqual({ public: false, file_size_limit: String(25 * MB), allowed_mime_types: [PDF, "image/png", "image/jpeg", DOCX] });
      await db.query("update storage.buckets set public = true, file_size_limit = 10485760 where id = 'sources'");
      await db.query(SCHEMA);
      const again = (await db.query("select public, file_size_limit from storage.buckets where id = 'sources'")).rows[0];
      expect(again).toEqual({ public: false, file_size_limit: "10485760" }); // the owner's own limit stays
      await db.query("update storage.buckets set file_size_limit = $1 where id = 'sources'", [25 * MB]);
    });

    // the review's probe: the update to private sat in one block with the policies — a policy statement refused rolled
    // the bucket back to public after the run had warned «it is private again»
    it("goes private on a re-run even when the policies cannot be (re)created — which then stay as they were — and the other way round", async () => {
      const warnings: string[] = [];
      const listen = (n: { severity?: string; message?: string }) => {
        if (n.severity === "WARNING" && n.message?.includes("«sources»")) warnings.push(n.message);
      };
      const policies = async () => (await db.query("select polname from pg_policy where polrelid = 'storage.objects'::regclass order by 1")).rows.map((r) => r.polname);
      const all = await policies();
      db.on("notice", listen);
      try {
        // the owner may write storage.buckets but may not touch the policies on storage.objects (privileges withdrawn)
        await db.query(`
          create schema refusals;
          create function refusals.policy_made() returns event_trigger language plpgsql as $f$
          begin
            if exists (select 1 from pg_event_trigger_ddl_commands() where object_identity like '% on storage.objects') then
              raise exception 'must be owner of table objects' using errcode = 'insufficient_privilege';
            end if;
          end $f$;
          create function refusals.policy_dropped() returns event_trigger language plpgsql as $f$
          begin
            if exists (select 1 from pg_event_trigger_dropped_objects() where object_identity like '% on storage.objects') then
              raise exception 'must be owner of table objects' using errcode = 'insufficient_privilege';
            end if;
          end $f$;
          create function refusals.bucket_written() returns trigger language plpgsql as $f$
          begin
            raise exception 'permission denied for table buckets' using errcode = 'insufficient_privilege';
          end $f$;
          create event trigger refuse_policy_made on ddl_command_end when tag in ('CREATE POLICY') execute function refusals.policy_made();
          create event trigger refuse_policy_dropped on sql_drop when tag in ('DROP POLICY') execute function refusals.policy_dropped();`);
        await db.query("update storage.buckets set public = true where id = 'sources'"); // someone ticked «Public» in the dashboard
        await db.query(SCHEMA);
        expect((await db.query("select public from storage.buckets where id = 'sources'")).rows[0].public).toBe(false);
        expect(await policies()).toEqual(all);
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toMatch(/^the «sources» bucket was public — it is private again .*send this whole message to Claude$/);
        expect(warnings[1]).toMatch(/^the «sources» policies could not be \(re\)created \(must be owner of table objects\) — the previous ones, if any, are unchanged .*send this whole message to Claude \(docs\/SETUP\.he\.md, גרסה 10\)$/);
        // and the other way round: the bucket cannot be written, the policies are (re)created all the same
        await db.query("drop event trigger refuse_policy_made; drop event trigger refuse_policy_dropped");
        await db.query("create trigger refuse_bucket_written before insert or update on storage.buckets for each statement execute function refusals.bucket_written()");
        await db.query("drop policy sources_cap_anon on storage.objects");
        warnings.length = 0;
        await db.query(SCHEMA);
        expect(await policies()).toEqual(all);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/^the «sources» bucket could not be created or made private \(permission denied for table buckets\) — .*send this whole message to Claude \(docs\/SETUP\.he\.md, גרסה 10\)$/);
      } finally {
        db.off("notice", listen);
        await db.query("drop trigger if exists refuse_bucket_written on storage.buckets; drop event trigger if exists refuse_policy_made; drop event trigger if exists refuse_policy_dropped; drop schema if exists refusals cascade");
      }
    });

    it("has exactly its policies on storage.objects: three to allow, five to cap (anon included)", async () => {
      const r = await db.query(`
        select polname, polpermissive, polcmd, array(select rolname::text from pg_roles where oid = any (polroles) order by 1) as roles
          from pg_policy where polrelid = 'storage.objects'::regclass order by polname`);
      expect(r.rows.map((p) => `${p.polname}:${p.polpermissive ? "allow" : "cap"}:${p.polcmd}:${p.roles.join(",")}`)).toEqual([
        "sources_cap_anon:cap:*:anon",
        "sources_cap_delete:cap:d:authenticated",
        "sources_cap_read:cap:r:authenticated",
        "sources_cap_update:cap:w:authenticated",
        "sources_cap_upload:cap:a:authenticated",
        "sources_delete:allow:d:authenticated",
        "sources_read:allow:r:authenticated",
        "sources_upload:allow:a:authenticated",
      ]);
    });
  });

  describe("upload (the INSERT policy)", () => {
    it("lets the edition's content members and admins upload to a closed lesson — the rule of set_sources", async () => {
      for (const who of [A, B, ED_ADMIN, ADMIN]) expect(await upload(who, path(ed, lesson)), who).toBe("ok");
      // a sandbox's own team, in the sandbox
      expect(await upload(PRACTICE, path(practice, practiceLesson))).toBe("ok");
      // an archived edition: its admins only (here, the global admin)
      expect(await upload(ADMIN, path(old, oldLesson))).toBe("ok");
    });

    it("refuses logistics, other editions, an archive's team, strangers and anon", async () => {
      expect(await upload(L, path(ed, lesson))).toBe("42501"); // logistics read and print; they do not upload
      expect(await upload(PRACTICE, path(ed, lesson))).toBe("42501"); // a practice week's member, into the real week
      expect(await upload(A, path(practice, practiceLesson))).toBe("42501"); // and the other way round
      expect(await upload(OLD, path(old, oldLesson))).toBe("42501"); // last year's content member: archived
      expect(await upload(STRANGER, path(ed, lesson))).toBe("42501");
      expect(await upload(null, path(ed, lesson))).toBe("42501");
    });

    it("refuses a draft, a memorial slot, and the poster for anyone but the edition's admins (and never a Word poster)", async () => {
      expect(await upload(A, path(ed, draft))).toBe("42501");
      expect(await upload(ED_ADMIN, path(ed, memorial))).toBe("42501");
      expect(await upload(A, path(ed, "cover"))).toBe("42501");
      expect(await upload(ED_ADMIN, path(ed, "cover", "poster.png"), "image/png")).toBe("ok");
      expect(await upload(ED_ADMIN, path(ed, "cover", "poster.docx"), DOCX)).toBe("42501");
    });

    it("holds the path convention: <edition>/<lesson>/<uuid>-<safe ascii name>.<pdf|png|jpg|jpeg|docx>", async () => {
      const u = randomUUID();
      for (const bad of [
        `${practice}/${lesson}/${u}-sources.pdf`, // the lesson is not that edition's
        `${ed}/${lesson}/${u}-מקורות.pdf`, // the original Hebrew name
        `${ed}/${lesson}/sources.pdf`, // no uuid
        `${ed}/${lesson}/${u}-sources.exe`, // not an accepted type
        `${ed}/${lesson}/${u}-sources.PDF`, // the extension lower-case
        `${ed}/${lesson}/${u}-a.b.pdf`, // dots inside the name
        `${ed}/${lesson}/x/${u}-sources.pdf`, // a folder too many
        `${ed}/${lesson}/${u}-${"a".repeat(61)}.pdf`, // a name too long
        `0${ed}/${lesson}/${u}-sources.pdf`,
        `${ed}/999999/${u}-sources.pdf`, // no such lesson
        `${ed}/${lesson}/${u.toUpperCase()}-sources.pdf`,
      ]) {
        expect(await upload(A, bad), bad).toBe("42501");
      }
      expect(await upload(A, `${ed}/${lesson}/${u}-sources-2027_v2.pdf`)).toBe("ok");
    });

    it("cannot be widened by another permissive policy someone adds to storage.objects", async () => {
      const name = path(ed, lesson);
      expect(await upload(A, name)).toBe("ok");
      await db.query("begin");
      try {
        await db.query("create policy wide_open on storage.objects for all to authenticated, anon using (true) with check (true)");
        const step = async (role: "authenticated" | "anon", c: Claims | null, sql: string, params: unknown[] = []) => {
          await db.query("savepoint s");
          try {
            await db.query(`set local role ${role}`);
            await db.query("select set_config('request.jwt.claims', $1, true)", [c ? JSON.stringify(c) : ""]);
            await db.query("select set_config('storage.allow_delete_query', 'true', true)");
            const r = await db.query(sql, params);
            return r.rowCount ?? 0;
          } catch (e) {
            return (e as { code?: string }).code ?? "error";
          } finally {
            await db.query("rollback to savepoint s");
          }
        };
        const insert = "insert into storage.objects (bucket_id, name, owner_id, metadata) values ('sources', $1, 'x', '{}')";
        for (const [role, c] of [["authenticated", claims(L)], ["authenticated", claims(STRANGER)], ["authenticated", claims(PRACTICE)], ["anon", null]] as const) {
          const who = `${role} ${c?.email ?? ""}`;
          expect(await step(role, c, insert, [path(ed, lesson)]), who).toBe("42501");
          expect(await step(role, c, "update storage.objects set metadata = '{}' where name = $1", [name]), who).toBe(0);
          expect(await step(role, c, "delete from storage.objects where name = $1", [name]), who).toBe(0);
          if (c?.email !== L) expect(await step(role, c, "select 1 from storage.objects where bucket_id = 'sources' and name like $1", [`${ed}/%`]), who).toBe(0);
        }
        expect(await step("authenticated", claims(A), insert, [path(ed, draft)])).toBe("42501");
      } finally {
        await db.query("rollback");
      }
    });
  });

  // the security review's probe: a removal that stopped half way left A's row; B uploaded other bytes (a 25 MB PNG
  // at the .pdf path) at its path, register answered A's row — A's name, PDF, size — in front of B's bytes, B
  // could not delete them and A's remove_source_file answered file_present
  describe("a path is used once", () => {
    it("never takes an upload at a path a source_files row holds — its object gone or not, from anyone", async () => {
      const name = path(ed, lesson, "mine.pdf");
      expect(await upload(A, name, PDF, 1000)).toBe("ok");
      const row = await register(A, ed, lesson, name, "של א.pdf", 2);
      expect(await remove(A, name)).toBe(1); // half way: the object gone, the row stays
      for (const who of [B, A, ED_ADMIN, ADMIN]) expect(await upload(who, name, "image/png", 25 * MB), who).toBe("42501");
      expect(await upload(B, name)).toBe("42501");
      expect((await db.query("select count(*)::int as n from storage.objects where name = $1", [name])).rows[0].n).toBe(0);
      // the row is as A left it, and A finishes the removal
      expect((await db.query("select display_name, mime, size_bytes::int as size, uploaded_by::int as by from public.source_files where id = $1", [row.id])).rows[0]).toEqual({
        display_name: "של א.pdf", mime: PDF, size: 1000, by: member[A],
      });
      expect(await refusal(commitAs(A, "select public.remove_source_file($1)", [row.id]))).toBe("ok");
      // a path with a live object and its row: a second upload is refused by the policy, not by the name's uniqueness
      const live = path(ed, lesson);
      expect(await upload(A, live)).toBe("ok");
      await register(A, ed, lesson, live);
      expect(await upload(A, live)).toBe("42501");
      // and the retry of a registration — the same path again, no upload — still answers the row it made
      expect((await register(A, ed, lesson, live, "x", 1)).storage_path).toBe(live);
    });
  });

  describe("read, update, delete", () => {
    it("lets the whole team of the edition read — content, admins and logistics — and nobody else", async () => {
      const name = path(ed, lesson);
      expect(await upload(A, name)).toBe("ok");
      for (const who of [A, B, ED_ADMIN, ADMIN, L]) expect(await visible(who, name), who).toBe(1);
      for (const who of [PRACTICE, OLD, STRANGER, null]) expect(await visible(who, name), String(who)).toBe(0);
    });

    it("never updates an object (a replacement is a delete and an upload) — not even for an admin", async () => {
      const name = path(ed, lesson);
      expect(await upload(A, name)).toBe("ok");
      for (const who of [A, ADMIN]) {
        await as(db, "authenticated", claims(who), async (q) => {
          expect((await q("update storage.objects set name = $2 where name = $1 returning id", [name, path(ed, lesson)])).rowCount, who).toBe(0);
          expect((await q("update storage.objects set metadata = '{}' where name = $1 returning id", [name])).rowCount, who).toBe(0);
        });
      }
      expect((await db.query("select metadata ->> 'mimetype' as m from storage.objects where name = $1", [name])).rows[0].m).toBe(PDF);
    });

    it("deletes for the uploader and the edition's admins; not for another member, logistics or anon", async () => {
      const name = path(ed, lesson);
      expect(await upload(A, name)).toBe("ok");
      await register(A, ed, lesson, name);
      for (const who of [B, L, PRACTICE, STRANGER, null]) expect(await remove(who, name), String(who)).toBe(0);
      expect(await remove(A, name)).toBe(1);
      const other = path(ed, lesson);
      expect(await upload(A, other)).toBe("ok");
      await register(A, ed, lesson, other);
      expect(await remove(ED_ADMIN, other)).toBe(1);
    });

    it("lets the uploader delete an object they never registered (an upload whose registration failed), and only them", async () => {
      const name = path(ed, lesson);
      expect(await upload(B, name)).toBe("ok");
      expect(await remove(A, name)).toBe(0);
      expect(await remove(B, name)).toBe(1);
    });

    it("refuses a delete from SQL that does not come through the Storage API", async () => {
      const name = path(ed, lesson);
      expect(await upload(A, name)).toBe("ok");
      await as(db, "authenticated", claims(A), async (q) => {
        expect(await refusal(q("delete from storage.objects where name = $1", [name]))).toBe("42501");
      });
    });
  });

  describe("register_source_file", () => {
    it("records the file with the Storage API's type and size, the browser's page count, the lead speaker and the uploader", async () => {
      const name = path(ed, lesson, "a.pdf");
      expect(await upload(B, name, PDF, 12345)).toBe("ok");
      const row = await register(B, ed, lesson, name, "  דף   מקורות.pdf ", 4);
      expect(row).toMatchObject({ edition_id: ed, lesson_id: lesson, cover: false, speaker_id: speaker, storage_path: name, display_name: "דף מקורות.pdf", mime: PDF, size_bytes: 12345, page_count: 4, uploaded_by: member[B] });
      // a retry returns the same row
      expect((await register(B, ed, lesson, name, "x", 1)).id).toBe(row.id);
    });

    it("turns «טרם התקבלו» into a sheet and puts the lesson in the reader on the speaker's first file — and only the first", async () => {
      // a fresh closed lesson, sources pending
      const l = (await closedLesson(A, 3, 510)).lesson;
      expect(await lessonRow(l)).toMatchObject({ sources_kind: "pending", in_reader: false });
      const first = path(ed, l, "docx-first.docx");
      expect(await upload(A, first, DOCX)).toBe("ok");
      const v0 = (await lessonRow(l)).version;
      const row = await register(A, ed, l, first, "מקורות.docx", 7);
      expect(row.page_count).toBeNull(); // a Word file has no page count
      expect(await lessonRow(l)).toMatchObject({ sources_kind: "sheet", in_reader: true, version: v0 + 1 });
      // the instructor takes it out of the reader on purpose; the next file leaves that alone
      const v1 = (await lessonRow(l)).version;
      await commitAs(A, "select public.set_sources($1, $2, 'sheet', 'none', null, null, false)", [l, v1]);
      const second = path(ed, l, "b.png");
      expect(await upload(A, second, "image/png")).toBe("ok");
      expect((await register(A, ed, l, second, "צילום.png", 9)).page_count).toBe(1); // an image is one page
      expect(await lessonRow(l)).toMatchObject({ sources_kind: "sheet", in_reader: false, version: v1 + 1 });
      // a picture the browser could not read as the reader would (src/reader/pages.ts): kept, with no page — out of the reader
      const unread = path(ed, l, "c.jpg");
      expect(await upload(A, unread, "image/jpeg")).toBe("ok");
      expect((await register(A, ed, l, unread, "IMG_0001.jpg", null)).page_count).toBeNull();
    });

    it("never puts a presentation alone in the reader", async () => {
      const l = (await closedLesson(A, 4, 510)).lesson;
      await commitAs(A, "select public.set_sources($1, $2, 'presentation', 'none', null, 'https://example.org/x', false)", [l, (await lessonRow(l)).version]);
      const name = path(ed, l);
      expect(await upload(A, name)).toBe("ok");
      await register(A, ed, l, name);
      expect(await lessonRow(l)).toMatchObject({ sources_kind: "presentation", in_reader: false });
    });

    it("refuses a path that is not this lesson's, someone else's object, a missing object, and a type or size the bucket would not take", async () => {
      const name = path(ed, lesson);
      expect(await upload(A, name)).toBe("ok");
      expect(await refusal(register(A, ed, draft, name))).toBe("bad_path"); // the path names another lesson
      expect(await refusal(register(A, practice, lesson, name))).toBe("not_member"); // not A's edition at all
      expect(await refusal(register(A, ed, null, name))).toBe("bad_path");
      expect(await refusal(register(B, ed, lesson, name))).toBe("no_file"); // A's upload, not B's
      expect(await refusal(register(A, ed, lesson, path(ed, lesson)))).toBe("no_file"); // nothing uploaded there
      expect(await refusal(register(A, ed, lesson, `${ed}/${lesson}/nope.pdf`))).toBe("bad_path");
      const mismatched = path(ed, lesson, "x.pdf");
      expect(await upload(A, mismatched, "image/png")).toBe("ok"); // a PNG named .pdf
      expect(await refusal(register(A, ed, lesson, mismatched))).toBe("bad_file");
      const big = path(ed, lesson, "big.pdf");
      expect(await upload(A, big, PDF, 25 * MB + 1)).toBe("ok"); // the stub has no size limit; the bucket does
      expect(await refusal(register(A, ed, lesson, big))).toBe("bad_file");
      const fine = path(ed, lesson);
      expect(await upload(A, fine)).toBe("ok");
      expect(await refusal(register(A, ed, lesson, fine, "   "))).toBe("bad_value");
      expect(await refusal(register(A, ed, lesson, fine, "x.pdf", 0))).toBe("bad_value");
      expect(await refusal(register(L, ed, lesson, fine))).toBe("forbidden");
      expect(await refusal(register(STRANGER, ed, lesson, fine))).toBe("not_member");
    });

    it("refuses a lesson that is no longer closed (the object stays the uploader's to delete)", async () => {
      const l = (await closedLesson(A, 0, 1200)).lesson;
      const name = path(ed, l);
      expect(await upload(A, name)).toBe("ok");
      await commitAs(A, "select public.reopen_lesson($1)", [l]);
      expect(await refusal(register(A, ed, l, name))).toBe("not_closed");
      expect(await remove(A, name)).toBe(1);
    });

    // the review's probe: the closed check ran before the lesson's lock, so a reopen committed while register waited
    // on it let the file in on the draft — sources_kind «sheet» and in_reader on, the stages reopen had just emptied
    it("takes the lesson's lock before it checks: a reopen committed while it waits refuses it, and the draft stays empty", async () => {
      const l = (await closedLesson(A, 4, 870)).lesson;
      const name = path(ed, l);
      expect(await upload(B, name)).toBe("ok");
      const [reopen, reg] = [await session(A), await session(B)];
      try {
        await reopen.query("select public.reopen_lesson($1)", [l]); // A's reopen, in flight: it holds the lesson's row
        const pending = reg.query("select public.register_source_file($1, $2, $3, 'מקורות.pdf', 2)", [ed, l, name]).then(() => "ok", (e: Error) => e.message);
        await waitingOnALock(reg);
        await reopen.query("commit");
        expect(await pending).toBe("not_closed");
      } finally {
        await reopen.end();
        await reg.end();
      }
      expect((await db.query("select state, sources_kind, in_reader from public.lessons where id = $1", [l])).rows[0]).toEqual({ state: "draft", sources_kind: "pending", in_reader: false });
      expect((await db.query("select count(*)::int as n from public.source_files where storage_path = $1", [name])).rows[0].n).toBe(0);
      expect(await remove(B, name)).toBe(1); // the object stays B's to delete
    });

    it("answers a retry with the row it made, even after the lesson was reopened — the browser lost the first answer", async () => {
      const l = (await closedLesson(A, 0, 1350)).lesson;
      const name = path(ed, l);
      expect(await upload(A, name)).toBe("ok");
      const row = await register(A, ed, l, name);
      await commitAs(A, "select public.reopen_lesson($1)", [l]);
      const before = await lessonRow(l);
      expect(await register(A, ed, l, name, "שוב.pdf", 9)).toEqual(row);
      expect(await lessonRow(l)).toEqual(before); // nothing set again on the draft
      expect(await refusal(register(A, ed, l, path(ed, l)))).toBe("not_closed"); // a new file still refused
      expect(await refusal(register(L, ed, l, name))).toBe("ok"); // the early answer gives nobody more than source_files' RLS: L reads the row anyway
      expect(await refusal(register(STRANGER, ed, l, name))).toBe("not_member");
    });

    it("makes the first poster the cover; set_reader_cover takes only a poster of the edition", async () => {
      const name = path(ed, "cover", "poster.pdf");
      expect(await upload(ED_ADMIN, name)).toBe("ok");
      const row = await register(ED_ADMIN, ed, null, name, "פוסטר.pdf", 1);
      expect(row).toMatchObject({ cover: true, lesson_id: null, speaker_id: null });
      expect((await db.query("select settings -> 'reader_cover' as c from public.editions where id = $1", [ed])).rows[0].c).toBe(Number(row.id));
      const lessonFile = Number((await db.query("select id from public.source_files where lesson_id = $1 limit 1", [lesson])).rows[0].id);
      expect(await refusal(commitAs(ED_ADMIN, "select public.set_reader_cover($1, $2)", [ed, lessonFile]))).toBe("bad_value");
      expect(await refusal(commitAs(A, "select public.set_reader_cover($1, null)", [ed]))).toBe("forbidden");
      expect(await refusal(commitAs(ED_ADMIN, "select public.set_reader_cover($1, null)", [ed]))).toBe("ok");
      expect(await refusal(commitAs(ED_ADMIN, "select public.set_reader_cover($1, $2)", [ed, row.id]))).toBe("ok");
      // removing the cover's file clears the mark
      expect(await remove(ED_ADMIN, name)).toBe(1);
      await commitAs(ED_ADMIN, "select public.remove_source_file($1)", [row.id]);
      expect((await db.query("select settings ? 'reader_cover' as c from public.editions where id = $1", [ed])).rows[0].c).toBe(false);
    });

    it("never makes a poster the browser could not read the cover — the first one it could read is", async () => {
      const cover = async () => (await db.query("select settings -> 'reader_cover' as c from public.editions where id = $1", [ed])).rows[0].c;
      expect(await cover()).toBeNull();
      const unread = path(ed, "cover", "poster.jpg");
      expect(await upload(ED_ADMIN, unread, "image/jpeg")).toBe("ok");
      const bad = await register(ED_ADMIN, ed, null, unread, "פוסטר.jpg", null);
      expect(bad).toMatchObject({ cover: true, page_count: null });
      expect(await cover()).toBeNull(); // the build would never fetch it: no cover, the schedule page instead
      expect(await refusal(commitAs(ED_ADMIN, "select public.set_reader_cover($1, $2)", [ed, bad.id]))).toBe("bad_value"); // nor by hand
      const good = path(ed, "cover", "poster.pdf");
      expect(await upload(ED_ADMIN, good)).toBe("ok");
      const row = await register(ED_ADMIN, ed, null, good, "פוסטר.pdf", 1);
      expect(await cover()).toBe(Number(row.id));
      // the edition's next poster leaves the cover as it is
      const next = path(ed, "cover", "poster2.pdf");
      expect(await upload(ED_ADMIN, next)).toBe("ok");
      await register(ED_ADMIN, ed, null, next, "פוסטר 2.pdf", 1);
      expect(await cover()).toBe(Number(row.id));
      for (const name of [unread, good, next]) {
        expect(await remove(ED_ADMIN, name)).toBe(1);
        await commitAs(ED_ADMIN, "select public.remove_source_file((select id from public.source_files where storage_path = $1))", [name]);
      }
      expect(await cover()).toBeNull();
    });
  });

  describe("remove_source_file", () => {
    it("refuses while the object is still stored, then forgets it — the uploader or an admin, nobody else", async () => {
      const name = path(ed, lesson);
      expect(await upload(A, name)).toBe("ok");
      const id = (await register(A, ed, lesson, name)).id;
      expect(await refusal(commitAs(A, "select public.remove_source_file($1)", [id]))).toBe("file_present");
      expect(await remove(A, name)).toBe(1);
      for (const who of [B, L]) expect(await refusal(commitAs(who, "select public.remove_source_file($1)", [id])), who).toBe("not_uploader");
      expect(await refusal(commitAs(PRACTICE, "select public.remove_source_file($1)", [id]))).toBe("not_member");
      expect(await refusal(commitAs(A, "select public.remove_source_file($1)", [id]))).toBe("ok");
      expect((await db.query("select count(*)::int as n from public.source_files where id = $1", [id])).rows[0].n).toBe(0);
      expect(await refusal(commitAs(A, "select public.remove_source_file($1)", [id]))).toBe("ok"); // gone already: nothing to do
      const other = path(ed, lesson);
      expect(await upload(A, other)).toBe("ok");
      const id2 = (await register(A, ed, lesson, other)).id;
      expect(await remove(ED_ADMIN, other)).toBe(1);
      expect(await refusal(commitAs(ED_ADMIN, "select public.remove_source_file($1)", [id2]))).toBe("ok");
    });

    it("keeps an archive's files for its admins only", async () => {
      const name = path(old, oldLesson);
      expect(await upload(ADMIN, name)).toBe("ok");
      const id = (await register(ADMIN, old, oldLesson, name)).id;
      expect(await remove(OLD, name)).toBe(0);
      expect(await remove(ADMIN, name)).toBe(1);
      expect(await refusal(commitAs(OLD, "select public.remove_source_file($1)", [id]))).toBe("archived");
      expect(await refusal(commitAs(ADMIN, "select public.remove_source_file($1)", [id]))).toBe("ok");
    });
  });

  describe("a speaker who leaves", () => {
    it("keeps the files through reopen_lesson, marked by the speaker they came for; the next speaker's first file starts the reader again", async () => {
      const first = await closedLesson(A, 2, 870);
      const l = first.lesson;
      const name = path(ed, l);
      expect(await upload(A, name)).toBe("ok");
      await register(A, ed, l, name);
      expect(await lessonRow(l)).toMatchObject({ in_reader: true });
      await commitAs(A, "select public.reopen_lesson($1)", [l]);
      expect(await lessonRow(l)).toMatchObject({ sources_kind: "pending", in_reader: false });
      expect((await db.query("select speaker_id::int as s from public.source_files where lesson_id = $1", [l])).rows).toEqual([{ s: first.speaker }]);
      // another speaker closes the slot: the old file is the previous speaker's, the new one turns the reader on
      const second = await closedLesson(A, 2, 870);
      expect(second.lesson).toBe(l);
      const next = path(ed, l);
      expect(await upload(A, next)).toBe("ok");
      await register(A, ed, l, next);
      expect(await lessonRow(l)).toMatchObject({ sources_kind: "sheet", in_reader: true });
      expect((await db.query("select speaker_id::int as s from public.source_files where lesson_id = $1 order by id", [l])).rows.map((r) => r.s)).toEqual([first.speaker, second.speaker]);
    });

    it("keeps a deleted lesson's files, with no lesson, for removal", async () => {
      const { lesson: l, pitch } = await closedLesson(B, 3, 870);
      const name = path(ed, l);
      expect(await upload(B, name)).toBe("ok");
      const id = (await register(B, ed, l, name)).id;
      // reopened, and its last pitch withdrawn: the plain draft is deleted (unpropose)
      await commitAs(B, "select public.reopen_lesson($1)", [l]);
      await commitAs(B, "select public.unpropose($1)", [pitch]);
      expect((await db.query("select count(*)::int as n from public.lessons where id = $1", [l])).rows[0].n).toBe(0);
      expect((await db.query("select lesson_id, edition_id from public.source_files where id = $1", [id])).rows[0]).toEqual({ lesson_id: null, edition_id: String(ed) });
      expect(await remove(B, name)).toBe(1);
      expect(await refusal(commitAs(B, "select public.remove_source_file($1)", [id]))).toBe("ok");
    });
  });

  describe("source_files and the week", () => {
    it("is read by the edition's team through RLS (logistics included), never written directly, and comes in load_week", async () => {
      const n = (email: string) => as(db, "authenticated", claims(email), async (q) => (await q("select count(*)::int as n from public.source_files where edition_id = $1", [ed])).rows[0].n as number);
      const total = Number((await db.query("select count(*) from public.source_files where edition_id = $1", [ed])).rows[0].count);
      expect(total).toBeGreaterThan(0);
      for (const who of [A, L, ED_ADMIN, ADMIN]) expect(await n(who), who).toBe(total);
      for (const who of [PRACTICE, OLD, STRANGER]) expect(await n(who), who).toBe(0);
      await as(db, "authenticated", claims(ADMIN), async (q) => {
        expect(await refusal(q("insert into public.source_files (edition_id, storage_path, display_name, mime, size_bytes) values ($1, 'x', 'x', $2, 1)", [ed, PDF]))).toBe("42501");
        expect(await refusal(q("update public.source_files set display_name = 'x'"))).toBe("42501");
        expect(await refusal(q("delete from public.source_files"))).toBe("42501");
        const w = (await q("select public.load_week($1) as w", [ed])).rows[0].w;
        expect(w.sourceFiles).toHaveLength(total);
        expect(Object.keys(w.sourceFiles[0]).sort()).toEqual(["cover", "display_name", "id", "lesson_id", "mime", "page_count", "size_bytes", "speaker_id", "storage_path", "uploaded_at", "uploaded_by"]);
      });
      await as(db, "anon", null, async (q) => {
        expect(await refusal(q("select * from public.source_files"))).toBe("42501");
        expect(await refusal(q("select public.register_source_file(1, 1, 'x', 'x', 1)"))).toBe("42501");
      });
    });

    it("is never published to Realtime", async () => {
      expect((await db.query("select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'source_files'")).rows[0].n).toBe(0);
    });

    it("counts an upload as a member's history (deactivate, never delete)", async () => {
      expect((await db.query("select app.member_has_history($1) as h", [member[B]])).rows[0].h).toBe(true);
    });

    it("keeps the reader's running headers as the admin typed them — empty removes them", async () => {
      expect(await refusal(commitAs(A, "select public.set_reader_headers($1, 'x', 'y')", [ed]))).toBe("forbidden");
      await commitAs(ED_ADMIN, "select public.set_reader_headers($1, $2, $3)", [ed, "  כותרת   שמאל ", null]);
      expect((await db.query("select settings -> 'reader_headers' as h from public.editions where id = $1", [ed])).rows[0].h).toEqual(["כותרת שמאל", ""]);
      await commitAs(ED_ADMIN, "select public.set_reader_headers($1, ' ', null)", [ed]);
      expect((await db.query("select settings ? 'reader_headers' as h from public.editions where id = $1", [ed])).rows[0].h).toBe(false);
    });

    it("exposes the functions with the contract's parameter names (src/data/supabaseSources.ts calls them by name)", async () => {
      const sig = async (fn: string) =>
        (await db.query("select pg_get_function_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows.map((r) => r.a);
      expect(await sig("register_source_file")).toEqual(["p_edition bigint, p_lesson bigint, p_path text, p_display_name text, p_pages integer"]);
      expect(await sig("remove_source_file")).toEqual(["p_file bigint"]);
      expect(await sig("set_reader_headers")).toEqual(["p_edition bigint, p_left text, p_right text"]);
      expect(await sig("set_reader_cover")).toEqual(["p_edition bigint, p_file bigint"]);
    });
  });
});
