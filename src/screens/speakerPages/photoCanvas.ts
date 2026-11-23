// The browser's part of the guests' photo (the reset, phase 5): a picture a member chose, decoded, drawn on a canvas and
// saved as JPEG by src/domain/photoFit.ts's loop until it fits what set_speaker_photo takes. Not unit-tested (no canvas
// in node); the e2e round sends real pictures through it.
//
// - A file over 25MB, or a picture over 40 megapixels (its header read first when it says, then the decoded size), is
//   refused before anything is drawn — a phone's memory.
// - Decoded by createImageBitmap with the EXIF orientation applied; where that fails (an old engine, an option it does
//   not know), by an <img>, which every current browser also turns upright. Never turned by hand (jpegOrientation would
//   turn it twice).
// - Reduced once to a base canvas whose long side is at most 1024 (halving first, for quality), every try drawn from it
//   on white (a transparent PNG comes out white, not black), smoothing «high».
// - The bytes stay in memory — React state on the page, never localStorage or IndexedDB.
import { type FitFailure, type FittedPhoto, fitPhoto, pictureSize, type RawEncode, scaledSize } from "../../domain/photoFit";

export const PICK_MAX_BYTES = 25 * 1024 * 1024;
export const PICK_MAX_PIXELS = 40_000_000;
/** The base canvas's long side: twice the photo's at most — enough for a smooth reduction, small for the tries. */
const BASE_SIDE = 1024;
/** How much of the file is read for its header (a phone's metadata comes before the frame). */
const HEAD_BYTES = 1 << 20;

export type PrepareFailure = "file_too_big" | "too_many_pixels" | "no_decode" | FitFailure;

/** What the page says beside the photo, in its own words (errors.ts has none of these: nothing was sent). */
export const PREPARE_TEXT: Record<PrepareFailure, string> = {
  file_too_big: "הקובץ גדול מדי: עד 25MB. אפשר לבחור תמונה קטנה יותר.",
  too_many_pixels: "התמונה גדולה מדי: עד 40 מגה-פיקסל. אפשר להקטין אותה ולנסות שוב.",
  no_decode: "הדפדפן לא הצליח לפתוח את התמונה (למשל HEIC במחשב). שומרים אותה כ-JPEG ומנסים שוב.",
  too_complex: "התמונה מורכבת מדי גם בגודל קטן. אפשר לנסות תמונה אחרת.",
  refused: "הדפדפן הזה שומר JPEG בצורה שהשרת לא מקבל. אפשר לנסות ב-Chrome או ב-Firefox.",
  no_jpeg: "הדפדפן הזה שומר JPEG בצורה שהשרת לא מקבל. אפשר לנסות ב-Chrome או ב-Firefox.",
};

interface Decoded {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bmp.width > 0 && bmp.height > 0) return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
      bmp.close();
    } catch {
      // on to the <img>
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    }
  } catch {
    // not a picture this browser draws
  }
  URL.revokeObjectURL(url);
  return null;
}

/** A w×h canvas with `from` drawn on white, or null (no 2D context: out of memory). */
function drawn(from: CanvasImageSource, w: number, h: number): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(from, 0, 0, w, h);
  return c;
}

/** A canvas's memory back at once (Safari keeps it until collected otherwise). */
function release(c: HTMLCanvasElement | null) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

const jpegOf = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob | null>((resolve) => {
    try {
      c.toBlob(resolve, "image/jpeg", q);
    } catch {
      resolve(null);
    }
  });

/**
 * The chosen file as the photo to send, or why not. The result's bytes are exactly what the page previews and sends
 * (photoFit: ≤ 512px, ≤ 20480 bytes, photoOk).
 */
export async function preparePhoto(file: Blob): Promise<FittedPhoto | PrepareFailure> {
  if (file.size > PICK_MAX_BYTES) return "file_too_big";
  try {
    const said = pictureSize(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()));
    if (said && said.width * said.height > PICK_MAX_PIXELS) return "too_many_pixels";
  } catch {
    // the decoder will tell
  }
  const pic = await decode(file);
  if (!pic) return "no_decode";
  const steps: HTMLCanvasElement[] = [];
  let tryCanvas: { w: number; h: number; c: HTMLCanvasElement | null } | null = null;
  try {
    if (pic.width * pic.height > PICK_MAX_PIXELS) return "too_many_pixels";
    // halve while the picture is more than twice the base, then once to the base
    let from: CanvasImageSource = pic.image;
    let [w, h] = [pic.width, pic.height];
    while (Math.max(w, h) > BASE_SIDE * 2) {
      [w, h] = [Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))];
      const c = drawn(from, w, h);
      if (!c) return "no_decode";
      steps.push(c);
      from = c;
    }
    const size = scaledSize(w, h, BASE_SIDE);
    const base = drawn(from, size.width, size.height);
    if (!base) return "no_decode";
    steps.push(base);
    // one canvas per size: the quality steps at one size draw it once
    const raw: RawEncode = async (tw, th, q) => {
      if (!tryCanvas || tryCanvas.w !== tw || tryCanvas.h !== th) {
        release(tryCanvas?.c ?? null);
        tryCanvas = { w: tw, h: th, c: drawn(base, tw, th) };
      }
      if (!tryCanvas.c) return null;
      const blob = await jpegOf(tryCanvas.c, q);
      if (!blob || blob.type !== "image/jpeg") return null;
      return new Uint8Array(await blob.arrayBuffer());
    };
    return await fitPhoto({ width: pic.width, height: pic.height }, raw);
  } catch {
    return "no_decode";
  } finally {
    release((tryCanvas as { c: HTMLCanvasElement | null } | null)?.c ?? null);
    for (const c of steps) release(c);
    pic.close();
  }
}
