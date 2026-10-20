// The files as they come, without a browser: a PNG cut short (named, never a
// build that hangs), a PDF page's annotations and filled fields painted into
// the reader, and the one check the upload and the build share
// (src/reader/readable.ts) — the same answer, file by file, on good and bad
// files alike. Every file is synthetic, built here.
import { zlibSync } from "fflate";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream, StandardFonts, decodePDFRawStream, degrees, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { appearanceMatrix } from "./annotations";
import { assembleReader, type JobFile, type ReaderJob } from "./assemble";
import { A4 } from "./layout";
import { looksPng, pngInflates } from "./png";
import { readableSource, type ReaderMime } from "./readable";
import type { Png, TextRenderer } from "./render";

// A 1×1 PNG: what the stub text drawer hands back for every line of Hebrew.
const PIXEL = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"));
const stub: TextRenderer = {
  runningHeader: async (_t, w) => ({ bytes: PIXEL, widthPt: w, heightPt: 14 }) as Png,
  entryStrip: async (_h, _w, width, height) => ({ bytes: PIXEL, widthPt: width, heightPt: height }),
  tocPage: async () => ({ bytes: PIXEL, widthPt: A4.width, heightPt: A4.height }),
  schedulePage: async () => ({ bytes: PIXEL, widthPt: A4.width, heightPt: A4.height }),
  summaryTitle: async (_t, w) => ({ bytes: PIXEL, widthPt: w, heightPt: 30 }),
};
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
/** The pages every reader has besides its files: the schedule cover, the contents, five «סיכום יום». */
const FIXED_PAGES = 1 + 1 + 5;

/** One entry of these files, in this order. */
function jobOf(files: { name: string; mime: ReaderMime; bytes: Uint8Array }[]): ReaderJob {
  return {
    editionLabel: "בדיקה", cover: null, schedule: [], scheduleTitle: "",
    entries: [{ ref: 0, day: 0, header: "א – ב", when: "", files: files.map((f, i): JobFile => ({ id: i + 1, name: f.name, mime: f.mime, bytes: ab(f.bytes) })) }],
  };
}

async function pdfBytes(build: (d: PDFDocument) => void | Promise<void>): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  await build(d);
  return d.save();
}
const good = () => pdfBytes((d) => void d.addPage([300, 400]).drawRectangle({ x: 10, y: 10, width: 20, height: 20 }));
/** An A4 page whose media box names its corners top-left first — valid, and upright in every viewer. */
const inverted = () =>
  pdfBytes((d) => {
    const p = d.addPage([595, 842]);
    p.drawRectangle({ x: 20, y: 20, width: 100, height: 50 });
    p.node.set(PDFName.of("MediaBox"), d.context.obj([0, 842, 595, 0]));
  });

// ---------------------------------------------------------------- PNG
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array | number[]): Uint8Array {
  const d = Uint8Array.from(data);
  const out = new Uint8Array(12 + d.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, d.length);
  out.set(Buffer.from(type, "latin1"), 4);
  out.set(d, 8);
  v.setUint32(8 + d.length, crc32(out.subarray(4, 8 + d.length)));
  return out;
}
const concat = (parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts));
const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

interface PngSpec {
  width: number;
  height: number;
  colour: 0 | 2 | 3 | 4 | 6;
  depth: number;
  adam7?: boolean;
  /** Split the image data into IDAT chunks of this size, as libpng does (8192); one chunk when not given. */
  idatSize?: number;
  /** Chunks after the image data, before IEND. */
  after?: Uint8Array[];
  /** A photo's grain over the gradient: less compressible (still Huffman-coded), so its data spans many chunks. */
  grain?: boolean;
}

/**
 * A synthetic PNG like a screenshot: a gradient with text-like stripes — compressible, so its data is Huffman-coded
 * (a picture of random pixels is stored, and pdf-lib's decoder throws on it cut short instead of hanging).
 */
