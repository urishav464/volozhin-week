// The reader, without a browser: what goes in and in what order (the manifest),
// the table of contents' page math, the A4 framing, the Word skeleton
// (unzipped: the headings in order, right to left, a TOC field, the running
// headers) and the PDF assembly itself (pdf-lib in Node, with a stub for the
// canvas text: page count, order — by each page's embedded source — and the
// files it had to leave out).
import { strFromU8, unzipSync } from "fflate";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { demoWeek, seedDemoSources } from "../data/demoWeek";
import type { SourceFile, Week } from "../domain/types";
import { assembleReader, chunkSchedule, jpegOrientation, orientationTurn, type ReaderJob } from "./assemble";
import { stripJpegMetadata } from "./jpeg";
import { buildSkeleton, skeletonParagraphs, skeletonRows } from "./docx";
import { A4, contentBox, frame, MARGIN, numbered, paginateToc, planReader, runningHeader, TOC_LINES_PER_PAGE, TOC_TITLE_LINES } from "./layout";
import { manifestTotals, readerHeader, readerManifest, readerRows } from "./model";
import { nextLessonStep, readerFilesOf, stagesOf } from "../domain/stages";
import type { Png, TextRenderer } from "./render";
import { fit, wrap } from "./render";

function demo(): Week {
  const w = demoWeek();
  seedDemoSources(w);
  return w;
}
const at = (w: Week, day: number, start: number, room = 1) => w.lessons.find((l) => l.day === day && l.start_min === start && l.room_id === room && l.state !== "cancelled")!;

