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
  it("has a message for every app.refuse code in schema.sql — and (v20) every code an invoker function raises itself", () => {
    const codes = new Set([...SCHEMA.matchAll(/app\.refuse\('([a-z_]+)'\)/g)].map((m) => m[1]));
    // an invoker (rota_split_cohort, app.rota_cohort_duties_guard) cannot run app.refuse: it raises the code itself
    const raised = [...SCHEMA.matchAll(/raise exception using message = '([a-z_]+)', errcode = 'P0001'/g)].map((m) => m[1]);
    expect(raised).toEqual(expect.arrayContaining(["in_use", "bad_value", "forbidden", "stale"]));
    for (const c of raised) codes.add(c);
    expect(ERRORS.cohort_not_helping).toBe("המכינה לא עוזרת באף תורנות, ולכן אין לה קבוצות. מסמנים לה תורנות קודם.");
    expect(ERRORS.rota_diets_exceed).toMatch(/מהם גם וגם/);
    expect(codes.size).toBeGreaterThan(10);
    expect([...codes].filter((c) => !ERRORS[c])).toEqual([]);
  });

  it("has a message for every code the browser refuses with — its own checks and the Storage API's answers as it maps them", () => {
    const codes = browserCodes();
    for (const status of [401, 403, 413, 415, 500]) codes.add(uploadRefusal(status, ""));
    // the pick's reasons (src/data/sourceRules.ts checkPicked — a presentation's three since the reset, phase 5) and the upload's, each its own
    for (const c of ["bad_file", "cover_bad_file", "file_too_big", "upload_refused", "upload_failed", "pptx_source", "presentation_bad_file", "week_presentation_bad_file"]) expect(codes).toContain(c);
    expect([...codes].filter((c) => !ERRORS[c])).toEqual([]);
  });

  it("approved_locked is reopen_lesson's refusal (its one raise): it names the reopen — the handler may still change the request", () => {
    expect(ERRORS.approved_locked).toBe("הבקשה אושרה — רק צוות המחזור פותח מחדש.");
    expect(ERRORS.approved_locked).not.toMatch(/לשנות/);
    expect([...SCHEMA.matchAll(/app\.refuse\('approved_locked'\)/g)]).toHaveLength(1);
  });

  it("says what is wrong with a picked file: its type, the poster's type, or its size — never one for the other", () => {
    expect(ERRORS.bad_file).toContain("PDF");
    expect(ERRORS.bad_file).not.toMatch(/25MB|לשער/);
    expect(ERRORS.cover_bad_file).toMatch(/^לשער/);
    expect(ERRORS.cover_bad_file).not.toContain("Word");
    expect(ERRORS.file_too_big).toContain("25MB");
    expect(ERRORS.file_too_big).not.toMatch(/Word|PNG/);
  });

  it("a presentation's three of its own (the reset, phase 5): a pptx is no source, what a deck may be, the week's never Word", () => {
    expect(ERRORS.pptx_source).toContain("PowerPoint");
    expect(ERRORS.pptx_source).toContain("«העלאת מצגת»");
    expect(ERRORS.presentation_bad_file).toMatch(/^מצגת/);
    for (const t of ["pptx", "PDF", "PNG/JPG", "Word"]) expect(ERRORS.presentation_bad_file).toContain(t);
    expect(ERRORS.week_presentation_bad_file).toMatch(/^למצגת של השבוע/);
    expect(ERRORS.week_presentation_bad_file).toMatch(/לא Word\.$/);
    // the sources' own words stay as they were (tests/e2e/reader.spec.ts pins bad_file)
    expect(ERRORS.bad_file).not.toMatch(/מצגת|pptx/);
    expect(ERRORS.upload_refused).toMatch(/^אין הרשאה להעלות לכאן/);
    expect(ERRORS.upload_refused).toContain("המצגת של השבוע");
  });
});
