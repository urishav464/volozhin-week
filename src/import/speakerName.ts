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
export function titleOf(word: string, titles: readonly string[]): string | null {
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

/**
 * A name's brackets at its end, on its own line («הרב פלוני (ישיבת בדיקה)», «מרצה 12 (מלווה: שירה)», «פלוני (א) (ב)»,
 * one left open «פלוני (ישיבת…»): the name before them, and each bracket in order — each a line of that name. A name
 * that is only a bracket, or a bracket in its middle («פלוני (בן) אלמוני»), is left whole.
 */
export function trailingBrackets(raw: string): { name: string; brackets: string[] } {
  let name = raw.trim();
  const brackets: string[] = [];
  for (;;) {
    const open = Math.max(name.lastIndexOf("("), name.lastIndexOf("["), name.lastIndexOf("{"));
    const before = name.slice(0, Math.max(open, 0)).trimEnd();
    if (open <= 0 || !BRACKET.test(name.slice(open)) || !before || /[([{]$/.test(before)) break;
    brackets.unshift(name.slice(open).trim());
    name = before;
  }
  return { name, brackets };
}
/** One bracket to the end: no other bracket inside it; its closing one may be missing. */
const BRACKET = /^[([{][^()[\]{}]*[)\]}]?\s*$/;

/**
 * A name's own line, apart (DECISIONS «סבב חמישי», «סבב שישי»): what follows «, », a spaced dash (« - », « – », « — »;
 * never a bare hyphen — «בן-דוד» stays whole) or «ו» before one of the edition's titles («והרב», «והרבנית», «וד"ר»,
 * «ופרופ׳») — each part a «tail», in order, never split inside brackets — and the brackets at the end of what is left
 * (trailingBrackets). The name is what is left: «הרב פלוני - ישיבת בדיקה» is «הרב פלוני», and «ישיבת בדיקה» a line of it.
 */
export function nameTails(raw: string, titles: readonly string[]): { name: string; brackets: string[]; tails: string[] } {
  const text = raw.trim();
  const cuts: { at: number; from: number }[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    const rest = text.slice(i);
    const comma = /^,\s+/.exec(rest);
    const dash = /^\s+[-–—]\s+/.exec(rest);
    const and = /^\s+ו(\S+)\s/.exec(rest);
    if (comma) cuts.push({ at: i, from: i + comma[0].length });
    else if (dash) cuts.push({ at: i, from: i + dash[0].length });
    else if (and && titleOf(and[1], titles)) cuts.push({ at: i, from: i + and[0].indexOf("ו") + 1 });
    else continue;
    i = cuts[cuts.length - 1].from - 1;
  }
  const parts = [0, ...cuts.map((c) => c.from)].map((start, k) => text.slice(start, k < cuts.length ? cuts[k].at : text.length).trim());
  const head = parts[0];
  if (!head || cuts.length === 0) return { ...trailingBrackets(text), tails: [] };
  return { ...trailingBrackets(head), tails: parts.slice(1).filter(Boolean) };
}