describe("the manifest", () => {
  it("lists every closed lesson and memorial slot in schedule order — day, time, the room's place — never a draft", () => {
    const w = demo();
    const m = readerManifest(w);
    const keys = m.rows.map((r) => [r.day, r.lesson.start_min, r.lesson.room_id]);
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    expect(keys).toEqual(sorted);
    expect(m.rows.every((r) => r.lesson.state === "closed" || r.kind === "memorial")).toBe(true);
    expect(m.rows.filter((r) => r.kind === "memorial")).toHaveLength(5);
  });

  it("says for each lesson what the reader has of it", () => {
    const w = demo();
    const m = readerManifest(w);
    const row = (day: number, start: number, room = 1) => m.rows.find((r) => r.lesson.id === at(w, day, start, room).id)!;
    expect(row(0, 510)).toMatchObject({ status: "included", pages: 3 });
    expect(row(0, 510).printable.map((f) => f.display_name)).toEqual(["דף מקורות לדוגמה.pdf", "מקור נוסף לדוגמה.pdf"]);
    expect(row(0, 600).status).toBe("presentation_only");
    expect(row(0, 1470).status).toBe("no_sources");
    expect(row(2, 510)).toMatchObject({ status: "needs_pdf", pages: 0 });
    expect(row(2, 510).word).toHaveLength(1);
    expect(row(1, 930).status).toBe("missing");
    expect(row(2, 960, 1)).toMatchObject({ status: "included", pages: 1 });
    expect(row(2, 960, 2).status).toBe("pending");
    expect(row(0, 870).status).toBe("pending");
    const t = manifestTotals(m);
    expect(t).toMatchObject({ included: 2, memorial: 5, needsPdf: 1, presentationOnly: 1, noSources: 1, files: 4, filePages: 4 });
    expect(t.missing).toBeGreaterThanOrEqual(1);
  });

  it("puts in the reader only what has printable pages, and the memorial slots — never a presentation alone, never Word alone", () => {
    const w = demo();
    // even marked for the reader by hand, and with a PDF of its slides uploaded, a presentation stays out (in_reader's own rule, and the manifest's)
    const slides = at(w, 0, 600);
    slides.in_reader = true;
    w.sourceFiles.push({
      id: 99, lesson_id: slides.id, cover: false, speaker_id: w.lessonSpeakers.find((x) => x.lesson_id === slides.id && x.role === "lead")!.speaker_id,
      storage_path: `1/${slides.id}/x`, display_name: "שקפים.pdf", mime: "application/pdf", size_bytes: 1, page_count: 12, uploaded_by: 1, uploaded_at: "2026-11-01T00:00:00Z",
    });
    expect(readerManifest(w).rows.find((r) => r.lesson.id === slides.id)).toMatchObject({ status: "presentation_only", pages: 0 });
    const rows = readerRows(readerManifest(w));
    expect(rows.map((r) => r.status)).not.toContain("presentation_only");
    expect(rows.map((r) => r.status)).not.toContain("needs_pdf");
    expect(rows.map((r) => (r.kind === "memorial" ? `m${r.day}` : r.lesson.id))).toEqual([at(w, 0, 510).id, "m0", "m1", "m2", at(w, 2, 960).id, "m3", "m4"]); // memorial at 13:00, before Tuesday's 16:00
  });

  it("keeps a previous speaker's files out of the reader, for removal", () => {
    const w = demo();
    const l = at(w, 0, 510);
    const x = w.lessonSpeakers.find((s) => s.lesson_id === l.id && s.role === "lead")!;
    x.speaker_id = 40; // another speaker closed the slot since
    const row = readerManifest(w).rows.find((r) => r.lesson.id === l.id)!;
    expect(row.previous).toHaveLength(2);
    expect(row).toMatchObject({ status: "missing", pages: 0, printable: [] });
  });

  it("gathers the files no lesson shows — a draft's, a deleted lesson's — and finds the marked cover", () => {
    const w = demo();
    const draft = w.lessons.find((l) => l.state === "draft" && l.kind === "lesson")!;
    const extra = (o: Partial<SourceFile>): SourceFile => ({
      id: 100 + w.sourceFiles.length, lesson_id: null, cover: false, speaker_id: null, storage_path: `1/x/${w.sourceFiles.length}`, display_name: "x.pdf",
      mime: "application/pdf", size_bytes: 1, page_count: 1, uploaded_by: 1, uploaded_at: "2026-11-01T00:00:00Z", ...o,
    });
    w.sourceFiles.push(extra({ lesson_id: draft.id }), extra({}), extra({ cover: true, id: 500 }), extra({ cover: true, id: 501, mime: "image/png" }));
    w.edition.settings.reader_cover = 501;
    const m = readerManifest(w);
    expect(m.leftovers.map((f) => f.lesson_id)).toEqual([draft.id, null]);
    expect(m.covers.map((f) => f.id)).toEqual([500, 501]);
    expect(m.cover?.id).toBe(501);
  });

  // the code review's proof: «ד״ר מרצה 10» was «חסר» in the manifest and a green «במקראה» dot on its card
  it("agrees with the lesson's «מקראה» stage — the card's dot, the panel — lesson by lesson", () => {
    const w = demo();
    const rows = readerManifest(w).rows.filter((r) => r.kind === "lesson");
    expect(rows.map((r) => r.status)).toEqual(expect.arrayContaining(["included", "missing", "needs_pdf"]));
    for (const r of rows) {
      const files = readerFilesOf(w, r.lesson.id);
      const reader = stagesOf(r.lesson, files).find((s) => s.key === "reader")!;
      expect(reader.state === "done", `${r.header}: ${r.status} / ${reader.note}`).toBe(r.status === "included");
      if (r.status === "missing" && r.lesson.in_reader) expect(reader.note).toBe("חסר קובץ");
      if (r.status === "needs_pdf") expect(reader.note).toBe("צריך PDF");
      // and «המרצים שלי» / the tracking table: such a lesson's sources are still a step to take, once the steps before it are done
      const settled = { ...r.lesson, approval: "none" as const, needs_reconfirm: false, confirm_sent_at: "2026-11-01T00:00:00Z", self_intro: true };
      if (r.status === "missing" || r.status === "needs_pdf") expect(nextLessonStep(settled, files), r.header).toBe("sources");
      if (r.status === "included") expect(nextLessonStep(settled, files), r.header).toBeNull();
    }
  });

  it("writes the header «מרצה – כותרת», TBD for what is missing, and the memorial slot's own", () => {
    expect(readerHeader("lesson", "ד״ר פלונית", "על הדרך")).toBe("ד״ר פלונית – על הדרך");
    expect(readerHeader("lesson", "ד״ר פלונית", null)).toBe("ד״ר פלונית – TBD");
    expect(readerHeader("memorial", "", "זמן זיכרון")).toBe("זמן זיכרון");
    expect(readerHeader("memorial", "", null)).toBe("זמן זיכרון");
    expect(readerHeader("memorial", "", "שם לדוגמה")).toBe("זמן זיכרון – שם לדוגמה");
  });
});

