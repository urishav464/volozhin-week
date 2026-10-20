// A PNG on its way into the reader (src/reader/readable.ts): pdf-lib decodes it
// with its own inflater (@pdf-lib/upng), and that one never stops on image data
// cut short — a partial download, a half-synced file, a screenshot whose save
// crashed: it reads past the end as zeros, looking for a last block that never
// comes, and the reader's worker hangs without a word. So the image data is
// inflated here first, with fflate, which says «unexpected EOF» at once; a PNG
// it cannot inflate is named, never handed to pdf-lib.

import { inflateSync } from "fflate";

/** The bytes start with PNG's signature. */
export const looksPng = (b: Uint8Array) =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;

/** Channels per pixel, by colour type — and the bit depths each one allows (PNG §11.2.2). */
const CHANNELS: Record<number, [number, number[]]> = { 0: [1, [1, 2, 4, 8, 16]], 2: [3, [8, 16]], 3: [1, [1, 2, 4, 8]], 4: [2, [8, 16]], 6: [4, [8, 16]] };

/**
 * Does this PNG's image data inflate to its end — what pdf-lib's decoder needs to come back at all? The chunks
 * are walked from the signature: IHDR first; the IDAT chunks' data gathered (the last one may be cut short —
 * the inflate decides); up to IEND. Then the data is inflated after its zlib header, into a buffer of the
 * image's own size when it is not interlaced (Adam7: as it comes) — so a large screenshot costs its size once.
 * Refused besides, as they would also hang the decoder or never draw: a text chunk whose fields do not end
 * inside it (the decoder looks for their end past the file's), and an animation's frames (pdf-lib draws none).
 */
export function pngInflates(b: Uint8Array): boolean {
  if (!looksPng(b)) return false;
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const type = (o: number) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
  if (b.length < 8 + 8 + 13 || type(8) !== "IHDR" || u32(8) < 13) return false;
  const width = u32(16);
  const height = u32(20);
  const depth = b[24];
  const colour = CHANNELS[b[25]];
  const interlaced = b[28];
  if (!width || !height || !colour || !colour[1].includes(depth) || interlaced > 1) return false;
  const idat: Uint8Array[] = [];
  for (let o = 8; o + 8 <= b.length; ) {
    const t = type(o);
    const from = o + 8;
    const to = Math.min(from + u32(o), b.length);
    if (t === "IDAT") idat.push(b.subarray(from, to));
    else if ((t === "tEXt" || t === "iTXt") && !textEnds(b, from, to, t === "iTXt")) return false;
    else if (t === "fdAT") return false;
    if (t === "IEND") break;
    o = from + u32(o) + 4;
  }
  const size = idat.reduce((n, d) => n + d.length, 0);
  if (size <= 2) return false; // a zlib header and nothing after it: no image at all
  const data = new Uint8Array(size);
  let at = 0;
  for (const d of idat) {
    data.set(d, at);
    at += d.length;
  }
  try {
    // after its two-byte header, as pdf-lib's decoder reads it (nor does it check the trailing checksum)
    const raw = data.subarray(2);
    const rowBytes = Math.ceil((width * depth * colour[0]) / 8);
    inflateSync(raw, interlaced ? undefined : { out: new Uint8Array((rowBytes + 1) * height) });
    return true;
  } catch {
    return false;
  }
}

/** tEXt: keyword\0 text; iTXt: keyword\0, two flag bytes, language\0, translated keyword\0, text — as the decoder reads them. */
function textEnds(b: Uint8Array, from: number, to: number, international: boolean): boolean {
  const zero = (at: number) => {
    const z = b.indexOf(0, at);
    return z >= 0 && z < to ? z : -1;
  };
  const keyword = zero(from);
  if (keyword < 0 || !international) return keyword >= 0;
  const language = zero(keyword + 3);
  return language >= 0 && zero(language + 1) >= 0;
}
