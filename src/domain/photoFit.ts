// The guests' photo, fitted (the reset, phase 5) — what the speaker page sends to set_speaker_photo. The picture a
// member chose is drawn on a canvas and saved as JPEG, again and again, until it fits the database's rule: at most
// 512px a side (never larger than the picture itself: no upscaling), at most 20480 bytes, and photoOk (≡ app.photo_ok)
// — baseline, no metadata. Every candidate is stripped of what a browser may still write into it (Safari's APP1/APP2:
// src/reader/jpeg.ts `stripJpegMetadata`) BEFORE it is measured, and checked by photoOk, so only bytes the database
// takes are ever returned — the loop never trusts the size to grow smoothly with the quality.
//
// Pure: the encoder is passed in (`RawEncode` — src/screens/speakerPages/photoCanvas.ts draws the canvas; the unit
// tests pass a model of one). The loop, from the largest side allowed:
//   1. the high quality: fits → done; no JPEG at all, or bytes photoOk refuses → done (a smaller canvas changes nothing);
//   2. the low quality: still too big → a smaller side, from how far over it is (never below `minSide`: then
//      «too_complex»), and back to 1;
//   3. the low quality fits → up to `bisect` steps between the two, keeping the highest quality that FITS.
// At most `maxTries` encodes in all (a phone takes ≈ 0.05 s for one at 512px).
import { stripJpegMetadata } from "../reader/jpeg";
import { PHOTO_LIMITS, photoOk, photoToBase64 } from "./photo";

/** The canvas's JPEG of the picture at w×h and quality q (0–1), or null when the browser wrote no JPEG. */
export type RawEncode = (w: number, h: number, q: number) => Promise<Uint8Array | null>;

export interface FitOptions {
  /** The longest side allowed (PHOTO_LIMITS.maxSide). */
  maxSide: number;
  /** Below this the picture is not made smaller: «too_complex». */
  minSide: number;
  qHigh: number;
  qLow: number;
  /** Steps between qLow and qHigh once qLow fits. */
  bisect: number;
  maxTries: number;
  /** Bytes (PHOTO_LIMITS.maxBytes). */
  budget: number;
}

export const FIT: FitOptions = { maxSide: PHOTO_LIMITS.maxSide, minSide: 96, qHigh: 0.86, qLow: 0.42, bisect: 3, maxTries: 12, budget: PHOTO_LIMITS.maxBytes };

export interface FittedPhoto {
  /** Exactly what is sent (and shown in the preview). */
  bytes: Uint8Array;
  /** Canonical base64 of `bytes` — set_speaker_photo's p_photo. */
  base64: string;
  width: number;
  height: number;
  quality: number;
  /** Encodes it took. */
  tries: number;
}

/**
 * Why nothing fits: the browser wrote no JPEG (`no_jpeg`); it wrote one photoOk refuses even stripped — a progressive
 * frame, a JFXX thumbnail, a size other than asked (`refused`); or the picture is too big even at the smallest side
 * and the lowest quality, or the tries ran out (`too_complex`).
 */
export type FitFailure = "no_jpeg" | "refused" | "too_complex";

/** w×h inside side×side, the proportions kept, never upscaled, each side at least 1 — rounded. */
export function scaledSize(w: number, h: number, side: number): { width: number; height: number } {
  const k = Math.min(1, side / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/**
 * A JPEG's size from its frame header (any SOF0–SOF15 but DHT, JPG, DAC), walking the segments from the start; null
 * when the bytes are not a JPEG or end before the frame. Also enough of a file's first bytes (the picker's guard: the
 * frame comes after the metadata, which a phone keeps under 64KB a segment).
 */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) {
      i += 1; // a fill byte
      continue;
    }
    if (m === 0xd8 || m === 0xd9 || m === 0xda) return null; // no frame before the image data
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2; // a marker without a length
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 9 > b.length || len < 8) return null;
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

/** A PNG's size from its IHDR (the first chunk); null when the bytes are not a PNG. */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((x, i) => b[i] !== x)) return null;
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null; // «IHDR»
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const width = u32(16);
  const height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * A WebP's canvas from its first chunk: «VP8 » (lossy — the frame's 14-bit sides after the start code 9d 01 2a), «VP8L»
 * (lossless — 14 bits each, minus one, after the signature 0x2f) or «VP8X» (extended — 24 bits each, minus one). A
 * lossless WebP of one colour at 16383×16383 is a few KB: read here, it is refused before the browser decodes ~1GB.
 */