describe("the page plan", () => {
  it("fits the table of contents: its first page loses two lines to the title", () => {
    const first = TOC_LINES_PER_PAGE - TOC_TITLE_LINES;
    expect(paginateToc([]).length).toBe(1);
    expect(paginateToc(Array(first).fill(0)).length).toBe(1);
    expect(paginateToc(Array(first + 1).fill(0)).length).toBe(2);
    expect(paginateToc(Array(first + TOC_LINES_PER_PAGE).fill(0)).length).toBe(2);
    expect(paginateToc(Array(first + TOC_LINES_PER_PAGE + 1).fill(0)).map((p) => p.length)).toEqual([first, TOC_LINES_PER_PAGE, 1]);
  });

  it("orders the book: cover, contents, each day's entries and its «סיכום יום» — and the contents point at the right pages", () => {
    const entries = [
      { ref: 0, day: 0 as const, header: "א – כותרת", filePages: [2, 1] },
      { ref: 1, day: 0 as const, header: "זמן זיכרון", filePages: [] },
      { ref: 2, day: 2 as const, header: "ב – כותרת", filePages: [0, 3] }, // a file that could not be read adds nothing
    ];
    const plan = planReader(entries, 1);
    expect(plan.pages.map((p) => p.kind)).toEqual([
      "cover", "toc", "file", "file", "file", "header", "summary", "summary", "file", "file", "file", "summary", "summary", "summary",
    ]);
    expect(plan.pages[2]).toEqual({ kind: "file", ref: 0, file: 0, page: 0, first: true });
    expect(plan.pages[4]).toEqual({ kind: "file", ref: 0, file: 1, page: 0, first: false });
    expect(plan.pages[8]).toEqual({ kind: "file", ref: 2, file: 1, page: 0, first: true });
    for (const line of plan.toc) {
      if (line.kind === "entry") expect(plan.pages[line.page - 1]).toMatchObject({ ref: line.ref });
      if (line.kind === "summary") expect(plan.pages[line.page - 1]).toEqual({ kind: "summary", day: line.day });
    }
    expect(plan.toc.filter((l) => l.kind === "entry").map((l) => (l.kind === "entry" ? l.page : 0))).toEqual([3, 6, 9]);
    expect(plan.toc.filter((l) => l.kind === "day")).toHaveLength(5);
  });

  it("gives a long table of contents more pages, and every number still lands on its entry", () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ ref: i, day: (i % 5) as 0 | 1 | 2 | 3 | 4, header: `מרצה ${i} – כותרת`, filePages: [1 + (i % 3)] }));
    const plan = planReader(entries, 2);
    // 5 day lines + 60 entries + 5 summaries = 70 lines: 32 + 34 + 4
    expect(plan.tocPages.map((p) => p.length)).toEqual([32, 34, 4]);
    expect(plan.pages.slice(0, 5).map((p) => p.kind)).toEqual(["cover", "cover", "toc", "toc", "toc"]);
    const filePages = entries.reduce((n, e) => n + e.filePages[0], 0);
    expect(plan.pages).toHaveLength(2 + 3 + filePages + 5);
    for (const line of plan.toc) if (line.kind === "entry") expect(plan.pages[line.page - 1]).toMatchObject({ kind: "file", ref: line.ref, first: true });
  });

  it("alternates the running headers — odd pages the left one — never on the cover, and numbers every page after it", () => {
    const h = ["שמאל", "ימין"] as const;
    expect([1, 2, 3, 4, 5].map((p) => runningHeader(p, 1, h))).toEqual([null, "ימין", "שמאל", "ימין", "שמאל"]);
    expect(runningHeader(3, 1, undefined)).toBeNull();
    expect(runningHeader(3, 1, ["", "ימין"])).toBeNull();
    expect([1, 2, 3].map((p) => numbered(p, 2))).toEqual([false, false, true]);
  });
});

