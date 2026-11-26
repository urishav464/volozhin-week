// The week's zip (v20) on a stub port and a stub fetch: the entries under their paths — a folder per day, the week's decks
// once in «0-השבוע» —, the text files first and knowing what failed, every file fetched and written once, the files stored
// as they are (no compression), addresses twenty at a time and one fetch after another, a file that cannot be read
// named, a cancel that stops, and the size cap.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { demoWeek, seedDemoPresentations, seedDemoSources } from "../data/demoWeek";
import { dayZipPlan, ORDER_FILE, PRESENTATION_ZIP_MAX, WEEK_FOLDER, weekZipPlan, type ZipEntry } from "../domain/presentations";
import type { SourceFile } from "../domain/types";
import { presentationsZip, RESIGN_AFTER_MS, URL_BATCH } from "./presentationsZip";

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
  return { w, plan: weekZipPlan(w) };
}

const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe("the week's zip", () => {
  it("holds the text files and every entry under its Hebrew path, in its day's folder, the bytes as they came", async () => {
    const { w, plan: p } = plan();
    const s = stub();
    const progress: string[] = [];
    const r = await presentationsZip(s.sources, w.edition.id, p.entries, {
      signal: new AbortController().signal,
      fetcher: s.fetcher,
      onProgress: ({ done, total }) => progress.push(`${done}/${total}`),
      texts: (failed) => weekZipPlan(w, failed).texts,
    });
    expect([r.came, r.failed, r.blob.type]).toEqual([p.entries, [], "application/zip"]);
    const files = await unzip(r.blob);
    expect(Object.keys(files)).toEqual([...p.texts.map((t) => t.name), ...p.entries.map((e) => e.name)]);
    expect(Object.keys(files).filter((n) => n.startsWith(`${WEEK_FOLDER}/`))).toEqual([`${WEEK_FOLDER}/המצגת המלווה לשבוע (לדוגמה).pdf`]);
    expect(Object.keys(files).filter((n) => n.startsWith("1-ראשון/"))).toEqual([`1-ראשון/${ORDER_FILE}`, "1-ראשון/links.txt", "1-ראשון/0830_בית מדרש_מצגת לדוגמה.pdf"]);
    for (const e of p.entries) expect(strFromU8(files[e.name])).toBe(`bytes of ${e.file.storage_path}`);
    const order = files[`1-ראשון/${ORDER_FILE}`];
    expect([...order.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8, its BOM kept (a decoder drops it)
    expect(strFromU8(order)).toBe(p.texts[0].text.slice(1));
    expect(progress).toEqual(["0/3", "1/3", "2/3", "3/3"]);
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
      { id: 103, name: "מצגת 3.pdf", path: "0000_השבוע_מצגת 3.pdf" },
      { id: 107, name: "מצגת 7.pdf", path: "0000_השבוע_מצגת 7.pdf" },
    ]);
    expect(failedSeen).toEqual([103, 107]);
    expect(r.came).toHaveLength(43);
    expect(Object.keys(await unzip(r.blob))).toHaveLength(43);
    const none = stub({ urlsFail: true });
    const all = await presentationsZip(none.sources, w.edition.id, entries.slice(0, 3), { signal: new AbortController().signal, fetcher: none.fetcher, texts: () => [] });
    expect([all.came.length, all.failed.length, none.fetched]).toEqual([0, 3, []]);
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

  it("a slow link: the batch is signed again before its ten-minute addresses expire, so a big day's later files still come", async () => {
    // fifteen decks of 15 MB at 2 Mbit/s: a minute each — Storage refuses an address used more than 600 s after it was signed
    const { w } = plan();
    const files: SourceFile[] = Array.from({ length: 15 }, (_, i) => ({
      id: 200 + i, lesson_id: null, cover: false, kind: "presentation", speaker_id: null, fallen_id: null, storage_path: `1/cover/slow-${i}.pdf`, display_name: `מצגת ${i}.pdf`,
      mime: "application/pdf", size_bytes: 15 * 1024 * 1024, page_count: null, uploaded_by: 1, uploaded_at: "2026-11-20T10:00:00Z",
    }));
    const entries: ZipEntry[] = files.map((file) => ({ name: `0000_השבוע_${file.display_name}`, file }));
    let clock = 0;
    const signs: number[] = [];
    const sources = {
      async urls(_edition: number, paths: string[]) {
        signs.push(paths.length);
        return new Map(paths.map((p) => [p, `https://storage.example/${p}?signed=${clock}`]));
      },
    };
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const expired = clock - Number(url.searchParams.get("signed")) > 600_000;
      clock += 60_000; // the file takes a minute to come
      return new Response(expired ? null : bytesOf(url.pathname), { status: expired ? 400 : 200 });
    }) as typeof fetch;
    const r = await presentationsZip(sources, w.edition.id, entries, { signal: new AbortController().signal, fetcher, now: () => clock, texts: () => [] });
    expect(r.failed).toEqual([]);
    expect(r.came).toHaveLength(15);
    // the batch once, then its rest again after eight minutes (and once more after sixteen)
    expect(signs).toEqual([15, 6]); // the tenth file starts at 9 minutes: the six left are signed again
    expect(RESIGN_AFTER_MS).toBe(8 * 60_000);
  });

  it("an address refused as expired (400, 401, 403) is asked for once more; a missing file (404) is not", async () => {
    const { w, plan: p } = plan();
    const first = p.entries[0].file.storage_path;
    const s = stub();
    let refusals = 1;
    const once = (async (input: RequestInfo | URL, init?: RequestInit) => {
      // the first answer for the first file is «expired»; its fresh address works
      if (String(input).endsWith(first) && refusals-- > 0) return new Response(null, { status: 403 });
      return s.fetcher(input, init);
    }) as typeof fetch;
    const r = await presentationsZip(s.sources, w.edition.id, p.entries, { signal: new AbortController().signal, fetcher: once, texts: () => [] });
    expect(r.failed).toEqual([]);
    expect(strFromU8((await unzip(r.blob))[p.entries[0].name])).toBe(`bytes of ${first}`);
    expect(s.calls.map((c) => c.length)).toEqual([p.entries.length, 1]); // the batch, then that one path again
    const gone = stub({ status: { [p.entries[0].file.storage_path]: 404 } });
    const r404 = await presentationsZip(gone.sources, w.edition.id, p.entries, { signal: new AbortController().signal, fetcher: gone.fetcher, texts: () => [] });
    expect(r404.failed.map((f) => f.id)).toEqual([p.entries[0].file.id]);
    expect(gone.calls.map((c) => c.length)).toEqual([p.entries.length]);
  });

  it("a file twice in the entries (two folders, or a plan gone wrong) is fetched once, written once, counted once — under its first path", async () => {
    const { w, plan: p } = plan();
    const deck = p.entries.find((e) => e.file.lesson_id == null)!;
    const twice: ZipEntry[] = [...p.entries, ...[0, 1, 2, 3, 4].map((d) => ({ name: `${d + 1}-x/${deck.name}`, file: deck.file }))];
    const s = stub();
    const progress: string[] = [];
    const r = await presentationsZip(s.sources, w.edition.id, twice, { signal: new AbortController().signal, fetcher: s.fetcher, onProgress: ({ done, total }) => progress.push(`${done}/${total}`), texts: () => [] });
    expect(s.fetched.filter((x) => x === deck.file.storage_path)).toHaveLength(1);
    expect(s.calls.flat().filter((x) => x === deck.file.storage_path)).toHaveLength(1);
    expect(r.came).toEqual(p.entries);
    expect(Object.keys(await unzip(r.blob))).toEqual(p.entries.map((e) => e.name));
    expect(progress.at(-1)).toBe(`${p.entries.length}/${p.entries.length}`);
    // and its size counts once against the cap
    const big = twice.map((e) => (e.file.id === deck.file.id ? { ...e, file: { ...e.file, size_bytes: PRESENTATION_ZIP_MAX / 2 } } : e));
    await expect(presentationsZip(s.sources, w.edition.id, big, { signal: new AbortController().signal, fetcher: s.fetcher, texts: () => [] })).resolves.toBeTruthy();
  });

  it("a day's part: that day's folder alone, under the week's own paths", async () => {
    const { w } = plan();
    const tuesday = dayZipPlan(w, 2);
    const s = stub();
    const r = await presentationsZip(s.sources, w.edition.id, tuesday.entries, { signal: new AbortController().signal, fetcher: s.fetcher, texts: (bad) => dayZipPlan(w, 2, bad).texts });
    expect(Object.keys(await unzip(r.blob))).toEqual([`3-שלישי/${ORDER_FILE}`, "3-שלישי/1600_כיתת בית מדרש_שקפים לדוגמה.pdf"]);
  });
});
