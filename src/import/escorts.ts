// (c) Last year's escorts' file → only how each speaker is reached (DECISIONS «סבב רביעי»): for each speaker the admin
// CHOOSES a contact channel from a fixed list (IMPORT_CHANNELS: the pool's four, and «אחר»), pre-selected from the
// file's phrases («דרך המזכירה», «רק בוואטסאפ») by a heuristic («הצעה»), and may TYPE a short note of their own — an
// empty field, never filled from the file. Only those two travel: the payload has no field for the file's text, and the
// commit refuses a row with any other key. The phrases are SHOWN, read-only, as the reason for the suggestion — a phone
// or an e-mail taken out of them first (stripContacts), a phrase about payment or transport set apart (derived from the
// lesson). So the escorts' names cannot reach the database by this path, however the file spells them: nothing the
// file says is saved. They are still kept OUT of what the wizard reads — the escorts' column is asked for, never
// guessed (ImportTab: «באיזו עמודה שמות המלווים?»), and it cannot be mapped (escortColumns) — and they are read, in the
// page only, to SAY so beside a phrase that names one (namedEscort: a visual warning) and, in the tracking sheet and
// the candidates, to propose «לא לייבא את השורה» for a line of a speaker's cell that names one. A speaker not in the
// pool is «מדולג» (the escorts' file adds no one).
import type { ContactFlags, EscortsPayload, ImportChannel, PrefsRow } from "../data/imports";
import { IMPORT_CHANNELS } from "../data/importRules";
import { LIMITS } from "../data/speakerRules";
import { nameKey } from "../domain/nameKey";
import type { ContactPref, Speaker } from "../domain/types";
import { CONTACT_PREF_LABEL } from "../lib/labels";
import type { MatchContext } from "./candidates";
import { columnsOf, FIELDS, HEADER_SEARCH, headerKey, type Mapping } from "./fields";
import { foldContact, hasContact, stripContacts } from "./phone";
import { actionOf, type Choice, fillPlan, matchSpeaker, type RowStatus, type SpeakerFill, type SpeakerMatch } from "./match";
import { cellOf, dataRows, type HeaderAt } from "./rows";
import { splitSpeakers, splitTitle } from "./speakerName";
import type { Grid } from "./table";

export { IMPORT_CHANNELS };
export type { ImportChannel };

/** The list the admin chooses from, as the wizard says it. */
export const CHANNEL_LABEL: Record<ImportChannel, string> = { ...CONTACT_PREF_LABEL, other: "אחר (כותבים בהערה)" };

/**
 * A word that speaks of an escort or a trainee, anywhere in a header or a phrase: «מלווה», «מלוה» (one vav), «מלווה/ת»,
 * «ליווי», «חניך/ה», «שם החניך/ה».
 */
export const ESCORT_COLUMN = /מלוו|מלוה|ליוו|חניכ|חניך/;
/**
 * A cell that reads as that column's header wherever it stands (compared by headerKey): «מלווה», «מלוה», «מלווה/ת»,
 * «המלווה», «שם המלווה», «מלווים», «מלווה 2», «ליווי», «חניך/ה», «שם החניך/ה», «חניכים».
 */
const ESCORT_HEADER = /^(?:שם)?ה?(?:מלוו?(?:ה|ת|ים|ות|הת|ית)?|ליווי?|חניכ(?:ה|ים|ות)|חניך(?:ה)?)[0-9]*$/;
export const looksLikeEscortHeader = (cell: string) => ESCORT_HEADER.test(headerKey(cell));

/** Every header a kind reads by itself («מרצה», «טלפון», «שיעור ב»…), as compared. */
const FIELD_HEADERS = new Set(Object.values(FIELDS).flatMap((fs) => fs.flatMap((f) => f.headers.map(headerKey))));

/**
 * The columns the escorts' names are in — never mappable, in any kind: the header row's cell says so, or a cell of the
 * header row chosen or a row below it, among the table's first rows, reads as that header (the header row chosen too
 * high, or none). The rows ABOVE the header row chosen are not looked at — a title paragraph «מלווים» over the table
 * blocks nothing — and a column whose header in the row chosen is a field's own («מרצה») is never blocked. A guard
 * only: in the escorts' file the admin is always asked which column it is, and in the tracking sheet whenever a
 * header or a first row looks like one (escortLike).
 */
export function escortColumns(grid: Grid, headerRow: HeaderAt): Set<number> {
  const out = new Set<number>();
  const width = grid[0]?.length ?? 0;
  const below = grid.slice(headerRow ?? 0, Math.max(HEADER_SEARCH, (headerRow ?? 0) + 1));
  for (let i = 0; i < width; i++) {
    const head = headerRow == null ? "" : (grid[headerRow]?.[i] ?? "");
    if (headerRow != null && ESCORT_COLUMN.test(head)) out.add(i);
    else if (headerRow != null && FIELD_HEADERS.has(headerKey(head))) continue;
    else if (below.some((r) => looksLikeEscortHeader(r[i] ?? ""))) out.add(i);
  }
  return out;
}