describe("A4 framing", () => {
  const box = { x: 10, y: 20, width: 500, height: 700 };

  it("scales a page to fit, keeps its aspect and centres it", () => {
    const a4 = frame(A4.width, A4.height, 0, box);
    expect(a4.rotate).toBe(0);
    expect(a4.box.width / a4.box.height).toBeCloseTo(A4.width / A4.height, 6);
    expect(a4.box.width <= box.width + 1e-9 && a4.box.height <= box.height + 1e-9).toBe(true);
    expect(Math.min(box.width - a4.box.width, box.height - a4.box.height)).toBeCloseTo(0, 6); // touches one pair of sides
    const wide = frame(800, 400, 0, box);
    expect(wide.scale).toBeCloseTo(500 / 800);
    expect(wide.box).toEqual({ x: 10, y: 20 + (700 - 250) / 2, width: 500, height: 250 });
    const small = frame(100, 100, 0, box);
    expect(small.scale).toBe(5); // up as well as down
  });

  it("turns a page with /Rotate the way it is displayed, and puts the origin where the rotation needs it", () => {
    const r90 = frame(800, 400, 90, box); // shown 400 wide, 800 tall
    expect(r90.rotate).toBe(-90);
    expect(r90.scale).toBeCloseTo(Math.min(500 / 400, 700 / 800));
    expect(r90.box.height).toBeCloseTo(700);
    expect([r90.x, r90.y]).toEqual([r90.box.x, r90.box.y + r90.box.height]);
    const r180 = frame(100, 200, 180, box);
    expect([r180.x, r180.y]).toEqual([r180.box.x + r180.box.width, r180.box.y + r180.box.height]);
    const r270 = frame(100, 200, -90, box);
    expect(r270.rotate).toBe(-270);
    expect([r270.x, r270.y]).toEqual([r270.box.x + r270.box.width, r270.box.y]);
  });

  it("keeps the header bands free: a first page leaves room for the strip", () => {
    const first = contentBox(true);
    const other = contentBox(false);
    expect(first.height).toBeLessThan(other.height);
    expect(first.x).toBe(MARGIN);
    expect(other.y + other.height).toBeLessThan(A4.height - MARGIN);
  });

  it("reads a JPEG's EXIF orientation", () => {
    const exif = (o: number, little: boolean) => {
      const u16 = (v: number) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
      const u32 = (v: number) => (little ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
      const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(o), 0, 0, ...u32(0)];
      const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
      return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2]);
    };
    expect(jpegOrientation(exif(6, true))).toBe(6);
    expect(jpegOrientation(exif(3, false))).toBe(3);
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda]))).toBe(1);
    expect([1, 3, 6, 8].map(orientationTurn)).toEqual([0, 180, 90, 270]);
  });
});

describe("text that must fit", () => {
  const measure = (s: string) => s.length * 10;
  it("wraps by words into at most two lines, the last cut with «…»", () => {
    expect(wrap(measure, "אחת שתיים שלוש", 100)).toEqual(["אחת שתיים", "שלוש"]);
    expect(wrap(measure, "אחת שתיים שלוש ארבע חמש שש", 100)).toEqual(["אחת שתיים", "שלוש ארבע…"]);
    expect(fit(measure, "קצר", 100)).toBe("קצר");
    expect(fit(measure, "ארוך מאוד מאוד", 60)).toBe("ארוך…");
  });
  it("splits the schedule cover into pages, never leaving a day's heading alone at a page's foot", () => {
    const lines = [{ kind: "day" as const, text: "יום ראשון" }, ...Array.from({ length: 40 }, () => ({ kind: "row" as const, text: "08:30–09:45" })), { kind: "day" as const, text: "יום שני" }, { kind: "row" as const, text: "x" }];
    const pages = chunkSchedule(lines, 44);
    expect(pages.map((p) => p.length)).toEqual([41, 2]);
    expect(pages[1][0].kind).toBe("day");
  });
});

