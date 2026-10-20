// A JPEG on its way into the reader (src/reader/assemble.ts): pdf-lib's
// embedJpg copies the file's bytes into the PDF as they are, so whatever a
// phone wrote into a photo — the place it was taken (GPS), the camera, the
// time, a thumbnail, a «motion photo»'s video after the image — would leave
// with the reader, which goes to a print shop and is passed around. So the
// photo is rebuilt from its own segments first, keeping only what draws the
// picture: the tables (DQT, DHT, DRI), the frame (SOF*), the scans (SOS and
// their data), APP0 (JFIF) and APP14 (Adobe's colour transform); APP1–APP13
// (EXIF, XMP, ICC, MPF, Photoshop), APP15 and comments are dropped, and so is
// anything after the end of the image. Its orientation is read before
// (jpegOrientation), so a sideways photo is still turned upright.

/** The bytes start like a JPEG (SOI and a marker). */
export const looksJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
/** The PNG check lives with the PNG (src/reader/png.ts); here for what imported it from here. */
export { looksPng } from "./png";

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

/** APP1–APP13, APP15 and COM: metadata, never the picture. */
const dropped = (m: number) => (m >= 0xe1 && m <= 0xed) || m === 0xef || m === 0xfe;

/**
 * The JPEG without its metadata (see the top of this file), or null when its structure cannot be followed (not
 * a JPEG, a segment that runs past the end, no frame or no scan) — the reader names such a file, never prints
 * half of it. A file cut short inside its image data keeps what there is and gets its end marker back: a
 * viewer shows the same. Stray bytes between two segments are passed over to the next marker, as libjpeg
 * does («extraneous bytes before marker») — and left behind.
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array | null {
  if (!looksJpeg(b)) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  const keep = (from: number, to: number) => parts.push(b.subarray(from, to));
  let frame = false;
  let scan = false;
  let i = 2;
  for (;;) {
    if (i >= b.length) {
      if (!scan) return null;
      parts.push(new Uint8Array([0xff, 0xd9])); // cut short after its data: the end marker back
      break;
    }
    if (b[i] !== 0xff) {
      i = nextMarker(b, i); // not a marker where one should be: on to the next one
      continue;
    }
    if (i + 1 >= b.length) return null;
    const m = b[i + 1];
    if (m === 0xff) {
      i += 1; // a fill byte before a marker
      continue;
    }
    if (m === 0x00) {
      i = nextMarker(b, i + 2); // FF 00 outside a scan is no marker either
      continue;
    }
    if (m === 0xd9) {
      keep(i, i + 2); // EOI — anything after it (a trailer, a motion photo's video) is left behind
      break;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      keep(i, i + 2); // markers without a length
      i += 2;
      continue;
    }
    if (m === 0xd8 || i + 3 >= b.length) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    const end = i + 2 + len;
    if (len < 2 || end > b.length) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) frame = true; // SOF0–SOF15 (not DHT, JPG, DAC)
    if (!dropped(m)) keep(i, end);
    i = end;
    if (m === 0xda) {
      if (!frame) return null;
      scan = true;
      // the entropy-coded data: up to the next marker that is not a stuffed byte (FF 00) or a restart (FF D0–D7) —
      // either may come after fill bytes (FF FF …), as a decoder reads them; fill bytes up to the end: cut short
      let j = i;
      while (j < b.length) {
        if (b[j] !== 0xff) {
          j++;
          continue;
        }
        let n = j + 1;
        while (n < b.length && b[n] === 0xff) n++;
        if (n >= b.length || b[n] === 0x00 || (b[n] >= 0xd0 && b[n] <= 0xd7)) {
          j = n + 1;
          continue;
        }
        break;
      }
      j = Math.min(j, b.length);
      keep(i, j);
      i = j;
    }
  }
  if (!frame || !scan) return null;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * From a byte that should have been a marker and is not: the next marker's FF (after any fill bytes), passing
 * over everything before it — FF 00 included — as libjpeg's next_marker does; the end when there is none.
 */
function nextMarker(b: Uint8Array, i: number): number {
  for (;;) {
    while (i < b.length && b[i] !== 0xff) i++;
    let n = i + 1;
    while (n < b.length && b[n] === 0xff) n++;
    if (n >= b.length) return b.length;
    if (b[n] !== 0x00) return n - 1;
    i = n + 1;
  }
}
