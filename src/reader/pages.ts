// What a picked file is registered with (register_source_file's page count):
// the reader's own check on its bytes, in the browser, before they go up —
// src/reader/readable.ts, the steps the build opens every file with, so a file
// the manifest counts as received is a file the build puts in. A PDF: its
// pages; a picture: 1; null — the reader cannot print it (protected by a
// password, damaged, not the type its name says): it is uploaded all the same,
// for the team to see and replace, and shown «לא נקרא» everywhere. Word: null,
// never read (its own «צריך PDF»). pdf-lib is in the check: loaded on demand.
import type { SourceMime } from "../domain/types";
import { DOCX } from "../data/sourceRules";
import type { ReaderMime } from "./readable";

export async function readerPages(file: Blob, mime: SourceMime): Promise<number | null> {
  if (mime === DOCX) return null;
  const { readableSource } = await import("./readable");
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const r = await readableSource(bytes, mime as ReaderMime);
    return r.ok ? r.pages : null;
  } catch {
    return null;
  }
}
