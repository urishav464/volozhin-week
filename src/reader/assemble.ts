// The reader's PDF, from the files' bytes (pdf-lib 1.17.1). Runs in the
// reader's worker (src/reader/worker.ts) — and in a unit test with a stub text
// drawer. The order and page numbers are src/reader/layout.ts's plan; every
// source page is re-framed to A4 (scaled to fit, aspect kept, its /Rotate
// honoured); the running headers alternate, the page numbers count from the
// cover. A file that cannot be read (protected, damaged) is left out and named
// in the result — never a silent gap.
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import type { Day } from "../domain/time";
import { A4, contentBox, dayTitle, frame, MARGIN, NUMBER_BAND, numbered, planReader, type PlanEntry, RUNNING_BAND, runningHeader, STRIP_HEIGHT } from "./layout";
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

type Loaded = { kind: "pdf"; doc: PDFDocument; pages: number } | { kind: "image"; mime: ReaderMime; bytes: Uint8Array; pages: 1 };

/** A JPEG's EXIF orientation (1 when there is none) — a phone's photo may be stored sideways. */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return 1;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
      const t = i + 10; // the TIFF header
      const little = bytes[t] === 0x49;
      const u16 = (o: number) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
      const u32 = (o: number) => (little ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0 : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0);
      const ifd = t + u32(t + 4);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda) return 1; // the image data: no EXIF before it
    i += 2 + len;
  }
  return 1;
}

/** EXIF orientation → the clockwise turn it asks for (mirrored orientations are rare from a phone; drawn unmirrored). */
export function orientationTurn(o: number): number {
  return o === 3 || o === 4 ? 180 : o === 5 || o === 6 ? 90 : o === 7 || o === 8 ? 270 : 0;
}

async function load(f: JobFile): Promise<Loaded | Skipped> {
  if (f.mime !== "application/pdf") return { kind: "image", mime: f.mime, bytes: new Uint8Array(f.bytes), pages: 1 };
  try {
    const doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
    const pages = doc.getPageCount();
    return pages > 0 ? { kind: "pdf", doc, pages } : { name: f.name, reason: "unreadable" };
  } catch (e) {
    return { name: f.name, reason: e instanceof Error && /encrypt/i.test(e.name + e.message) ? "protected" : "unreadable" };
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
  const readTotal = job.entries.reduce((n, e) => n + e.files.length, 0) + (job.cover ? 1 : 0);
  let readDone = 0;
  const step = async (f: JobFile): Promise<Loaded | null> => {
    check();
    const r = await load(f);
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
      pages.push(r ? r.pages : 0);
    }
    planned.push({ ref: e.ref, day: e.day, header: e.header, filePages: pages });
  }
  const cover = job.cover ? await step(job.cover) : null;

  // 2. the cover's pages: the poster's, or the schedule made from the week
  const scheduleChunks = cover ? [] : chunkSchedule(job.schedule);
  const coverPages = cover ? cover.pages : scheduleChunks.length;
  const plan = planReader(planned, coverPages);

  // 3. draw
  const out = await PDFDocument.create();
  out.setTitle(`מקראה ${job.editionLabel}`);
  out.setCreator("volozhin-week");
  out.setProducer("pdf-lib");
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
      if (cover) await drawSource(out, page, cover, p.index, { x: 0, y: 0, width: A4.width, height: A4.height });
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
      if (p.kind === "file") await drawSource(out, page, loaded.get(key(p.ref, p.file))!, p.page, contentBox(first));
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

/** One page of a file (a PDF's page, or the image) into `box`. */
async function drawSource(out: PDFDocument, page: PDFPage, src: Loaded, index: number, box: { x: number; y: number; width: number; height: number }) {
  if (src.kind === "pdf") {
    const sp = src.doc.getPage(index);
    if (!sp.node.Contents()) return; // a page with nothing on it (pdf-lib cannot embed it): a blank page, kept as one
    const crop = sp.getCropBox();
    const embedded = await out.embedPage(sp, { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height });
    const f = frame(crop.width, crop.height, sp.getRotation().angle, box);
    page.drawPage(embedded, { x: f.x, y: f.y, xScale: f.scale, yScale: f.scale, rotate: degrees(f.rotate) });
    return;
  }
  const img = src.mime === "image/png" ? await out.embedPng(src.bytes) : await out.embedJpg(src.bytes);
  const turn = src.mime === "image/jpeg" ? orientationTurn(jpegOrientation(src.bytes)) : 0;
  const f = frame(img.width, img.height, turn, box);
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
