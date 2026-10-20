// (c) Last year's escorts' file → only how each speaker is reached: the phrases about the contact channel («דרך
// המזכירה», «רק בוואטסאפ») go to speaker_contacts.secretary_note, and the channel itself to speakers.contact_pref when
// the ticked phrases name exactly one. The admin ticks which phrases are about the channel — a heuristic pre-ticks
// («הצעה»); phrases about payment or transport are dropped (they are derived from the lesson), and so is every other
// phrase left unticked. The escorts' names are never imported: no field takes them; a column headed «מלווה» — in the
// header row chosen, or in a row below it among the table's first rows — cannot be mapped at all, in any kind
// (escortColumns), unless the header row chosen names that column as a field («מרצה»); and their names, as the file
// writes them and as an edition's roster has them, are read in the page only to keep them OUT of a phrase — word by
// word: a phrase holding ANY word of an escort's name (a first name alone, a surname alone, a Hebrew prefix letter
// before it) is never pre-ticked, and cannot be ticked — nor kept, ticked or edited — while it holds one (a phrase's
// text is editable before it is ticked). A phone or an e-mail in a phrase is taken out of it (stripContacts) and said:
// the note says how, never a number. A speaker not in the pool is «מדולג» (the escorts' file adds no one).
import type { ContactFlags, EscortsPayload, PrefsRow } from "../data/imports";
import { LIMITS } from "../data/speakerRules";
import { nameKey } from "../domain/nameKey";
import type { ContactPref } from "../domain/types";
import type { MatchContext } from "./candidates";
import { columnsOf, FIELDS, HEADER_SEARCH, headerKey, type Mapping } from "./fields";
import { stripContacts } from "./phone";
import { actionOf, type Choice, fillPlan, matchSpeaker, type RowStatus, type SpeakerMatch } from "./match";
import { cellOf, dataRows, type HeaderAt } from "./rows";
import { splitSpeakers, splitTitle } from "./speakerName";
import type { Grid } from "./table";

/** A column the escorts' names are in — its header in the header row chosen: never read. */
export const ESCORT_COLUMN = /מלוו/;
/** A cell that reads as that column's header wherever it stands («מלווה», «מלווה/ת», «המלווה», «שם המלווה», «מלווים», «מלווה 2»). */
const ESCORT_HEADER = /^(?:שם)?ה?מלוו(?:ה|ת|ים|ות|הת)?[0-9]*$/;
export const looksLikeEscortHeader = (cell: string) => ESCORT_HEADER.test(headerKey(cell));

/** Every header a kind reads by itself («מרצה», «טלפון», «שיעור ב»…), as compared. */
const FIELD_HEADERS = new Set(Object.values(FIELDS).flatMap((fs) => fs.flatMap((f) => f.headers.map(headerKey))));

/**
 * The columns the escorts' names are in — never mappable, in any kind: the header row's cell says so, or a cell of the
 * header row chosen or a row below it, among the table's first rows, reads as that header (the header row chosen too
 * high, or none). The rows ABOVE the header row chosen are not looked at — a title paragraph «מלווים» over the table
 * blocks nothing — and a column whose header in the row chosen is a field's own («מרצה») is never blocked.
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

/** A value of the escorts' column that names no one: «אין», «לא צריך», «מגיע/ה לבד», «—», «TBD», «?». */
const FILLER = /^(?:אין(?: מלווה| מלווים| צורך)?|בלי(?: מלווה)?|ללא(?: מלווה)?|לא(?: צריך| צריכה| צריך\/ה| רלוונטי| ידוע)?|מגיע(?:\/ה|ה)?(?: לבד)?|מגיעים לבד|לבד|עצמאי(?:\/ת|ת)?|tbd|x|\?+|[-–—־.]+)$/i;
/** Words that are no one's name, in a value of that column («חניך X ו…», «(שנה ב)» aside): never a reason to lock a phrase. */
export const NOT_A_NAME: ReadonlySet<string> = new Set(["אין", "לא", "צריך", "צריכה", "מגיע", "מגיעה", "מגיעים", "לבד", "ללא", "בלי", "עם", "של", "את", "או", "גם", "רק", "הרב", "הרבנית", "רב", "דר", "פרופ", "שנה", "שנת", "מלווה", "מלווים", "מלוות", "tbd"]);