describe("the Word skeleton", () => {
  it("has the headings in schedule order, a page each, right to left, a TOC field and the running headers", async () => {
    const w = demo();
    const m = readerManifest(w);
    const rows = skeletonRows(m);
    // the marked lessons whatever their files (Word only, nothing yet — this is where they are pasted), and the memorial slots
    expect(rows.map((r) => r.status)).toEqual(expect.arrayContaining(["included", "needs_pdf", "missing", "memorial"]));
    expect(rows.map((r) => r.status)).not.toContain("presentation_only");
    const bytes = await buildSkeleton({ manifest: m, editionLabel: "הדגמה", headers: ["כותרת שמאל לבדיקה", "כותרת ימין לבדיקה"] });
    const zip = unzipSync(bytes);
    const doc = strFromU8(zip["word/document.xml"]);
    const texts = [...doc.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((x) => x[1]);
    const expected = skeletonParagraphs({ manifest: m, editionLabel: "הדגמה" }).filter((p) => p.text).map((p) => p.text);
    // each heading found after the one before it: in this order, every one of them
    let from = 0;
    for (const t of expected) {
      const i = texts.indexOf(t, from);
      expect(i, t).toBeGreaterThanOrEqual(0);
      from = i + 1;
    }
    expect(expected[0]).toBe("יום ראשון");
    expect(expected).toContain("סיכום יום חמישי");
    expect(expected).toContain(m.rows.find((r) => r.status === "needs_pdf")!.header);
    expect(doc).toContain("<w:bidi/>");
    expect(doc).toContain("<w:rtl/>");
    expect(doc).toMatch(/TOC \\h \\o &quot;1-2&quot;/);
    // a page each — but a day's heading shares its page with its first entry (never a day's name alone on a page)
    const paras = skeletonParagraphs({ manifest: m, editionLabel: "הדגמה" });
    expect((doc.match(/<w:pageBreakBefore\/>/g) ?? []).length).toBe(paras.filter((p) => p.pageBreak).length);
    paras.forEach((p, i) => {
      if (p.style === "h1") expect(p.pageBreak).toBe(true);
      if (i > 0 && paras[i - 1].style === "h1") expect(p.pageBreak, p.text).toBe(false);
    });
    // «סיכום יום»'s ruled lines: a between border too, or Word and LibreOffice draw one line under the whole block
    expect(doc).toMatch(/<w:between /);
    expect(doc).toContain("תוכן העניינים"); // the table of contents has a title on the page, not only the field's alias
    // right to left by default (the TOC's own paragraphs too), and outline levels a TOC can be built from
    const styles = strFromU8(zip["word/styles.xml"]);
    expect(styles).toMatch(/<w:pPrDefault><w:pPr>(?:(?!<\/w:pPr>).)*<w:bidi\/>/s);
    expect(styles).toMatch(/w:styleId="Heading1"(?:(?!<\/w:style>).)*<w:outlineLvl w:val="0"\/>/s);
    expect(styles).toMatch(/w:styleId="Heading1"(?:(?!<\/w:style>).)*<w:keepNext\/>/s);
    expect(styles).toMatch(/w:styleId="Heading2"(?:(?!<\/w:style>).)*<w:outlineLvl w:val="1"\/>/s);
    const settings = strFromU8(zip["word/settings.xml"]);
    expect(settings).toContain("w:evenAndOddHeaders");
    expect(settings).toContain("w:updateFields");
    const headers = Object.keys(zip).filter((k) => /^word\/header\d+\.xml$/.test(k)).map((k) => strFromU8(zip[k])).join("");
    expect(headers).toContain("כותרת שמאל לבדיקה");
    expect(headers).toContain("כותרת ימין לבדיקה");
  });

  it("writes no running header the admin did not type", async () => {
    const m = readerManifest(demo());
    const zip = unzipSync(await buildSkeleton({ manifest: m, editionLabel: "הדגמה" }));
    const headers = Object.keys(zip).filter((k) => /^word\/header\d+\.xml$/.test(k)).map((k) => strFromU8(zip[k])).join("");
    expect(headers).not.toMatch(/<w:t[ >]/);
  });
});

/** Scan data with a stuffed byte (FF 00) and a restart marker (FF D0) in it. */
const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a];

/**
 * A photo as a phone writes it, synthetic: JFIF, EXIF (orientation 6, the camera's make, a GPS IFD), XMP, an
 * ICC-like APP2, a comment, Adobe's APP14, the tables, a 16×8 frame, a scan — and a «motion photo» after the end.
 * pdf-lib reads only the frame, so the scan need not decode.
 */
