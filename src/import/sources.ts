// «מקורות (נשלח?)» — last year's words for a lesson's sources, translated to the lesson's own fields. The wizard
// shows every value the sheet holds with its translation, and the admin changes any of them before the commit:
// the three DESIGN names (כן → דף מקורות, כן+סרטון → דף וסרטון, להדפיס לפני → להדפיס לפני השבוע) and a few more
// that are «הצעה». An empty cell stays «טרם התקבלו» (pending); a value no rule knows is «אחר», its words kept in
// the lesson's sources note — nothing guessed, nothing lost.
import type { PrintWhen, SourcesKind } from "../domain/types";
import { cleanCell } from "./table";

export interface SourcesRule {
  kind: SourcesKind;
  print: PrintWhen;
}

/** A value as the table compares it: quotes, spaces around «+» and case away, inner spaces single. */
export function sourcesKey(v: string): string {
  return cleanCell(v)
    .replace(/\n/g, " ")
    .replace(/["״'׳]/g, "")
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** DESIGN's three («ייבוא תשפ"ו»): «כן», «כן+סרטון», «להדפיס לפני». */
export const DESIGN_SOURCES: Record<string, SourcesRule> = {
  "כן": { kind: "sheet", print: "none" },
  "כן+סרטון": { kind: "sheet_video", print: "none" },
  "להדפיס לפני": { kind: "sheet", print: "before" },
};

/** More of the same words, «הצעה» — shown as such in the table. */
export const SUGGESTED_SOURCES: Record<string, SourcesRule> = {
  "כן+מצגת": { kind: "sheet_presentation", print: "none" },
  "מצגת": { kind: "presentation", print: "none" },
  "להדפיס באותו יום": { kind: "sheet", print: "same_day" },
  "לא": { kind: "none", print: "none" },
  "אין": { kind: "none", print: "none" },
  "בלי מקורות": { kind: "none", print: "none" },
};

export type SourcesOrigin = "design" | "suggested" | "unknown" | "empty";

/** The translation the table starts with for a value, and where it comes from. */
export function defaultSourcesRule(value: string): SourcesRule & { origin: SourcesOrigin } {
  const k = sourcesKey(value);
  if (!k) return { kind: "pending", print: "none", origin: "empty" };
  if (DESIGN_SOURCES[k]) return { ...DESIGN_SOURCES[k], origin: "design" };
  if (SUGGESTED_SOURCES[k]) return { ...SUGGESTED_SOURCES[k], origin: "suggested" };
  return { kind: "other", print: "none", origin: "unknown" };
}

/** A lesson's sources fields from its cell and the (edited) table: an «other» keeps the sheet's words as the note. */
export function translateSources(value: string, table: ReadonlyMap<string, SourcesRule>): { sources_kind: SourcesKind; print_when: PrintWhen; sources_note: string | null } {
  const k = sourcesKey(value);
  const rule = table.get(k) ?? defaultSourcesRule(value);
  const words = cleanCell(value).replace(/\n/g, " ");
  return { sources_kind: rule.kind, print_when: rule.print, sources_note: rule.kind === "other" && words ? words : null };
}
