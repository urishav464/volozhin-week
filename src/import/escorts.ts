// (c) Last year's escorts' file → only how each speaker is reached: the phrases about the contact channel («דרך
// המזכירה», «רק בוואטסאפ») go to speaker_contacts.secretary_note, and the channel itself to speakers.contact_pref when
// the ticked phrases name exactly one. The admin ticks which phrases are about the channel — a heuristic pre-ticks
// («הצעה»); phrases about payment or transport are dropped (they are derived from the lesson), and so is every other
// phrase left unticked. The escorts' names are never imported: no field takes them, and a column headed «מלווה»
// cannot be mapped at all. A speaker not in the pool is «מדולג» (the escorts' file adds no one).
import type { ContactFlags, EscortsPayload, PrefsRow } from "../data/imports";
import { LIMITS } from "../data/speakerRules";
import { nameKey } from "../domain/nameKey";
import type { ContactPref } from "../domain/types";
import type { MatchContext } from "./candidates";
import { columnsOf, type Mapping } from "./fields";
import { actionOf, type Choice, fillPlan, matchSpeaker, type RowStatus, type SpeakerMatch } from "./match";
import { cellOf, dataRows } from "./rows";
import { splitSpeakers, splitTitle } from "./speakerName";
import type { Grid } from "./table";

/** A column the escorts' names are in: never read. */
export const ESCORT_COLUMN = /מלוו/;

const CHANNELS: [RegExp, ContactPref][] = [
  [/מזכיר/, "secretary"],
  [/ו{1,2}א?[טצ]?[סצ]א?פ|whats\s?app/i, "whatsapp"],
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

/** About the contact channel — the heuristic that pre-ticks a phrase («הצעה»). */
export const isContactPhrase = (phrase: string) => !isMoneyOrTransport(phrase) && (CHANNELS.some(([re]) => re.test(phrase)) || CONTACT_WORDS.test(phrase));

/** A cell's phrases: split at lines, semicolons, bullets and sentence ends. */
export function splitPhrases(cell: string): string[] {
  return cell
    .split(/\n|;|•|\.(?=\s|$)/)
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
  phrases: string[];
}

export function readEscorts(grid: Grid, m: Mapping, o: { headerRow: boolean; titles: readonly string[] }): EscortsRow[] {
  return dataRows(grid, o.headerRow).map(({ row, cells }) => {
    const [first] = splitSpeakers(cellOf(cells, m, "speaker"));
    const { name } = splitTitle(first ?? "", o.titles);
    const key = nameKey(name);
    const phrases = columnsOf(m, "phrases").flatMap((i) => splitPhrases(cells[i] ?? ""));
    if (!key) return { row, skip: "אין מרצה", key, name, phrases };
    if (phrases.length === 0) return { row, skip: "אין ניסוחים", key, name, phrases };
    return { row, skip: null, key, name, phrases };
  });
}

export interface Phrase {
  key: string;
  text: string;
  count: number;
  channel: ContactPref | null;
  /** The heuristic's tick («הצעה»). */
  contact: boolean;
  /** About payment or transport: dropped. */
  money: boolean;
}

export function phrasesOf(rows: EscortsRow[]): Phrase[] {
  const m = new Map<string, Phrase>();
  for (const r of rows) {
    if (r.skip) continue;
    for (const p of r.phrases) {
      const k = phraseKey(p);
      const e = m.get(k) ?? { key: k, text: p, count: 0, channel: channelOf(p), contact: isContactPhrase(p), money: isMoneyOrTransport(p) };
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

/** One line per speaker: their ticked phrases, the one channel those name, and what would be filled. */
export function previewEscorts(rows: EscortsRow[], ticked: ReadonlySet<string>, ctx: MatchContext): EscortsPreview[] {
  const by = new Map<string, EscortsRow[]>();
  for (const r of rows) if (!r.skip) by.set(r.key, [...(by.get(r.key) ?? []), r]);
  const out: EscortsPreview[] = [];
  for (const r of rows) {
    if (r.skip) out.push({ key: r.key, name: r.name, rows: [r.row], status: "skip", reason: r.skip, match: null, contact_pref: null, secretary_note: null, warnings: [], fills: [] });
  }
  for (const [key, rs] of by) {
    const phrases = [...new Set(rs.flatMap((r) => r.phrases).filter((p) => ticked.has(phraseKey(p)) && !isMoneyOrTransport(p)))];
    const channels = [...new Set(phrases.map(channelOf).filter((c): c is ContactPref => c != null))];
    const warnings: string[] = [];
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
