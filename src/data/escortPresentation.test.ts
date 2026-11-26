// v20: escort_view's `presentation` in the demo (Engine.escortView behind DemoLinks) is exactly the state of the
// lesson's row in src/domain/presentations.ts (lessonPresentations / presentationRows) — the current lead's file, else a
// link, else one the sources expect, else none; a memorial slot none — and the escort's page gets nothing more of a
// presentation: no file name, no path, no link. tests/parity holds the SQL to the same (its anon steps pinned with `is`).
// Synthetic only.
import { describe, expect, it } from "vitest";
import { lessonPresentations } from "../domain/presentations";
import type { Week } from "../domain/types";
import { demoToken } from "./demoLinks";
import { DemoPort } from "./demoPort";

/** The demo's week with one trainee escorting every closed lesson and memorial slot — what the escort's page then lists. */
function everyLessonEscorted(): { port: DemoPort; week: Week; escort: number } {
  const port = new DemoPort();
  const week = port.engine(1).week;
  const escort = week.roster[0].id;
  for (const l of week.lessons) if (l.state === "closed" || l.kind === "memorial") l.escort_roster_id = escort;
  return { port, week, escort };
}

const stateOf = (week: Week, lessonId: number) => {
  const s = lessonPresentations(week, week.lessons.find((l) => l.id === lessonId)!).state;
  return s === "memorial" ? "none" : s;
};

describe("the escort's page: what presentation a lesson has (v20)", () => {
  it("each lesson's state is its row's on the presentations page — file, link, missing, none — and a memorial slot's none", async () => {
    const { port, week, escort } = everyLessonEscorted();
    const closed = week.lessons.filter((l) => l.state === "closed" && l.kind === "lesson");
    // one of each, by hand on lessons without a file: a link; a presentation expected; a previous speaker's file only
    const withFile = new Set(week.sourceFiles.filter((f) => f.kind === "presentation" && f.lesson_id != null).map((f) => f.lesson_id));
    const plain = closed.filter((l) => !withFile.has(l.id));
    plain[0].presentation_url = "https://example.org/slides-for-the-test";
    plain[1].sources_kind = "sheet_presentation";
    plain[2].sources_kind = "presentation";
    week.sourceFiles.push({ ...week.sourceFiles.find((f) => f.kind === "presentation" && f.lesson_id != null)!, id: 9001, lesson_id: plain[2].id, speaker_id: -1 }); // not the lead's: still missing
    const v = await port.public.escortView(demoToken("escort", 1, escort, true));
    expect(v.lessons.length).toBeGreaterThan(5);
    for (const l of v.lessons) expect(l.presentation, `lesson ${l.lesson_id}`).toBe(stateOf(week, l.lesson_id));
    const states = new Set(v.lessons.map((l) => l.presentation));
    expect(states).toEqual(new Set(["file", "link", "missing", "none"]));
    expect(v.lessons.find((l) => l.lesson_id === plain[0].id)!.presentation).toBe("link");
    expect(v.lessons.find((l) => l.lesson_id === plain[1].id)!.presentation).toBe("missing");
    expect(v.lessons.find((l) => l.lesson_id === plain[2].id)!.presentation).toBe("missing");
    expect(v.lessons.filter((l) => l.kind === "memorial").every((l) => l.presentation === "none")).toBe(true);
    // a file beats a link
    const filed = closed.find((l) => withFile.has(l.id))!;
    filed.presentation_url = "https://example.org/a-link-too";
    expect((await port.public.escortView(demoToken("escort", 1, escort, true))).lessons.find((l) => l.lesson_id === filed.id)!.presentation).toBe("file");
  });

  it("the state alone: never a file's name, a storage path or the link itself", async () => {
    const { port, week, escort } = everyLessonEscorted();
    week.lessons.find((l) => l.state === "closed" && l.kind === "lesson")!.presentation_url = "https://example.org/never-on-the-page";
    const text = JSON.stringify(await port.public.escortView(demoToken("escort", 1, escort, true)));
    expect(text).not.toContain("never-on-the-page");
    for (const f of week.sourceFiles) {
      expect(text).not.toContain(f.storage_path);
      expect(text).not.toContain(f.display_name);
    }
  });
});
