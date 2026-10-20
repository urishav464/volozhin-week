// The decision gate's practice week: it seeds once, holds only synthetic
// people, satisfies every constraint, and unseeds without touching real rows.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SCHEMA, dropDatabase, freshDatabase, google } from "./db";

const SEED = readFileSync(new URL("../../supabase/seed_gate.sql", import.meta.url), "utf8");
const UNSEED = readFileSync(new URL("../../supabase/unseed_gate.sql", import.meta.url), "utf8");

describe("seed_gate.sql / unseed_gate.sql", () => {
  const dbName = `vw_seed_${process.pid}`;
  let db: pg.Client;

  beforeAll(async () => {
    db = await freshDatabase(dbName, "new");
    await db.query(SCHEMA);
    await db.query("insert into public.speakers (name, gender, vetted) values ('מרצה אמיתית', 'f', 'approved')");
  });
  afterAll(async () => {
    if (db) await dropDatabase(db, dbName);
  });

  const count = async (sql: string) => Number((await db.query(sql)).rows[0].n);

  it("seeds the practice week once", async () => {
    await db.query(SEED);
    await db.query(SEED);
    expect(await count("select count(*) as n from public.editions where label = 'הדגמה'")).toBe(1);
    expect(await count("select count(*) as n from public.speakers where source = 'synthetic'")).toBe(60);
    expect(await count("select count(*) as n from public.lessons where state = 'closed'")).toBe(18);
    expect(await count("select count(*) as n from public.lesson_speakers where active")).toBe(18);
    expect(await count("select count(*) as n from public.lessons where kind = 'memorial'")).toBe(5);
    expect(await count("select count(*) as n from public.lessons where end_min - start_min = 270")).toBe(1); // the all-night merge
  });

  it("unseeds everything synthetic and nothing else — speakers the team added in the gate too, unless another edition uses them", async () => {
    // the gate's team adds two speakers from the demo edition; a real edition then takes one of them
    const gate = Number((await db.query("select id from public.editions where label = 'הדגמה'")).rows[0].id);
    const real = Number((await db.query("insert into public.editions (label, kind) values ('מחזור אמיתי', 'real') returning id")).rows[0].id);
    await db.query("insert into public.members (email, display_name, role, edition_id) values ('gate@example.org', 'צוות', 'content', $1), ('real@example.org', 'צוות', 'content', $2)", [gate, real]);
    const added: number[] = [];
    for (const name of ["מרצה שנוספה בהדגמה", "מרצה אחרת שנוספה בהדגמה"]) {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google("gate@example.org"))]);
      added.push(Number((await db.query("select (public.create_speaker($1, $2::jsonb, true, false, true) ->> 'speaker_id')::bigint as id", [gate, JSON.stringify({ name })])).rows[0].id));
      await db.query("commit");
    }
    expect(await count(`select count(*) as n from public.speakers where source = 'synthetic' and id in (${added.join(",")})`)).toBe(2);
    await db.query("insert into public.approaches (edition_id, speaker_id, owner_member_id) select $1, $2, id from public.members where email = 'real@example.org'", [real, added[1]]);
    // a file uploaded in the practice week: its row goes with the edition, its bytes stay — the run says where, as SETUP does
    await db.query("insert into public.source_files (edition_id, cover, storage_path, display_name, mime, size_bytes, page_count) values ($1, true, $2, 'פוסטר.pdf', 'application/pdf', 10, 1)", [gate, `${gate}/cover/00000000-0000-4000-8000-000000000000-poster.pdf`]);
    const notices: string[] = [];
    const heard = (n: { message?: string }) => notices.push(n.message ?? "");
    db.on("notice", heard);

    await db.query(UNSEED);
    await db.query(UNSEED);
    db.off("notice", heard);
    expect(notices).toEqual([`1 uploaded file(s) of the practice week stay in Storage: Storage → Files → sources → folder ${gate} (right-click → Delete)`]);
    expect((await db.query("select label from public.editions")).rows.map((r) => r.label)).toEqual(["מחזור אמיתי"]);
    expect((await db.query("select name from public.speakers order by name")).rows.map((r) => r.name)).toEqual(["מרצה אחרת שנוספה בהדגמה", "מרצה אמיתית"]);
  });
});