function syntheticPhoto(): Uint8Array {
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
  const ascii = (t: string) => [...Buffer.from(t, "latin1")];
  // EXIF, little-endian: IFD0 with Orientation (0x0112) = 6, Make (0x010f) → «SamsungPhone», GPS IFD (0x8825) → one GPS tag
  const u16 = (v: number) => [v & 255, v >> 8];
  const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24];
  const make = ascii("SamsungPhone\0");
  const ifd0At = 8;
  const ifd0Len = 2 + 3 * 12 + 4;
  const makeAt = ifd0At + ifd0Len;
  const gpsAt = makeAt + make.length;
  const tiff = [
    0x49, 0x49, ...u16(42), ...u32(ifd0At),
    ...u16(3),
    ...u16(0x010f), ...u16(2), ...u32(make.length), ...u32(makeAt),
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(6), 0, 0,
    ...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsAt),
    ...u32(0),
    ...make,
    ...u16(1), ...u16(1), ...u16(2), ...u32(2), ...ascii("N\0"), 0, 0, ...u32(0), // GPSLatitudeRef = N
    ...ascii("GPS"),
  ];
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, [...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, [...ascii("Exif\0\0"), ...tiff]),
    ...seg(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/\0"), ...ascii("<x:xmpmeta/>")]),
    ...seg(0xe2, [...ascii("ICC_PROFILE\0"), 1, 1, 0, 0]),
    ...seg(0xfe, ascii("a comment")),
    ...seg(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 1]),
    ...seg(0xdb, [0, ...Array(64).fill(1)]),
    ...seg(0xc0, [8, 0, 8, 0, 16, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    ...seg(0xc4, [0, ...Array(16).fill(0)]),
    ...seg(0xda, [3, 1, 0, 2, 0, 3, 0, 0, 63, 0]),
    ...SCAN,
    0xff, 0xd9,
    ...ascii("MotionPhoto_Data"), 0, 0, 0, 0x18, ...ascii("ftypmp42"),
  ]);
}

// A 1×1 PNG: what the stub text drawer hands back for every line of Hebrew.
const PIXEL = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"));
const stub: TextRenderer = {
  runningHeader: async (_t, w) => ({ bytes: PIXEL, widthPt: w, heightPt: 14 }) as Png,
  entryStrip: async (_h, _w, width, height) => ({ bytes: PIXEL, widthPt: width, heightPt: height }),
  tocPage: async () => ({ bytes: PIXEL, widthPt: A4.width, heightPt: A4.height }),
  schedulePage: async () => ({ bytes: PIXEL, widthPt: A4.width, heightPt: A4.height }),
  summaryTitle: async (_t, w) => ({ bytes: PIXEL, widthPt: w, heightPt: 30 }),
};