export function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 30 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const u16 = (o: number) => b[o] | (b[o + 1] << 8);
  const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  let width = 0;
  let height = 0;
  switch (tag(12)) {
    case "VP8 ":
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      width = u16(26) & 0x3fff;
      height = u16(28) & 0x3fff;
      break;
    case "VP8L": {
      if (b[20] !== 0x2f) return null;
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      break;
    }
    case "VP8X":
      width = u24(24) + 1;
      height = u24(27) + 1;
      break;
    default:
      return null;
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * An AVIF's or a HEIF's (HEIC) size: an ISO-BMFF file («ftyp» at 4) states each image's in an «ispe» box (version and
 * flags, then width and height, 32 bits each) — the largest found in the first bytes is the one checked (a grid's whole
 * picture is larger than its tiles). One whose boxes come after the bytes read is decoded first (DECISIONS).
 */
export function heifSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 12 || b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) return null; // «ftyp»
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  let best: { width: number; height: number } | null = null;
  for (let i = 8; i + 16 <= b.length; i++) {
    if (b[i] !== 0x69 || b[i + 1] !== 0x73 || b[i + 2] !== 0x70 || b[i + 3] !== 0x65) continue; // «ispe»
    if (u32(i - 4) < 20) continue; // not a box of its own
    const width = u32(i + 8);
    const height = u32(i + 12);
    if (width > 0 && height > 0 && (!best || width * height > best.width * best.height)) best = { width, height };
  }
  return best;
}

/**
 * A picture's size from a file's first bytes, when it says it there (a JPEG, a PNG, a WebP, an AVIF/HEIF); else null —
 * the decoder will tell (a GIF or a BMP: the browser refuses or the 25MB cap bounds it — DECISIONS «ביקורת»).
 */
export const pictureSize = (head: Uint8Array) => jpegSize(head) ?? pngSize(head) ?? webpSize(head) ?? heifSize(head);

type Verdict = { kind: "fits"; bytes: Uint8Array } | { kind: "big"; length: number } | { kind: "no_jpeg" } | { kind: "refused" };

/**
 * The best JPEG of a picture of `src`'s size that the database takes (see the top of this file), or why there is none.
 * Only ever returns bytes that are ≤ `budget` and pass photoOk, whose frame says exactly the size asked.
 */
export async function fitPhoto(src: { width: number; height: number }, raw: RawEncode, opts: FitOptions = FIT): Promise<FittedPhoto | FitFailure> {
  let tries = 0;
  const encode = async (w: number, h: number, q: number): Promise<Verdict> => {
    tries++;
    const out = await raw(w, h, q);
    if (out == null) return { kind: "no_jpeg" };
    const b = stripJpegMetadata(out);
    if (b == null) return { kind: "no_jpeg" };
    if (b.length > opts.budget) return { kind: "big", length: b.length };
    const size = jpegSize(b);
    if (!photoOk(b) || size == null || size.width !== w || size.height !== h) return { kind: "refused" };
    return { kind: "fits", bytes: b };
  };
  const done = (bytes: Uint8Array, w: number, h: number, quality: number): FittedPhoto => ({ bytes, base64: photoToBase64(bytes), width: w, height: h, quality, tries });

  let side = Math.min(opts.maxSide, Math.max(src.width, src.height));
  while (tries < opts.maxTries) {
    const { width: w, height: h } = scaledSize(src.width, src.height, side);
    const high = await encode(w, h, opts.qHigh);
    if (high.kind === "fits") return done(high.bytes, w, h, opts.qHigh);
    if (high.kind !== "big") return high.kind;
    if (tries >= opts.maxTries) break;
    const low = await encode(w, h, opts.qLow);
    if (low.kind === "no_jpeg" || low.kind === "refused") return low.kind;
    if (low.kind === "big") {
      if (side <= opts.minSide) return "too_complex";
      const k = Math.min(0.85, Math.max(0.5, 0.92 * Math.sqrt(opts.budget / low.length)));
      side = Math.max(opts.minSide, Math.floor(side * k));
      continue;
    }
    // the low quality fits: the highest quality between the two that also fits
    let best = done(low.bytes, w, h, opts.qLow);
    let [lo, hi] = [opts.qLow, opts.qHigh];
    for (let step = 0; step < opts.bisect && tries < opts.maxTries; step++) {
      const mid = Math.round(((lo + hi) / 2) * 1000) / 1000;
      const v = await encode(w, h, mid);
      if (v.kind === "fits") {
        best = done(v.bytes, w, h, mid);
        lo = mid;
      } else hi = mid;
    }
    return { ...best, tries };
  }
  return "too_complex";
}
