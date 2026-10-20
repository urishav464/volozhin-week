// The reader (DESIGN «תוצרים» 5, and its appendix: what last year's reader
// was): which lessons go in and in what order, and the manifest «התקבל /
// חסר». Pure, from a loaded Week — the screen, the PDF build and the Word
// skeleton read this one list.
//
// In the reader, in schedule order (day, teaching time, the room's place):
//   - every closed lesson marked «במקראה» (in_reader) that has a PDF or an
//     image from its current speaker, read in the browser on upload — a header
//     «מרצה – כותרת», then its files;
//   - every memorial slot: its header — «זמן זיכרון – <the fallen>» when a plan
//     is placed on it — then the plan's materials (memorialFiles: the PDFs and
//     images that came for that fallen, wherever uploaded, read on upload), with
//     a lesson's verdicts for the rest (Word: «צריך PDF»; not read: «צריך קובץ
//     אחר»). A plan in the tray keeps its materials, «ממתין לשיבוץ» (waiting).
// Not in it: a lesson without sources, a presentation alone, one not marked,
// one whose files are all Word (they cannot be merged in the browser: «צריך
// PDF»), a file the browser could not read on upload (its page_count NULL:
// src/reader/pages.ts — «צריך קובץ אחר»), and a previous speaker's files
// (reopen_lesson keeps them, for removal).
import { displayName } from "../domain/names";
import { DAY_NAMES, type Day, DAYS, fmtRange } from "../domain/time";
import type { Lesson, MemorialPlan, SourceFile, SourcesKind, Week } from "../domain/types";
import { scheduleEntries } from "../exports/designer";
import { LRM } from "../exports/table";
import { printableMime } from "../data/sourceRules";
import { planReader, scheduleCoverPages } from "./layout";
import type { ScheduleLine } from "./render";

export type ManifestStatus =
  /** in the reader: marked, with at least one PDF or image */
  | "included"
  /** marked, but its files are all Word — someone makes a PDF */
  | "needs_pdf"
  /** marked, but its PDFs and pictures could not be read (protected, damaged) — someone uploads another file */
  | "unreadable"
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
  /** a memorial slot with no plan placed on it: in the reader, its header alone */
  | "memorial"
  /** a memorial slot with a plan, and its materials arrived (a PDF or a picture read on upload): its header and them */
  | "memorial_received"
  /** a memorial slot with a plan, and its materials are all Word — someone makes a PDF: its header alone */
  | "memorial_needs_pdf"
  /** a memorial slot with a plan, and its PDFs and pictures could not be read — someone uploads another file: its header alone */
  | "memorial_unreadable"
  /** a memorial slot with a plan, and no materials arrived yet: its header alone */
  | "memorial_missing";

export const STATUS_LABEL: Record<ManifestStatus, string> = {
  included: "התקבל",
  needs_pdf: "צריך PDF",
  unreadable: "צריך קובץ אחר",
  missing: "חסר",
  not_marked: "לא סומן למקראה",
  pending: "חסר — טרם התקבלו",
  presentation_only: "מצגת בלבד — לא במקראה",
  no_sources: "בלי מקורות",
  memorial: "זמן זיכרון",
  memorial_received: "זמן זיכרון — התקבל",
  memorial_needs_pdf: "זמן זיכרון — צריך PDF",
  memorial_unreadable: "זמן זיכרון — צריך קובץ אחר",
  memorial_missing: "זמן זיכרון — חסר",
};

/** Does the status put the lesson's pages in the reader? */
export const IN_READER: Record<ManifestStatus, boolean> = {
  included: true, memorial: true, memorial_received: true, memorial_needs_pdf: true, memorial_unreadable: true, memorial_missing: true, needs_pdf: false, unreadable: false, missing: false, not_marked: false, pending: false, presentation_only: false, no_sources: false,
};

/**
 * Can the reader print this file: a PDF or a picture the browser read on upload as the build reads it (its page
 * count). A PDF or picture without one could not be read — protected, damaged, not the type its name says.
 */
export const readableFile = (f: Pick<SourceFile, "mime" | "page_count">): boolean => printableMime(f.mime) && f.page_count != null;

