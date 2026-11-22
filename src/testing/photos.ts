// v19's photo fixtures — synthetic JPEGs built byte by byte from the demo's (src/data/demoPhoto.ts), never a picture
// kept in git: the unit tests of photoOk and tests/parity send the same bytes to the engine and to app.photo_ok.
//   clean        the demo's 32×16 gray baseline JPEG — passes
//   exif         an APP1 «Exif» segment after APP0 — refused (metadata)
//   progressive  its SOF0 made SOF2 — refused (only baseline)
//   trailer      two bytes after the end marker — refused
//   big          its entropy data padded with zeros to 21000 bytes — refused (over 20480; the structure is sound)
//   garbage      300 bytes that are no JPEG — refused
// And, for the reset's phase 5 (the photo fitter, the upload through a canvas): `jpegOfSize` (a canvas's output of a
// given size, as a model) and `jpegWithOrientation` (a picture a browser draws, stored on its side).
import { demoPhotoBytes } from "../data/demoPhoto";
import { photoToBase64 } from "../domain/photo";

export const PHOTO_FIXTURES = ["clean", "exif", "progressive", "trailer", "big", "garbage"] as const;
export type PhotoFixture = (typeof PHOTO_FIXTURES)[number];

/** Where the clean file's scan header ends (its entropy data begins). */
function scanStart(b: Uint8Array): number {
  let i = 2;
  while (i + 4 <= b.length) {
    const len = (b[i + 2] << 8) | b[i + 3];
    if (b[i + 1] === 0xda) return i + 2 + len;
    i += 2 + len;
  }
  throw new Error("photos: no scan");
}

export function photoBytes(name: PhotoFixture): Uint8Array {
  const clean = demoPhotoBytes();
  switch (name) {
    case "clean":
      return clean;
    case "exif": {
      // after SOI (2) and APP0 (2 + its length)
      const at = 2 + 2 + ((clean[4] << 8) | clean[5]);
      const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00];
      const app1 = [0xff, 0xe1, 0x00, body.length + 2, ...body];
      return new Uint8Array([...clean.slice(0, at), ...app1, ...clean.slice(at)]);
    }
    case "progressive": {
      const out = clean.slice();
      const i = out.findIndex((x, k) => x === 0xff && out[k + 1] === 0xc0);
      out[i + 1] = 0xc2;
      return out;
    }
    case "trailer":
      return new Uint8Array([...clean, 0x00, 0x00]);
    case "big": {
      const s = scanStart(clean);
      const pad = new Array<number>(21000 - clean.length).fill(0x00);
      return new Uint8Array([...clean.slice(0, s), ...pad, ...clean.slice(s)]);
    }
    case "garbage": {
      // a fixed linear congruential run, its first byte not FF
      const out = new Uint8Array(300);
      let x = 7;
      for (let k = 0; k < out.length; k++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        out[k] = (x >> 16) & 0xff;
      }
      out[0] = 0x47;
      return out;
    }
  }
}

export const photoBase64 = (name: PhotoFixture): string => photoToBase64(photoBytes(name));

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * The same bytes in a base64 whose padding bits are not zero — the last character before the «=» with its lowest bit
 * set. Postgres's decode reads it as the same bytes; a canonical encoder never writes it. Throws when there is no
 * padding (a length that is a multiple of three has no padding bits).
 */
export function nonCanonical(b64: string): string {
  const m = /([A-Za-z0-9+/])(=+)$/.exec(b64);
  if (!m) throw new Error("photos: no padding bits to set");
  const v = ALPHABET.indexOf(m[1]);
  if (v & 1) throw new Error("photos: already non-canonical");
  return b64.slice(0, m.index) + ALPHABET[v | 1] + m[2];
}

/** A fixture's name for the bytes, or `bytes:N` — what parity's photos line and its readPhoto answer say. */
export function photoName(bytes: Uint8Array): string {
  for (const name of PHOTO_FIXTURES) {
    const f = photoBytes(name);
    if (f.length === bytes.length && f.every((x, i) => x === bytes[i])) return name;
  }
  return `bytes:${bytes.length}`;
}

/**
 * The reset, phase 5 — what a canvas would write, as the photo fitter's tests need it (src/domain/photoFit.test.ts): the
 * clean file with its frame saying w×h and its entropy data padded with zeros to `bytes` in all (legal for photoOk, as
 * `big` is; never decodable as w×h — only its structure is read). `exif` adds the APP1 of `exif` (a strip takes it
 * away), `progressive` makes the frame SOF2 (refused). A `bytes` below the file's own length gives the file as it is.
 */
export function jpegOfSize(w: number, h: number, bytes: number, extra?: "exif" | "progressive"): Uint8Array {
  const base = photoBytes(extra ?? "clean");
  const sof = base.findIndex((x, k) => x === 0xff && (base[k + 1] === 0xc0 || base[k + 1] === 0xc2));
  base[sof + 5] = h >> 8;
  base[sof + 6] = h & 0xff;
  base[sof + 7] = w >> 8;
  base[sof + 8] = w & 0xff;
  const s = scanStart(base);
  const out = new Uint8Array(Math.max(bytes, base.length)); // zeros: the padding
  out.set(base.subarray(0, s), 0);
  out.set(base.subarray(s), out.length - (base.length - s));
  return out;
}

/**
 * The demo's 32×16 JPEG (a picture a browser draws) with an EXIF orientation — 6: stored on its side, to be turned 90°
 * clockwise, so a browser that honours it draws 16×32. An APP1 «Exif» after APP0: a big-endian TIFF header and one
 * IFD entry, 0x0112 SHORT. For the e2e round's upload through the canvas (src/screens/speakerPages/photoCanvas.ts).
 */
export function jpegWithOrientation(orientation: number): Uint8Array {
  const clean = demoPhotoBytes();
  const at = 2 + 2 + ((clean[4] << 8) | clean[5]);
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08];
  const ifd = [0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff, ...ifd];
  const app1 = [0xff, 0xe1, 0x00, body.length + 2, ...body];
  return new Uint8Array([...clean.slice(0, at), ...app1, ...clean.slice(at)]);
}
