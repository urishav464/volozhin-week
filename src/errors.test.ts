// Every refusal code the database can raise — and every one the browser
// raises itself, before or around a call — has Hebrew in src/errors.ts, so a
// raw code never reaches a trainee.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { uploadRefusal } from "./data/supabaseSources";
import { ERRORS } from "./errors";

const SCHEMA = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

/** The codes thrown in the app's own code: `fail("…")` and `new CommandError("…")` in every non-test source under src/. */
function browserCodes(): Set<string> {
  const root = new URL("./", import.meta.url);
  const codes = new Set<string>();
  for (const f of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
    for (const m of readFileSync(new URL(f, root), "utf8").matchAll(/(?:fail|CommandError)\("([a-z_]+)"\)/g)) codes.add(m[1]);
  }
  return codes;
}

describe("the error catalog", () => {
  it("has a message for every app.refuse code in schema.sql", () => {
    const codes = new Set([...SCHEMA.matchAll(/app\.refuse\('([a-z_]+)'\)/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(10);
    expect([...codes].filter((c) => !ERRORS[c])).toEqual([]);
  });

  it("has a message for every code the browser refuses with — its own checks and the Storage API's answers as it maps them", () => {
    const codes = browserCodes();
    for (const status of [401, 403, 413, 415, 500]) codes.add(uploadRefusal(status, ""));
    // the pick's three reasons (src/data/sourceRules.ts checkPicked) and the upload's, each its own
    for (const c of ["bad_file", "cover_bad_file", "file_too_big", "upload_refused", "upload_failed"]) expect(codes).toContain(c);
    expect([...codes].filter((c) => !ERRORS[c])).toEqual([]);
  });

  it("says what is wrong with a picked file: its type, the poster's type, or its size — never one for the other", () => {
    expect(ERRORS.bad_file).toContain("PDF");
    expect(ERRORS.bad_file).not.toMatch(/25MB|לשער/);
    expect(ERRORS.cover_bad_file).toMatch(/^לשער/);
    expect(ERRORS.cover_bad_file).not.toContain("Word");
    expect(ERRORS.file_too_big).toContain("25MB");
    expect(ERRORS.file_too_big).not.toMatch(/Word|PNG/);
  });
});