/**
 * The escorts' names as the file writes them — the data cells of their columns, by line, comma, «+», « / » or « - »;
 * a phone, an e-mail, a bracket («(שנה ב)») and digits out; a value that names no one («אין», «מגיע/ה לבד») skipped —
 * read only to keep them out of the phrases (namedEscort); never imported, never kept.
 */
export function escortNames(grid: Grid, headerRow: HeaderAt, columns: ReadonlySet<number>): string[] {
  const out = new Set<string>();
  for (const { cells } of dataRows(grid, headerRow)) {
    for (const i of columns) {
      const cell = stripContacts(cells[i] ?? "").text.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ").replace(/[0-9]+/g, " ");
      for (const n of cell.split(/\n|[,;+()[\]{}]|\s[/\-–—־]\s/)) {
        const name = n.replace(/\s+/g, " ").trim();
        if ([...name].length >= 2 && !looksLikeEscortHeader(name) && !FILLER.test(name.replace(/[.:!]+$/, ""))) out.add(name);
      }
    }
  }
  return [...out];
}

const WORD = /[A-Za-z\u05D0-\u05EA]+/g;
/** A text's words as compared: quote marks out («ג'ני» is «גני» on both sides), Latin in lower case. */
const wordsOf = (s: string) => (s.replace(/["'״׳`]/g, "").match(WORD) ?? []).map((w) => w.toLowerCase());

/**
 * The words an escort may be named by: every word of 2 letters or more of each name (a first name, a surname); a word
 * that begins with «ו» after the first («… וחניכה …») also without it — two names joined. Words that are no one's name
 * (NOT_A_NAME) aside.
 */
export function escortWords(names: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    wordsOf(n).forEach((w, i) => {
      if (NOT_A_NAME.has(w)) return;
      if (w.length >= 2) out.add(w);
      if (i > 0 && w.startsWith("ו") && w.length >= 3 && !NOT_A_NAME.has(w.slice(1))) out.add(w.slice(1));
    });
  }
  return out;
}

/** The escort's word a phrase holds — a word of it, alone or after one or two Hebrew prefix letters (ו ה ב כ ל מ ש) — or null. */
export function namedEscort(phrase: string, names: readonly string[] | ReadonlySet<string>): string | null {
  const words = names instanceof Set ? names : escortWords(names as readonly string[]);
  if (words.size === 0) return null;
  for (const w of wordsOf(phrase)) {
    for (let k = 0; k <= 2 && w.length - k >= 2; k++) {
      if (k > 0 && !/^[והבכלמש]+$/.test(w.slice(0, k))) break;
      if (words.has(w.slice(k))) return w.slice(k);
    }
  }
  return null;
}

/** It speaks of the escort («המלווה יתאם…»): not pre-ticked — the channel is the speaker's, and a name may be beside it. */
export const mentionsEscort = (phrase: string) => ESCORT_COLUMN.test(phrase);

const CHANNELS: [RegExp, ContactPref][] = [
  [/מזכיר/, "secretary"],
  // the word's spellings, whole (וואטסאפ, ווטסאפ, וואצאפ, ווצאפ…) — never «וספ» inside נוספות, תוספת, הוספה
  [/(?<![א-ת])[בלוה]?ו{1,2}א?(?:טס|טצ|צ|ס)א?[פף](?![א-ת])|whats\s?app/i, "whatsapp"],
  [/מייל|אימייל|דוא["״]?ל|e-?mail/i, "email"],
  [/טלפון|להתקשר|בנייד|נייד|שיחה/, "phone"],
];
const CONTACT_WORDS = /דרך|לפנות|פנייה|ליצור קשר|יצירת קשר|לא לשלוח|לא להתקשר|זמין|בשעות/;
const MONEY_OR_TRANSPORT = /תשלום|לשלם|שכר|כסף|העברה בנקאית|חשבונית|קבלה|₪|ש["״]ח|שקל|הסעה|נסיעה|לנסוע|חניה|חנייה|לאסוף|איסוף|נהג|מונית|רכבת|אוטובוס|דלק|טרמפ/;

/** The one channel a phrase names, or null. */
export function channelOf(phrase: string): ContactPref | null {
  const found = CHANNELS.filter(([re]) => re.test(phrase)).map(([, c]) => c);
  return found.length === 1 ? found[0] : null;
}

/** About payment or transport: dropped, never ticked (derived from the lesson). */
export const isMoneyOrTransport = (phrase: string) => MONEY_OR_TRANSPORT.test(phrase);

/** About the contact channel — the heuristic that pre-ticks a phrase («הצעה»); never one that speaks of the escort. */
export const isContactPhrase = (phrase: string) =>
  !isMoneyOrTransport(phrase) && !mentionsEscort(phrase) && (CHANNELS.some(([re]) => re.test(phrase)) || CONTACT_WORDS.test(phrase));

/** A cell's phrases: split at lines, semicolons, bullets and sentence ends — never at an initial («ח. לדוגמה»). */
export function splitPhrases(cell: string): string[] {
  return cell
    .split(/\n|;|•|(?<!(?:^|[\s(])[A-Za-z\u05D0-\u05EA])\.(?=\s|$)/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => [...p].length >= 2);
}

/** A phrase as the table groups it. */
export const phraseKey = (p: string) => p.replace(/\s+/g, " ").trim().toLowerCase();

export interface EscortsRow {
  row: number;
  skip: string | null;
  /** The speaker's name key, and the name as written. */
  key: string;
  name: string;
  /** Its phrases — a phone or an e-mail taken out of the cell first (stripContacts), then split: a number broken over a
   * line is one number, never two «phrases» of digits. */
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

export interface Phrase {
  key: string;
  text: string;
  count: number;
  channel: ContactPref | null;
  /** The heuristic's tick («הצעה») — never on a phrase that names an escort or speaks of one. */
  contact: boolean;
  /** About payment or transport: dropped. */
  money: boolean;
  /** The escort's name it holds (namedEscort): not tickable until edited out. */
  escort: string | null;
  /** It speaks of the escort («המלווה…»). */
  mentions: boolean;
}

/** The phrases, grouped; `names`: the escorts' (escortNames, and an edition's roster) — a phrase holding one is never pre-ticked. */
export function phrasesOf(rows: EscortsRow[], names: readonly string[] = []): Phrase[] {
  const m = new Map<string, Phrase>();
  const words = escortWords(names);
  for (const r of rows) {
    if (r.skip) continue;
    for (const p of r.phrases) {
      const k = phraseKey(p);
      const escort = namedEscort(p, words);
      const mentions = mentionsEscort(p);
      const e = m.get(k) ?? { key: k, text: p, count: 0, channel: channelOf(p), contact: isContactPhrase(p) && !escort, money: isMoneyOrTransport(p), escort, mentions };
      e.count++;
      m.set(k, e);
    }
  }
  return [...m.values()];
}

export interface EscortsPreview {
  key: string;
  name: string;
  rows: number[];
  status: RowStatus;
  reason: string | null;
  match: SpeakerMatch | null;
  contact_pref: ContactPref | null;
  secretary_note: string | null;
  warnings: string[];
  fills: string[];
}

/** A phrase's text as the admin edited it (spaces single) — its own text when not edited. */
export const editedText = (p: string, edits: ReadonlyMap<string, string> | undefined) => (edits?.get(phraseKey(p)) ?? p).replace(/\s+/g, " ").trim();

/**
 * One line per speaker: their ticked phrases (as edited), the one channel those name, and what would be filled. A
 * phrase about payment or transport, or one that still holds an escort's name (a word of it), is never kept — ticked or
 * not; a phone or an e-mail (the file's, or one typed into an edit) is taken out of a phrase kept, and said.
 */
export function previewEscorts(rows: EscortsRow[], ticked: ReadonlySet<string>, ctx: MatchContext, edits?: ReadonlyMap<string, string>, names: readonly string[] = []): EscortsPreview[] {
  const by = new Map<string, EscortsRow[]>();
  for (const r of rows) if (!r.skip) by.set(r.key, [...(by.get(r.key) ?? []), r]);
  const out: EscortsPreview[] = [];
  for (const r of rows) {
    if (r.skip) out.push({ key: r.key, name: r.name, rows: [r.row], status: "skip", reason: r.skip, match: null, contact_pref: null, secretary_note: null, warnings: [], fills: [] });
  }
  const words = escortWords(names);
  for (const [key, rs] of by) {
    let typedOut = false;
    const phrases = [
      ...new Set(
        rs
          .flatMap((r) => r.phrases)
          .filter((p) => ticked.has(phraseKey(p)))
          .map((p) => {
            const st = stripContacts(editedText(p, edits));
            if (st.phones.length || st.emails.length) typedOut = true;
            return st.text.replace(/\s+/g, " ").trim();
          })
          .filter((p) => [...p].length >= 2 && !isMoneyOrTransport(p) && namedEscort(p, words) == null),
      ),
    ];
    const channels = [...new Set(phrases.map(channelOf).filter((c): c is ContactPref => c != null))];
    const warnings: string[] = [];
    if (typedOut || rs.some((r) => r.contactsOut)) warnings.push("הוסר טלפון או מייל מהניסוחים — לא נשמר (ההערה אומרת איך פונים, לא מספר)");
    let note: string | null = phrases.join(" · ") || null;
    if (note && [...note].length > LIMITS.secretary_note) {
      warnings.push(`הניסוחים ארוכים מ-${LIMITS.secretary_note} תווים — לא נשמרים`);
      note = null;
    }
    const base = { key, name: rs[0].name, rows: rs.map((r) => r.row), contact_pref: channels.length === 1 ? channels[0] : null, secretary_note: note, warnings };
    if (!note && base.contact_pref == null) {
      out.push({ ...base, status: "skip", reason: "אין ניסוח מסומן על ערוץ הקשר", match: null, fills: [] });
      continue;
    }
    const m = matchSpeaker(key, null, ctx.pool, new Map());
    if (m.status === "new") {
      out.push({ ...base, status: "skip", reason: "לא במאגר — קודם מייבאים את המועמדים או את גיליון המעקב", match: null, fills: [] });
      continue;
    }
    const match = { ...m, allowNew: false };
    const target = m.status === "match" ? ctx.pool.find((s) => s.id === m.target) : undefined;
    const fills = target
      ? fillPlan(target, ctx.flags.get(target.id) as ContactFlags | undefined, { title: null, gender: null, affiliation: null, topics: [], phone: null, email: null, notes: null, contact_pref: base.contact_pref, secretary_note: note })
      : [];
    out.push({ ...base, status: m.status, reason: null, match, fills });
  }
  return out.sort((a, b) => a.rows[0] - b.rows[0]);
}

/** The commit's payload — null while an «עמום» speaker waits for a choice. */
export function escortsPayload(rows: EscortsPreview[], choices: ReadonlyMap<string, Choice>): EscortsPayload | null {
  const out: PrefsRow[] = [];
  for (const r of rows) {
    if (r.status === "skip") continue;
    const a = actionOf(r.status, r.match, choices.get(r.key));
    if (a == null) return null;
    if (a.action !== "merge") continue;
    out.push({ row: r.rows[0], speaker_id: a.target, contact_pref: r.contact_pref, secretary_note: r.secretary_note });
  }
  return { rows: out };
}
