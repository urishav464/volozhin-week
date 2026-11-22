// v19's photo grammar (photoOk ≡ app.photo_ok) on the byte-built fixtures, segment by segment, and the base64 both
// ways (set_speaker_photo's decode, get_speaker_photo's encode) — tests/parity runs the same bytes through the SQL.
import { describe, expect, it } from "vitest";
import { DEMO_PHOTO_SIZE, demoPhotoBytes } from "../data/demoPhoto";
import { nonCanonical, PHOTO_FIXTURES, photoBase64, photoBytes, photoName } from "../testing/photos";
import { guestPhotoSrc, PHOTO_DATA_PREFIX, PHOTO_LIMITS, photoDataUrl, photoFromBase64, photoOk, photoToBase64 } from "./photo";

/** The demo's file with one segment's bytes changed: `at` the segment's marker (FF m), the change made by `edit`. */
function withSegment(marker: number, edit: (b: Uint8Array, at: number) => void): Uint8Array {
  const b = demoPhotoBytes();
  const at = b.findIndex((x, i) => i >= 2 && x === 0xff && b[i + 1] === marker);
  if (at < 0) throw new Error(`no segment ${marker.toString(16)}`);
  edit(b, at);
  return b;
}

/** A segment inserted right after SOI. */
const insertAfterSoi = (seg: number[]) => {
  const b = demoPhotoBytes();
  return new Uint8Array([0xff, 0xd8, ...seg, ...b.slice(2)]);
};

