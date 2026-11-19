// v19: a speaker's photo for the guests' schedule — small, and stored in the database (speaker_photos), never in
// Storage. The browser re-encodes what was picked (a canvas, at most 512px, the quality stepped down until it fits
// 20KB), strips what is left of its metadata (src/reader/jpeg.ts) and checks it here before it is sent; the database
// checks the same bytes again (app.photo_ok ≡ photoOk) and refuses anything else (bad_file). A guest sees it only
// through the schedule link, and only while that edition's approach has `public_ok`.
//
// The grammar (app.photo_ok, supabase/schema.sql — keep the two equal; tests/parity runs the same bytes through
// both): 100 … 20480 bytes; SOI; then marker segments `FF m` with a length ≥ 2 that stays inside the file (no fill
// bytes), `m` one of APP0 (length ≥ 7, starting «JFIF\0»), APP14, DQT, DHT, DRI and at most one SOF0/SOF1 (length ≥ 8,
// 0 < height, width ≤ 512); at SOS (exactly one frame seen) its segment is skipped and every byte after it up to the
// last two is entropy data, where FF is followed only by 00 or D0–D7; the last two bytes are FFD9. Anything else —
// APP1–APP13 (EXIF, XMP, ICC…), APP15, a comment, a progressive frame, a second scan, bytes after the end — is refused.

export const PHOTO_LIMITS = {
  minBytes: 100,
  maxBytes: 20480,
  /** Height and width, in pixels. */
  maxSide: 512,
  /** base64 of maxBytes: ceil(20480 / 3) × 4. */
  maxBase64: 27308,
} as const;

/** app.photo_ok: the bytes are a small baseline JPEG with nothing but the picture in it (the grammar above). */
export function photoOk(b: Uint8Array): boolean {
  const n = b.length;
  if (n < PHOTO_LIMITS.minBytes || n > PHOTO_LIMITS.maxBytes) return false;
  if (b[0] !== 0xff || b[1] !== 0xd8) return false;
  let i = 2;
  let frames = 0;
  let scan = -1;
  while (scan < 0) {
    if (i + 4 > n || b[i] !== 0xff) return false;
    const m = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > n) return false;
    switch (m) {
      case 0xe0:
        if (len < 7 || b[i + 4] !== 0x4a || b[i + 5] !== 0x46 || b[i + 6] !== 0x49 || b[i + 7] !== 0x46 || b[i + 8] !== 0x00) return false;
        break;
      case 0xee:
      case 0xdb:
      case 0xc4:
      case 0xdd:
        break;
      case 0xc0:
      case 0xc1: {
        if (len < 8) return false;
        const h = (b[i + 5] << 8) | b[i + 6];
        const w = (b[i + 7] << 8) | b[i + 8];
        if (h < 1 || h > PHOTO_LIMITS.maxSide || w < 1 || w > PHOTO_LIMITS.maxSide) return false;
        if (++frames > 1) return false;
        break;
      }
      case 0xda:
        if (frames !== 1) return false;
        scan = i + 2 + len;
        break;
      default:
        return false;
    }
    if (scan < 0) i += 2 + len;
  }
  if (scan > n - 2) return false;
  for (let j = scan; j < n - 2; j++) {
    if (b[j] !== 0xff) continue;
    const next = b[j + 1];
    if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) return false;
  }
  return b[n - 2] === 0xff && b[n - 1] === 0xd9;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VALUE = new Map([...ALPHABET].map((c, i) => [c, i]));
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Canonical base64 (padding bits zero, «=» padding), no newlines — what Postgres's encode(…, 'base64') gives, its newlines taken out. */
export function photoToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < bytes.length ? ALPHABET[c & 63] : "=";
  }
  return out;
}

/**
 * set_speaker_photo's p_photo: base64 of at most 27308 characters, a multiple of four, `^[A-Za-z0-9+/]+={0,2}$`, whose
 * bytes pass photoOk — else null (bad_file). Padding bits that are not zero are accepted, as Postgres's decode accepts
 * them (the stored bytes are the same; the read gives them back canonical).
 */
export function photoFromBase64(v: unknown): Uint8Array | null {
  if (typeof v !== "string" || v.length > PHOTO_LIMITS.maxBase64 || v.length % 4 !== 0 || !BASE64.test(v)) return null;
  const body = v.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((body.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let k = 0;
  for (const ch of body) {
    acc = (acc << 6) | VALUE.get(ch)!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[k++] = (acc >> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  return photoOk(out) ? out : null;
}

/** What an <img> shows, and what schedule_view gives a guest: «data:image/jpeg;base64,…». */
export const PHOTO_DATA_PREFIX = "data:image/jpeg;base64,";
export const photoDataUrl = (b64: string): string => PHOTO_DATA_PREFIX + b64;
