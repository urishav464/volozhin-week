// «בנה מקראה» from the page: the files' bytes are fetched here (short-lived
// signed URLs — the demo's object URLs), handed to the reader's worker
// (src/reader/worker.ts) that assembles the PDF, and the result comes back to
// be downloaded. Never uploaded. «ביטול» aborts the fetches and ends the worker.
import type { DataPort } from "../data/port";
import { printableMime } from "../data/sourceRules";
import type { SourceFile, Week } from "../domain/types";
import { DAY_NAMES, type Day } from "../domain/time";
import { designerRows, scheduleEntries } from "../exports/designer";
import type { JobEntry, JobFile, ReaderJob, ReaderMime, Skipped } from "./assemble";
import { readerRows, type Manifest } from "./model";
import type { ScheduleLine } from "./render";
import type { FromWorker, ToWorker } from "./worker";

export interface BuildProgress {
  /** fetch: the files come down; read / draw / save: the worker. */
  step: "fetch" | "read" | "draw" | "save";
  done: number;
  total: number;
}

export interface BuildResult {
  bytes: Uint8Array;
  pages: number;
  /** Files left out: not fetched, or not readable as a PDF. */
  skipped: (Skipped | { name: string; reason: "missing" })[];
}

/** The schedule cover's lines, from the public schedule (src/exports/designer.ts): each day's heading, then its rows. */
export function scheduleLines(week: Week): ScheduleLine[] {
  const rows = designerRows(week);
  const entries = scheduleEntries(week);
  const out: ScheduleLine[] = [];
  let day: Day | null = null;
  entries.forEach((e, i) => {
    const r = rows[i];
    if (e.day !== day) {
      day = e.day;
      out.push({ kind: "day", text: `יום ${DAY_NAMES[e.day]}${r.date !== "TBD" ? ` · ${r.date}` : ""}` });
    }
    out.push({ kind: "row", text: r.time, speaker: e.kind === "memorial" ? "" : r.speaker, title: r.title, memorial: e.kind === "memorial" });
  });
  return out;
}

export interface ReaderBuild {
  promise: Promise<BuildResult>;
  cancel(): void;
}

/** Start building: what the manifest puts in the reader, in its order, with the edition's headers and cover. */
export function buildReader(port: DataPort, week: Week, manifest: Manifest, onProgress: (p: BuildProgress) => void): ReaderBuild {
  const abort = new AbortController();
  let worker: Worker | null = null;
  let rejectNow: ((e: unknown) => void) | null = null;
  const cancel = () => {
    abort.abort();
    worker?.terminate();
    rejectNow?.(new DOMException("cancelled", "AbortError"));
  };

  const promise = (async (): Promise<BuildResult> => {
    const rows = readerRows(manifest);
    const wanted: SourceFile[] = [...rows.flatMap((r) => r.printable), ...(manifest.cover ? [manifest.cover] : [])];
    const skipped: BuildResult["skipped"] = [];
    // the bytes: signed URLs a batch at a time (each lives a few minutes), fetched one by one
    const bytes = new Map<number, ArrayBuffer>();
    let done = 0;
    onProgress({ step: "fetch", done, total: wanted.length });
    for (let i = 0; i < wanted.length; i += 20) {
      const batch = wanted.slice(i, i + 20);
      const urls = await port.sources.urls(week.edition.id, batch.map((f) => f.storage_path));
      for (const f of batch) {
        if (abort.signal.aborted) throw new DOMException("cancelled", "AbortError");
        const url = urls.get(f.storage_path);
        try {
          if (!url) throw new Error("no url");
          const res = await fetch(url, { signal: abort.signal });
          if (!res.ok) throw new Error(String(res.status));
          bytes.set(f.id, await res.arrayBuffer());
        } catch (e) {
          if (abort.signal.aborted) throw new DOMException("cancelled", "AbortError");
          skipped.push({ name: f.display_name, reason: "missing" });
        }
        onProgress({ step: "fetch", done: ++done, total: wanted.length });
      }
    }
    const asFile = (f: SourceFile): JobFile | null => {
      const b = bytes.get(f.id);
      return b && printableMime(f.mime) ? { id: f.id, name: f.display_name, mime: f.mime as ReaderMime, bytes: b } : null;
    };
    const entries: JobEntry[] = rows.map((r) => ({
      ref: manifest.rows.indexOf(r),
      day: r.day,
      header: r.header,
      when: r.when,
      files: r.printable.map(asFile).filter((x): x is JobFile => x != null),
    }));
    const job: ReaderJob = {
      editionLabel: week.edition.label,
      headers: week.edition.settings.reader_headers,
      cover: manifest.cover ? asFile(manifest.cover) : null,
      schedule: scheduleLines(week),
      scheduleTitle: `לו"ז שבוע וולוז'ין ${week.edition.label}`,
      entries,
    };
    const transfer = [...new Set([...entries.flatMap((e) => e.files.map((f) => f.bytes)), ...(job.cover ? [job.cover.bytes] : [])])];

    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    return await new Promise<BuildResult>((resolve, reject) => {
      rejectNow = reject;
      worker!.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === "progress") onProgress({ step: m.step, done: m.done, total: m.total });
        else if (m.type === "done") {
          worker!.terminate();
          resolve({ bytes: new Uint8Array(m.bytes), pages: m.pages, skipped: [...skipped, ...m.skipped] });
        } else {
          worker!.terminate();
          reject(new Error(m.code));
        }
      };
      worker!.onerror = (e) => {
        worker!.terminate();
        reject(new Error(e.message || "failed"));
      };
      worker!.postMessage({ type: "build", job } satisfies ToWorker, transfer);
    });
  })();
  return { promise, cancel };
}

export const PDF_MIME = "application/pdf";
