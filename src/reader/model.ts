// The reader (DESIGN «תוצרים» 5, and its appendix: what last year's reader
// was): which lessons go in and in what order, and the manifest «התקבל /
// חסר». Pure, from a loaded Week — the screen, the PDF build and the Word
// skeleton read this one list.
//
// In the reader, in schedule order (day, teaching time, the room's place):
//   - every closed lesson marked «במקראה» (in_reader) that has a PDF or an
//     image from its current speaker — a header «מרצה – כותרת», then its files;
//   - every memorial slot (its materials come with the memorial screen, 5ב-2:
//     memorialFiles is the hook; until then its header alone).
// Not in it: a lesson without sources, a presentation alone, one not marked,
// one whose files are all Word (they cannot be merged in the browser: «צריך
// PDF»), and a previous speaker's files (reopen_lesson keeps them, for removal).
import { displayName } from "../domain/names";
import { DAY_NAMES, type Day, DAYS, fmtRange } from "../domain/time";
import type { Lesson, SourceFile, SourcesKind, Week } from "../domain/types";
import { scheduleEntries } from "../exports/designer";
import { printableMime } from "../data/sourceRules";

export type ManifestStatus =
  /** in the reader: marked, with at least one PDF or image */
  | "included"
  /** marked, but its files are all Word — someone makes a PDF */
  | "needs_pdf"
  /** marked (or a kind with something to print), and nothing arrived yet */
  | "missing"
  /** files arrived, but the lesson is not marked «במקראה» */
  | "not_marked"
  /** sources not received yet */
  | "pending"
  /** a presentation alone: never printed */
  | "presentation_only"
  /** no sources at all */
  | "no_sources"
  /** a memorial slot: in the reader, its header (its materials: 5ב-2) */
  | "memorial";

export const STATUS_LABEL: Record<ManifestStatus, string> = {
  included: "התקבל",
  needs_pdf: "צריך PDF",
  missing: "חסר",
  not_marked: "לא סומן למקראה",
  pending: "חסר — טרם התקבלו",
  presentation_only: "מצגת בלבד — לא במקראה",
  no_sources: "בלי מקורות",
  memorial: "זמן זיכרון",
};

/** Does the status put the lesson's pages in the reader? */
export const IN_READER: Record<ManifestStatus, boolean> = {
  included: true, memorial: true, needs_pdf: false, missing: false, not_marked: false, pending: false, presentation_only: false, no_sources: false,
};

export interface ManifestRow {
  lesson: Lesson;
  kind: "lesson" | "memorial";
  day: Day;
  /** «ראשון 08:30–09:45», a night's «ליל ראשון–שני 00:30–01:45» — the teaching time. */
  when: string;
  /** The speakers as printed, the lead first («ד״ר פלונית · פלוני»); "" for a memorial slot. */
  speaker: string;
  title: string | null;
  /** The reader's header: «מרצה – כותרת» (TBD for a missing title, never a word of ours); «זמן זיכרון – …». */
  header: string;
  sourcesKind: SourcesKind;
  status: ManifestStatus;
  /** The current speaker's files, upload order. */
  files: SourceFile[];
  /** Of those, what the PDF build merges: PDFs and images. */
  printable: SourceFile[];
  /** Word files: kept and listed, never merged («צריך PDF»). */
  word: SourceFile[];
  /** PDFs whose pages the browser could not count on upload (protected? damaged?) — the build tries them and says so. */
  unread: SourceFile[];
  /** Files that came for a speaker who is not the lead any more — «מהמרצה הקודם», for removal. */
  previous: SourceFile[];
  /** The pages it adds as far as is known now (a PDF not counted: 1). */
  pages: number;
}

export interface Manifest {
  rows: ManifestRow[];
  /** Files with no lesson to show them under: a draft's (its speaker left), a deleted lesson's. */
  leftovers: SourceFile[];
  /** The edition's posters (the cover is one of them, settings.reader_cover). */
  covers: SourceFile[];
  /** The marked poster, when it is still there and printable. */
  cover: SourceFile | null;
}

/** «ראשון», «ליל ראשון–שני» — a lesson's day as the tracking table writes it. */
export function dayLabel(day: Day, start: number): string {
  return start >= 1440 && day < 4 ? `ליל ${DAY_NAMES[day]}–${DAY_NAMES[(day + 1) as Day]}` : DAY_NAMES[day];
}

/** The reader's header for a lesson or a memorial slot. */
export function readerHeader(kind: "lesson" | "memorial", speaker: string, title: string | null): string {
  if (kind === "memorial") return title && title.trim() && title.trim() !== "זמן זיכרון" ? `זמן זיכרון – ${title.trim()}` : "זמן זיכרון";
  return `${speaker || "TBD"} – ${title?.trim() || "TBD"}`;
}

/**
 * The hook for the memorial slots' materials (milestone 5ב-2: a fallen's page, a family's text). None yet — so a
 * memorial slot is its header page alone.
 */
export function memorialFiles(_week: Week, _lesson: Lesson): SourceFile[] {
  return [];
}

