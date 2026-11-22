// Hands a file made in the browser to the person: a Blob and a link with
// `download` — nothing goes to a server. The link's address is revoked once the
// browser has taken the file.
export function download(name: string, bytes: Uint8Array | string | Blob, type: string): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.append(a);
  a.click();
  // the browser reads the link's name after this task: it stays a moment
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}

export const CSV_MIME = "text/csv;charset=utf-8";

/** The archive's personal-data file (src/exports/archive.ts) — here, so the settings panel names it without loading the zip writer. */
export const PERSONAL_FILE = "PERSONAL-DATA_contacts_and_transport.json";
export const ZIP_MIME = "application/zip";

/**
 * A file's name as a zip entry may carry it: no folder separators or characters a file system refuses, no control or
 * format character (C0/C1, DEL, LRM/RLM, the bidi embeddings, overrides and isolates — an RLO would show «…rcs.pdf» for
 * «…fdp.scr»); at most 80 characters, the end kept.
 */
export function safeEntryName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]/gu, "_").replace(/^[._\s]+|[.\s]+$/g, "").trim();
  return [...(clean || "file")].slice(-80).join("");
}

/**
 * An uploaded file's name for the person's computer (a zip entry, a download): the display name's stem, made safe, and
 * the extension of the STORED file — its path's (`ext`, which app.source_mime_ok ties to the declared type) — never the
 * one the display name gives itself: «x.pdf.exe» stored as a PDF lands as «x.pdf.pdf», a name with no extension gains
 * its type's, a PowerPoint registered as «deck.pdf» lands as «deck.pptx». No `ext` (a path the rule does not read):
 * the safe name as it is.
 */
export function storedFileName(display: string, ext: string | null | undefined): string {
  if (!ext) return safeEntryName(display);
  const stem = safeEntryName(display.replace(/\.[A-Za-z0-9]{1,5}$/, ""));
  return [...stem].slice(-(79 - ext.length)).join("") + "." + ext.toLowerCase();
}

/** «2026-11-10» in Israel — for a file's name. */
export function israelDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * A downloaded file's name — ASCII only: some systems drop a name with Hebrew letters and save «download»
 * (headless Chromium does). The edition's label when it is ASCII, else its number:
 * «volozhin-tracking-edition-7-2026-11-10.csv».
 */
export function fileName(what: string, edition: { id: number; label: string }, day: string, ext: string): string {
  const ed = /^[A-Za-z0-9._-]+$/.test(edition.label) ? edition.label : `edition-${edition.id}`;
  return `volozhin-${what}-${ed}-${day}.${ext}`;
}
