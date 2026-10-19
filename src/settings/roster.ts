// The trainees' list arrives by pasting: one name per line, or a column copied
// from a spreadsheet (cells separated by tabs). Names only — a phone or an
// e-mail in the paste is never kept: only the name cell (and a gender cell) is read.
import { nameKey } from "../domain/nameKey";
import type { Gender } from "../domain/types";

export interface PastedName {
  full_name: string;
  gender: Gender | null;
  key: string;
}

/** A name has letters, and is not an address or a phone number (a row number, a bullet, a phone or an e-mail cell is skipped). */
const nameLike = (c: string) => /\p{L}/u.test(c) && !c.includes("@") && (c.match(/\d/g)?.length ?? 0) <= 4;
/** A header row copied along with the column. */
const HEADERS = new Set(["שם", "שמות", "שם מלא", "שם החניך", "שם החניכה", "שם החניך/ה", "חניכים", "name", "full name"]);
const GENDER: Record<string, Gender> = { ז: "m", זכר: "m", m: "m", בן: "m", נ: "f", נקבה: "f", f: "f", בת: "f" };

function clean(cell: string): string {
  return cell
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/^\s*["']|["']\s*$/g, "") // a spreadsheet's quoting
    .replace(/^\s*(?:\d+[.)]|[-–—•*])\s+/, "") // "1. " / "- " list markers
    .replace(/\s+/g, " ")
    .trim();
}

/** Every name in a paste, in order. A gender cell beside the name (ז/נ, זכר/נקבה) is read too. */
export function parseRosterPaste(text: string): PastedName[] {
  const out: PastedName[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const cells = line.split("\t").map(clean);
    const nameAt = cells.findIndex((c) => nameLike(c) && !(c.toLowerCase() in GENDER));
    if (nameAt === -1) continue;
    const full_name = cells[nameAt].slice(0, 120);
    if (HEADERS.has(full_name.toLowerCase())) continue;
    const g = cells.find((c, i) => i !== nameAt && c.toLowerCase() in GENDER);
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