function makePng(s: PngSpec): { bytes: Uint8Array; idat: Uint8Array[]; dataAt: number } {
  const bits = s.depth * CHANNELS[s.colour];
  const rows: Uint8Array[] = [];
  let seed = 1;
  const grain = () => (s.grain ? (seed = (seed * 1103515245 + 12345) >>> 0) >>> 28 : 0);
  const image = (w: number, h: number) => {
    const rowBytes = Math.ceil((w * bits) / 8);
    for (let y = 0; y < h; y++) {
      const row = new Uint8Array(1 + rowBytes);
      row[0] = y % 5; // the five filter types
      for (let x = 0; x < rowBytes; x++) row[1 + x] = (((x >> 3) + (y >> 2)) % 7 === 0 ? 20 : ((x * 255) / rowBytes) | 0) + grain();
      rows.push(row);
    }
  };
  if (s.adam7) {
    for (const [x0, y0, dx, dy] of ADAM7) {
      const w = Math.ceil((s.width - x0) / dx);
      const h = Math.ceil((s.height - y0) / dy);
      if (w > 0 && h > 0) image(w, h);
    }
  } else image(s.width, s.height);
  const z = zlibSync(concat(rows), { level: 6 });
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, s.width);
  new DataView(ihdr.buffer).setUint32(4, s.height);
  ihdr.set([s.depth, s.colour, 0, 0, s.adam7 ? 1 : 0], 8);
  const size = s.idatSize ?? z.length;
  const idat: Uint8Array[] = [];
  for (let i = 0; i < z.length; i += size) idat.push(chunk("IDAT", z.subarray(i, i + size)));
  const palette = s.colour === 3 ? [chunk("PLTE", Array.from({ length: 3 * (1 << Math.min(s.depth, 8)) }, (_, i) => (i * 37) & 255))] : [];
  const head = [SIGNATURE, chunk("IHDR", ihdr), ...palette];
  const bytes = concat([...head, ...idat, ...(s.after ?? []), chunk("IEND", [])]);
  return { bytes, idat, dataAt: concat(head).length + 8 };
}

const SCREENSHOT: PngSpec = { width: 160, height: 100, colour: 2, depth: 8 };
const LIBPNG: PngSpec = { width: 320, height: 200, colour: 2, depth: 8, idatSize: 8192, grain: true };
const text = (keyword: string, value: string) => chunk("tEXt", [...Buffer.from(keyword, "latin1"), 0, ...Buffer.from(value, "latin1")]);

/** The damaged PNGs: each one hangs pdf-lib's decoder (UPNG) for ever when it reaches it. */
function brokenPngs(): Record<string, Uint8Array> {
  const one = makePng(SCREENSHOT);
  const z = one.idat[0].subarray(8, -4);
  expect((z[2] >> 1) & 3, "Huffman-coded, not stored").not.toBe(0);
  const multi = makePng(LIBPNG);
  expect(multi.idat.length).toBeGreaterThan(5);
  expect((multi.idat[0][8 + 2] >> 1) & 3, "Huffman-coded, not stored").not.toBe(0);
  const zeroTail = multi.bytes.slice();
  zeroTail.fill(0, Math.floor(zeroTail.length * 0.6));
  const dated = makePng({ ...SCREENSHOT, after: [text("date:create", "2026-01-01")] });
  const textAt = dated.dataAt - 8 + dated.idat[0].length; // where the tEXt chunk starts
  const frame = (seq: number) => {
    const b = new Uint8Array(26);
    new DataView(b.buffer).setUint32(0, seq);
    new DataView(b.buffer).setUint32(4, SCREENSHOT.width);
    new DataView(b.buffer).setUint32(8, SCREENSHOT.height);
    return chunk("fcTL", b);
  };
  const animated = concat([
    SIGNATURE, makePng(SCREENSHOT).bytes.subarray(8, 33), chunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]), frame(0), one.idat[0], frame(1),
    chunk("fdAT", [0, 0, 0, 2, ...z]),
  ]);
  return {
    "cut-mid-idat.png": one.bytes.slice(0, one.dataAt + Math.floor(z.length / 2)),
    "cut-at-a-chunk-boundary.png": concat([multi.bytes.subarray(0, 33), ...multi.idat.slice(0, 5)]),
    "zeroed-tail.png": zeroTail,
    "cut-after-the-zlib-header.png": one.bytes.slice(0, one.dataAt + 2),
    "cut-four-bytes-in.png": one.bytes.slice(0, one.dataAt + 4),
    "cut-in-a-text-keyword.png": dated.bytes.slice(0, textAt + 8 + 4), // «date» of «date:create»
    "animation-cut-short.png": animated.slice(0, animated.length - Math.floor(z.length / 2)),
  };
}

