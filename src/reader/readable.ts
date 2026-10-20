// Can the reader print this file? One answer, for the build (src/reader/assemble.ts
// opens every file through openSource before it embeds it) and for the upload
// (readableSource: the same steps, nothing embedded) — so a file the manifest
// counts as received is a file the build puts in. The type is taken from the
// bytes, not the label, for a picture: a PNG saved as .jpg is the PNG it is;
// a PNG whose image data does not inflate to its end (src/reader/png.ts), a
// JPEG whose structure cannot be followed (src/reader/jpeg.ts) or whose frame
// pdf-lib's embedder does not take, and bytes that are neither are
// «unreadable». A PDF: opened (a password → «protected»), its
// pages' annotations painted in (src/reader/annotations.ts), each page's box and
// turn read, and every page that draws anything decoded once — what embedding
// it does when the reader is saved. pdf-lib is in it: a screen loads this
// module on demand.
import { decodePDFRawStream, JpegEmbedder, PDFContentStream, PDFDocument, type PDFPage, PDFRawStream, PDFStream } from "pdf-lib";
import { flattenAnnotations } from "./annotations";
import { jpegOrientation, looksJpeg, orientationTurn, stripJpegMetadata } from "./jpeg";
import { looksPng, pngInflates } from "./png";

export type ReaderMime = "application/pdf" | "image/png" | "image/jpeg";

export interface Unreadable {
  ok: false;
  reason: "protected" | "unreadable";
}

/** A PDF's page, as the build frames it. */
export interface SourcePdfPage {
  page: PDFPage;
  /** Has it content? pdf-lib embeds a page by its content; one without any is kept, a blank page. */
  drawn: boolean;
  /** Its crop box (its media box when it has none), the corners in order. */
  box: { x: number; y: number; width: number; height: number };
  /** Its /Rotate, clockwise degrees. */
  rotation: number;
}

/** A file the reader can print, opened: what the build embeds. */
export type Opened =
  | { ok: true; kind: "png"; bytes: Uint8Array }
  /** Without its metadata; `turn`: its EXIF orientation, as a clockwise turn. */
  | { ok: true; kind: "jpeg"; bytes: Uint8Array; turn: number }
  | { ok: true; kind: "pdf"; doc: PDFDocument; pages: SourcePdfPage[] };

const unreadable: Unreadable = { ok: false, reason: "unreadable" };

/**
 * A page's crop box with its corners in order: PDF takes any two opposite corners — [0 842 595 0] is an upright
 * A4 — and pdf-lib's rectangle would have a negative height, the page printed upside down. A page with no box at
 * all (no MediaBox anywhere above it) throws: the file is «unreadable».
 */
function cropBox(p: PDFPage): SourcePdfPage["box"] {
  const c = p.getCropBox();
  return { x: Math.min(c.x, c.x + c.width), y: Math.min(c.y, c.y + c.height), width: Math.abs(c.width), height: Math.abs(c.height) };
}

/** Open a file as the build does — see the top of this file. */
export async function openSource(bytes: Uint8Array, mime: ReaderMime): Promise<Opened | Unreadable> {
  if (mime !== "application/pdf") {
    if (looksPng(bytes)) return pngInflates(bytes) ? { ok: true, kind: "png", bytes } : unreadable;
    const clean = looksJpeg(bytes) ? stripJpegMetadata(bytes) : null;
    if (!clean) return unreadable;
    try {
      // pdf-lib's own read of the frame (what embedJpg does first, up to the SOF): a frame it cannot take — not
      // 1, 3 or 4 components, a marker it cannot step over — is «unreadable» here, as it would be at the build
      await JpegEmbedder.for(clean);
    } catch {
      return unreadable;
    }
    return { ok: true, kind: "jpeg", bytes: clean, turn: orientationTurn(jpegOrientation(bytes)) };
  }
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return e instanceof Error && /encrypt/i.test(e.name + e.message) ? { ok: false, reason: "protected" } : unreadable;
  }
  try {
    if (doc.getPageCount() === 0) return unreadable;
    const pages = doc.getPages().map((page): SourcePdfPage => {
      flattenAnnotations(doc, page);
      return { page, drawn: Boolean(page.node.Contents()), box: cropBox(page), rotation: page.getRotation().angle };
    });
    // pdf-lib decodes an embedded page's content only when the reader is saved — a page it cannot decode would
    // fail the whole book there; so every page is decoded once here, and such a file is left out and named
    if (!pages.every((p) => !p.drawn || decodes(p.page))) return unreadable;
    return { ok: true, kind: "pdf", doc, pages };
  } catch {
    return unreadable;
  }
}

/** At the upload: would the build put this file in, and with how many pages? */
export async function readableSource(bytes: Uint8Array, mime: ReaderMime): Promise<{ ok: true; pages: number } | Unreadable> {
  const r = await openSource(bytes, mime);
  if (!r.ok) return r;
  return { ok: true, pages: r.kind === "pdf" ? r.doc.getPageCount() : 1 };
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