describe("photoOk (≡ app.photo_ok)", () => {
  it("accepts the clean fixture and refuses every other one", () => {
    expect(Object.fromEntries(PHOTO_FIXTURES.map((n) => [n, photoOk(photoBytes(n))]))).toEqual({
      clean: true, exif: false, progressive: false, trailer: false, big: false, garbage: false,
    });
  });

  it("the clean photo is the demo's: a 32×16 baseline JPEG of 160 bytes — not a multiple of three, so its base64 pads", () => {
    const b = photoBytes("clean");
    expect(b).toEqual(demoPhotoBytes());
    expect(b.length).toBe(160);
    expect(b.length % 3).not.toBe(0);
    const sof = b.findIndex((x, i) => x === 0xff && b[i + 1] === 0xc0);
    expect([(b[sof + 5] << 8) | b[sof + 6], (b[sof + 7] << 8) | b[sof + 8]]).toEqual([DEMO_PHOTO_SIZE.height, DEMO_PHOTO_SIZE.width]);
    expect(photoBase64("clean").endsWith("==")).toBe(true);
  });

  it("the big fixture is sound but for its size; the size limits are 100 … 20480 bytes", () => {
    expect(photoBytes("big").length).toBe(21000);
    // the same structure cut back to the limit passes: only the size refused it
    const big = photoBytes("big");
    const cut = new Uint8Array([...big.slice(0, PHOTO_LIMITS.maxBytes - 2), 0xff, 0xd9]);
    expect(photoOk(cut)).toBe(true);
    expect(photoOk(new Uint8Array([...big.slice(0, PHOTO_LIMITS.maxBytes - 1), 0xff, 0xd9]))).toBe(false);
    expect(photoOk(new Uint8Array(0))).toBe(false);
    expect(photoOk(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(false); // under 100
  });

  it("only APP0 «JFIF», APP14, DQT, DHT and DRI before the scan — any other marker, a comment, metadata, refused", () => {
    expect(photoOk(insertAfterSoi([0xff, 0xee, 0x00, 0x04, 0x00, 0x00]))).toBe(true); // APP14
    expect(photoOk(insertAfterSoi([0xff, 0xdd, 0x00, 0x04, 0x00, 0x00]))).toBe(true); // DRI
    for (const m of [0xe1, 0xe2, 0xed, 0xef, 0xfe, 0xc2, 0xc3, 0xcc, 0xd8]) {
      expect(photoOk(insertAfterSoi([0xff, m, 0x00, 0x04, 0x00, 0x00])), m.toString(16)).toBe(false);
    }
    // APP0 must say JFIF\0
    expect(photoOk(withSegment(0xe0, (b, at) => (b[at + 4] = 0x4b)))).toBe(false);
    expect(photoOk(withSegment(0xe0, (b, at) => (b[at + 8] = 0x20)))).toBe(false);
  });

  it("a segment's length: at least 2 and inside the file; no fill bytes between segments", () => {
    expect(photoOk(withSegment(0xdb, (b, at) => (b[at + 3] = 0x01)))).toBe(false); // a length of 1
    expect(photoOk(withSegment(0xdb, (b, at) => (b[at + 2] = 0x7f)))).toBe(false); // past the end
    expect(photoOk(insertAfterSoi([0xff]))).toBe(false); // a fill byte
  });

  it("exactly one baseline frame (SOF0 or SOF1) of 1 … 512 pixels a side, before the one scan", () => {
    expect(photoOk(withSegment(0xc0, (b, at) => (b[at + 1] = 0xc1)))).toBe(true); // SOF1: extended sequential
    const side = (h: number, w: number) => withSegment(0xc0, (b, at) => {
      b[at + 5] = h >> 8;
      b[at + 6] = h & 0xff;
      b[at + 7] = w >> 8;
      b[at + 8] = w & 0xff;
    });
    expect(photoOk(side(512, 512))).toBe(true);
    expect(photoOk(side(513, 16))).toBe(false);
    expect(photoOk(side(16, 513))).toBe(false);
    expect(photoOk(side(0, 16))).toBe(false);
    expect(photoOk(side(16, 0))).toBe(false);
    // two frames
    const b = demoPhotoBytes();
    const sof = b.findIndex((x, i) => x === 0xff && b[i + 1] === 0xc0);
    const seg = [...b.slice(sof, sof + 2 + ((b[sof + 2] << 8) | b[sof + 3]))];
    expect(photoOk(new Uint8Array([...b.slice(0, sof), ...seg, ...b.slice(sof)]))).toBe(false);
    // a scan before any frame
    const noFrame = new Uint8Array([...b.slice(0, sof), ...b.slice(sof + seg.length)]);
    expect(photoOk(noFrame)).toBe(false);
  });

  it("in the scan's data FF only before 00 or a restart marker; the last two bytes FFD9, nothing after", () => {
    const b = demoPhotoBytes();
    const end = b.length - 2;
    const put = (bytes: number[]) => new Uint8Array([...b.slice(0, end), ...bytes, 0xff, 0xd9]);
    expect(photoOk(put([0xff, 0x00]))).toBe(true);
    expect(photoOk(put([0xff, 0xd0, 0x00, 0xff, 0xd7]))).toBe(true);
    expect(photoOk(put([0xff, 0xd8]))).toBe(false);
    expect(photoOk(put([0xff, 0xda]))).toBe(false); // a second scan
    expect(photoOk(put([0xff]))).toBe(false); // an FF right before the end marker
    expect(photoOk(new Uint8Array([...b, 0x00]))).toBe(false); // after the end
    expect(photoOk(new Uint8Array([...b.slice(0, -1), 0xd8]))).toBe(false); // no end marker
  });
});

describe("the photo as base64 (set_speaker_photo / get_speaker_photo)", () => {
  it("round-trips every fixture's bytes, canonical, without newlines", () => {
    for (const n of PHOTO_FIXTURES) {
      const b = photoBytes(n);
      const s = photoToBase64(b);
      expect(s).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
      expect(s.length).toBe(Math.ceil(b.length / 3) * 4);
      expect(Buffer.from(s, "base64").equals(Buffer.from(b)), n).toBe(true);
      expect(s).toBe(Buffer.from(b).toString("base64"));
    }
    // a length of each remainder
    for (const len of [1, 2, 3, 4, 5, 6]) {
      const b = new Uint8Array(len).map((_, i) => (i * 97 + 13) & 0xff);
      expect(photoToBase64(b)).toBe(Buffer.from(b).toString("base64"));
    }
  });

  it("reads only what passes photoOk; the length, the alphabet and the padding first", () => {
    const clean = photoBase64("clean");
    expect(photoFromBase64(clean)).toEqual(photoBytes("clean"));
    for (const n of ["exif", "progressive", "trailer", "big", "garbage"] as const) expect(photoFromBase64(photoBase64(n)), n).toBeNull();
    expect(photoFromBase64("")).toBeNull();
    expect(photoFromBase64("abc")).toBeNull(); // not a multiple of four
    expect(photoFromBase64(`${clean.slice(0, 40)} ${clean.slice(41)}`)).toBeNull(); // a space
    expect(photoFromBase64(`${clean.slice(0, 40)}-${clean.slice(41)}`)).toBeNull(); // the URL alphabet
    expect(photoFromBase64(`${clean.slice(0, -4)}A===`)).toBeNull(); // three «=»
    expect(photoFromBase64(`=${clean.slice(1)}`)).toBeNull(); // «=» inside
    expect(photoFromBase64(`${clean}\n`)).toBeNull(); // a newline
    expect(photoFromBase64(null)).toBeNull();
    expect(photoFromBase64(42)).toBeNull();
    expect(photoFromBase64("A".repeat(PHOTO_LIMITS.maxBase64 + 4))).toBeNull(); // too long before anything is decoded
    expect(PHOTO_LIMITS.maxBase64).toBe(Math.ceil(PHOTO_LIMITS.maxBytes / 3) * 4);
  });

  it("padding bits that are not zero decode to the same bytes (as Postgres's decode) — and are written back canonical", () => {
    const clean = photoBase64("clean");
    const odd = nonCanonical(clean);
    expect(odd).not.toBe(clean);
    expect(odd.length).toBe(clean.length);
    const bytes = photoFromBase64(odd)!;
    expect(bytes).toEqual(photoBytes("clean"));
    expect(photoToBase64(bytes)).toBe(clean);
    expect(photoName(bytes)).toBe("clean");
    expect(() => nonCanonical(photoToBase64(new Uint8Array(3)))).toThrow(); // no padding: no bits to set
  });

  it("no fixture's base64 holds «500» or a run of seven digits (links.test asserts neither appears anywhere)", () => {
    for (const n of PHOTO_FIXTURES) {
      const s = photoBase64(n);
      expect(s, n).not.toContain("500");
      expect(s, n).not.toMatch(/\d{7}/);
      const odd = s.endsWith("=") ? nonCanonical(s) : s;
      expect(odd, n).not.toContain("500");
      expect(odd, n).not.toMatch(/\d{7}/);
    }
  });

  it("names bytes by fixture, else by length; a data URL for an <img>", () => {
    expect(photoName(photoBytes("exif"))).toBe("exif");
    expect(photoName(new Uint8Array(7))).toBe("bytes:7");
    expect(photoDataUrl("QUJD")).toBe(`${PHOTO_DATA_PREFIX}QUJD`);
    expect(PHOTO_DATA_PREFIX).toBe("data:image/jpeg;base64,");
  });
});

describe("guestPhotoSrc (the guests' card, the reset, phase 5)", () => {
  it("draws schedule_view's data URL of a photo the database would store — the same string back", () => {
    const url = photoDataUrl(photoBase64("clean"));
    expect(guestPhotoSrc(url)).toBe(url);
    expect(guestPhotoSrc(photoDataUrl(nonCanonical(photoBase64("clean"))))).toBe(photoDataUrl(nonCanonical(photoBase64("clean"))));
  });

  it("refuses any other photo: one photoOk refuses, a payload that is no base64, another type, an address of its own", () => {
    for (const n of ["exif", "progressive", "trailer", "big", "garbage"] as const) expect(guestPhotoSrc(photoDataUrl(photoBase64(n))), n).toBeNull();
    const clean = photoBase64("clean");
    for (const v of [
      "data:image/jpeg;base64,/9j/AAAA", // a JPEG's first bytes, no photo
      `data:image/png;base64,${clean}`,
      `data:image/jpeg,${clean}`,
      `DATA:image/jpeg;base64,${clean}`,
      ` ${photoDataUrl(clean)}`,
      `${photoDataUrl(clean)}#x`,
      photoDataUrl(`${clean}\n`),
      "https://example.org/x.jpg",
      "//example.org/x.jpg",
      "/x.jpg",
      clean, // the bare base64 (get_speaker_photo's shape) is not an <img> source
      PHOTO_DATA_PREFIX,
      "",
    ])
      expect(guestPhotoSrc(v), v.slice(0, 40)).toBeNull();
    for (const v of [null, undefined, 42, {}, [photoDataUrl(clean)]]) expect(guestPhotoSrc(v)).toBeNull();
  });
});
