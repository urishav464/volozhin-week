// pg_trgm's similarity(), in the browser — so the demo and a screen say
// «ייתכן שזה…» about exactly the speakers the database would
// (public.speaker_matches, public.create_speaker). tests/sql/speakers.test.ts
// holds this equal to the extension on a sample of names.
//
// As pg_trgm does it: lower-case; split into words of letters and digits
// (iswalpha/iswdigit in the database's locale: Unicode «Alphabetic» and
// decimal digits; anything else separates); pad each word with two spaces before and one
// after; take every three consecutive characters; keep each trigram once.
// similarity = shared / (|a| + |b| − shared), a 4-byte float in Postgres.
// (pg_trgm stores a trigram with a non-ASCII character as a 3-byte hash; two
// different trigrams sharing a hash is the one case where this can differ.)

const WORD = /[\p{Alphabetic}\p{Nd}]+/gu;

export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.toLowerCase().match(WORD) ?? []) {
    const chars = [..." ".repeat(2) + word + " "];
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars[i] + chars[i + 1] + chars[i + 2]);
  }
  return out;
}

/** pg_trgm similarity(a, b): 0 when either side has no trigram. */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return Math.fround(shared / (ta.size + tb.size - shared));
}