function statusOf(l: Lesson, printable: SourceFile[], word: SourceFile[]): ManifestStatus {
  if (l.sources_kind === "none") return "no_sources";
  if (l.sources_kind === "presentation") return "presentation_only";
  if (l.in_reader) {
    if (printable.length > 0) return "included";
    return word.length > 0 ? "needs_pdf" : "missing";
  }
  if (l.sources_kind === "pending") return "pending";
  return printable.length > 0 || word.length > 0 ? "not_marked" : "missing";
}

/** The manifest: every closed lesson and memorial slot, in schedule order, and what the reader has of it. */
export function readerManifest(week: Week): Manifest {
  const lessons = new Map(week.lessons.map((l) => [l.id, l]));
  const lead = new Map(week.lessonSpeakers.filter((x) => x.role === "lead").map((x) => [x.lesson_id, x.speaker_id]));
  const files = [...(week.sourceFiles ?? [])].sort((a, b) => a.id - b.id);
  const rows: ManifestRow[] = scheduleEntries(week).map((e) => {
    const l = lessons.get(e.lesson_id)!;
    const when = `${dayLabel(l.day, l.start_min)} ${fmtRange(e.start_min, e.end_min)}`;
    if (e.kind === "memorial") {
      const mine = memorialFiles(week, l);
      const pages = mine.reduce((n, f) => n + (f.page_count ?? 1), 0);
      return {
        lesson: l, kind: "memorial", day: l.day, when, speaker: "", title: l.title, header: readerHeader("memorial", "", l.title), sourcesKind: l.sources_kind,
        status: "memorial", files: mine, printable: mine.filter((f) => printableMime(f.mime)), word: [], unread: [], previous: [], pages: Math.max(1, pages),
      };
    }
    const current = lead.get(l.id) ?? null;
    const own = files.filter((f) => f.lesson_id === l.id);
    const mine = own.filter((f) => f.speaker_id === current);
    const previous = own.filter((f) => f.speaker_id !== current);
    const printable = mine.filter((f) => printableMime(f.mime));
    const word = mine.filter((f) => !printableMime(f.mime));
    const unread = printable.filter((f) => f.mime === "application/pdf" && f.page_count == null);
    const status = statusOf(l, printable, word);
    return {
      lesson: l, kind: "lesson", day: l.day, when, speaker: e.speaker, title: l.title, header: readerHeader("lesson", e.speaker, l.title), sourcesKind: l.sources_kind,
      status, files: mine, printable, word, unread, previous, pages: status === "included" ? printable.reduce((n, f) => n + (f.page_count ?? 1), 0) : 0,
    };
  });
  const shownLessons = new Set(rows.map((r) => r.lesson.id));
  const leftovers = files.filter((f) => !f.cover && (f.lesson_id == null || !shownLessons.has(f.lesson_id)));
  const covers = files.filter((f) => f.cover);
  const marked = week.edition.settings?.reader_cover;
  const cover = covers.find((f) => f.id === marked && printableMime(f.mime)) ?? null;
  return { rows, leftovers, covers, cover };
}

/** What the reader prints, in order: the rows whose status puts them in. */
export function readerRows(m: Manifest): ManifestRow[] {
  return m.rows.filter((r) => IN_READER[r.status]);
}

export interface ManifestTotals {
  lessons: number;
  included: number;
  memorial: number;
  missing: number;
  needsPdf: number;
  notMarked: number;
  pending: number;
  presentationOnly: number;
  noSources: number;
  files: number;
  /** Pages from the lessons' files (an uncounted PDF: 1). */
  filePages: number;
}

export function manifestTotals(m: Manifest): ManifestTotals {
  const count = (s: ManifestStatus) => m.rows.filter((r) => r.status === s).length;
  return {
    lessons: m.rows.filter((r) => r.kind === "lesson").length,
    included: count("included"),
    memorial: count("memorial"),
    missing: count("missing"),
    needsPdf: count("needs_pdf"),
    notMarked: count("not_marked"),
    pending: count("pending"),
    presentationOnly: count("presentation_only"),
    noSources: count("no_sources"),
    files: m.rows.reduce((n, r) => n + r.files.length, 0),
    filePages: readerRows(m).reduce((n, r) => n + (r.kind === "lesson" ? r.pages : 0), 0),
  };
}

/** A day's rows in the reader, every day of the week (a «סיכום יום» page closes each one, even an empty day). */
export function byDay<T extends { day: Day }>(rows: T[]): { day: Day; rows: T[] }[] {
  return DAYS.map((day) => ({ day, rows: rows.filter((r) => r.day === day) }));
}

/** The lead speaker's display name, for a lesson (used where a screen needs one name). */
export function leadName(week: Week, lessonId: number): string | null {
  const x = week.lessonSpeakers.find((s) => s.lesson_id === lessonId && s.role === "lead");
  const s = x && week.speakers.find((p) => p.id === x.speaker_id);
  return s ? displayName(s) : null;
}
