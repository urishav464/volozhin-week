// The sources' files in the demo: the bucket is the engine's (shared.objects —
// the same predicates as the policies on storage.objects), the bytes stay in
// this tab (a Blob per path; the seeded ones are made when first read), and
// register/remove are the engine's twins of the SQL functions. Nothing leaves
// the browser. A short pause stands in for the upload's progress.
import type { SourceFile } from "../domain/types";
import { CommandError } from "./commands";
import { makeSample, type Sample } from "./demoFiles";
import type { Engine } from "./engine";
import { checkPicked, displayNameOf, sourcePath } from "./sourceRules";
import type { SourcesPort, UploadOptions } from "./sources";

export interface DemoSourceStore {
  engine(editionId: number): Engine;
  notify(): void;
  /** The uploaded files' bytes, by storage path. */
  readonly blobs: Map<string, Blob>;
  /** The seeded files, made on first read. */
  readonly samples: Map<string, Sample>;
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

export class DemoSources implements SourcesPort {
  private readonly objectUrls = new Map<string, string>();
  constructor(private readonly s: DemoSourceStore) {}

  async upload(editionId: number, lessonId: number | null, file: File, opts: UploadOptions): Promise<SourceFile> {
    const mime = checkPicked(file, lessonId == null);
    const e = this.s.engine(editionId);
    const path = sourcePath(editionId, lessonId, crypto.randomUUID(), file.name, mime);
    for (const f of [0.25, 0.6, 1]) {
      await pause(60, opts.signal);
      opts.onProgress?.(f);
    }
    e.storeObject(path, mime, file.size);
    this.s.blobs.set(path, file);
    try {
      const row = e.registerSourceFile(lessonId, path, displayNameOf(file.name), opts.pages);
      this.s.notify();
      return row;
    } catch (err) {
      if (e.deleteObject(path)) this.s.blobs.delete(path);
      throw err;
    }
  }

  async remove(editionId: number, file: Pick<SourceFile, "id" | "storage_path">): Promise<void> {
    const e = this.s.engine(editionId);
    if (e.deleteObject(file.storage_path)) {
      this.s.blobs.delete(file.storage_path);
      const url = this.objectUrls.get(file.storage_path);
      if (url) URL.revokeObjectURL(url);
      this.objectUrls.delete(file.storage_path);
    }
    e.removeSourceFile(file.id);
    this.s.notify();
  }

  async urls(editionId: number, paths: string[]): Promise<Map<string, string>> {
    const e = this.s.engine(editionId);
    const out = new Map<string, string>();
    for (const path of paths) {
      if (!e.maySeeSource(path)) continue;
      let url = this.objectUrls.get(path);
      if (!url) {
        let blob = this.s.blobs.get(path);
        const sample = this.s.samples.get(path);
        if (!blob && sample) {
          blob = await makeSample(sample);
          this.s.blobs.set(path, blob);
        }
        if (!blob) continue;
        url = URL.createObjectURL(blob);
        this.objectUrls.set(path, url);
      }
      out.set(path, url);
    }
    if (paths.length > 0 && out.size === 0) throw new CommandError("read_failed");
    return out;
  }

  async setHeaders(editionId: number, left: string | null, right: string | null): Promise<void> {
    this.s.engine(editionId).setReaderHeaders(left, right);
    this.s.notify();
  }

  async setCover(editionId: number, fileId: number | null): Promise<void> {
    this.s.engine(editionId).setReaderCover(fileId);
    this.s.notify();
  }
}
