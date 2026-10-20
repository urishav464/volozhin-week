// The reader's PDF, from the files' bytes (pdf-lib 1.17.1). Runs in the
// reader's worker (src/reader/worker.ts) — and in a unit test with a stub text
// drawer. The order and page numbers are src/reader/layout.ts's plan; every
// source page is re-framed to A4 (scaled to fit, aspect kept, its /Rotate
// honoured); the running headers alternate, the page numbers count from the
// cover. A file that cannot be read (protected, damaged, no PDF or picture at all)
// is left out and named in the result — never a silent gap, never a failed
// build: every file is embedded as it is read, before the pages are planned.
// A photo goes in without its metadata (src/reader/jpeg.ts).
import {
  PDFContentStream, PDFDocument, type PDFEmbeddedPage, type PDFFont, type PDFImage, type PDFPage, PDFRawStream, PDFStream, StandardFonts, decodePDFRawStream, degrees, rgb,
} from "pdf-lib";
import type { Day } from "../domain/time";
import { A4, contentBox, dayTitle, frame, MARGIN, NUMBER_BAND, numbered, planReader, type PlanEntry, RUNNING_BAND, runningHeader, STRIP_HEIGHT } from "./layout";
import { jpegOrientation, looksJpeg, looksPng, orientationTurn, stripJpegMetadata } from "./jpeg";
import type { Png, ScheduleLine, TextRenderer } from "./render";

export type ReaderMime = "application/pdf" | "image/png" | "image/jpeg";

export interface JobFile {
  id: number;
  name: string;
  mime: ReaderMime;
  bytes: ArrayBuffer;
}

export interface JobEntry {
  /** The manifest row's index — what the table of contents points at. */
  ref: number;
  day: Day;
  header: string;
  when: string;
  files: JobFile[];
}

export interface ReaderJob {
  editionLabel: string;
  headers?: readonly [string, string];
  /** The marked poster; null — the schedule made from the week (`schedule`) is the cover. */
  cover: JobFile | null;
  schedule: ScheduleLine[];
  scheduleTitle: string;
  /** Schedule order. */
  entries: JobEntry[];
}

export interface Skipped {
  name: string;
  reason: "unreadable" | "protected";
}

export interface Progress {
  done: number;
  total: number;
  /** What is being done: «קורא קבצים», «מצייר עמודים», «שומר». */
  step: "read" | "draw" | "save";
}

export interface ReaderResult {
  bytes: Uint8Array;
  pages: number;
  skipped: Skipped[];
}

/** One page of a source, embedded in the reader: a PDF's page (null — a page with nothing on it, kept blank) or the image. */
type SourcePage =
  | { kind: "pdf"; page: PDFEmbeddedPage | null; width: number; height: number; rotation: number }
  | { kind: "image"; img: PDFImage; turn: number };
type Loaded = { pages: SourcePage[] };

export { jpegOrientation, orientationTurn } from "./jpeg";

/**
 * Read a file and embed it in the reader `out` — here, while the page plan can still change, so a file that cannot
 * be read is left out and named instead of failing the build half way. The type is checked from the bytes, not
 * the label: a PNG saved as .jpg is drawn as the PNG it is; bytes that are neither are «unreadable». A photo goes
 * in without its metadata (src/reader/jpeg.ts). A PDF's pages are embedded together, all or none.
 */
async function load(out: PDFDocument, f: JobFile): Promise<Loaded | Skipped> {
  const bytes = new Uint8Array(f.bytes);
  if (f.mime !== "application/pdf") {
    try {
      if (looksPng(bytes)) return { pages: [{ kind: "image", img: await out.embedPng(bytes), turn: 0 }] };
      const clean = looksJpeg(bytes) ? stripJpegMetadata(bytes) : null;
      if (!clean) return { name: f.name, reason: "unreadable" };
      return { pages: [{ kind: "image", img: await out.embedJpg(clean), turn: orientationTurn(jpegOrientation(bytes)) }] };
    } catch {
      return { name: f.name, reason: "unreadable" };
    }
  }
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
  } catch (e) {
    return { name: f.name, reason: e instanceof Error && /encrypt/i.test(e.name + e.message) ? "protected" : "unreadable" };
  }
  try {
    const src = doc.getPages();
    if (src.length === 0) return { name: f.name, reason: "unreadable" };
    // a page with nothing on it (no Contents — pdf-lib cannot embed it) stays a blank page, kept as one
    const drawn = src.filter((p) => p.node.Contents());
    // pdf-lib decodes an embedded page's content only when the reader is saved — a page it cannot decode would
    // fail the whole book there; so every page is decoded once here, and such a file is left out and named
    if (!drawn.every(decodes)) return { name: f.name, reason: "unreadable" };
    const embedded = await out.embedPages(
      drawn,
      drawn.map((p) => {
        const c = p.getCropBox();
        return { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height };
      }),
    );
    const of = new Map(drawn.map((p, i) => [p, embedded[i]]));
    return {
      pages: src.map((p) => {
        const c = p.getCropBox();
        return { kind: "pdf" as const, page: of.get(p) ?? null, width: c.width, height: c.height, rotation: p.getRotation().angle };
      }),
    };
  } catch {
    return { name: f.name, reason: "unreadable" };
  }
}