describe("a PNG cut short", () => {
  it("is refused before pdf-lib's decoder sees it: data cut mid-stream, at a chunk boundary, a zeroed tail, a cut text chunk, an animation", () => {
    for (const [name, bytes] of Object.entries(brokenPngs())) {
      expect(looksPng(bytes), name).toBe(true);
      expect(pngInflates(bytes), name).toBe(false);
    }
  });

  it("is named, and the rest of the reader builds", { timeout: 20_000 }, async () => {
    const broken = brokenPngs();
    const files = [
      { name: "good.pdf", mime: "application/pdf" as const, bytes: await good() },
      ...Object.entries(broken).map(([name, bytes]) => ({ name, mime: "image/png" as const, bytes })),
      { name: "whole.png", mime: "image/png" as const, bytes: makePng(SCREENSHOT).bytes },
    ];
    const r = await assembleReader(jobOf(files), stub);
    expect(r.skipped).toEqual(Object.keys(broken).map((name) => ({ name, reason: "unreadable" })));
    expect(r.pages).toBe(FIXED_PAGES + 2);
  });

  it("still lets every whole PNG in: each colour type and bit depth, interlaced or not, in many chunks, with text, without IEND", async () => {
    const specs: PngSpec[] = [];
    for (const [colour, depths] of [[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]] as const) {
      for (const depth of depths) for (const adam7 of [false, true]) specs.push({ width: 37, height: 23, colour, depth, adam7 });
    }
    const files: { name: string; mime: ReaderMime; bytes: Uint8Array }[] = specs.map((s) => ({ name: `c${s.colour}-d${s.depth}${s.adam7 ? "-adam7" : ""}.png`, mime: "image/png", bytes: makePng(s).bytes }));
    const multi = makePng(LIBPNG);
    const dated = makePng({ ...SCREENSHOT, after: [text("date:create", "2026-01-01"), chunk("iTXt", [...Buffer.from("k"), 0, 0, 0, ...Buffer.from("he"), 0, 0, ...Buffer.from("x")])] });
    files.push(
      { name: "libpng.png", mime: "image/png", bytes: multi.bytes },
      { name: "with-text.png", mime: "image/png", bytes: dated.bytes },
      { name: "no-iend.png", mime: "image/png", bytes: multi.bytes.slice(0, -12) }, // as pdf-lib draws it today
      { name: "checksum-cut.png", mime: "image/png", bytes: multi.bytes.slice(0, -12 - 4 - 2) }, // its data whole, the zlib checksum cut
      { name: "a-png-named.jpg", mime: "image/jpeg", bytes: makePng(SCREENSHOT).bytes },
    );
    for (const f of files) expect(pngInflates(f.bytes), f.name).toBe(true);
    const r = await assembleReader(jobOf(files), stub);
    expect(r.skipped).toEqual([]);
    expect(r.pages).toBe(FIXED_PAGES + files.length);
  });

  it("refuses what is not a PNG at all, or says it is one and is not", () => {
    expect(pngInflates(new TextEncoder().encode("not a png"))).toBe(false);
    const whole = makePng(SCREENSHOT).bytes;
    const noIhdr = concat([SIGNATURE, ...makePng(SCREENSHOT).idat, chunk("IEND", [])]);
    expect(pngInflates(noIhdr)).toBe(false);
    const badDepth = whole.slice();
    badDepth[24] = 4; // a truecolour picture of 4 bits: no such PNG
    expect(pngInflates(badDepth)).toBe(false);
    const noData = concat([whole.subarray(0, 33), chunk("IEND", [])]);
    expect(pngInflates(noData)).toBe(false);
  });
});

