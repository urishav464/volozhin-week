// A speaker cell's other names — a line under the first (a Word cell's second paragraph, a Sheets cell's Alt+Enter),
// a name beside it («פלוני + פלמוני» in a candidates' row; in the tracking sheet, one that names an escort), or a
// bracket at the end of a name, on its own line («הרב פלוני (ישיבת בדיקה)», «מרצה 12 (מלווה: …)») — in the tracking
// sheet and in the candidates alike (DECISIONS «סבב רביעי», «סבב חמישי»). Each is one of three — «מרצה נוסף/ת», «שיוך
// מוסדי» of the name it stands by, or «לא לייבא את השורה» — and the read proposes only two («הצעה»): an affiliation,
// when the line holds an institution's word («ישיבת…», «מכון…»); «לא לייבא», when it names an escort (a word of the
// escorts' column, or «מלווה»/«חניך»). Every other line — in brackets or not, with a title or not — waits for the
// admin's choice, and «ייבוא» waits with it. A name is matched to the pool without its brackets («פלוני»).
import { escortWords, mentionsEscort, namedEscort } from "./escorts";

export type LineAs = "affiliation" | "speaker" | "skip";

export interface ExtraLine {
  /** «row:index» — the admin's choice is kept by it. */
  id: string;
  row: number;
  /** The line as written. */
  text: string;
  /** The speaker above it (its key): whose affiliation it would be. */
  of: string;
  ofName: string;
  /** What it is read as — the read's own («הצעה») or the admin's; null: undecided — none of the three, until chosen. */
  as: LineAs | null;
  /** The admin turned it. */
  chosen: boolean;
  /** Why the read made it what it is. */
  why: string;
}

/** A name of an institution: «ישיבת…», «מכון…», «מדרשת…», «אוניברסיטת…», «מכללת…», «בית מדרש…» and the like. */
export const INSTITUTION =
  /(?<![א-ת])(?:ה?ישיב(?:ת|ה)|ה?מכון|ה?מדרש(?:ת|ה)|בית ה?מדרש|ה?אוניברסיט(?:ת|ה)|ה?מכלל(?:ת|ה)|ה?אולפנ(?:ת|ה)|בית ה?ספר|ה?קהיל(?:ת|ה)|בית ה?כנסת|ה?מרכז|ה?עמות(?:ת|ה)|ה?תנוע(?:ת|ה)|ה?ארגון|ה?מוסד|ה?כולל|ה?סמינר|ה?מכינ(?:ת|ה))(?![א-ת])/;

/** What the read proposes for a line, and why: «לא לייבא» when it names an escort, an affiliation when it names an institution — else nothing. */
export function lineProposal(raw: string, escorts: ReadonlySet<string>): [LineAs | null, string] {
  const escort = namedEscort(raw, escorts);
  if (escort) return ["skip", `שם מעמודת המלווים («${escort}»)`];
  if (mentionsEscort(raw)) return ["skip", "מדבר על מלווה"];
  if (INSTITUTION.test(raw)) return ["affiliation", "שם של מוסד"];
  return [null, "בלי שם של מוסד"];
}

/** A line as an affiliation (or a name): without the brackets around it («(ישיבת דוגמה)», «[…]», one left open «(…»). */
export const affiliationText = (raw: string) => (/^[([{]\s*(.+?)\s*[)\]}]?$/.exec(raw.trim())?.[1] ?? raw).trim();

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

/** One line of a cell, read: the proposal, and the admin's choice over it. */
export function extraLine(id: string, row: number, raw: string, of: { key: string; name: string }, escorts: ReadonlySet<string>, lineAs?: ReadonlyMap<string, LineAs>): ExtraLine {
  const [proposed, why] = lineProposal(raw, escorts);
  const chosen = lineAs?.get(id);
  return { id, row, text: raw.trim(), of: of.key, ofName: of.name, as: chosen ?? proposed, chosen: chosen != null && chosen !== proposed, why };
}

export { escortWords };