export interface ManifestRow {
  lesson: Lesson;
  kind: "lesson" | "memorial";
  day: Day;
  /** «ראשון 08:30–09:45», a night's «ליל ראשון–שני 00:30–01:45» — the teaching time (an LRM before it keeps it left to right). */
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
  /** Of those, what the PDF build merges: PDFs and images the browser read on upload (readableFile). */
  printable: SourceFile[];
  /** Word files: kept and listed, never merged («צריך PDF»). */
  word: SourceFile[];
  /** PDFs and images the browser could not read on upload: kept and listed, never in the reader («צריך קובץ אחר»). */
  unread: SourceFile[];
  /** Files that came for a speaker who is not the lead any more — «מהמרצה הקודם», for removal; a memorial slot's: memorialLeftovers. */
  previous: SourceFile[];
  /** The pages it adds: its readable files' counts. */
  pages: number;
  /** A memorial slot: the fallen of the plan placed on it (null: no plan). */
  fallen?: string | null;
}

export interface Manifest {
  rows: ManifestRow[];
  /** Files with no lesson to show them under: a draft's (its speaker left), a deleted lesson's. */
  leftovers: SourceFile[];
  /** A memorial plan's materials while the plan is in the tray: «ממתין לשיבוץ» — into the reader once it is placed, never for removal. */
  waiting: SourceFile[];
  /** The edition's posters (the cover is one of them, settings.reader_cover). */
  covers: SourceFile[];
  /** The marked poster, when it is still there and readable (else the schedule is the cover). */
  cover: SourceFile | null;
}

/** «ראשון», «ליל ראשון–שני» — a lesson's day as the tracking table writes it. */
export function dayLabel(day: Day, start: number): string {
  return start >= 1440 && day < 4 ? `ליל ${DAY_NAMES[day]}–${DAY_NAMES[(day + 1) as Day]}` : DAY_NAMES[day];
}

/** The reader's header for a lesson or a memorial slot (`speaker`: the fallen of the plan placed on it, or ""). */
export function readerHeader(kind: "lesson" | "memorial", speaker: string, title: string | null): string {
  if (kind === "memorial") {
    if (speaker.trim()) return `זמן זיכרון – ${speaker.trim()}`;
    return title && title.trim() && title.trim() !== "זמן זיכרון" ? `זמן זיכרון – ${title.trim()}` : "זמן זיכרון";
  }
  return `${speaker || "TBD"} – ${title?.trim() || "TBD"}`;
}

/** The plan placed on a memorial slot, and the name of its fallen. */
export function planOn(week: Week, lessonId: number): { plan: MemorialPlan; fallen: string } | null {
  const plan = (week.memorialPlans ?? []).find((p) => p.lesson_id === lessonId);
  if (!plan) return null;
  return { plan, fallen: (week.fallen ?? []).find((f) => f.id === plan.fallen_id)?.name ?? "" };
}

/**
 * A memorial slot's materials: the files that came for the fallen of the plan placed on it (source_files.fallen_id),
 * wherever they were uploaded — a plan moved to another slot takes them along — upload order. No plan: none.
 */
export function memorialFiles(week: Week, lesson: Lesson): SourceFile[] {
  const on = planOn(week, lesson.id);
  if (!on) return [];
  return [...(week.sourceFiles ?? [])].filter((f) => !f.cover && f.fallen_id === on.plan.fallen_id).sort((a, b) => a.id - b.id);
}

/**
 * A memorial slot's own files that are no plan's in this edition any more — their fallen's plan was deleted — for
 * removal, never in the reader. A file whose fallen has a plan here is that plan's material wherever the plan is: on
 * another slot (memorialFiles) or in the tray (memorialWaiting) — never offered for removal as a leftover.
 */
export function memorialLeftovers(week: Week, lesson: Lesson): SourceFile[] {
  const planned = new Set((week.memorialPlans ?? []).map((p) => p.fallen_id));
  return [...(week.sourceFiles ?? [])].filter((f) => f.lesson_id === lesson.id && (f.fallen_id == null || !planned.has(f.fallen_id))).sort((a, b) => a.id - b.id);
}

/** A plan's materials while it waits in the tray (no memorial slot holds it): the files that came for its fallen, upload order. */
export function memorialWaiting(week: Week, plan: MemorialPlan): SourceFile[] {
  return [...(week.sourceFiles ?? [])].filter((f) => !f.cover && f.fallen_id === plan.fallen_id).sort((a, b) => a.id - b.id);
}

/** A memorial slot's verdict, in a lesson's order (statusOf): a readable file, else Word, else an unread one, else nothing yet. */
function memorialStatus(on: boolean, printable: SourceFile[], word: SourceFile[], unread: SourceFile[]): ManifestStatus {
  if (!on) return "memorial";
  if (printable.length > 0) return "memorial_received";
  return word.length > 0 ? "memorial_needs_pdf" : unread.length > 0 ? "memorial_unreadable" : "memorial_missing";
}