/**
 * Does the table look like it has an escorts' column — a header of the header row chosen speaks of escorts or trainees
 * («מלוה», «ליווי», «שם החניך/ה»…), or a cell of its first rows reads as such a header (the header row chosen wrong, or
 * none): the tracking sheet then asks which column is theirs.
 */
export function escortLike(grid: Grid, headerRow: HeaderAt): boolean {
  if (headerRow != null && (grid[headerRow] ?? []).some((c) => ESCORT_COLUMN.test(c))) return true;
  return grid.slice(0, HEADER_SEARCH).some((r) => r.some(looksLikeEscortHeader));
}

/** A value of the escorts' column that names no one: «אין», «לא צריך», «מגיע/ה לבד», «—», «TBD», «?». */
const FILLER = /^(?:אין(?: מלווה| מלווים| צורך)?|בלי(?: מלווה)?|ללא(?: מלווה)?|לא(?: צריך| צריכה| צריך\/ה| רלוונטי| ידוע)?|מגיע(?:\/ה|ה)?(?: לבד)?|מגיעים לבד|לבד|עצמאי(?:\/ת|ת)?|tbd|x|\?+|[-–—־.]+)$/i;
/** Words that are no one's name, in a value of that column («חניך X ו…», «(שנה ב)», «מחליפה:» aside). */
export const NOT_A_NAME: ReadonlySet<string> = new Set([
  "אין", "לא", "צריך", "צריכה", "מגיע", "מגיעה", "מגיעים", "לבד", "ללא", "בלי", "עם", "של", "את", "או", "גם", "רק", "הרב", "הרבנית", "רב", "דר", "פרופ", "שנה", "שנת",
  "מלווה", "מלווים", "מלוות", "מחליף", "מחליפה", "במקום", "tbd",
]);

/**
 * The escorts' names as the file writes them — the data cells of their columns, by line, comma, «+», a bracket, « / »
 * or « - » (what a bracket holds is a name too: a second escort, a nickname, a stand-in); a phone, an e-mail and digits
 * out; a value that names no one («אין», «מגיע/ה לבד») skipped — read only in the page (namedEscort); never imported.
 */
export function escortNames(grid: Grid, headerRow: HeaderAt, columns: ReadonlySet<number>): string[] {
  const out = new Set<string>();
  for (const { cells } of dataRows(grid, headerRow)) {
    for (const i of columns) {
      const cell = stripContacts(cells[i] ?? "").text.replace(/[0-9]+/g, " ");
      for (const n of cell.split(/\n|[,;:+()[\]{}]|\s[/\-–—־]\s/)) {
        const name = n.replace(/\s+/g, " ").trim();
        // a part with no word of a name («(שנה ב)», «מחליפה»): no one
        if ([...name].length >= 2 && !looksLikeEscortHeader(name) && !FILLER.test(name.replace(/[.:!]+$/, "")) && escortWords([name]).size > 0) out.add(name);
      }
    }
  }
  return [...out];
}

