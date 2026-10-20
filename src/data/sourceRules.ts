// The sources' files, in the browser (milestone 5ב-1): the path convention, the
// four accepted types and the size, the stored name, the display name, and the
// rule that puts a lesson in the reader when its first file arrives — the same
// as app.source_path_re, app.source_mime_ok, app.source_refusal and
// public.register_source_file in supabase/schema.sql «Milestone 5ב-1», so the
// demo (src/data/engine.ts) refuses exactly what production refuses
// (tests/parity runs the same uploads through both).
import type { Lesson, SourceFile, SourceMime } from "../domain/types";
import { CommandError } from "./commands";
import { cleanLine } from "./speakerRules";
import { readerKind } from "./stageRules";

export const SOURCES_BUCKET = "sources";
/** The bucket's file_size_limit: 25 MB. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const DISPLAY_NAME_MAX = 200;
export const MAX_PAGES = 5000;

export const PDF: SourceMime = "application/pdf";
export const DOCX: SourceMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const SOURCE_MIMES: readonly SourceMime[] = [PDF, "image/png", "image/jpeg", DOCX];

/** What the file picker offers (accept=…). */
export const SOURCE_ACCEPT = ".pdf,.docx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg," + DOCX;
export const COVER_ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

const EXT: Record<SourceMime, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", [DOCX]: "docx" };

/** app.source_path_re: <edition>/<lesson|cover>/<uuid>-<safe name>.<pdf|png|jpg|jpeg|docx>. */
export const SOURCE_PATH_RE =
  /^([1-9][0-9]{0,17})\/([1-9][0-9]{0,17}|cover)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9][A-Za-z0-9_-]{0,59}\.(pdf|png|jpg|jpeg|docx)$/;

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** The path's edition, lesson (null: the poster) and extension — or null when it is not the convention. */
export function parseSourcePath(path: string): { edition: number; lesson: number | null; ext: string } | null {
  const m = SOURCE_PATH_RE.exec(path);
  if (!m) return null;
  return { edition: Number(m[1]), lesson: m[2] === "cover" ? null : Number(m[2]), ext: m[3] };
}

/** app.source_mime_ok: the type is one we take, and the extension is its own. */
export function mimeMatches(mime: string, ext: string): boolean {
  switch (mime) {
    case "application/pdf":
      return ext === "pdf";
    case "image/png":
      return ext === "png";
    case "image/jpeg":
      return ext === "jpg" || ext === "jpeg";
    case DOCX:
      return ext === "docx";
    default:
      return false;
  }
}

/** A PDF or an image goes into the merged reader; a Word file cannot be merged in the browser («צריך PDF»). */
export function printableMime(mime: SourceMime): boolean {
  return mime !== DOCX;
}

/**
 * The type of a picked file: the browser's word when it is one we take, else by the name's extension
 * (some systems give a .docx no type at all). null: not a type we take.
 */
export function mimeOfFile(f: { name: string; type: string }): SourceMime | null {
  if ((SOURCE_MIMES as readonly string[]).includes(f.type)) return f.type as SourceMime;
  const ext = /\.([A-Za-z0-9]+)$/.exec(f.name)?.[1]?.toLowerCase();
  if (f.type && f.type !== "application/octet-stream") return null;
  return ext === "pdf" ? PDF : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "docx" ? DOCX : null;
}

/**
 * The stored name's tail: the original name's ASCII letters, digits, «_» and «-» only (everything else — a
 * Hebrew name, spaces, dots — becomes «-», runs collapse), at most 60 characters, «file» when nothing is
 * left; and the extension of its type. Never the original name: that stays in display_name.
 */
export function safeName(original: string, mime: SourceMime): string {
  const base = original.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  let s = base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  s = s.slice(0, 60).replace(/[-_]+$/, "");
  if (!/^[A-Za-z0-9]/.test(s)) s = "file";
  return `${s}.${EXT[mime]}`;
}

/** Where an upload goes: <edition>/<lesson|cover>/<uuid>-<safe name>. */
export function sourcePath(edition: number, lesson: number | null, uuid: string, original: string, mime: SourceMime): string {
  return `${edition}/${lesson ?? "cover"}/${uuid.toLowerCase()}-${safeName(original, mime)}`;
}

/** What a picked file must be before it is sent: a type we take (bad_file), at most 25 MB (bad_file); the poster never a Word file. */
export function checkPicked(f: { name: string; type: string; size: number }, cover: boolean): SourceMime {
  const mime = mimeOfFile(f) ?? fail("bad_file");
  if (f.size > MAX_SOURCE_BYTES || (cover && mime === DOCX)) fail("bad_file");
  return mime;
}

/** register_source_file's display name: one line, ≤ 200, required (bad_value). */
export function cleanDisplayName(v: string | null | undefined): string {
  return cleanLine(v, DISPLAY_NAME_MAX) ?? fail("bad_value");
}

/** register_source_file's page count: a PDF's as the browser counted it (1–5000, else bad_value); an image 1; Word null. */
export function pagesFor(mime: SourceMime, pages: number | null | undefined): number | null {
  if (pages != null && (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES)) fail("bad_value");
  if (mime === PDF) return pages ?? null;
  return mime === DOCX ? null : 1;
}

/**
 * What a lesson's sources become when a file arrives (register_source_file): «טרם התקבלו» → a sheet (a file
 * came), and the current speaker's first file puts the lesson in the reader — when its kind has something to
 * print (in_reader's own rule: never a presentation alone). A later file leaves in_reader as it is (an
 * instructor who took the lesson out of the reader meant it).
 */
export function arrived(l: Pick<Lesson, "sources_kind" | "in_reader">, first: boolean): Pick<Lesson, "sources_kind" | "in_reader"> {
  const kind = l.sources_kind === "pending" ? "sheet" : l.sources_kind;
  return { sources_kind: kind, in_reader: l.in_reader || (first && readerKind(kind)) };
}

/** A lesson's files, the poster's (null) or a lesson's, and whether each is the current lead speaker's. */
export function filesOf(files: SourceFile[], lessonId: number): SourceFile[] {
  return files.filter((f) => f.lesson_id === lessonId);
}

/** «מהמרצה הקודם»: a file that arrived for a speaker who is not the lesson's lead now (or the lesson is no longer closed). */
export function fromPreviousSpeaker(f: Pick<SourceFile, "speaker_id">, lead: number | null): boolean {
  return lead == null || f.speaker_id !== lead;
}

/** «1.2MB», «340KB». */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
