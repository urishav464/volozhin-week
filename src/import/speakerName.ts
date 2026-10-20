// A speaker's name as last year's files wrote it — «הרב פלוני אלמוני», «ד"ר …», «פרופ' …» — split into the title the
// pool keeps apart (one of the edition's titles: settings.titles, else ד״ר · פרופ׳ · הרב · הרבנית) and the name.
// Gender: ONLY from the titles הרב (m) and הרבנית (f), as a «הצעה» the admin sees and may turn off — never from a
// name (supabase/schema.sql «Import 5786» refuses any other: app.title_gender).
import type { Gender } from "../domain/types";
import { cleanCell } from "./table";

/** How a sheet spells a title, to the pool's spelling. */
const SPELLINGS: [RegExp, string][] = [
  [/^(?:ד["״'׳]{1,2}ר|דר['׳]?|דוקטור)$/, "ד״ר"],
  [/^(?:פרופ['׳.]?|פרופסור)$/, "פרופ׳"],
];

/** The title a word is, in the edition's list — or null. */
function titleOf(word: string, titles: readonly string[]): string | null {
  if (titles.includes(word)) return word;
  for (const [re, t] of SPELLINGS) if (re.test(word) && titles.includes(t)) return t;
  return null;
}

/** «הרב פלוני אלמוני» → {title: «הרב», name: «פלוני אלמוני»}; a name with no title (or one not in the list) as it is. */
export function splitTitle(raw: string, titles: readonly string[]): { title: string | null; name: string } {
  const t = cleanCell(raw).replace(/\n/g, " ");
  // the edition's own titles first, longest first (a title of two words; «הרבנית» before «הרב»)
  for (const title of [...titles].sort((a, b) => b.length - a.length)) {
    if (t.startsWith(`${title} `) && t.length > title.length + 1) return { title, name: t.slice(title.length + 1).trim() };
  }
  const sp = t.indexOf(" ");
  if (sp > 0) {
    const title = titleOf(t.slice(0, sp), titles);
    if (title) return { title, name: t.slice(sp + 1).trim() };
  }
  return { title: null, name: t };
}

/** The gender a title says — הרב: m, הרבנית: f — and nothing else (app.title_gender). */
export function titleGender(title: string | null | undefined): Gender | null {
  return title === "הרב" ? "m" : title === "הרבנית" ? "f" : null;
}

/** A title typed in its own column: the pool's spelling of it, or null when it is not one of the edition's titles. */
export function pickTitleCell(raw: string, titles: readonly string[]): string | null {
  const t = cleanCell(raw).replace(/\n/g, " ");
  return t ? titleOf(t, titles) : null;
}

/** A speaker cell with more than one name («פלוני + פלמוני», one per line): each, in order — the first leads. */
export function splitSpeakers(cell: string): string[] {
  return cleanCell(cell)
    .split(/\s*(?:[+&;\n]|\s\/\s)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}
