// The demo's speaker photo (v19) — built here byte by byte, never a picture kept in git: a baseline JPEG of 32×16
// gray pixels (eight 8×8 blocks, one component), the smallest file a decoder draws. Each block is a zero DC difference
// and an end-of-block, each coded with a one-bit Huffman code «0»: two bits a block, 16 bits of zeros in all. Every
// coefficient is 0, so every pixel is the level shift, 128 — a flat mid-gray. It passes photoOk (src/domain/photo.ts)
// and is what src/testing/photos.ts calls `clean`. 160 bytes — not a multiple of three, so its base64 ends in «==»
// (the parity's non-canonical padding is tried on it).

/** The segment `FF m` with its body, the length written before it (2 + the body's length). */
function segment(marker: number, body: readonly number[]): number[] {
  const len = body.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...body];
}

/** A Huffman table with one symbol of code length 1 (its code is «0»): class 0 = DC, 1 = AC, table id 0. */
const oneCode = (cls: number, symbol: number) => segment(0xc4, [(cls << 4) | 0, 1, ...new Array<number>(15).fill(0), symbol]);

export const DEMO_PHOTO_SIZE = { width: 32, height: 16 } as const;

export function demoPhotoBytes(): Uint8Array {
  const { width, height } = DEMO_PHOTO_SIZE;
  const jfif = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const dqt = segment(0xdb, [0x00, ...new Array<number>(64).fill(1)]);
  const sof0 = segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]);
  const sos = segment(0xda, [1, 1, 0x00, 0, 63, 0]);
  const blocks = (width / 8) * (height / 8);
  const data = new Array<number>(Math.ceil((blocks * 2) / 8)).fill(0x00);
  return new Uint8Array([0xff, 0xd8, ...jfif, ...dqt, ...sof0, ...oneCode(0, 0x00), ...oneCode(1, 0x00), ...sos, ...data, 0xff, 0xd9]);
}
