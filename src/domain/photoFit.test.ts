// The guests' photo fitter (src/domain/photoFit.ts) on a model of a canvas: a JPEG whose size grows with the area and
// the quality (620 + w·h·(0.25 + 3q²)·c/8 bytes, c the picture's complexity), built byte by byte (src/testing/photos.ts
// `jpegOfSize` — zeros for the image data: nothing for scan:pii). The cases name what the loop promises; the seeded run
// at the end holds the invariants on 2,000 random pictures, with a size that jumps ±12% from one encode to the next
// (never smooth in the quality, as a real encoder is not).
import { describe, expect, it } from "vitest";
import { jpegOrientation } from "../reader/jpeg";
import { jpegOfSize, jpegWithOrientation, photoBytes } from "../testing/photos";
import { PHOTO_LIMITS, photoFromBase64, photoOk } from "./photo";
import { FIT, type FittedPhoto, fitPhoto, heifSize, jpegSize, pictureSize, pngSize, type RawEncode, scaledSize, webpSize } from "./photoFit";

/** mulberry32: a small seeded generator — the same cases on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Call {
  w: number;
  h: number;
  q: number;
  bytes: number;
}

/**
 * Above this the model's file is cut to it: far enough over the budget that the loop's next side is already its
 * smallest step (×0.5 from 3.4 × the budget up), so no decision changes — and the run stays fast.
 */
const CAP = 4 * PHOTO_LIMITS.maxBytes;

/** The model canvas: every call recorded. `jitter` 0 is smooth; else each encode's size is off by up to ±jitter, at random. */
function canvas(c: number, opts: { jitter?: number; seed?: number; extra?: "exif" | "progressive" } = {}): { raw: RawEncode; calls: Call[] } {
  const next = rng(opts.seed ?? 1);
  const calls: Call[] = [];
  const raw: RawEncode = async (w, h, q) => {
    const j = 1 + (next() * 2 - 1) * (opts.jitter ?? 0);
    const bytes = Math.min(CAP, Math.round((620 + (w * h * (0.25 + 3 * q * q) * c) / 8) * j));
    calls.push({ w, h, q, bytes });
    return jpegOfSize(w, h, bytes, opts.extra);
  };
  return { raw, calls };
}

/** The same bytes (expect's deep equality is slow on thousands of 20KB arrays). */
const same = (a: Uint8Array | null, b: Uint8Array) => a != null && a.length === b.length && a.every((x, i) => x === b[i]);

const fitted = (r: Awaited<ReturnType<typeof fitPhoto>>): FittedPhoto => {
  if (typeof r === "string") throw new Error(`no photo: ${r}`);
  return r;
};

