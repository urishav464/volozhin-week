// The day's zip on a stub port and a stub fetch: the entries under their names, the text files first and knowing what
// failed, the files stored as they are (no compression), addresses twenty at a time and one fetch after another, a file
// that cannot be read named, a cancel that stops, and the size cap.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { demoWeek, seedDemoPresentations, seedDemoSources } from "../data/demoWeek";
import { dayZipPlan, ORDER_FILE, PRESENTATION_ZIP_MAX, type ZipEntry } from "../domain/presentations";
import type { SourceFile } from "../domain/types";
import { presentationsZip, URL_BATCH } from "./presentationsZip";

const bytesOf = (path: string) => new TextEncoder().encode(`bytes of ${path}`);

function stub(opts: { missing?: string[]; status?: Record<string, number>; urlsFail?: boolean } = {}) {
  const calls: string[][] = [];
  const fetched: string[] = [];
  let open = 0;
  let most = 0;
  const sources = {
    async urls(_edition: number, paths: string[]) {
      calls.push(paths);
      if (opts.urlsFail) throw new Error("offline");
      return new Map(paths.filter((p) => !opts.missing?.includes(p)).map((p) => [p, `https://storage.example/${p}`]));
    },
  };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    open++;
    most = Math.max(most, open);
    try {
      await Promise.resolve();
      if (init?.signal?.aborted) throw new DOMException("cancelled", "AbortError");
      const path = String(input).replace("https://storage.example/", "");
      fetched.push(path);
      const status = opts.status?.[path] ?? 200;
      return new Response(status === 200 ? bytesOf(path) : null, { status });
    } finally {
      open--;
    }
  }) as typeof fetch;
  return { sources, fetcher, calls, fetched, most: () => most };
}

function plan() {
  const w = demoWeek();
  seedDemoSources(w);
  seedDemoPresentations(w);
  return { w, plan: dayZipPlan(w, 0, null) };
}

const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe("the day's zip", () => {
  it("holds the text files and every entry under its Hebrew name, the bytes as they came", async () => {
    const { w, plan: p } = plan();
    const s = stub();
    const progress: string[] = [];
    const r = await presentationsZip(s.sources, w.edition.id, p.entries, {
      signal: new AbortController().signal,
      fetcher: s.fetcher,
      onProgress: ({ done, total }) => progress.push(`${done}/${total}`),
      texts: (failed) => dayZipPlan(w, 0, null, failed).texts,
    });
    expect([r.got, r.failed, r.blob.type]).toEqual([2, [], "application/zip"]);
    const files = await unzip(r.blob);
    expect(Object.keys(files)).toEqual([ORDER_FILE, "links.txt", ...p.entries.map((e) => e.name)]);
    for (const e of p.entries) expect(strFromU8(files[e.name])).toBe(`bytes of ${e.file.storage_path}`);
    expect([...files[ORDER_FILE].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8, its BOM kept (a decoder drops it)
    expect(strFromU8(files[ORDER_FILE])).toBe(p.texts[0].text.slice(1));
    expect(progress).toEqual(["0/2", "1/2", "2/2"]);
    expect(s.most()).toBe(1); // one fetch at a time
  });

  it("stores the files (no compression) and marks the names as UTF-8", async () => {
    const { w, plan: p } = plan();
    const s = stub();
    const r = await presentationsZip(s.sources, w.edition.id, p.entries, { signal: new AbortController().signal, fetcher: s.fetcher, texts: () => [] });
    const raw = new Uint8Array(await r.blob.arrayBuffer());
    // the first local header: method 0 (stored), general-purpose flag bit 11 (UTF-8 names)
    const view = new DataView(raw.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint16(6, true) & 0x800).toBe(0x800);
  });

  it("asks for addresses twenty at a time, and names what it could not fetch — a missing address, an error, a batch with no addresses", async () => {
    const { w } = plan();
    const files: SourceFile[] = Array.from({ length: 45 }, (_, i) => ({
      id: 100 + i, lesson_id: null, cover: false, kind: "presentation", speaker_id: null, fallen_id: null, storage_path: `1/cover/deck-${i}.pdf`, display_name: `מצגת ${i}.pdf`,
      mime: "application/pdf", size_bytes: 10, page_count: null, uploaded_by: 1, uploaded_at: "2026-11-20T10:00:00Z",
    }));
    const entries: ZipEntry[] = files.map((file) => ({ name: `0000_השבוע_${file.display_name}`, file }));
    const s = stub({ missing: ["1/cover/deck-3.pdf"], status: { "1/cover/deck-7.pdf": 404 } });
    let failedSeen: number[] = [];
    const r = await presentationsZip(s.sources, w.edition.id, entries, {
      signal: new AbortController().signal,
      fetcher: s.fetcher,
      texts: (failed) => {
        failedSeen = [...failed];
        return [];
      },
    });
    expect(s.calls.map((c) => c.length)).toEqual([URL_BATCH, URL_BATCH, 5]);
    expect(r.failed).toEqual([
      { id: 103, name: "מצגת 3.pdf" },
      { id: 107, name: "מצגת 7.pdf" },
    ]);
    expect(failedSeen).toEqual([103, 107]);
    expect(r.got).toBe(43);
    expect(Object.keys(await unzip(r.blob))).toHaveLength(43);
    const none = stub({ urlsFail: true });
    const all = await presentationsZip(none.sources, w.edition.id, entries.slice(0, 3), { signal: new AbortController().signal, fetcher: none.fetcher, texts: () => [] });
    expect([all.got, all.failed.length, none.fetched]).toEqual([0, 3, []]);
  });

  it("a cancel stops between files with an AbortError, and nothing more is fetched", async () => {
    const { w, plan: p } = plan();
    const s = stub();
    const ctrl = new AbortController();
    const run = presentationsZip(s.sources, w.edition.id, p.entries, {
      signal: ctrl.signal,
      fetcher: s.fetcher,
      onProgress: ({ done }) => done === 1 && ctrl.abort(),
      texts: () => [],
    });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(s.fetched).toHaveLength(1);
    const before = new AbortController();
    before.abort();
    await expect(presentationsZip(s.sources, w.edition.id, p.entries, { signal: before.signal, fetcher: s.fetcher, texts: () => [] })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuses more than the cap before it fetches anything", async () => {
    const { w, plan: p } = plan();
    const s = stub();
    const big = p.entries.map((e, i) => ({ ...e, file: { ...e.file, size_bytes: i === 0 ? PRESENTATION_ZIP_MAX : 1 } }));
    await expect(presentationsZip(s.sources, w.edition.id, big, { signal: new AbortController().signal, fetcher: s.fetcher, texts: () => [] })).rejects.toBeInstanceOf(RangeError);
    expect(s.calls).toEqual([]);
  });
});