/**
 * A memorial slot's verdict in a sentence — the slot's panel says it after its badge (src/screens/memorial/SlotPanel.tsx),
 * in the words the manifest uses for a lesson in the same state.
 */
export const MEMORIAL_SAID: Record<"memorial" | "memorial_received" | "memorial_needs_pdf" | "memorial_unreadable" | "memorial_missing", string> = {
  memorial: "עוד לא שובץ/ה כאן חלל/ה: במקראה עמוד כותרת בלבד.",
  memorial_received: "החומרים בתוך המקראה, אחרי עמוד הכותרת.",
  memorial_needs_pdf: "מה שהועלה הוא Word, והוא לא נכנס למקראה שנבנית בדפדפן: צריך להעלות PDF. בינתיים במקראה עמוד כותרת בלבד.",
  memorial_unreadable: "הקבצים שהועלו לא נקראו (מוגנים בסיסמה, פגומים או בפורמט אחר): צריך להעלות קובץ אחר. בינתיים במקראה עמוד כותרת בלבד.",
  memorial_missing: "עוד לא הועלו חומרים: במקראה עמוד כותרת בלבד.",
};

/** In the order the lesson's «מקראה» stage says it (src/domain/stages.ts): a readable file, else Word, else an unread one. */
function statusOf(l: Lesson, printable: SourceFile[], word: SourceFile[], unread: SourceFile[]): ManifestStatus {
  if (l.sources_kind === "none") return "no_sources";
  if (l.sources_kind === "presentation") return "presentation_only";
  if (l.in_reader) {
    if (printable.length > 0) return "included";
    return word.length > 0 ? "needs_pdf" : unread.length > 0 ? "unreadable" : "missing";
  }
  if (l.sources_kind === "pending") return "pending";
  return printable.length > 0 || word.length > 0 || unread.length > 0 ? "not_marked" : "missing";
}

/** The manifest: every closed lesson and memorial slot, in schedule order, and what the reader has of it. */
export function readerManifest(week: Week): Manifest {
  const lessons = new Map(week.lessons.map((l) => [l.id, l]));
  const lead = new Map(week.lessonSpeakers.filter((x) => x.role === "lead").map((x) => [x.lesson_id, x.speaker_id]));
  const files = [...(week.sourceFiles ?? [])].sort((a, b) => a.id - b.id);
  const rows: ManifestRow[] = scheduleEntries(week).map((e) => {
    const l = lessons.get(e.lesson_id)!;
    // the time stays left to right inside a right-to-left line (a mark before it, as the files write it)
    const when = `${dayLabel(l.day, l.start_min)} ${LRM}${fmtRange(e.start_min, e.end_min)}`;
    if (e.kind === "memorial") {
      const on = planOn(week, l.id);
      const mine = memorialFiles(week, l);
      const printable = mine.filter(readableFile);
      const word = mine.filter((f) => !printableMime(f.mime));
      const unread = mine.filter((f) => printableMime(f.mime) && !readableFile(f));
      return {
        lesson: l, kind: "memorial", day: l.day, when, speaker: "", title: l.title, header: readerHeader("memorial", on?.fallen ?? "", l.title), sourcesKind: l.sources_kind,
        status: memorialStatus(!!on, printable, word, unread), files: mine, printable, word, unread,
        previous: memorialLeftovers(week, l), pages: printable.reduce((n, f) => n + (f.page_count ?? 1), 0), fallen: on?.fallen ?? null,
      };
    }
    const current = lead.get(l.id) ?? null;
    const own = files.filter((f) => f.lesson_id === l.id);
    const mine = own.filter((f) => f.speaker_id === current);
    const previous = own.filter((f) => f.speaker_id !== current);
    const printable = mine.filter(readableFile);
    const word = mine.filter((f) => !printableMime(f.mime));
    const unread = mine.filter((f) => printableMime(f.mime) && !readableFile(f));
    const status = statusOf(l, printable, word, unread);
    return {
      lesson: l, kind: "lesson", day: l.day, when, speaker: e.speaker, title: l.title, header: readerHeader("lesson", e.speaker, l.title), sourcesKind: l.sources_kind,
      status, files: mine, printable, word, unread, previous, pages: status === "included" ? printable.reduce((n, f) => n + (f.page_count ?? 1), 0) : 0,
    };
  });
  const shownLessons = new Set(rows.map((r) => r.lesson.id));
  // a memorial plan's file shows under the slot its plan is on now, whatever slot it came to (or none left); a plan in
  // the tray keeps its files, waiting — never a leftover, whatever became of the slot they came to
  const shownFiles = new Set(rows.flatMap((r) => (r.kind === "memorial" ? r.files : [])).map((f) => f.id));
  const planned = new Set((week.memorialPlans ?? []).map((p) => p.fallen_id));
  const waiting = files.filter((f) => !f.cover && !shownFiles.has(f.id) && f.fallen_id != null && planned.has(f.fallen_id));
  const waitingIds = new Set(waiting.map((f) => f.id));
  const leftovers = files.filter((f) => !f.cover && !shownFiles.has(f.id) && !waitingIds.has(f.id) && (f.lesson_id == null || !shownLessons.has(f.lesson_id)));
  const covers = files.filter((f) => f.cover);
  const marked = week.edition.settings?.reader_cover;
  const cover = covers.find((f) => f.id === marked && readableFile(f)) ?? null;
  return { rows, leftovers, waiting, covers, cover };
}