/** Can pdf-lib decode this page's content (what embedding it does when the document is saved)? */
function decodes(p: PDFPage): boolean {
  try {
    const { Contents } = p.node.normalizedEntries();
    if (!Contents) return false;
    for (let i = 0; i < Contents.size(); i++) {
      const s = Contents.lookup(i, PDFStream);
      if (s instanceof PDFRawStream) decodePDFRawStream(s).decode();
      else if (!(s instanceof PDFContentStream)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const isSkipped = (x: Loaded | Skipped): x is Skipped => "reason" in x;

export async function assembleReader(
  job: ReaderJob,
  text: TextRenderer,
  onProgress: (p: Progress) => void = () => {},
  cancelled: () => boolean = () => false,
): Promise<ReaderResult> {
  const check = () => {
    if (cancelled()) throw new DOMException("cancelled", "AbortError");
  };
  const skipped: Skipped[] = [];
  // the reader itself first: every file is embedded in it as it is read (load)
  const out = await PDFDocument.create();
  out.setTitle(`מקראה ${job.editionLabel}`);
  out.setCreator("volozhin-week");
  out.setProducer("pdf-lib");
  const readTotal = job.entries.reduce((n, e) => n + e.files.length, 0) + (job.cover ? 1 : 0);
  let readDone = 0;
  const step = async (f: JobFile): Promise<Loaded | null> => {
    check();
    const r = await load(out, f);
    onProgress({ done: ++readDone, total: readTotal, step: "read" });
    if (isSkipped(r)) {
      skipped.push(r);
      return null;
    }
    return r;
  };

  // 1. read every file: its page count fixes the table of contents
  const loaded = new Map<string, Loaded>();
  const key = (ref: number, i: number) => `${ref}:${i}`;
  const planned: PlanEntry[] = [];
  for (const e of job.entries) {
    const pages: number[] = [];
    for (let i = 0; i < e.files.length; i++) {
      const r = await step(e.files[i]);
      if (r) loaded.set(key(e.ref, i), r);
      pages.push(r ? r.pages.length : 0);
    }
    planned.push({ ref: e.ref, day: e.day, header: e.header, filePages: pages });
  }
  const cover = job.cover ? await step(job.cover) : null;

  // 2. the cover's pages: the poster's, or the schedule made from the week
  const scheduleChunks = cover ? [] : chunkSchedule(job.schedule);
  const coverPages = cover ? cover.pages.length : scheduleChunks.length;
  const plan = planReader(planned, coverPages);

  // 3. draw
  const helvetica = await out.embedFont(StandardFonts.Helvetica);
  const images = new Map<string, PDFImage>();
  const embedPng = async (k: string, make: () => Promise<Png>): Promise<{ img: PDFImage; png: Png | null }> => {
    const have = images.get(k);
    if (have) return { img: have, png: null };
    const png = await make();
    const img = await out.embedPng(png.bytes);
    images.set(k, img);
    return { img, png };
  };
  const width = A4.width - 2 * MARGIN;
  const entryOf = new Map(job.entries.map((e) => [e.ref, e]));
  const total = plan.pages.length;

  for (let n = 0; n < total; n++) {
    check();
    const p = plan.pages[n];
    const pageNo = n + 1;
    const page = out.addPage([A4.width, A4.height]);
    if (p.kind === "cover") {
      if (cover) drawSource(page, cover.pages[p.index], { x: 0, y: 0, width: A4.width, height: A4.height });
      else {
        const png = await text.schedulePage(scheduleChunks[p.index], p.index === 0 ? job.scheduleTitle : null);
        page.drawImage(await out.embedPng(png.bytes), { x: 0, y: 0, width: A4.width, height: A4.height });
      }
    } else if (p.kind === "toc") {
      const png = await text.tocPage(plan.tocPages[p.index], p.index === 0 ? "תוכן העניינים" : null);
      page.drawImage(await out.embedPng(png.bytes), { x: 0, y: 0, width: A4.width, height: A4.height });
    } else if (p.kind === "summary") {
      const title = `סיכום ${dayTitle(p.day)}`;
      const { img } = await embedPng(`summary:${title}`, () => text.summaryTitle(title, width));
      const top = A4.height - MARGIN - RUNNING_BAND;
      page.drawImage(img, { x: MARGIN, y: top - 30, width, height: 30 });
      // ruled lines to write on
      for (let y = top - 62; y > MARGIN + NUMBER_BAND + 10; y -= 26) {
        page.drawLine({ start: { x: MARGIN + 6, y }, end: { x: A4.width - MARGIN - 6, y }, thickness: 0.5, color: rgb(0.78, 0.76, 0.71) });
      }
    } else {
      const e = entryOf.get(p.ref)!;
      const first = p.kind === "header" || p.first;
      if (first) {
        const { img } = await embedPng(`strip:${p.ref}`, () => text.entryStrip(e.header, e.when, width, STRIP_HEIGHT));
        page.drawImage(img, { x: MARGIN, y: A4.height - MARGIN - RUNNING_BAND - STRIP_HEIGHT, width, height: STRIP_HEIGHT });
      }
      if (p.kind === "file") drawSource(page, loaded.get(key(p.ref, p.file))!.pages[p.page], contentBox(first));
    }
    const head = runningHeader(pageNo, plan.coverPages, job.headers);
    if (head) {
      const { img } = await embedPng(`head:${head}`, () => text.runningHeader(head, width));
      page.drawImage(img, { x: MARGIN, y: A4.height - MARGIN - 14, width, height: 14 });
    }
    if (numbered(pageNo, plan.coverPages)) drawNumber(page, helvetica, pageNo);
    onProgress({ done: n + 1, total, step: "draw" });
  }

  check();
  onProgress({ done: 0, total: 1, step: "save" });
  const bytes = await out.save();
  onProgress({ done: 1, total: 1, step: "save" });
  return { bytes, pages: out.getPageCount(), skipped };
}

function drawNumber(page: PDFPage, font: PDFFont, n: number) {
  const s = String(n);
  const size = 9;
  page.drawText(s, { x: (A4.width - font.widthOfTextAtSize(s, size)) / 2, y: MARGIN + 4, size, font, color: rgb(0.29, 0.34, 0.45) });
}

/** One page of a file (a PDF's page, or the image), already embedded, into `box`. */
function drawSource(page: PDFPage, src: SourcePage, box: { x: number; y: number; width: number; height: number }) {
  if (src.kind === "pdf") {
    if (!src.page) return; // a page with nothing on it: a blank page, kept as one
    const f = frame(src.width, src.height, src.rotation, box);
    page.drawPage(src.page, { x: f.x, y: f.y, xScale: f.scale, yScale: f.scale, rotate: degrees(f.rotate) });
    return;
  }
  const { img } = src;
  const f = frame(img.width, img.height, src.turn, box);
  page.drawImage(img, { x: f.x, y: f.y, width: img.width * f.scale, height: img.height * f.scale, rotate: degrees(f.rotate) });
}

/** The schedule cover's lines, page by page (a day's heading never alone at a page's foot). */
export function chunkSchedule(lines: ScheduleLine[], perPage = 44): ScheduleLine[][] {
  const out: ScheduleLine[][] = [[]];
  for (let i = 0; i < lines.length; i++) {
    let cur = out[out.length - 1];
    const room = perPage - (out.length === 1 ? 3 : 0) - cur.length; // the first page has the title
    if (room <= 0 || (lines[i].kind === "day" && room <= 1)) {
      cur = [];
      out.push(cur);
    }
    cur.push(lines[i]);
  }
  return out;
}