// ---------------------------------------------------------------- annotations
/** An annotation on `page`: its dictionary, with an appearance stream (or `ap` as given) when `draw` is set. */
function annotate(d: PDFDocument, page: ReturnType<PDFDocument["addPage"]>, dict: Record<string, unknown>, draw?: { ops: string; bbox: number[]; matrix?: number[] }) {
  const ctx = d.context;
  const entries: Record<string, unknown> = { Type: "Annot", ...dict };
  if (draw) {
    const ap = ctx.stream(draw.ops, { Type: "XObject", Subtype: "Form", BBox: draw.bbox, ...(draw.matrix ? { Matrix: draw.matrix } : {}) });
    entries.AP = { N: ctx.register(ap) };
  }
  const ref = ctx.register(ctx.obj(entries as never));
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray) ?? ctx.obj([]);
  annots.push(ref);
  page.node.set(PDFName.of("Annots"), annots);
}

const decoded = (s: PDFStream) => Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : new Uint8Array()).toString("latin1");

/** A reader page's embedded source page: its content, and what each name it draws (`/Name Do`) paints, decoded. */
function embedded(doc: PDFDocument, n: number): { content: string; draws: string[] } {
  const xo = doc.getPage(n).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
  for (const [, ref] of xo.entries()) {
    const s = doc.context.lookup(ref);
    if (!(s instanceof PDFRawStream) || s.dict.get(PDFName.of("Subtype"))?.toString() !== "/Form") continue;
    const content = decoded(s);
    const own = s.dict.lookupMaybe(PDFName.of("Resources"), PDFDict)?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const draws = [...content.matchAll(/\/(\S+) Do/g)].map((m) => {
      const x = own?.lookupMaybe(PDFName.of(m[1]), PDFStream);
      return x ? decoded(x) : "";
    });
    return { content, draws };
  }
  throw new Error(`reader page ${n + 1} has no source page`);
}

