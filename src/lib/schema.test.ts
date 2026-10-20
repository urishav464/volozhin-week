// The app's expected schema version and the database's own must be bumped together
// (CLAUDE.md «Schema changes»): a mismatch locks every member out on the re-run screen
// (gateFor), and nothing else catches it — the demo and the mock both echo the app's number.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPECTED_SCHEMA_VERSION } from "./schema";

const SCHEMA = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");

describe("EXPECTED_SCHEMA_VERSION", () => {
  it("is the number public.schema_version() returns in supabase/schema.sql", () => {
    const m = SCHEMA.match(/create or replace function public\.schema_version\(\)[\s\S]*?\$\$\s*select\s+(\d+)\s*\$\$/);
    expect(m, "public.schema_version() not found").not.toBeNull();
    expect(Number(m![1])).toBe(EXPECTED_SCHEMA_VERSION);
  });
});