describe("the photo fitter (the reset, phase 5)", () => {
  it("scaledSize: inside the square, the proportions kept, never upscaled, never below 1", () => {
    expect(scaledSize(4000, 3000, 512)).toEqual({ width: 512, height: 384 });
    expect(scaledSize(3000, 4000, 512)).toEqual({ width: 384, height: 512 });
    expect(scaledSize(60, 40, 512)).toEqual({ width: 60, height: 40 });
    expect(scaledSize(1000, 1000, 300)).toEqual({ width: 300, height: 300 });
    expect(scaledSize(20000, 3, 512)).toEqual({ width: 512, height: 1 });
  });

  it("an easy picture: one encode, at the high quality, 4000×3000 → 512×384", async () => {
    const { raw, calls } = canvas(0.05);
    const r = fitted(await fitPhoto({ width: 4000, height: 3000 }, raw));
    expect(r).toMatchObject({ width: 512, height: 384, quality: FIT.qHigh, tries: 1 });
    expect(calls).toHaveLength(1);
    expect(r.bytes.length).toBeLessThanOrEqual(PHOTO_LIMITS.maxBytes);
    expect(jpegSize(r.bytes)).toEqual({ width: 512, height: 384 });
  });

  it("a medium one: the high quality is too big, the low one fits — the steps between keep the highest quality that fits", async () => {
    const { raw, calls } = canvas(0.6);
    const r = fitted(await fitPhoto({ width: 4000, height: 3000 }, raw));
    expect(r.tries).toBe(2 + FIT.bisect);
    expect(calls).toHaveLength(r.tries);
    expect(r.quality).toBeGreaterThan(FIT.qLow);
    expect(r.quality).toBeLessThan(FIT.qHigh);
    const fits = calls.filter((x) => x.bytes <= PHOTO_LIMITS.maxBytes);
    expect(r.quality).toBe(Math.max(...fits.map((x) => x.q)));
    expect(r.bytes.length).toBe(calls.find((x) => x.q === r.quality)!.bytes);
    expect([r.width, r.height]).toEqual([512, 384]);
  });

  it("a hard one: too big even at the low quality — a smaller side, then it fits", async () => {
    const { raw, calls } = canvas(3);
    const r = fitted(await fitPhoto({ width: 4000, height: 3000 }, raw));
    expect(r.width).toBeLessThan(512);
    expect(r.width).toBeGreaterThanOrEqual(FIT.minSide);
    expect(Math.abs(r.height - (r.width * 3) / 4)).toBeLessThanOrEqual(1);
    expect(r.bytes.length).toBeLessThanOrEqual(PHOTO_LIMITS.maxBytes);
    expect(photoOk(r.bytes)).toBe(true);
    // the side only shrinks
    const sides = calls.map((x) => x.w);
    expect(sides).toEqual([...sides].sort((a, b) => b - a));
    expect(r.tries).toBeLessThanOrEqual(FIT.maxTries);
  });

  it("an impossible one: «too_complex», within the tries", async () => {
    const { raw, calls } = canvas(1000);
    expect(await fitPhoto({ width: 4000, height: 3000 }, raw)).toBe("too_complex");
    expect(calls.length).toBeLessThanOrEqual(FIT.maxTries);
    expect(Math.min(...calls.map((x) => Math.max(x.w, x.h)))).toBe(FIT.minSide);
    // a canvas whose every answer is too big, whatever the size: the tries end it
    const always: RawEncode = async (w, h) => jpegOfSize(w, h, PHOTO_LIMITS.maxBytes + 1);
    let n = 0;
    expect(await fitPhoto({ width: 512, height: 512 }, (w, h, q) => (n++, always(w, h, q)))).toBe("too_complex");
    expect(n).toBeLessThanOrEqual(FIT.maxTries);
  });

  it("a small picture stays its size: 60×40 → 60×40", async () => {
    const r = fitted(await fitPhoto({ width: 60, height: 40 }, canvas(0.5).raw));
    expect([r.width, r.height]).toEqual([60, 40]);
    expect(jpegSize(r.bytes)).toEqual({ width: 60, height: 40 });
  });

  it("what a browser adds (an APP1 «Exif») is stripped before it is measured and sent", async () => {
    const { raw } = canvas(0.05, { extra: "exif" });
    const raw1 = await raw(512, 384, FIT.qHigh);
    expect(raw1!.some((x, i) => x === 0xff && raw1![i + 1] === 0xe1)).toBe(true);
    const r = fitted(await fitPhoto({ width: 4000, height: 3000 }, raw));
    expect(r.bytes.some((x, i) => x === 0xff && r.bytes[i + 1] === 0xe1)).toBe(false);
    expect(photoOk(r.bytes)).toBe(true);
  });

  it("a progressive JPEG is refused at once; no JPEG at all is «no_jpeg»; a size other than asked is refused", async () => {
    const prog = canvas(0.05, { extra: "progressive" });
    expect(await fitPhoto({ width: 4000, height: 3000 }, prog.raw)).toBe("refused");
    expect(prog.calls).toHaveLength(1);
    let n = 0;
    expect(await fitPhoto({ width: 4000, height: 3000 }, async () => (n++, null))).toBe("no_jpeg");
    expect(n).toBe(1);
    expect(await fitPhoto({ width: 4000, height: 3000 }, async () => photoBytes("garbage"))).toBe("no_jpeg");
    expect(await fitPhoto({ width: 4000, height: 3000 }, async (w, h) => jpegOfSize(w + 1, h, 2000))).toBe("refused");
  });

  it("the base64 is what set_speaker_photo decodes back to the same bytes", async () => {
    const r = fitted(await fitPhoto({ width: 1200, height: 900 }, canvas(0.6).raw));
    expect(photoFromBase64(r.base64)).toEqual(r.bytes);
  });

  it("a picture's size from a file's first bytes: a JPEG's frame (after its metadata), a PNG's IHDR; else null", () => {
    expect(jpegSize(photoBytes("clean"))).toEqual({ width: 32, height: 16 });
    expect(jpegSize(photoBytes("exif"))).toEqual({ width: 32, height: 16 });
    expect(jpegSize(photoBytes("progressive"))).toEqual({ width: 32, height: 16 });
    expect(jpegSize(jpegOfSize(4000, 3000, 900))).toEqual({ width: 4000, height: 3000 });
    expect(jpegSize(photoBytes("clean").slice(0, 30))).toBeNull(); // cut before the frame
    expect(jpegSize(photoBytes("garbage"))).toBeNull();
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x09, 0x60, 0, 0, 0x06, 0x40]);
    expect(pngSize(png)).toEqual({ width: 2400, height: 1600 });
    expect(pictureSize(png)).toEqual({ width: 2400, height: 1600 });
    expect(pictureSize(photoBytes("clean"))).toEqual({ width: 32, height: 16 });
    expect(pictureSize(new Uint8Array(40))).toBeNull();
  });

  it("a WebP's canvas from its first chunk (VP8, VP8L, VP8X), an AVIF/HEIF's from its «ispe» — a decoder bomb is read before it is decoded", () => {
    const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const riff = (chunk: string, data: number[]) => new Uint8Array([...tag("RIFF"), 0, 0, 0, 0, ...tag("WEBP"), ...tag(chunk), 0, 0, 0, 0, ...data, ...new Array(16).fill(0)]);
    const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
    const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
    // lossy: a frame tag (3 bytes), the start code, then 14-bit sides
    const vp8 = riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(640), ...le16(480)]);
    expect(webpSize(vp8)).toEqual({ width: 640, height: 480 });
    // lossless: 0x2f, then width−1 and height−1 in 14 bits each — one colour at 16383×16383 is a few KB
    const bits = (16383 - 1) | ((16383 - 1) << 14);
    const vp8l = riff("VP8L", [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff]);
    expect(webpSize(vp8l)).toEqual({ width: 16383, height: 16383 });
    expect(pictureSize(vp8l)!.width * pictureSize(vp8l)!.height).toBeGreaterThan(40_000_000);
    // extended: flags and three reserved bytes, then width−1 and height−1 in 24 bits each
    const vp8x = riff("VP8X", [0x10, 0, 0, 0, ...le24(8000 - 1), ...le24(8000 - 1)]);
    expect(webpSize(vp8x)).toEqual({ width: 8000, height: 8000 });
    expect(pictureSize(vp8x)).toEqual({ width: 8000, height: 8000 });
    expect(webpSize(riff("VP8 ", [0, 0, 0, 0, 0, 0, ...le16(640), ...le16(480)]))).toBeNull(); // no start code
    expect(webpSize(riff("ALPH", []))).toBeNull();
    expect(webpSize(photoBytes("clean"))).toBeNull();
    // AVIF/HEIF: «ftyp», then somewhere in the meta box an «ispe» (size, type, version+flags, width, height) — the largest wins
    const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    const ispe = (w: number, h: number) => [...be32(20), ...tag("ispe"), 0, 0, 0, 0, ...be32(w), ...be32(h)];
    const avif = new Uint8Array([...be32(28), ...tag("ftyp"), ...tag("avif"), 0, 0, 0, 0, ...tag("avifmif1"), ...be32(200), ...tag("meta"), 0, 0, 0, 0, ...ispe(512, 512), ...ispe(8000, 8000)]);
    expect(heifSize(avif)).toEqual({ width: 8000, height: 8000 });
    expect(pictureSize(avif)).toEqual({ width: 8000, height: 8000 });
    expect(heifSize(new Uint8Array([...be32(28), ...tag("ftyp"), ...tag("heic"), 0, 0, 0, 0]))).toBeNull(); // its boxes after the bytes read
    expect(heifSize(photoBytes("clean"))).toBeNull();
    expect(heifSize(vp8x)).toBeNull();
  });

  it("the e2e's sideways picture: EXIF orientation 6 on the demo's 32×16", () => {
    const b = jpegWithOrientation(6);
    expect(jpegOrientation(b)).toBe(6);
    expect(jpegSize(b)).toEqual({ width: 32, height: 16 });
    expect(photoOk(b)).toBe(false); // the metadata: what the canvas leaves behind
  });

  it("2,000 random pictures: never over 20480 bytes, always photoOk, each side ≤ 512 and ≤ the picture's, the proportions within 1px, ≤ 12 encodes", async () => {
    const next = rng(5787);
    const outcomes = { fitted: 0, too_complex: 0 };
    for (let k = 0; k < 2000; k++) {
      // sides from 1 to 6000, often very unequal; complexity from flat to noise, log-uniform
      const side = () => Math.max(1, Math.round(Math.exp(next() * Math.log(6000))));
      const [width, height] = [side(), side()];
      const c = Math.exp(Math.log(0.005) + next() * (Math.log(200) - Math.log(0.005)));
      const { raw, calls } = canvas(c, { jitter: 0.12, seed: k + 1 });
      const r = await fitPhoto({ width, height }, raw);
      const at = `case ${k}: ${width}×${height}, c=${c.toFixed(3)}`;
      expect(calls.length, at).toBeLessThanOrEqual(FIT.maxTries);
      if (typeof r === "string") {
        expect(r, at).toBe("too_complex");
        outcomes.too_complex++;
        continue;
      }
      outcomes.fitted++;
      expect(r.tries, at).toBe(calls.length);
      expect(r.bytes.length, at).toBeLessThanOrEqual(PHOTO_LIMITS.maxBytes);
      expect(photoOk(r.bytes), at).toBe(true);
      expect(jpegSize(r.bytes), at).toEqual({ width: r.width, height: r.height });
      expect(Math.max(r.width, r.height), at).toBeLessThanOrEqual(PHOTO_LIMITS.maxSide);
      expect(r.width, at).toBeLessThanOrEqual(width);
      expect(r.height, at).toBeLessThanOrEqual(height);
      const off = width >= height ? Math.abs(r.height - (r.width * height) / width) : Math.abs(r.width - (r.height * width) / height);
      expect(off, at).toBeLessThanOrEqual(1);
      expect(same(photoFromBase64(r.base64), r.bytes), at).toBe(true);
    }
    // both outcomes were met: the run is not all easy pictures
    expect(outcomes.fitted).toBeGreaterThan(1800);
    expect(outcomes.too_complex).toBeGreaterThan(30);
  }, 60_000);
});