describe("a PDF's annotations and filled fields", () => {
  it("maps an appearance's box, through its own matrix, onto the annotation's rectangle — the matrix applied once", () => {
    expect(appearanceMatrix([0, 0, 200, 80], [1, 0, 0, 1, 0, 0], [100, 200, 300, 280])).toEqual([1, 0, 0, 1, 100, 200]);
    expect(appearanceMatrix([0, 0, 100, 50], [1, 0, 0, 1, 0, 0], [10, 20, 210, 120])).toEqual([2, 0, 0, 2, 10, 20]);
    // turned a quarter by its /Matrix: the box becomes [-50 0 0 100] — moved onto the rectangle, not turned again
    expect(appearanceMatrix([0, 0, 100, 50], [0, 1, -1, 0, 0, 0], [100, 100, 150, 200])).toEqual([1, 0, 0, 1, 150, 100]);
    expect(appearanceMatrix([0, 0, 100, 50], [1, 0, 0, 1, 0, 0], [150, 200, 100, 100])).toEqual([0.5, 0, 0, 2, 100, 100]); // corners in any order
    expect(appearanceMatrix([0, 0, 0, 50], [1, 0, 0, 1, 0, 0], [0, 0, 10, 10])).toBeNull();
  });

  it("paints what prints into the reader — a text box, a filled field, a ticked check box, a highlight — and nothing that does not", async () => {
    const bytes = await pdfBytes(async (d) => {
      const font = await d.embedFont(StandardFonts.Helvetica);
      // 1: a FreeText box, and next to it what must stay out: hidden, not for print, a pop-up, two malformed ones
      const p1 = d.addPage([400, 400]);
      p1.drawRectangle({ x: 10, y: 10, width: 30, height: 30, color: rgb(0, 0, 0) });
      annotate(d, p1, { Subtype: "FreeText", F: 4, Rect: [100, 200, 300, 280], Contents: "SYNTHETIC NOTE" }, { ops: "1 0 0 rg 0 0 200 80 re f", bbox: [0, 0, 200, 80] });
      annotate(d, p1, { Subtype: "Square", F: 4 | 2, Rect: [0, 0, 50, 50] }, { ops: "1 0 1 rg HIDDEN", bbox: [0, 0, 50, 50] });
      annotate(d, p1, { Subtype: "Square", F: 0, Rect: [0, 0, 50, 50] }, { ops: "0.3 g SCREEN-ONLY", bbox: [0, 0, 50, 50] });
      annotate(d, p1, { Subtype: "Popup", F: 4, Rect: [0, 0, 50, 50] }, { ops: "0 1 1 rg POPUP", bbox: [0, 0, 50, 50] });
      annotate(d, p1, { Subtype: "Square", F: 4 }, { ops: "0 0 0 rg NO-RECT", bbox: [0, 0, 50, 50] });
      annotate(d, p1, { Subtype: "Square", F: 4, Rect: ["a", 0, 50, 50] }, { ops: "0 0 0 rg BAD-RECT", bbox: [0, 0, 50, 50] });
      annotate(d, p1, { Subtype: "Stamp", F: 4, Rect: [0, 0, 50, 50], AP: { N: 7 } });
      // 2: a text field filled in (pdf-lib writes its appearance, a stream with no states)
      const p2 = d.addPage([400, 400]);
      p2.drawRectangle({ x: 10, y: 10, width: 30, height: 30, color: rgb(0, 0, 0) });
      const field = d.getForm().createTextField("answer");
      field.setText("FILLED FIELD VALUE");
      field.addToPage(p2, { x: 50, y: 200, width: 300, height: 60, borderWidth: 0, backgroundColor: rgb(0, 0, 1), font });
      // 3: a check box, ticked: its appearance by /AS, of two states
      const p3 = d.addPage([400, 400]);
      p3.drawRectangle({ x: 10, y: 10, width: 30, height: 30, color: rgb(0, 0, 0) });
      const on = d.context.register(d.context.stream("0 0.5 0 rg 0 0 20 20 re f TICKED", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 20, 20] }));
      const off = d.context.register(d.context.stream("0.5 g 0 0 20 20 re f UNTICKED", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 20, 20] }));
      annotate(d, p3, { Subtype: "Widget", FT: "Btn", F: 4, Rect: [60, 60, 80, 80], AS: "On", V: "On", AP: { N: { On: on, Off: off } } });
      // 4: a highlight, on a page with nothing else on it (no content at all)
      const p4 = d.addPage([400, 400]);
      annotate(d, p4, { Subtype: "Highlight", F: 4, Rect: [50, 100, 300, 140], QuadPoints: [50, 140, 300, 140, 50, 100, 300, 100] }, { ops: "0 1 0 rg 0 0 250 40 re f", bbox: [0, 0, 250, 40] });
    });
    const r = await assembleReader(jobOf([{ name: "marked.pdf", mime: "application/pdf", bytes }]), stub);
    expect(r.skipped).toEqual([]); // the malformed ones are skipped alone
    expect(r.pages).toBe(FIXED_PAGES + 4);
    const out = await PDFDocument.load(r.bytes);

    const freeText = embedded(out, 2);
    expect(freeText.content).toMatch(/0 0 m\s+0 30 l\s+30 30 l\s+30 0 l/); // the page's own square first
    expect(freeText.content).toMatch(/1 0 0 1 100 200 cm\s*\/\S+ Do/);
    expect(freeText.draws).toEqual(["1 0 0 rg 0 0 200 80 re f"]);

    const filled = embedded(out, 3);
    expect(filled.draws).toHaveLength(1);
    expect(filled.draws[0]).toContain("0 0 1 rg"); // its blue background
    expect(filled.draws[0]).toContain(Buffer.from("FILLED FIELD VALUE", "latin1").toString("hex").toUpperCase()); // and its value

    const ticked = embedded(out, 4);
    expect(ticked.draws).toEqual(["0 0.5 0 rg 0 0 20 20 re f TICKED"]);
    expect(ticked.content).toMatch(/1 0 0 1 60 60 cm/);

    const highlight = embedded(out, 5); // drawn now: its page used to be a blank one
    expect(highlight.draws).toEqual(["0 1 0 rg 0 0 250 40 re f"]);
    expect(highlight.content).toMatch(/1 0 0 1 50 100 cm/);

    const everything = [freeText, filled, ticked, highlight].flatMap((e) => [e.content, ...e.draws]).join("\n");
    for (const kept of ["HIDDEN", "SCREEN-ONLY", "POPUP", "NO-RECT", "BAD-RECT", "UNTICKED"]) expect(everything, kept).not.toContain(kept);
  });

  it("adds an appearance to its own page's resources, not to those it shares with the next page", async () => {
    const bytes = await pdfBytes((d) => {
      const shared = d.context.register(d.context.obj({ XObject: {} }));
      for (const marked of [true, false]) {
        const p = d.addPage([300, 400]);
        p.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
        p.node.set(PDFName.of("Resources"), shared);
        if (marked) annotate(d, p, { Subtype: "Square", F: 4, Rect: [50, 50, 100, 100] }, { ops: "1 0 0 rg 0 0 50 50 re f", bbox: [0, 0, 50, 50] });
      }
    });
    const out = await PDFDocument.load((await assembleReader(jobOf([{ name: "shared.pdf", mime: "application/pdf", bytes }]), stub)).bytes);
    expect(embedded(out, 2).draws).toEqual(["1 0 0 rg 0 0 50 50 re f"]);
    const names = (n: number) => {
      const xo = out.getPage(n).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
      const form = [...xo.values()].map((r) => out.context.lookup(r)).find((x): x is PDFRawStream => x instanceof PDFRawStream && x.dict.get(PDFName.of("Subtype"))?.toString() === "/Form")!;
      return form.dict.lookupMaybe(PDFName.of("Resources"), PDFDict)?.lookupMaybe(PDFName.of("XObject"), PDFDict)?.keys().map(String) ?? [];
    };
    expect(names(2)).toHaveLength(1);
    expect(names(3)).toEqual([]);
  });

  it("never lets a malformed /Annots make the file unreadable", async () => {
    const bytes = await pdfBytes((d) => {
      const p = d.addPage([300, 400]);
      p.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
      p.node.set(PDFName.of("Annots"), d.context.obj({ Not: "an array" }));
      const q = d.addPage([300, 400]);
      q.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
      q.node.set(PDFName.of("Annots"), d.context.obj([PDFNumber.of(3), d.context.obj({ Subtype: "Text", F: 4, Rect: [0, 0, 10, 10], AP: { N: {} } })]));
    });
    const r = await assembleReader(jobOf([{ name: "odd-annots.pdf", mime: "application/pdf", bytes }]), stub);
    expect(r.skipped).toEqual([]);
    expect(r.pages).toBe(FIXED_PAGES + 2);
  });
});

