// The decision gate's practice week: it seeds once, holds only synthetic
// people, satisfies every constraint, and unseeds without touching real rows.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SCHEMA, dropDatabase, freshDatabase } from "./db";

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

  it("unseeds everything synthetic and nothing else", async () => {
    await db.query(UNSEED);
    await db.query(UNSEED);
    expect(await count("select count(*) as n from public.editions")).toBe(0);
    expect(await count("select count(*) as n from public.speakers where source = 'synthetic'")).toBe(0);
    expect(await count("select count(*) as n from public.speakers")).toBe(1);
  });
});
