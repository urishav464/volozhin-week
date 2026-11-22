// «הורדת כל המצגות של היום» (the reset, phase 5): the day's presentations in one zip for the hall's computer, which is
// not signed in — downloaded in the morning and copied over on a USB stick. The plan (names, order, the two text files)
// is src/domain/presentations.ts `dayZipPlan`; this fetches the files through signed URLs, twenty addresses at a time
// (the archive's `fetchSources`), one file after another, and writes each straight into a streaming zip with no
// compression (fflate `Zip` + `ZipPassThrough`: decks are already compressed, and the chunks go to the Blob as they are —
// about the files' own size in memory, not the archive's three times). A file that cannot be fetched is named, never
// silently left out — the order says so beside its name. A cancel stops between files (and inside a fetch). Nothing is
// uploaded and nothing is kept in the browser: the Blob is handed to the person and dropped.
import { strToU8, Zip, ZipPassThrough } from "fflate";
import type { SourcesPort } from "../data/sources";
import { PRESENTATION_ZIP_MAX, type ZipEntry, type ZipText } from "../domain/presentations";
import { ZIP_MIME } from "./download";

export interface ZipProgress {
  done: number;
  total: number;
}

export interface DayZipResult {
  blob: Blob;
  /** How many of the entries are in it. */
  got: number;
  /** The entries that could not be fetched, by file id and display name. */
  failed: { id: number; name: string }[];
}

export interface DayZipOptions {
  signal: AbortSignal;
  onProgress?: (p: ZipProgress) => void;
  /** The text files, given which files could not be fetched (dayZipPlan(…, failed).texts). */
  texts: (failed: ReadonlySet<number>) => ZipText[];
  /** The fetch to use (a test's); the browser's by default. */
  fetcher?: typeof fetch;
}

/** An addresses batch: the archive's size. */
export const URL_BATCH = 20;

const aborted = () => new DOMException("cancelled", "AbortError");

/**
 * The zip of the entries, the text files first. Throws an AbortError when cancelled, and a RangeError when the entries
 * are more than PRESENTATION_ZIP_MAX together (the page says so before it offers the button).
 */
export async function presentationsZip(sources: Pick<SourcesPort, "urls">, editionId: number, entries: readonly ZipEntry[], opts: DayZipOptions): Promise<DayZipResult> {
  const { signal, onProgress } = opts;
  const get = opts.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  if (entries.reduce((n, e) => n + e.file.size_bytes, 0) > PRESENTATION_ZIP_MAX) throw new RangeError("zip_too_big");
  const stop = () => {
    if (signal.aborted) throw aborted();
  };
  stop();

  const chunks: Uint8Array[] = [];
  let broken: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) broken = err;
    else if (chunk.length > 0) chunks.push(chunk);
  });
  const put = (name: string, bytes: Uint8Array) => {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(bytes, true);
  };

  const bytes = new Map<number, Uint8Array>();
  const failed: DayZipResult["failed"] = [];
  let done = 0;
  onProgress?.({ done, total: entries.length });
  for (let i = 0; i < entries.length; i += URL_BATCH) {
    stop();
    const batch = entries.slice(i, i + URL_BATCH);
    let urls = new Map<string, string>();
    try {
      urls = await sources.urls(editionId, batch.map((e) => e.file.storage_path));
    } catch {
      // no addresses for this batch: each of its files is named as not fetched
    }
    for (const e of batch) {
      stop();
      const url = urls.get(e.file.storage_path);
      try {
        if (!url) throw new Error("no url");
        const res = await get(url, { signal });
        if (!res.ok) throw new Error(String(res.status));
        bytes.set(e.file.id, new Uint8Array(await res.arrayBuffer()));
      } catch {
        stop(); // a fetch cut by the cancel is the cancel, not a failure
        failed.push({ id: e.file.id, name: e.file.display_name });
      }
      onProgress?.({ done: ++done, total: entries.length });
    }
  }
  stop();

  // the texts know which files did not come: written first, then each file as it is, then the directory
  for (const t of opts.texts(new Set(failed.map((f) => f.id)))) put(t.name, strToU8(t.text));
  for (const e of entries) {
    const b = bytes.get(e.file.id);
    if (!b) continue;
    put(e.name, b);
    bytes.delete(e.file.id);
  }
  zip.end();
  if (broken) throw broken;
  return { blob: new Blob(chunks as BlobPart[], { type: ZIP_MIME }), got: entries.length - failed.length, failed };
}
