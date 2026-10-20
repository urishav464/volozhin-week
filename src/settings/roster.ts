// The trainees' list arrives by pasting: one name per line, or a block copied
// from a spreadsheet (cells separated by tabs). Names only — a phone, an
// e-mail or an address in the paste is never kept. From a spreadsheet ONE
// column is read, the same in every row (the screen shows which, and lets the
// admin pick another): a row is never searched for "something that looks like
// a name", which would store a city or a parent's name in its place.
import { nameKey } from "../domain/nameKey";
import type { Gender } from "../domain/types";

export interface PastedName {
  full_name: string;
  gender: Gender | null;
  key: string;
}

/** An address cell: a street word, a P.O. box, or a comma next to a number. */
const ADDRESS = /(^|[\s,])(רחוב|רח['׳]|שד['׳]|שדרות|ת\.?\s?ד\.?|דירה|כניסה|מיקוד)(?=$|[\s,.])|\d.*,|,.*\d/;
/** A name has letters, and is not an e-mail, a phone, a row number or an address. */
const nameLike = (c: string) => /\p{L}/u.test(c) && !c.includes("@") && (c.match(/\d/g)?.length ?? 0) <= 4 && !ADDRESS.test(c);
/** A header row copied along with the column. */
const HEADERS = new Set(["שם", "שמות", "שם מלא", "שם החניך", "שם החניכה", "שם החניך/ה", "חניכים", "name", "full name"]);
const GENDER: Record<string, Gender> = { ז: "m", זכר: "m", m: "m", בן: "m", נ: "f", נקבה: "f", f: "f", בת: "f" };
const isGender = (c: string) => c.toLowerCase() in GENDER;
const isHeader = (c: string) => HEADERS.has(c.toLowerCase());

function clean(cell: string): string {
  return cell
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/^\s*["']|["']\s*$/g, "") // a spreadsheet's quoting
    .replace(/^\s*(?:\d+[.)]|[-–—•*])\s+/, "") // "1. " / "- " list markers
    .replace(/\s+/g, " ")
    .trim();
}

function rows(text: string): string[][] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.split("\t").map(clean))
    .filter((cells) => cells.some((c) => c !== ""));
}

/** A column a pasted block could take its names from, with its first name as a sample. */
export interface PasteColumn {
  index: number;
  sample: string;
  /** How many rows have a name-like cell in this column. */
  names: number;
}

/** The paste's rows, its header row (if one was copied along) and the spreadsheet rows (more than one cell). */
function shape(text: string) {
  const all = rows(text);
  const header = all.find((cells) => cells.some(isHeader));
  const sheet = all.filter((cells) => cells !== header && cells.length > 1);
  return { all, header, sheet };
}

/**
 * The spreadsheet columns of a paste that hold names (name-like in at least
 * half its spreadsheet rows), and the one to read by default: the column under
 * a «שם» header if there is one, else the one with the most different names (a
 * city repeats; names do not), the first on a tie. A line without tabs is a
 * name by itself and needs no column.
 */
export function pasteColumns(text: string): { columns: PasteColumn[]; best: number | null } {
  const { header, sheet } = shape(text);
  const width = Math.max(0, ...sheet.map((c) => c.length));
  const columns: (PasteColumn & { distinct: number })[] = [];
  for (let index = 0; index < width; index++) {
    const cells = sheet.map((r) => r[index] ?? "").filter((c) => nameLike(c) && !isGender(c));
    if (cells.length === 0 || cells.length * 2 < sheet.length) continue;
    columns.push({ index, sample: cells[0], names: cells.length, distinct: new Set(cells.map(nameKey)).size });
  }
  const headed = header && header.length > 1 ? header.findIndex(isHeader) : -1;
  const best = columns.some((c) => c.index === headed)
    ? headed
    : (columns.reduce<(typeof columns)[number] | null>((b, c) => (!b || c.distinct > b.distinct ? c : b), null)?.index ?? null);
  return { columns: columns.map(({ index, sample, names }) => ({ index, sample, names })), best };
}

/**
 * Every name in a paste, in order: a line on its own as it is, a spreadsheet
 * row from one column (`column`, else pasteColumns' default) — the same
 * column in every row. A gender cell elsewhere in the row (ז/נ, זכר/נקבה) is read too.
 */
export function parseRosterPaste(text: string, column?: number | null): PastedName[] {
  const { all, header } = shape(text);
  const at = column ?? pasteColumns(text).best;
  const out: PastedName[] = [];
  for (const cells of all) {
    if (cells === header) continue; // the whole header row, whichever column is read
    const i = cells.length === 1 ? 0 : at;
    if (i == null) continue;
    const cell = cells[i] ?? "";
    if (!nameLike(cell) || isGender(cell)) continue;
    const full_name = cell.slice(0, 120);
    const g = cells.find((c, j) => j !== i && isGender(c));
    out.push({ full_name, gender: g ? GENDER[g.toLowerCase()] : null, key: nameKey(full_name) });
  }
  return out;
}

export type PasteStatus = "new" | "exists" | "repeat";

/** What saving the paste would do: «חדש», «כבר ברשימה», or a repeat within the paste itself. */
export function previewPaste(pasted: PastedName[], existingKeys: ReadonlySet<string>): { name: PastedName; status: PasteStatus }[] {
  const seen = new Set<string>();
  return pasted.map((name) => {
    const status: PasteStatus = existingKeys.has(name.key) ? "exists" : seen.has(name.key) ? "repeat" : "new";
    seen.add(name.key);
    return { name, status };
  });
}