const WORD = /[A-Za-zא-ת]+/g;
/** A text's words as compared: what shows nothing and the niqqud out, quote marks out («ג'ני» is «גני»), Latin in lower case. */
const wordsOf = (s: string) => (foldContact(s).replace(/[֑-ׇ"'״׳`]/g, "").match(WORD) ?? []).map((w) => w.toLowerCase());

/**
 * The words an escort may be named by: every word of 2 letters or more of each name (a first name, a surname); a word
 * that begins with «ו» also without it — two names joined («… וחניכה …», «(ונועם …)»). Words that are no one's name
 * (NOT_A_NAME) aside.
 */
export function escortWords(names: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    for (const w of wordsOf(n)) {
      if (NOT_A_NAME.has(w)) continue;
      if (w.length >= 2) out.add(w);
      if (w.startsWith("ו") && w.length >= 3 && !NOT_A_NAME.has(w.slice(1))) out.add(w.slice(1));
    }
  }
  return out;
}

/** The escort's word a text holds — a word of it, alone or after up to four Hebrew prefix letters (ו ה ב כ ל מ ש) — or null. A warning, and a default; never a gate. */
export function namedEscort(text: string, names: readonly string[] | ReadonlySet<string>): string | null {
  const words = names instanceof Set ? names : escortWords(names as readonly string[]);
  if (words.size === 0) return null;
  for (const w of wordsOf(text)) {
    for (let k = 0; k <= 4 && w.length - k >= 2; k++) {
      if (k > 0 && !/^[והבכלמש]+$/.test(w.slice(0, k))) break;
      if (words.has(w.slice(k))) return w.slice(k);
    }
  }
  return null;
}

/** It speaks of the escort («המלווה יתאם…», «החניכה»). */
export const mentionsEscort = (text: string) => ESCORT_COLUMN.test(text);

const CHANNELS: [RegExp, ContactPref][] = [
  [/מזכיר/, "secretary"],
  // the word's spellings, whole (וואטסאפ, ווטסאפ, וואצאפ, ווצאפ…) — never «וספ» inside נוספות, תוספת, הוספה
  [/(?<![א-ת])[בלוה]?ו{1,2}א?(?:טס|טצ|צ|ס)א?[פף](?![א-ת])|whats\s?app/i, "whatsapp"],
  [/מייל|אימייל|דוא["״]?ל|e-?mail/i, "email"],
  [/טלפון|להתקשר|בנייד|נייד|שיחה/, "phone"],
];
const MONEY_OR_TRANSPORT = /תשלום|לשלם|שכר|כסף|העברה בנקאית|חשבונית|קבלה|₪|ש["״]ח|שקל|הסעה|נסיעה|לנסוע|חניה|חנייה|לאסוף|איסוף|נהג|מונית|רכבת|אוטובוס|דלק|טרמפ/;

/** The one channel a phrase names, or null. */
export function channelOf(phrase: string): ContactPref | null {
  const found = CHANNELS.filter(([re]) => re.test(phrase)).map(([, c]) => c);
  return found.length === 1 ? found[0] : null;
}

/** About payment or transport: set apart (derived from the lesson), never a reason for the channel. */
export const isMoneyOrTransport = (phrase: string) => MONEY_OR_TRANSPORT.test(phrase);

/** A cell's phrases: split at lines, semicolons, bullets and sentence ends — never at an initial («ח. לדוגמה»). */
export function splitPhrases(cell: string): string[] {
  return cell
    .split(/\n|;|•|(?<!(?:^|[\s(])[A-Za-zא-ת])\.(?=\s|$)/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => [...p].length >= 2);
}

/** A phrase as compared (the same phrase twice is shown once). */
export const phraseKey = (p: string) => p.replace(/\s+/g, " ").trim().toLowerCase();

export interface EscortsRow {
  row: number;
  skip: string | null;
  /** The speaker's name key, and the name as written. */
  key: string;
  name: string;
  /** Its phrases — a phone or an e-mail taken out of the cell first (stripContacts), then split. Shown, never sent. */
  phrases: string[];
  /** A phone or an e-mail was taken out of its cells (said in the preview). */
  contactsOut: boolean;
}

export function readEscorts(grid: Grid, m: Mapping, o: { headerRow: number | null; titles: readonly string[] }): EscortsRow[] {
  return dataRows(grid, o.headerRow).map(({ row, cells }) => {
    // the speaker as named — a phone or an e-mail beside the name is no part of it (matched by the name alone)
    const [first] = splitSpeakers(stripContacts(cellOf(cells, m, "speaker")).text);
    const { name } = splitTitle(first ?? "", o.titles);
    const key = nameKey(name);
    let contactsOut = false;
    const phrases = columnsOf(m, "phrases").flatMap((i) => {
      const st = stripContacts(cells[i] ?? "");
      if (st.phones.length || st.emails.length) contactsOut = true;
      return splitPhrases(st.text);
    });
    if (!key) return { row, skip: "אין מרצה", key, name, phrases, contactsOut };
    if (phrases.length === 0) return { row, skip: "אין ניסוחים", key, name, phrases, contactsOut };
    return { row, skip: null, key, name, phrases, contactsOut };
  });
}

/** A phrase of the file as the preview shows it — read-only: the reason for the channel proposed. */
export interface ShownPhrase {
  text: string;
  /** The channel it names (one), or null. */
  channel: ContactPref | null;
  /** About payment or transport: no reason for anything. */
  money: boolean;
  /** An escort's word it holds (namedEscort) — said beside it; nothing of it is saved in any case. */
  escort: string | null;
  /** It speaks of the escort. */
  mentions: boolean;
}

/** The channel the phrases suggest («הצעה»): the one channel those not about payment or transport name — else none. */
export function suggestChannel(phrases: readonly Pick<ShownPhrase, "channel" | "money">[]): ImportChannel | null {
  const found = [...new Set(phrases.filter((p) => !p.money && p.channel).map((p) => p.channel!))];
  return found.length === 1 ? found[0] : null;
}

export interface EscortsPreview {
  key: string;
  name: string;
  rows: number[];
  status: RowStatus;
  reason: string | null;
  match: SpeakerMatch | null;
  /** The pool speaker it completes («תואם»), for what a choice would fill. */
  target: Speaker | null;
  /** The file's phrases about the speaker, each once — shown, never sent. */
  phrases: ShownPhrase[];
  /** The list's pre-selection («הצעה»). */
  suggested: ImportChannel | null;
  warnings: string[];
}

/** One line per speaker of the pool: the file's phrases (shown), the channel they suggest, the match. */
export function previewEscorts(rows: EscortsRow[], ctx: MatchContext, names: readonly string[] = []): EscortsPreview[] {
  const by = new Map<string, EscortsRow[]>();
  for (const r of rows) if (!r.skip) by.set(r.key, [...(by.get(r.key) ?? []), r]);
  const out: EscortsPreview[] = [];
  const blank = { match: null, target: null, phrases: [], suggested: null, warnings: [] };
  for (const r of rows) if (r.skip) out.push({ key: r.key, name: r.name, rows: [r.row], status: "skip", reason: r.skip, ...blank });
  const words = escortWords(names);
  for (const [key, rs] of by) {
    const seen = new Set<string>();
    const phrases: ShownPhrase[] = [];
    for (const p of rs.flatMap((r) => r.phrases)) {
      if (seen.has(phraseKey(p))) continue;
      seen.add(phraseKey(p));
      phrases.push({ text: p, channel: channelOf(p), money: isMoneyOrTransport(p), escort: namedEscort(p, words), mentions: mentionsEscort(p) });
    }
    const warnings = rs.some((r) => r.contactsOut) ? ["הוסר טלפון או מייל מהניסוחים שבקובץ (לא נשמרים בכל מקרה — נשמרים רק הערוץ וההערה שלך)"] : [];
    const base = { key, name: rs[0].name, rows: rs.map((r) => r.row), phrases, suggested: suggestChannel(phrases), warnings };
    const m = matchSpeaker(key, null, ctx.pool, new Map());
    if (m.status === "new") {
      out.push({ ...base, status: "skip", reason: "לא במאגר — קודם מייבאים את המועמדים או את גיליון המעקב", match: null, target: null });
      continue;
    }
    const target = m.status === "match" ? (ctx.pool.find((s) => s.id === m.target) ?? null) : null;
    out.push({ ...base, status: m.status, reason: null, match: { ...m, allowNew: false }, target });
  }
  return out.sort((a, b) => a.rows[0] - b.rows[0]);
}

/** The admin's answer for a speaker: the channel from the list (null: nothing is saved for them), and their own note. */
export interface EscortAnswer {
  channel: ImportChannel | null;
  note: string;
}

/** What is wrong with a note the admin typed (it blocks «ייבוא»), or null. */
export function noteProblem(note: string): string | null {
  const t = note.trim();
  if (hasContact(t)) return "בהערה יש טלפון או מייל — מוחקים אותו (ההערה אומרת איך פונים, לא מספר)";
  if ([...t].length > LIMITS.secretary_note) return `ההערה ארוכה מ-${LIMITS.secretary_note} תווים`;
  return null;
}

/** What an answer would save for a speaker: nothing (null) — no channel, or «אחר» with no note — or its channel and note. */
export function answerSaves(a: EscortAnswer | undefined): { contact_pref: ContactPref | null; note: string | null } | null {
  if (!a?.channel) return null;
  const note = a.note.trim() || null;
  if (a.channel === "other" && !note) return null;
  return { contact_pref: a.channel === "other" ? null : a.channel, note };
}

/** What a speaker of the pool would get — only what is empty (the commit fills, never overwrites). */
export function escortFills(target: Speaker, flags: ContactFlags | undefined, a: EscortAnswer | undefined): string[] {
  const fill = escortFill(a);
  return fill ? fillPlan(target, flags, fill) : [];
}

/** What an answer would fill, as a speaker's fill (only the channel and the note) — null: it saves nothing. */
export function escortFill(a: EscortAnswer | undefined): SpeakerFill | null {
  const saves = answerSaves(a);
  return saves ? { title: null, gender: null, affiliation: null, topics: [], phone: null, email: null, notes: null, contact_pref: saves.contact_pref, secretary_note: saves.note } : null;
}

/**
 * The commit's payload: for each speaker the admin gave a channel, that channel and the admin's own note — nothing of
 * the file. Null while an «עמום» speaker with a channel waits for a choice, or while a note has a problem (noteProblem).
 */
export function escortsPayload(rows: EscortsPreview[], choices: ReadonlyMap<string, Choice>, answers: ReadonlyMap<string, EscortAnswer>): EscortsPayload | null {
  const out: PrefsRow[] = [];
  for (const r of rows) {
    if (r.status === "skip") continue;
    const a = answers.get(r.key);
    const saves = answerSaves(a);
    if (!saves) continue;
    if (noteProblem(a!.note)) return null;
    const act = actionOf(r.status, r.match, choices.get(r.key));
    if (act == null) return null;
    if (act.action !== "merge") continue;
    out.push({ row: r.rows[0], speaker_id: act.target, channel: a!.channel!, note: saves.note });
  }
  return { rows: out };
}
