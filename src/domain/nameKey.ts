// A name's comparison key — app.name_key() in supabase/schema.sql, in the
// browser: no title word up front, no gershayim/geresh/quote differences, no
// vowel points or cantillation, one space between words. The database computes
// the stored keys (speakers.name_key, roster.name_key, kk_groups.place_key);
// this copy lets a screen say «כבר ברשימה» before saving, and the engine refuse
// `place_taken`. tests/sql/settings.test.ts holds the two equal on text spaced
// in ASCII: they differ on the other Unicode spaces (no-break U+00A0, U+202F,
// U+FEFF …), which JS's \s and the trim below take and PostgreSQL's \s and
// btrim leave in — so a form folds every space to an ASCII one before it sends
// text to be keyed (the kk group form's place, title and author).
export function nameKey(p: string | null | undefined): string {
  return (p ?? "")
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, "") // niqqud and cantillation (also maqaf, paseq)
    .replace(/["\u05F4'\u05F3]/g, "") // gershayim / geresh / quotes
    .replace(/^(הרב|הרבנית|ד"?ר|דר|פרופ|פרופסור|פרופ\.)\s+/, "") // a leading title
    .replace(/[\s\-–־]+/g, " ")
    .replace(/^ +| +$/g, "");
}