/** What the reader prints, in order: the rows whose status puts them in. */
export function readerRows(m: Manifest): ManifestRow[] {
  return m.rows.filter((r) => IN_READER[r.status]);
}

/**
 * The files a build names without trying them: the PDFs and pictures the browser could not read on upload, of every
 * lesson marked for the reader — one in it beside its other files, and one whose files were all unread («צריך קובץ
 * אחר»), not in it at all — in schedule order. Never a file the build fetches (those it read), so never named twice.
 */
export function unreadForReader(m: Manifest): SourceFile[] {
  return m.rows.filter((r) => r.kind === "memorial" || r.lesson.in_reader).flatMap((r) => r.unread);
}

export interface ManifestTotals {
  lessons: number;
  included: number;
  memorial: number;
  missing: number;
  needsPdf: number;
  unreadable: number;
  notMarked: number;
  pending: number;
  presentationOnly: number;
  noSources: number;
  files: number;
  /** Pages from the lessons' files in the reader. */
  filePages: number;
}

export function manifestTotals(m: Manifest): ManifestTotals {
  const count = (s: ManifestStatus) => m.rows.filter((r) => r.status === s).length;
  return {
    lessons: m.rows.filter((r) => r.kind === "lesson").length,
    included: count("included"),
    memorial: m.rows.filter((r) => r.kind === "memorial").length,
    missing: count("missing"),
    needsPdf: count("needs_pdf") + count("memorial_needs_pdf"),
    unreadable: count("unreadable") + count("memorial_unreadable"),
    notMarked: count("not_marked"),
    pending: count("pending"),
    presentationOnly: count("presentation_only"),
    noSources: count("no_sources"),
    files: m.rows.reduce((n, r) => n + r.files.length, 0),
    filePages: readerRows(m).reduce((n, r) => n + (r.kind === "lesson" ? r.pages : 0), 0),
  };
}

/**
 * The words for a lesson's files the reader leaves out, the same on the manifest and in the lesson panel: Word
 * («ועוד קובץ Word אחד שלא נכנס — צריך PDF», after the count of what went in) and files not read on upload
 * («קובץ אחד לא נקרא — צריך קובץ אחר»; `more`: after that count, «ועוד קובץ אחד שלא נקרא — …»).
 */
export function wordText(n: number): string {
  return n === 1 ? "ועוד קובץ Word אחד שלא נכנס — צריך PDF" : `ועוד ${n} קבצי Word שלא נכנסו — צריך PDF`;
}
export function unreadText(n: number, more: boolean): string {
  if (more) return n === 1 ? "ועוד קובץ אחד שלא נקרא — צריך קובץ אחר" : `ועוד ${n} קבצים שלא נקראו — צריך קובץ אחר`;
  return n === 1 ? "קובץ אחד לא נקרא — צריך קובץ אחר" : `${n} קבצים לא נקראו — צריך קובץ אחר`;
}

/**
 * The reader's pages as far as is known now — the screen's estimate: the plan the build makes (src/reader/layout.ts)
 * of what the manifest puts in, the cover the marked poster's pages or the schedule's (`schedule`:
 * scheduleLines(week), src/reader/build.ts).
 */
export function readerEstimate(m: Manifest, schedule: ScheduleLine[]): number {
  const entries = readerRows(m).map((r, i) => ({ ref: i, day: r.day, header: r.header, filePages: r.printable.map((f) => f.page_count ?? 1) }));
  return planReader(entries, m.cover ? (m.cover.page_count ?? 1) : scheduleCoverPages(schedule)).pages.length;
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