async function pdfOf(sizes: [number, number][], rotate = 0, blank = false): Promise<ArrayBuffer> {
  const d = await PDFDocument.create();
  for (const s of sizes) {
    const p = d.addPage(s);
    p.setRotation(degrees(rotate));
    if (!blank) p.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
  }
  const b = await d.save();
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** A page's content stream, decoded. */
function pageContent(doc: PDFDocument, n: number): string {
  const c = doc.getPage(n).node.normalizedEntries().Contents!;
  return Array.from({ length: c.size() }, (_, i) => {
    const s = c.lookup(i, PDFStream);
    return s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") : "";
  }).join("\n");
}

/** Each page's embedded source page, by its BBox («300x400»), or «-» for a page with none (text pictures only). */
function sources(doc: PDFDocument): string[] {
  return doc.getPages().map((p) => {
    const xo = p.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xo) return "-";
    for (const [, ref] of xo.entries()) {
      const s = doc.context.lookup(ref);
      if (s instanceof PDFRawStream && s.dict.get(PDFName.of("Subtype"))?.toString() === "/Form") {
        const bb = s.dict.lookup(PDFName.of("BBox"), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
        return `${bb[2] - bb[0]}x${bb[3] - bb[1]}`;
      }
    }
    return "-";
  });
}

describe("the PDF assembly", () => {
  it("builds cover, contents, each lesson's pages re-framed to A4 and a «סיכום יום» per day — and leaves out what it cannot read", async () => {
    const job: ReaderJob = {
      editionLabel: "בדיקה",
      headers: ["שמאל", "ימין"],
      cover: null,
      schedule: [{ kind: "day", text: "יום ראשון" }, { kind: "row", text: "08:30–09:45", speaker: "א", title: "ב" }],
      scheduleTitle: "לו\"ז",
      entries: [
        { ref: 0, day: 0, header: "א – ראשון", when: "ראשון 08:30–09:45", files: [{ id: 1, name: "a.pdf", mime: "application/pdf", bytes: await pdfOf([[300, 400], [300, 400]]) }] },
        { ref: 1, day: 0, header: "זמן זיכרון", when: "ראשון 13:00–13:15", files: [] },
        {
          ref: 2, day: 1, header: "ב – שני", when: "שני 10:00–11:15",
          files: [
            { id: 2, name: "broken.pdf", mime: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 not really").buffer as ArrayBuffer },
            { id: 3, name: "c.pdf", mime: "application/pdf", bytes: await pdfOf([[500, 250]], 90) },
            { id: 4, name: "d.png", mime: "image/png", bytes: PIXEL.buffer.slice(0) as ArrayBuffer },
            { id: 5, name: "blank.pdf", mime: "application/pdf", bytes: await pdfOf([[400, 400]], 0, true) }, // a page with no content at all: a blank page, still a page
          ],
        },
      ],
    };
    const progress: string[] = [];
    const r = await assembleReader(job, stub, (p) => progress.push(p.step));
    const out = await PDFDocument.load(r.bytes);
    // 1 schedule page + 1 contents + 2 + 1 (memorial header) + 1 + 1 + 1 (blank) + 5 summaries
    expect(r.pages).toBe(13);
    expect(out.getPageCount()).toBe(13);
    expect(out.getPages().every((p) => Math.abs(p.getWidth() - A4.width) < 0.01 && Math.abs(p.getHeight() - A4.height) < 0.01)).toBe(true);
    expect(sources(out)).toEqual(["-", "-", "300x400", "300x400", "-", "-", "500x250", "-", "-", "-", "-", "-", "-"]);
    expect(r.skipped).toEqual([{ name: "broken.pdf", reason: "unreadable" }]);
    expect(progress).toContain("read");
    expect(progress.at(-1)).toBe("save");
  });

  it("opens with the marked poster's pages instead of the schedule", async () => {
    const job: ReaderJob = {
      editionLabel: "בדיקה", cover: { id: 9, name: "poster.pdf", mime: "application/pdf", bytes: await pdfOf([[1000, 1414]]) }, schedule: [], scheduleTitle: "",
      entries: [{ ref: 0, day: 3, header: "א – ב", when: "", files: [{ id: 1, name: "a.pdf", mime: "application/pdf", bytes: await pdfOf([[200, 200]]) }] }],
    };
    const out = await PDFDocument.load((await assembleReader(job, stub)).bytes);
    expect(sources(out).slice(0, 3)).toEqual(["1000x1414", "-", "-"]);
    expect(sources(out)).toContain("200x200");
    expect(out.getPageCount()).toBe(1 + 1 + 1 + 5);
  });

  // the reviewer's proof (a damaged picture failed the whole build with «SOI not found in JPEG»), turned round
  it("leaves out a damaged picture, a broken PNG and a PDF whose pages cannot be embedded — names each, and builds the rest", async () => {
    const pngHead = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
    // a PDF that opens, with a page whose content is in a filter pdf-lib cannot decode: embedding it throws
    const odd = await PDFDocument.create();
    const page = odd.addPage([300, 300]);
    page.node.set(PDFName.of("Contents"), odd.context.register(odd.context.stream("x", { Filter: "JBIG2Decode" })));
    odd.addPage([300, 300]).drawRectangle({ x: 1, y: 1, width: 5, height: 5 });
    const oddBytes = await odd.save();
    const job: ReaderJob = {
      editionLabel: "x", cover: null, schedule: [], scheduleTitle: "",
      entries: [{ ref: 0, day: 0, header: "א – ב", when: "", files: [
        { id: 1, name: "photo.jpg", mime: "image/jpeg", bytes: new TextEncoder().encode("not a jpeg at all").buffer as ArrayBuffer },
        { id: 2, name: "broken.png", mime: "image/png", bytes: pngHead.buffer as ArrayBuffer },
        { id: 3, name: "odd.pdf", mime: "application/pdf", bytes: oddBytes.buffer.slice(oddBytes.byteOffset, oddBytes.byteOffset + oddBytes.byteLength) as ArrayBuffer },
        { id: 4, name: "good.pdf", mime: "application/pdf", bytes: await pdfOf([[300, 400]]) },
        { id: 5, name: "really-a-png.jpg", mime: "image/jpeg", bytes: PIXEL.buffer.slice(0) as ArrayBuffer }, // drawn as the PNG it is
      ] }],
    };
    const r = await assembleReader(job, stub);
    expect(r.skipped).toEqual([
      { name: "photo.jpg", reason: "unreadable" },
      { name: "broken.png", reason: "unreadable" },
      { name: "odd.pdf", reason: "unreadable" }, // all of its pages, or none
    ]);
    const out = await PDFDocument.load(r.bytes);
    // 1 schedule page + 1 contents + good.pdf + the PNG + 5 summaries
    expect(out.getPageCount()).toBe(1 + 1 + 1 + 1 + 5);
    expect(sources(out).slice(2, 4)).toEqual(["300x400", "-"]);
  });

  it("puts a phone's photo in without its metadata — no EXIF, no GPS, no camera, no comment, nothing after the image — and still turns it upright", async () => {
    const jpeg = syntheticPhoto();
    const has = (b: Uint8Array, text: string) => Buffer.from(b).includes(Buffer.from(text, "latin1"));
    expect(has(jpeg, "Exif\0\0") && has(jpeg, "SamsungPhone") && has(jpeg, "a comment") && has(jpeg, "MotionPhoto")).toBe(true);
    // the control: pdf-lib alone copies the photo's bytes into the PDF as they are
    const raw = await PDFDocument.create();
    raw.addPage().drawImage(await raw.embedJpg(jpeg), { x: 0, y: 0, width: 10, height: 10 });
    expect(has(await raw.save(), "SamsungPhone")).toBe(true);

    const clean = stripJpegMetadata(jpeg)!;
    for (const t of ["Exif\0\0", "SamsungPhone", "GPS", "a comment", "MotionPhoto", "http://ns.adobe.com/xap/1.0/"]) expect(has(clean, t), t).toBe(false);
    expect(has(clean, "JFIF\0")).toBe(true); // APP0 kept
    expect(has(clean, "Adobe")).toBe(true); // APP14 kept (the colour transform)
    expect(Buffer.from(clean.subarray(-2)).toString("hex")).toBe("ffd9");
    // the picture's own segments and its scan data, byte for byte
    expect(Buffer.from(clean).includes(Buffer.from(SCAN))).toBe(true);
    expect(jpegOrientation(jpeg)).toBe(6);

    const job: ReaderJob = {
      editionLabel: "x", cover: null, schedule: [], scheduleTitle: "",
      entries: [{ ref: 0, day: 0, header: "א – ב", when: "", files: [{ id: 1, name: "צילום.jpg", mime: "image/jpeg", bytes: jpeg.buffer.slice(0) as ArrayBuffer }] }],
    };
    const r = await assembleReader(job, stub);
    expect(r.skipped).toEqual([]);
    for (const t of ["Exif\0\0", "SamsungPhone", "a comment", "MotionPhoto"]) expect(has(r.bytes, t), t).toBe(false);
    // drawn turned a quarter clockwise (EXIF orientation 6): pdf-lib's rotate of -90° is the matrix [cos −1 1 cos 0 0]
    const out = await PDFDocument.load(r.bytes);
    expect(pageContent(out, 2)).toMatch(/\S+ -1 1 \S+ 0 0 cm/);
  });

  it("follows a JPEG's structure or says it cannot: cut short, no frame, a segment past the end", () => {
    const jpeg = syntheticPhoto();
    const eoi = jpeg.lastIndexOf(0xd9) - 1;
    const cut = stripJpegMetadata(jpeg.subarray(0, eoi - 3).slice())!; // cut inside the scan data: kept, its end marker back
    expect(Buffer.from(cut.subarray(-2)).toString("hex")).toBe("ffd9");
    expect(stripJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 1, 2]))).toBeNull(); // a scan before any frame
    expect(stripJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x40, 0, 1, 2]))).toBeNull(); // a segment past the end
    expect(stripJpegMetadata(new TextEncoder().encode("not a jpeg"))).toBeNull();
  });

  it("stops when cancelled", async () => {
    const job: ReaderJob = { editionLabel: "x", cover: null, schedule: [], scheduleTitle: "", entries: [] };
    await expect(assembleReader(job, stub, () => {}, () => true)).rejects.toThrow(/cancelled/);
  });
});
