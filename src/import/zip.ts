// The zip inside an .xlsx or a .docx, read with care: the central directory first (names and sizes, nothing
// inflated), then only the parts the wizard needs, each inflated by fflate's streaming Inflate in small pieces and
// stopped the moment it passes its limit — what a zip SAYS a part's size is is not trusted, so a zip bomb costs
// at most a limit's worth of memory and a few pieces' time. No zip64, no encryption, no method but stored/deflate:
// an Office file never needs them, and each is refused with a Hebrew message.
import { Inflate } from "fflate";
import { CommandError } from "../data/commands";
import { badFile, IMPORT_LIMITS, tooBig } from "./limits";

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflate. */
  method: number;
  flags: number;
  compressedSize: number;
  /** What the directory says — checked, never relied on. */
  size: number;
  /** The local header's offset. */
  offset: number;
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** The bytes look like a zip at all (a local header first). */
export const looksZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** The central directory: every part's name and sizes. Refused: not a zip, zip64, too many parts. */
export function zipEntries(b: Uint8Array): ZipEntry[] {
  if (b.length > IMPORT_LIMITS.fileBytes) tooBig();
  if (!looksZip(b) || b.length < 22) badFile();
  // the end of central directory record: the last one in the final 64 KiB (+ its 22 bytes)
  let eocd = -1;
  for (let o = b.length - 22; o >= Math.max(0, b.length - 22 - 0xffff); o--) {
    if (u32(b, o) === 0x06054b50) {
      eocd = o;
      break;
    }
  }
  if (eocd < 0) badFile();
  const count = u16(b, eocd + 10);
  const cdSize = u32(b, eocd + 12);
  const cdOffset = u32(b, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) badFile(); // zip64
  if (count > IMPORT_LIMITS.zipEntries) tooBig();
  if (cdOffset + cdSize > eocd) badFile();
  const out: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let o = cdOffset, k = 0; k < count; k++) {
    if (o + 46 > eocd || u32(b, o) !== 0x02014b50) badFile();
    const nameLen = u16(b, o + 28);
    const extraLen = u16(b, o + 30);
    const commentLen = u16(b, o + 32);
    if (o + 46 + nameLen > eocd) badFile();
    out.push({
      name: decoder.decode(b.subarray(o + 46, o + 46 + nameLen)),
      method: u16(b, o + 10),
      flags: u16(b, o + 8),
      compressedSize: u32(b, o + 20),
      size: u32(b, o + 24),
      offset: u32(b, o + 42),
    });
    o += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** How much one file may still inflate, across the parts read from it. */
export interface Budget {
  left: number;
}
export const newBudget = (): Budget => ({ left: IMPORT_LIMITS.totalBytes });

/** Inflate raw deflate data, in pieces, stopping past `limit` bytes of output (import_too_big). */
export function boundedInflate(data: Uint8Array, limit: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inf = new Inflate((chunk) => {
    total += chunk.length;
    if (total > limit) tooBig();
    chunks.push(chunk);
  });
  const PIECE = 16 * 1024; // at most ~16 MiB out per piece (deflate's ratio tops out near 1:1032)
  try {
    for (let o = 0; o < data.length; o += PIECE) inf.push(data.subarray(o, Math.min(o + PIECE, data.length)), o + PIECE >= data.length);
    if (data.length === 0) inf.push(new Uint8Array(0), true);
  } catch (e) {
    if (e instanceof CommandError) throw e;
    badFile(); // fflate's «invalid block type», «unexpected EOF»…
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** One part's bytes — within the part's own limit and what is left of the file's budget. */
export function readEntry(b: Uint8Array, e: ZipEntry, budget: Budget): Uint8Array {
  if (e.flags & 0x1) throw new CommandError("import_encrypted");
  const limit = Math.min(IMPORT_LIMITS.entryBytes, budget.left);
  if (e.size > limit) tooBig();
  if (e.offset + 30 > b.length || u32(b, e.offset) !== 0x04034b50) badFile();
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const end = start + e.compressedSize;
  if (end > b.length) badFile();
  const data = b.subarray(start, end);
  let out: Uint8Array;
  if (e.method === 0) {
    if (data.length > limit) tooBig();
    out = data.slice();
  } else if (e.method === 8) out = boundedInflate(data, limit);
  else return badFile();
  budget.left -= out.length;
  return out;
}

/** A part's text (UTF-8), or null when the zip has no part of that name. */
export function readText(b: Uint8Array, entries: ZipEntry[], name: string, budget: Budget): string | null {
  const e = entries.find((x) => x.name === name);
  return e ? new TextDecoder().decode(readEntry(b, e, budget)) : null;
}
