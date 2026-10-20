// The sources' files and the reader's settings (milestone 5ב-1) — what the
// lesson panel's «מקורות» and the reader screen need beyond the Week (whose
// sourceFiles are the rows). Two implementations: SupabaseSources (Storage over
// HTTP, with the session's token, then the v10 functions) and DemoSources (an
// in-memory bucket on the engine, synthetic files made in the browser).
// Semantics: docs/CONTRACT.md «Sources and the reader».
import type { SourceFile } from "../domain/types";

export interface UploadOptions {
  /** A PDF's page count, as the browser counted it (src/reader/pages.ts); null when it could not be read. */
  pages: number | null;
  /** 0…1 while the bytes go up. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface SourcesPort {
  /**
   * Upload a picked file to Storage at <edition>/<lesson|cover>/<uuid>-<safe name>, then register it
   * (register_source_file). lessonId null: the edition's poster. A registration the database refuses removes
   * the stored object again, and the refusal is thrown.
   */
  upload(editionId: number, lessonId: number | null, file: File, opts: UploadOptions): Promise<SourceFile>;
  /** The stored object first (the Storage API, under the same rule), then the row (remove_source_file). */
  remove(editionId: number, file: Pick<SourceFile, "id" | "storage_path">): Promise<void>;
  /** Addresses that read the files for a few minutes: signed URLs (never public ones); the demo's object URLs. By storage path. */
  urls(editionId: number, paths: string[]): Promise<Map<string, string>>;
  /** settings.reader_headers — [left, right]; both empty removes them. */
  setHeaders(editionId: number, left: string | null, right: string | null): Promise<void>;
  /** settings.reader_cover — one of the edition's posters, or null (a schedule page instead). */
  setCover(editionId: number, fileId: number | null): Promise<void>;
}

/** How long a signed URL reads a file: long enough to fetch a reader's files, short enough not to linger. */
export const SIGNED_URL_SECONDS = 600;