// ---------------------------------------------------------------- one check for the upload and the build
/** A small JPEG: the tables, a 16×8 frame and a scan (pdf-lib reads only the frame, so the scan need not decode). */
function jpeg(scan: number[] = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]): Uint8Array {
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xdb, [0, ...Array(64).fill(1)]),
    ...seg(0xc0, [8, 0, 8, 0, 16, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    ...seg(0xc4, [0, ...Array(16).fill(0)]),
    ...seg(0xda, [3, 1, 0, 2, 0, 3, 0, 0, 63, 0]),
    ...scan,
    0xff, 0xd9,
  ]);
}

/** Good files and bad, of every kind the reader takes: what the upload is asked about, and what the build meets. */
async function corpus(): Promise<{ name: string; mime: ReaderMime; bytes: Uint8Array }[]> {
  const pdf = "application/pdf" as const;
  const odd = await pdfBytes((d) => {
    d.addPage([300, 300]).node.set(PDFName.of("Contents"), d.context.register(d.context.stream("x", { Filter: "JBIG2Decode" })));
    d.addPage([300, 300]).drawRectangle({ x: 1, y: 1, width: 5, height: 5 });
  });
  const locked = await pdfBytes((d) => {
    d.addPage([300, 300]).drawRectangle({ x: 1, y: 1, width: 5, height: 5 });
    d.context.trailerInfo.Encrypt = d.context.obj({ Filter: "Standard", V: 1, R: 2 });
  });
  const marked = await pdfBytes((d) => {
    const p = d.addPage([400, 400]);
    annotate(d, p, { Subtype: "FreeText", F: 4, Rect: [100, 200, 300, 280] }, { ops: "1 0 0 rg 0 0 200 80 re f", bbox: [0, 0, 200, 80] });
  });
  const broken = brokenPngs();
  const cutPhoto = jpeg();
  return [
    { name: "good.pdf", mime: pdf, bytes: await good() },
    { name: "three-pages.pdf", mime: pdf, bytes: await pdfBytes((d) => [0, 1, 2].forEach(() => d.addPage([500, 250]).setRotation(degrees(90)))) },
    { name: "blank.pdf", mime: pdf, bytes: await pdfBytes((d) => void d.addPage([400, 400])) },
    { name: "annotation-only.pdf", mime: pdf, bytes: marked },
    { name: "inverted-box.pdf", mime: pdf, bytes: await inverted() },
    { name: "no-pages.pdf", mime: pdf, bytes: await pdfBytes(() => {}) },
    { name: "no-media-box.pdf", mime: pdf, bytes: await pdfBytes((d) => void d.addPage([300, 300]).node.delete(PDFName.of("MediaBox"))) },
    { name: "not-really.pdf", mime: pdf, bytes: new TextEncoder().encode("%PDF-1.4 not really") },
    { name: "undecodable-page.pdf", mime: pdf, bytes: odd },
    { name: "locked.pdf", mime: pdf, bytes: locked },
    { name: "a-png-named.pdf", mime: pdf, bytes: makePng(SCREENSHOT).bytes },
    { name: "whole.png", mime: "image/png", bytes: makePng(SCREENSHOT).bytes },
    { name: "adam7.png", mime: "image/png", bytes: makePng({ ...SCREENSHOT, adam7: true }).bytes },
    { name: "a-png-named.jpg", mime: "image/jpeg", bytes: makePng(SCREENSHOT).bytes },
    { name: "stub.png", mime: "image/png", bytes: Uint8Array.from([...SIGNATURE, 1, 2, 3, 4, 5, 6, 7, 8]) },
    ...Object.entries(broken).map(([name, bytes]) => ({ name, mime: "image/png" as const, bytes })),
    { name: "photo.jpg", mime: "image/jpeg", bytes: jpeg() },
    { name: "photo-cut-in-its-scan.jpg", mime: "image/jpeg", bytes: cutPhoto.slice(0, cutPhoto.length - 4) },
    { name: "fill-before-a-restart.jpg", mime: "image/jpeg", bytes: jpeg([0x12, 0x34, 0xff, 0xff, 0xd0, 0x78]) },
    { name: "a-jpeg-named.png", mime: "image/png", bytes: jpeg() },
    { name: "heic-named.jpg", mime: "image/jpeg", bytes: Uint8Array.from([0, 0, 0, 0x18, ...Buffer.from("ftypheic"), ...Array(32).fill(0)]) },
    { name: "not-a-jpeg.jpg", mime: "image/jpeg", bytes: new TextEncoder().encode("not a jpeg at all") },
    { name: "no-frame.jpg", mime: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 1, 2]) },
  ];
}

