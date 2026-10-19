// A name's comparison key — app.name_key() in supabase/schema.sql, in the
// browser: no title word up front, no gershayim/geresh/quote differences, no
// vowel points or cantillation, one space between words. The database computes
// the stored key (speakers.name_key, roster.name_key); this copy lets a screen
// say «כבר ברשימה» before saving. tests/sql/settings.test.ts holds the two equal.
export function nameKey(p: string | null | undefined): string {
  return (p ?? "")
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, "") // niqqud and cantillation (also maqaf, paseq)
    .replace(/["\u05F4'\u05F3]/g, "") // gershayim / geresh / quotes
    .replace(/^(הרב|הרבנית|ד"?ר|דר|פרופ|פרופסור|פרופ\.)\s+/, "") // a leading title
    .replace(/[\s\-–־]+/g, " ")
    .replace(/^ +| +$/g, "");
}
