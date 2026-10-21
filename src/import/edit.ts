// «עריכה» in the preview (DECISIONS «סבב שישי»): the admin's own reading of a speaker card's name, title and
// affiliation, where the file's free text was read wrong («הרב פלוני-ישיבת X» glued, a comma that was not a second
// name). The edited values replace the parsed ones — the readers apply them (readCandidateSheet by the row's ref,
// readTracking by the speaker's parsed key), so the name is matched again against the pool and the sheet, the title
// gives the gender by the same rule (הרב / הרבנית only), and the payload carries them. They go through the same
// checks as the file's text: no phone and no e-mail (hasContact here; the commit's «contact_in_text» on the server),
// a title from the edition's list, the pool's lengths. The preview says so («נערך ידנית»).
import { LIMITS } from "../data/speakerRules";
import { nameKey } from "../domain/nameKey";
import { hasContact } from "./phone";
import { cleanCell } from "./table";

export interface SpeakerEdit {
  title: string | null;
  name: string;
  affiliation: string | null;
}

const chars = (s: string) => [...s].length;
const one = (s: string | null | undefined) => cleanCell(s ?? "").replace(/\s+/g, " ").trim();

/** An edit as it is kept: one line each, white space collapsed; an empty title or affiliation is none. */
export const cleanEdit = (e: SpeakerEdit): SpeakerEdit => ({ title: one(e.title) || null, name: one(e.name), affiliation: one(e.affiliation) || null });

/** What is wrong with an edit (it is not saved, and a reader ignores it), or null. */
export function editProblem(raw: SpeakerEdit, titles: readonly string[]): string | null {
  const e = cleanEdit(raw);
  if ([e.name, e.title, e.affiliation].some((x) => hasContact(x))) return "יש כאן טלפון או מייל — מוחקים אותו (טלפון ומייל נשמרים רק בפרטי הקשר)";
  if (!nameKey(e.name)) return "צריך שם";
  if (chars(e.name) > LIMITS.name) return `השם ארוך מ-${LIMITS.name} תווים`;
  if (e.title && !titles.includes(e.title)) return "התואר לא ברשימת התארים";
  if (e.affiliation && chars(e.affiliation) > LIMITS.affiliation) return `השיוך המוסדי ארוך מ-${LIMITS.affiliation} תווים`;
  return null;
}

/** The edit a reader applies — cleaned — or none (absent, or not valid). */
export const validEdit = (e: SpeakerEdit | undefined, titles: readonly string[]): SpeakerEdit | null => (e && !editProblem(e, titles) ? cleanEdit(e) : null);