describe("one check for the upload and the build", () => {
  it("answers the upload exactly as the build does — in or left out, why, and with how many pages — file by file", { timeout: 30_000 }, async () => {
    const seen = new Set<string>();
    for (const f of await corpus()) {
      const check = await readableSource(f.bytes, f.mime);
      const r = await assembleReader(jobOf([f]), stub);
      if (check.ok) {
        seen.add("ok");
        expect(r.skipped, f.name).toEqual([]);
        expect(r.pages - FIXED_PAGES, f.name).toBe(check.pages);
      } else {
        seen.add(check.reason);
        expect(r.skipped, f.name).toEqual([{ name: f.name, reason: check.reason }]);
      }
    }
    expect([...seen].sort()).toEqual(["ok", "protected", "unreadable"]);
  });

  it("says what the build does of a few by name", async () => {
    const all = Object.fromEntries((await corpus()).map((f) => [f.name, f]));
    const ask = (n: string) => readableSource(all[n].bytes, all[n].mime);
    expect(await ask("three-pages.pdf")).toEqual({ ok: true, pages: 3 });
    expect(await ask("blank.pdf")).toEqual({ ok: true, pages: 1 });
    expect(await ask("locked.pdf")).toEqual({ ok: false, reason: "protected" });
    expect(await ask("undecodable-page.pdf")).toEqual({ ok: false, reason: "unreadable" });
    expect(await ask("cut-mid-idat.png")).toEqual({ ok: false, reason: "unreadable" });
    expect(await ask("heic-named.jpg")).toEqual({ ok: false, reason: "unreadable" });
    expect(await ask("a-png-named.jpg")).toEqual({ ok: true, pages: 1 });
    expect(await ask("fill-before-a-restart.jpg")).toEqual({ ok: true, pages: 1 });
  });
});
