// Hands a file made in the browser to the person: a Blob and a link with
// `download` — nothing goes to a server. The link's address is revoked once the
// browser has taken the file.
export function download(name: string, bytes: Uint8Array | string, type: string): void {
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
