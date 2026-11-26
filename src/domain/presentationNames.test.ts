// The week's zip names (v20) from the escort's side: what the escort's page (/e) says of each lesson's presentation, from
// escort_view's state and its day, start and room alone — and that it is the zip's own naming: for every lesson the page
// says «הקובץ שמתחיל ב-…», each of that lesson's files in the week's zip lies in that folder and starts with that. On the
// demo's escort link (Engine.escortView behind DemoLinks, which tests/parity holds equal to the SQL). Synthetic only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoToken } from "../data/demoLinks";
import { DemoPort } from "../data/demoPort";
import { dayFolder, entryPrefix, escortPresentationLine, LINKS_FILE, segmentsText, splitEntry } from "./presentationNames";
import { presentationEntries, presentationRows, weekZipPlan } from "./presentations";
import type { SourceFile } from "./types";

describe("the escort's line about the presentation", () => {
  it("file: the day's folder and the name's start; link: links.txt in the day's folder; missing: ask the team; none (or no answer): nothing", () => {
    expect(segmentsText(escortPresentationLine("file", 1, 630, "בית מדרש")!)).toBe("מצגת: במחשב של האולם, בתיקייה «2-שני», הקובץ שמתחיל ב-«1030_בית מדרש_»");
    expect(escortPresentationLine("file", 1, 630, "בית מדרש")!.filter((s) => "name" in s)).toEqual([{ name: "2-שני" }, { name: "1030_בית מדרש_" }]);
    expect(segmentsText(escortPresentationLine("file", 0, 1470, "Hall A")!)).toBe("מצגת: במחשב של האולם, בתיקייה «1-ראשון», הקובץ שמתחיל ב-«2430_Hall A_»"); // a night: the day before's folder
    expect(segmentsText(escortPresentationLine("link", 3, 600, "בית מדרש")!)).toBe(`המצגת בקישור — בקובץ ${LINKS_FILE} בתיקייה של היום, «4-רביעי»`);
    expect(segmentsText(escortPresentationLine("missing", 3, 600, "בית מדרש")!)).toBe("המצגת עוד לא הועלתה — בודקים עם הצוות");
    expect(escortPresentationLine("none", 3, 600, "בית מדרש")).toBeNull();
    expect(escortPresentationLine(undefined, 3, 600, "בית מדרש")).toBeNull(); // an answer without the key: never «a file»
  });

  it("is the zip's naming: every file of a lesson the escort is told «file» about is in that folder and starts with that; «link» has its links.txt there", async () => {
    const port = new DemoPort();
    const week = port.engine(1).week;
    const escort = week.roster[0].id;
    for (const l of week.lessons) if (l.state === "closed" || l.kind === "memorial") l.escort_roster_id = escort;
    // a file for most closed lessons (two for some, one of them at night), a link on one more
    const closed = week.lessons.filter((l) => l.kind === "lesson" && l.state === "closed");
    const base = week.sourceFiles.find((f) => f.kind === "presentation" && f.lesson_id != null)!;
    let id = 9000;
    const add = (lessonId: number, display: string) => {
      const lead = week.lessonSpeakers.find((x) => x.lesson_id === lessonId && x.role === "lead")!.speaker_id;
      const f: SourceFile = { ...base, id: ++id, lesson_id: lessonId, speaker_id: lead, display_name: display, storage_path: base.storage_path.replace(/\/\d+\/([^/]+)$/, `/${lessonId}/${id}-$1`) };
      week.sourceFiles.push(f);
    };
    for (const [i, l] of closed.entries()) {
      if (i % 3 === 2) continue;
      add(l.id, "שקפים.pdf");
      if (i % 4 === 0) add(l.id, "שקפים.pdf"); // the same name twice: the second gets its id, after the prefix
    }
    const linkOnly = closed.find((l, i) => i % 3 === 2 && !week.sourceFiles.some((f) => f.lesson_id === l.id))!;
    linkOnly.presentation_url = "https://example.org/slides-for-the-test";

    const view = await port.public.escortView(demoToken("escort", 1, escort, true));
    const entries = presentationEntries(week);
    const plan = weekZipPlan(week);
    const byLesson = new Map(presentationRows(week).map((r) => [r.lessonId, r.files.map((f) => f.id)]));
    let files = 0;
    for (const l of view.lessons) {
      const line = escortPresentationLine(l.presentation, l.day, l.start_min, l.room);
      if (l.presentation === "file") {
        const [folder, start] = line!.flatMap((s) => ("name" in s ? [s.name] : []));
        const ids = byLesson.get(l.lesson_id)!;
        expect(ids.length, `lesson ${l.lesson_id}`).toBeGreaterThan(0);
        for (const fid of ids) {
          const path = entries.get(fid)!;
          expect(splitEntry(path).folder, path).toBe(folder);
          expect(splitEntry(path).name.startsWith(start), path).toBe(true);
          expect(path.startsWith(entryPrefix(l.day, l.start_min, l.room))).toBe(true);
          files++;
        }
      } else if (l.presentation === "link") {
        expect(plan.texts.some((t) => t.name === `${dayFolder(l.day)}/${LINKS_FILE}`), `lesson ${l.lesson_id}`).toBe(true);
      } else if (l.presentation === "none") expect(line).toBeNull();
    }
    expect(files).toBeGreaterThan(10);
    expect(view.lessons.find((l) => l.lesson_id === linkOnly.id)!.presentation).toBe("link");
    expect(plan.texts.find((t) => t.name === `${dayFolder(linkOnly.day)}/${LINKS_FILE}`)!.text).toContain("https://example.org/slides-for-the-test");
  });

  it("stays small for the public bundle: it imports the safe-name helper and the day names, nothing else", () => {
    const src = readFileSync(new URL("./presentationNames.ts", import.meta.url), "utf8");
    expect(src.match(/^import .*$/gm)).toEqual(['import { safeEntryName } from "../exports/download";', 'import { type Day, DAY_NAMES } from "./time";']);
    const download = readFileSync(new URL("../exports/download.ts", import.meta.url), "utf8");
    expect(download.match(/^import .*$/gm)).toBeNull();
  });
});
