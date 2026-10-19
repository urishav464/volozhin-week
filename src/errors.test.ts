// Every refusal code the database can raise has Hebrew in src/errors.ts, so a
// raw code never reaches a trainee.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ERRORS } from "./errors";

const SCHEMA = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

describe("the error catalog", () => {
  it("has a message for every app.refuse code in schema.sql", () => {
    const codes = new Set([...SCHEMA.matchAll(/app\.refuse\('([a-z_]+)'\)/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(10);
    expect([...codes].filter((c) => !ERRORS[c])).toEqual([]);
  });
});
