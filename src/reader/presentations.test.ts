// v19: a presentation (source_files.kind) is shown in the room, never printed — not in the manifest (no row's file, no
// leftover, never waiting, never the cover), not in the «מקראה» stage's count, not in the prints; and «נשלח לדפוס»
// counts the reader's files that came after it (filesAfterSent). Synthetic only.
import { describe, expect, it } from "vitest";
import { isPresentation } from "../data/sourceRules";
import { readerFilesOf } from "../domain/stages";
import type { SourceFile } from "../domain/types";
import { printRows } from "../exports/logistics";
import { addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import { filesAfterSent, readerManifest, unreadForReader } from "./model";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
let seq = 0;
const file = (over: Partial<SourceFile>): SourceFile => ({
  id: ++seq, lesson_id: null, cover: false, speaker_id: null, fallen_id: null, storage_path: `1/cover/x-${seq}.pdf`, display_name: `קובץ ${seq}.pdf`,
  mime: "application/pdf", size_bytes: 1000, page_count: 2, uploaded_by: 1, uploaded_at: "2026-11-10T08:00:00.000Z", ...over,
});

function week() {
  const w = emptyWeek();
  const s = addSpeaker(w, "f", "מרצה לדוגמה");
  const l = closeWith(w, addLesson(w, 1, 510, 600, { sources_kind: "sheet", in_reader: true, print_when: "before" }), s);
  const sheet = file({ lesson_id: l.id, speaker_id: s.id });
  const deck = file({ lesson_id: l.id, speaker_id: s.id, kind: "presentation", mime: PPTX, page_count: null });
  const pdfDeck = file({ lesson_id: l.id, speaker_id: s.id, kind: "presentation", page_count: 5 });
  const unreadDeck = file({ lesson_id: l.id, speaker_id: s.id, kind: "presentation", page_count: null });
  const weekDeck = file({ kind: "presentation", mime: PPTX, page_count: null }); // the week's, on the cover path
  const poster = file({ cover: true, mime: "image/png", page_count: 1 });
  w.sourceFiles.push(sheet, deck, pdfDeck, unreadDeck, weekDeck, poster);
  w.edition.settings = { reader_cover: poster.id };
  return { w, l, sheet, deck, pdfDeck, weekDeck, poster };
}

describe("a presentation is never the reader's", () => {
  it("the manifest: the lesson's row has its sheet only; nothing left over, waiting, unread or a cover", () => {
    const { w, l, sheet, poster } = week();
    const m = readerManifest(w);
    const row = m.rows.find((r) => r.lesson.id === l.id)!;
    expect(row.files.map((f) => f.id)).toEqual([sheet.id]);
    expect(row.printable.map((f) => f.id)).toEqual([sheet.id]);
    expect([row.word, row.unread, row.previous]).toEqual([[], [], []]);
    expect(row.pages).toBe(2);
    expect(row.status).toBe("included");
    expect(m.leftovers).toEqual([]); // the week's presentation (no lesson, no cover) is no leftover
    expect(m.waiting).toEqual([]);
    expect(m.covers.map((f) => f.id)).toEqual([poster.id]);
    expect(m.cover?.id).toBe(poster.id);
    expect(unreadForReader(m)).toEqual([]);
  });

  it("a lesson whose files are all presentations has none for the reader: «חסר»", () => {
    const { w, l, sheet } = week();
    w.sourceFiles = w.sourceFiles.filter((f) => f.id !== sheet.id);
    const row = readerManifest(w).rows.find((r) => r.lesson.id === l.id)!;
    expect([row.status, row.files]).toEqual(["missing", []]);
    expect(readerFilesOf(w, l.id)).toEqual({ printable: 0, word: 0, unread: 0 });
  });

  it("the «מקראה» stage counts the sheet alone", () => {
    const { w, l } = week();
    expect(readerFilesOf(w, l.id)).toEqual({ printable: 1, word: 0, unread: 0 });
  });

  it("the prints list the sheet alone, and its pages", () => {
    const { w, l, sheet } = week();
    const [row] = printRows(w);
    expect(row.lesson.id).toBe(l.id);
    expect(row.files.map((f) => f.id)).toEqual([sheet.id]);
    expect([row.pages, row.uncounted]).toEqual([2, 0]);
  });

  it("isPresentation reads the kind; absent is a source", () => {
    expect(isPresentation({ kind: "presentation" })).toBe(true);
    expect(isPresentation({ kind: "source" })).toBe(false);
    expect(isPresentation({})).toBe(false);
  });
});

describe("filesAfterSent («נוספו N קבצים אחרי השליחה»)", () => {
  it("0 while not sent; then the reader's files uploaded after the stamp — never a presentation", () => {
    const { w, l, sheet } = week();
    expect(filesAfterSent(w)).toBe(0);
    w.edition.settings = { ...w.edition.settings, reader_sent: { at: "2026-11-10T08:00:00.000Z", by: 5 } };
    expect(filesAfterSent(w)).toBe(0); // the same instant is not after
    w.sourceFiles.push(
      file({ lesson_id: l.id, speaker_id: sheet.speaker_id, uploaded_at: "2026-11-10T08:00:00.001Z" }),
      file({ cover: true, mime: "image/jpeg", page_count: 1, uploaded_at: "2026-11-11T08:00:00.000Z" }), // a poster counts
      file({ lesson_id: l.id, kind: "presentation", uploaded_at: "2026-11-12T08:00:00.000Z" }),
      file({ lesson_id: l.id, uploaded_at: "2026-11-09T08:00:00.000Z" }), // before
    );
    expect(filesAfterSent(w)).toBe(2);
    w.edition.settings = { ...w.edition.settings, reader_sent: { at: "not a date", by: 5 } };
    expect(filesAfterSent(w)).toBe(0);
  });
});
