// What a PDF's page shows through its annotations — a highlight, a text box, a
// stamp, ink (what Preview, an iPad's markup or Acrobat's comments add) and a
// filled form's values — painted into the page itself before it is embedded
// (src/reader/readable.ts): pdf-lib embeds a page's content alone, so all of it
// would be missing from the printed reader without a word. As a viewer prints
// (PDF 32000-1 §12.5.5): an annotation that prints — the Print flag, not Hidden;
// never a Popup or a Link — draws its normal appearance (/AP /N; a check box's
// or a radio button's by its /AS), its /BBox, through its /Matrix, mapped onto
// its /Rect. Not pdf-lib's form.flatten(): it leaves markup out, redraws a
// field that has no appearance in a font with no Hebrew, and throws on an
// appearance that is not a reference. An annotation that cannot be followed is
// skipped, alone — never the file.
import {
  concatTransformationMatrix, drawObject, PDFArray, PDFDict, type PDFDocument, PDFName, PDFNumber, type PDFOperator, type PDFPage, PDFRef, PDFStream, popGraphicsState, pushGraphicsState,
} from "pdf-lib";

const HIDDEN = 2;
const PRINT = 4;
const NOT_PRINTED = new Set(["Popup", "Link"]);

/**
 * The `cm` that puts an appearance on its annotation's rectangle: its /BBox, transformed by its /Matrix (the
 * smallest rectangle around the four corners), scaled and moved onto /Rect. Only that — `Do` applies the form's
 * own /Matrix itself, so it is not applied twice. null: an empty box or rectangle, nothing to draw.
 */
export function appearanceMatrix(bbox: number[], matrix: number[], rect: number[]): [number, number, number, number, number, number] | null {
  const [a, b, c, d, e, f] = matrix;
  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[0], bbox[3]],
    [bbox[2], bbox[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const x1 = Math.min(...corners.map((p) => p[0]));
  const x2 = Math.max(...corners.map((p) => p[0]));
  const y1 = Math.min(...corners.map((p) => p[1]));
  const y2 = Math.max(...corners.map((p) => p[1]));
  const rx = Math.min(rect[0], rect[2]);
  const ry = Math.min(rect[1], rect[3]);
  const rw = Math.abs(rect[2] - rect[0]);
  const rh = Math.abs(rect[3] - rect[1]);
  if (!(x2 > x1 && y2 > y1 && rw > 0 && rh > 0)) return null;
  const sx = rw / (x2 - x1);
  const sy = rh / (y2 - y1);
  const out: [number, number, number, number, number, number] = [sx, 0, 0, sy, rx - sx * x1, ry - sy * y1];
  return out.every(Number.isFinite) ? out : null;
}

/** An array of numbers in `dict` (each may be a reference), or null when it is not one of `length`. */
function numbers(dict: PDFDict, key: string, length: number): number[] | null {
  const arr = dict.lookupMaybe(PDFName.of(key), PDFArray);
  if (!arr || arr.size() !== length) return null;
  return Array.from({ length }, (_, i) => arr.lookup(i, PDFNumber).asNumber());
}

/** One annotation onto its page: the operators that draw it, or null when it does not print or has nothing to draw. */
function paint(doc: PDFDocument, page: PDFPage, annot: PDFDict): PDFOperator[] | null {
  const flags = annot.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
  if (!(flags & PRINT) || flags & HIDDEN) return null;
  const subtype = annot.lookupMaybe(PDFName.of("Subtype"), PDFName);
  if (subtype && NOT_PRINTED.has(subtype.decodeText())) return null;
  const ap = annot.lookupMaybe(PDFName.of("AP"), PDFDict);
  if (!ap) return null;
  let ref = ap.get(PDFName.of("N"));
  let normal = ap.lookup(PDFName.of("N"));
  if (normal instanceof PDFDict) {
    // a check box's or a radio button's states: the one it is in
    const state = annot.lookupMaybe(PDFName.of("AS"), PDFName);
    if (!state) return null;
    ref = normal.get(state);
    normal = normal.lookup(state);
  }
  if (!(normal instanceof PDFStream)) return null;
  const bbox = numbers(normal.dict, "BBox", 4);
  const rect = numbers(annot, "Rect", 4);
  if (!bbox || !rect) return null;
  const cm = appearanceMatrix(bbox, numbers(normal.dict, "Matrix", 6) ?? [1, 0, 0, 1, 0, 0], rect);
  if (!cm) return null;
  const name = page.node.newXObject("Annot", ref instanceof PDFRef ? ref : doc.context.register(normal));
  return [pushGraphicsState(), concatTransformationMatrix(...cm), drawObject(name), popGraphicsState()];
}

/**
 * The page's resources as its own, to add appearances to: a copy (and of its XObjects), since they may be another
 * page's as well — inherited from the page tree, or one object several pages point at — and each page embedded
 * copies all of its resources: the other pages' would carry these appearances too, undrawn.
 */
function ownResources(doc: PDFDocument, page: PDFPage) {
  const { context } = doc;
  const res = page.node.Resources();
  const own = res ? res.clone(context) : context.obj({});
  const xo = res?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  own.set(PDFName.of("XObject"), xo ? xo.clone(context) : context.obj({}));
  page.node.set(PDFName.of("Resources"), own);
}

/**
 * Paint the page's printing annotations into its content, after what it draws, and take its /Annots away (the
 * reader embeds the content alone; nothing is left to draw twice). A page with nothing but annotations gets a
 * content of its own — no longer a blank page. Returns how many were painted.
 */
export function flattenAnnotations(doc: PDFDocument, page: PDFPage): number {
  let annots: PDFArray | undefined;
  try {
    annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  } catch {
    annots = undefined; // not an array: nothing that can be followed
  }
  page.node.delete(PDFName.of("Annots"));
  if (!annots || annots.size() === 0) return 0;
  try {
    ownResources(doc, page);
  } catch {
    return 0; // resources that are not a dictionary: the page as it is (its decode decides)
  }
  const ops: PDFOperator[] = [];
  let painted = 0;
  for (let i = 0; i < annots.size(); i++) {
    try {
      const drawn = paint(doc, page, annots.lookup(i, PDFDict));
      if (drawn) {
        ops.push(...drawn);
        painted++;
      }
    } catch {
      // a malformed annotation (no /Rect, a /BBox that is not numbers, a broken reference): skipped
    }
  }
  if (painted === 0) return 0;
  const { context } = doc;
  // the page's own content between q … Q, so whatever it leaves in the graphics state does not move these
  const after = context.register(context.contentStream([popGraphicsState(), ...ops]));
  if (page.node.Contents()) page.node.wrapContentStreams(context.register(context.contentStream([pushGraphicsState()])), after);
  else page.node.addContentStream(context.register(context.contentStream(ops)));
  return painted;
}
