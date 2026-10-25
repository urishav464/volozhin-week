// A speaker cell's other names — a line under the first (a Word cell's second paragraph, a Sheets cell's Alt+Enter),
// a name beside it («פלוני + פלמוני», «פלוני / פלמוני»), a bracket at the end of a name on its own line («הרב פלוני
// (ישיבת בדיקה)»), or what follows «, », a spaced dash or «והרב…» on that line («הרב פלוני - ישיבת בדיקה», nameTails) —
// in the tracking sheet and in the candidates alike (DECISIONS «סבב רביעי», «סבב חמישי», «סבב שישי»). Each is one of
// three — «מרצה נוסף/ת», «שיוך מוסדי» of the name it stands by, or «לא לייבא» (only it: the name stays) — and the read
// proposes («הצעה»): «לא לייבא» when the line is ONE escort's name and nothing else, or speaks of an escort («מלווה»,
// «חניך»); an affiliation when it holds an institution's word («ישיבת…», «מכון…»); in the tracking sheet, a name beside
// the first is a co-speaker. A line that only shares a word with an escort's name («הרב דוד כהן» beside «שירה כהן»,
// «(ישיבת נועם)» beside «נועם …»), and every other line, waits for the admin's choice, and «ייבוא» waits with it. A
// name is matched to the pool without its brackets and tails («פלוני»).
import { allOfOneEscort, type EscortIndex, escortIndex, escortWords, mentionsEscort, namedEscort } from "./escorts";
import { MEMORIAL_LINE, nameTails, titleOf, trailingBrackets } from "./speakerName";

export type LineAs = "affiliation" | "speaker" | "skip";

/** Where a line stands: under the name, beside it («+», « / »), a bracket at its end, or a tail («, », « - », «והרב…»). */
export type LineKind = "under" | "beside" | "bracket" | "tail";

export interface ExtraLine {
  /** «row:index» — the admin's choice is kept by it. */
  id: string;
  row: number;
  /** The line as written. */
  text: string;
  kind: LineKind;
  /** The speaker above it (its key): whose affiliation it would be. */
  of: string;
  ofName: string;
  /** What it is read as — the read's own («הצעה») or the admin's; null: undecided — none of the three, until chosen. */
  as: LineAs | null;
  /** The admin turned it. */
  chosen: boolean;
  /** Why the read made it what it is. */
  why: string;
  /** A word of the escorts' column the line holds (said beside it), or null. */
  escort: string | null;
  /** It waits because of an escort's word, or a word about one, in it — said in red beside it. */
  held: boolean;
}

/** What a line is compared with: the escorts' names, and the edition's titles (a trainee has none). */
export interface LineContext {
  escorts: EscortIndex;
  titles: readonly string[];
}
export const lineContext = (escorts: readonly string[], titles: readonly string[]): LineContext => ({ escorts: escortIndex(escorts), titles });

/** A name of an institution: «ישיבת…», «מכון…», «מדרשת…», «אוניברסיטת…», «מכללת…», «בית מדרש…» and the like. */
export const INSTITUTION =
  /(?<![א-ת])(?:ה?ישיב(?:ת|ה)|ה?מכון|ה?מדרש(?:ת|ה)|בית ה?מדרש|ה?אוניברסיט(?:ת|ה)|ה?מכלל(?:ת|ה)|ה?אולפנ(?:ת|ה)|בית ה?ספר|ה?קהיל(?:ת|ה)|בית ה?כנסת|ה?מרכז|ה?עמות(?:ת|ה)|ה?תנוע(?:ת|ה)|ה?ארגון|ה?מוסד|ה?כולל|ה?סמינר|ה?מכינ(?:ת|ה))(?![א-ת])/;

/** Does a text hold one of the edition's titles as a word of its own («הרב», «ד"ר», «והרבנית»)? */
export const hasTitle = (raw: string, titles: readonly string[]) =>
  raw
    .replace(/[()[\]{}:,;]/g, " ")
    .split(/\s+/)
    .some((w) => !!w && (titleOf(w, titles) != null || (w.startsWith("ו") && titleOf(w.slice(1), titles) != null)));

export interface LineProposal {
  as: LineAs | null;
  why: string;
  escort: string | null;
  /** Undecided because of an escort's word (or a word about one) in it — never proposed anything. */
  held: boolean;
}

/**
 * What the read proposes for a line, and why (DECISIONS «סבב שישי»): «לא לייבא» only when it is strong — the line speaks
 * of an escort («מלווה», «חניך»), or it is ONE escort's name and nothing else (allOfOneEscort), with no title and no
 * institution's word; a line that only shares a word with an escort's name waits («צריך לבחור», the word said); an
 * institution's word — an affiliation; else nothing.
 */
export function lineProposal(raw: string, c: LineContext): LineProposal {
  // a dedication («לע״נ …», «… ז״ל», «הי״ד») is no one's name nor an institution (the dry run of 5786's files)
  if (MEMORIAL_LINE.test(raw)) return { as: "skip", why: "הקדשה לזכר מישהו — לא שם של מרצה", escort: null, held: false };
  const escort = namedEscort(raw, c.escorts.words);
  const mentions = mentionsEscort(raw);
  const institution = INSTITUTION.test(raw);
  if (mentions && !institution) return { as: "skip", why: escort ? `שם מעמודת המלווים («${escort}»)` : "מדבר על מלווה", escort, held: false };
  if (escort && !institution && !hasTitle(raw, c.titles) && allOfOneEscort(raw, c.escorts)) return { as: "skip", why: `שם מעמודת המלווים («${escort}»)`, escort, held: false };
  if (escort || mentions) {
    const said = escort ? `מילה מעמודת המלווים («${escort}»)` : "מילה על מלווה או חניך/ה";
    return { as: null, why: `יש כאן ${said}, אבל לא רק שם של מלווה — לבדוק`, escort, held: true };
  }
  if (institution) return { as: "affiliation", why: "שם של מוסד", escort: null, held: false };
  return { as: null, why: "בלי שם של מוסד", escort: null, held: false };
}

/** A line as an affiliation (or a name): without the brackets around it («(ישיבת דוגמה)», «[…]», one left open «(…»). */
export const affiliationText = (raw: string) => (/^[([{]\s*(.+?)\s*[)\]}]?$/.exec(raw.trim())?.[1] ?? raw).trim();

/**
 * One line of a cell, read: the proposal, and the admin's choice over it. A name beside the first in the tracking sheet
 * (`coSpeaker`) is read by its own name — its brackets and tails are lines of their own once it is a speaker — and is
 * proposed «מרצה נוסף/ת» when nothing else is (it was a co-speaker before it was a line).
 */
export function extraLine(
  id: string,
  row: number,
  raw: string,
  of: { key: string; name: string },
  c: LineContext,
  lineAs: ReadonlyMap<string, LineAs> | undefined,
  kind: LineKind,
  coSpeaker = false,
): ExtraLine {
  const p = lineProposal(coSpeaker ? nameTails(raw, c.titles).name : raw, c);
  const proposed = p.as ?? (coSpeaker && !p.held ? "speaker" : null);
  const why = p.as == null && proposed === "speaker" ? "שם ליד השם — מרצה נוסף/ת" : p.why;
  const chosen = lineAs?.get(id);
  return { id, row, text: raw.trim(), kind, of: of.key, ofName: of.name, as: chosen ?? proposed, chosen: chosen != null && chosen !== proposed, why, escort: p.escort, held: p.held };
}

export { escortWords, nameTails, trailingBrackets };
