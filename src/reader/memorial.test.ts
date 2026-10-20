// Memorial times in the reader (milestone 5ב-2): a slot with a plan says «התקבל» or «חסר» for its materials, which
// are the files that came for the plan's fallen wherever they were uploaded; its header names the fallen; the Word
// skeleton, the PDF's plan and the estimate take them; an unread one is named after a build like a lesson's. And the
// escorts' list puts a slot in its liaison's group — never a family's contact.
import { describe, expect, it } from "vitest";
import { demoWeek } from "../data/demoWeek";
import type { Lesson, SourceFile, Week } from "../domain/types";
import { escortGroups } from "../exports/escorts";
import { skeletonParagraphs } from "./docx";
import { IN_READER, manifestTotals, memorialFiles, readerEstimate, readerManifest, readerRows, unreadForReader } from "./model";

const memorialOn = (w: Week, day: number): Lesson => w.lessons.find((l) => l.kind === "memorial" && l.day === day)!;
let n = 900;
function file(w: Week, lessonId: number | null, fallenId: number | null, o: Partial<SourceFile> = {}): SourceFile {
  const f: SourceFile = {
    id: ++n, lesson_id: lessonId, cover: false, speaker_id: null, fallen_id: fallenId, storage_path: `1/${lessonId ?? "x"}/${n}`, display_name: `עמוד ${n}.pdf`,
    mime: "application/pdf", size_bytes: 1, page_count: 2, uploaded_by: 1, uploaded_at: "2026-11-01T00:00:00Z", ...o,
  };
  w.sourceFiles.push(f);
  return f;
}
const rowOf = (w: Week, l: Lesson) => readerManifest(w).rows.find((r) => r.lesson.id === l.id)!;

describe("memorial times in the reader", () => {
  it("say «חסר» for a slot with a plan and nothing printable yet, «זמן זיכרון» for one without — both in the reader, with their header", () => {
    const w = demoWeek(); // Sunday's slot holds «חלל/ה לדוגמה 1»'s plan, with no file yet
    const sunday = rowOf(w, memorialOn(w, 0));
    expect(sunday).toMatchObject({ status: "memorial_missing", header: "זמן זיכרון – חלל/ה לדוגמה 1", fallen: "חלל/ה לדוגמה 1", pages: 0, files: [] });
    expect(rowOf(w, memorialOn(w, 1))).toMatchObject({ status: "memorial", header: "זמן זיכרון", fallen: null });
    expect(IN_READER.memorial_missing && IN_READER.memorial && IN_READER.memorial_received).toBe(true);
    expect(readerRows(readerManifest(w)).filter((r) => r.kind === "memorial")).toHaveLength(5);
    expect(manifestTotals(readerManifest(w)).memorial).toBe(5);
  });

  it("take the plan's files once one is read: «התקבל», its pages in the reader, the estimate and the Word skeleton", () => {
    const w = demoWeek();
    const slot = memorialOn(w, 0);
    const before = readerEstimate(readerManifest(w), []);
    file(w, slot.id, 1, { page_count: 3 });
    file(w, slot.id, 1, { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", page_count: null });
    const unread = file(w, slot.id, 1, { page_count: null });
    const row = rowOf(w, slot);
    expect(row).toMatchObject({ status: "memorial_received", pages: 3 });
    expect([row.printable.length, row.word.length, row.unread.length]).toEqual([1, 1, 1]);
    expect(readerEstimate(readerManifest(w), [])).toBe(before + 2); // its header page becomes the strip on the file's first page
    // named after a build like any lesson's unread file (the slot is not marked in_reader: it is always in)
    expect(unreadForReader(readerManifest(w)).map((f) => f.id)).toContain(unread.id);
    const paras = skeletonParagraphs({ manifest: readerManifest(w), editionLabel: "הדגמה" }).map((p) => p.text);
    expect(paras).toContain("זמן זיכרון – חלל/ה לדוגמה 1");
  });

  it("follow the plan: a file that came for a fallen is theirs wherever the plan is placed now — and never listed twice", () => {
    const w = demoWeek();
    const [sun, mon] = [memorialOn(w, 0), memorialOn(w, 1)];
    const page = file(w, sun.id, 1);
    const stray = file(w, sun.id, 2); // came for fallen 2, whose plan is in the tray
    expect(memorialFiles(w, sun).map((f) => f.id)).toEqual([page.id]);
    expect(rowOf(w, sun).previous.map((f) => f.id)).toEqual([stray.id]); // for removal, never in the reader
    w.memorialPlans.find((p) => p.fallen_id === 1)!.lesson_id = mon.id; // the plan moved to Monday
    expect(memorialFiles(w, mon).map((f) => f.id)).toEqual([page.id]);
    expect(rowOf(w, mon)).toMatchObject({ status: "memorial_received", header: "זמן זיכרון – חלל/ה לדוגמה 1" });
    expect(rowOf(w, sun)).toMatchObject({ status: "memorial", files: [] });
    expect(rowOf(w, sun).previous.map((f) => f.id)).toEqual([stray.id]); // fallen 1's file is Monday's now
    // its slot removed since (lesson_id null): still Monday's, not a leftover
    page.lesson_id = null;
    const m = readerManifest(w);
    expect(m.leftovers.map((f) => f.id)).not.toContain(page.id);
    expect(m.rows.find((r) => r.lesson.id === mon.id)!.files.map((f) => f.id)).toEqual([page.id]);
    // off its slot: the file is no slot's — it shows where it came from, for removal
    w.memorialPlans.find((p) => p.fallen_id === 1)!.lesson_id = null;
    page.lesson_id = sun.id;
    expect(rowOf(w, sun).previous.map((f) => f.id)).toEqual([page.id, stray.id]);
    expect(readerManifest(w).rows.flatMap((r) => r.files).map((f) => f.id)).not.toContain(page.id);
  });
});

describe("the escorts' list and a memorial slot", () => {
  it("puts the slot in its liaison's group — the family's contact person, the fallen's name — never a family's contact detail", () => {
    const w = demoWeek(); // Sunday's slot: «מלווה לדוגמה ד׳» is the liaison
    const g = escortGroups(w).find((x) => x.escort?.id === 4)!;
    const line = g.lessons.find((l) => l.lesson.kind === "memorial")!;
    expect(line).toMatchObject({ title: "זמן זיכרון – חלל/ה לדוגמה 1", intro: "זמן זיכרון", introDetail: "איש הקשר של המשפחה", speaker: "", speakerId: null });
    expect(g.load).toBe("הוא מלווה 2 שיעורים");
    expect(JSON.stringify(escortGroups(w))).not.toMatch(/טלפון לדוגמה|family1@example\.org|איש\/אשת קשר לדוגמה/);
    // a slot with no liaison is not «עוד בלי מלווה»: that list is the closed lessons'
    expect(escortGroups(w).find((x) => x.escort == null)?.lessons.some((l) => l.lesson.kind === "memorial") ?? false).toBe(false);
  });
});
