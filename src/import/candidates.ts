// (a) The candidates → the speaker pool. Each row: the title split from the name (the edition's titles), the name's
// key, the affiliation, the topics as tags (one line ≤ 40, at most 10 — the rest of the cell goes to the note, never
// cut), the phone and e-mail (to speaker_contacts only), and every status-like column («טווח ימים», «נסגר») and note
// column as a line of the note «כותרת: ערך» — no meaning invented for them. Gender only from הרב / הרבנית, as a
// «הצעה» the admin may turn off. Matching: src/import/match.ts.
import type { CandidatesPayload, ContactFlags, SpeakerRow } from "../data/imports";
import { IMPORT_RULES } from "../data/importRules";
import { LIMITS } from "../data/speakerRules";
import { nameKey } from "../domain/nameKey";
import type { Gender, Speaker } from "../domain/types";
import type { Mapping } from "./fields";
import { actionOf, type Choice, fillPlan, matchSpeaker, type RowStatus, type SpeakerMatch } from "./match";
import { normalizeEmail, normalizePhone } from "./phone";
import { cellOf, columnNames, dataRows, labelledCells, noteLines } from "./rows";
import { pickTitleCell, splitTitle, titleGender } from "./speakerName";
import type { Grid } from "./table";

export interface CandidateData {
  title: string | null;
  name: string;
  key: string;
  gender: Gender | null;
  affiliation: string | null;
  topics: string[];
  phone: string | null;
  phoneKey: string | null;
  email: string | null;
  notes: string | null;
}

export interface CandidateRead {
  row: number;
  data: CandidateData | null;
  /** Why the row is «מדולג» (null: it was read). */
  skip: string | null;
  /** What the row will not keep, said beside it («הטלפון לא נשמר»). */
  warnings: string[];
}

export interface ReadOptions {
  headerRow: boolean;
  titles: readonly string[];
  /** «הצעה»: gender from the title הרב / הרבנית. */
  genderFromTitle: boolean;
}

const chars = (s: string) => [...s].length;
const oneLine = (s: string) => s.replace(/\n/g, " ").trim();

/** Topics as tags: split at commas, semicolons and lines; a tag ≤ 40, at most 10 — the rest back to the note. */
export function splitTopics(cell: string): { tags: string[]; rest: string[] } {
  const tags: string[] = [];
  const rest: string[] = [];
  for (const t of cell.split(/[,;،\n•]+/).map((x) => x.trim()).filter(Boolean)) {
    if (chars(t) <= LIMITS.topic && tags.length < LIMITS.topics && !tags.includes(t)) tags.push(t);
    else if (!tags.includes(t)) rest.push(t);
  }
  return { tags, rest };
}

export function readCandidates(grid: Grid, m: Mapping, o: ReadOptions): CandidateRead[] {
  const names = columnNames(grid, o.headerRow);
  const seen = new Map<string, number>();
  return dataRows(grid, o.headerRow).map(({ row, cells }) => {
    const warnings: string[] = [];
    const skip = (why: string): CandidateRead => ({ row, data: null, skip: why, warnings });
    const raw = oneLine(cellOf(cells, m, "name"));
    if (!raw) return skip("אין שם");
    let { title, name } = splitTitle(raw, o.titles);
    const notes: string[] = [];
    const titleCell = oneLine(cellOf(cells, m, "title"));
    if (titleCell && !title) {
      title = pickTitleCell(titleCell, o.titles);
      if (!title) {
        notes.push(`תואר: ${titleCell}`);
        warnings.push(`התואר «${titleCell}» לא ברשימת התארים — נשמר בהערה`);
      }
    }
    if (chars(name) > LIMITS.name) return skip(`השם ארוך מ-${LIMITS.name} תווים`);
    const key = nameKey(name);
    if (!key) return skip("אין שם");
    const first = seen.get(key);
    if (first != null) return skip(`כפול בטבלה (כמו שורה ${first})`);
    seen.set(key, row);
    const gender = o.genderFromTitle ? titleGender(title) : null;
    let affiliation: string | null = oneLine(cellOf(cells, m, "affiliation")) || null;
    if (affiliation && chars(affiliation) > LIMITS.affiliation) {
      notes.push(`מוסד: ${affiliation}`);
      warnings.push("המוסד ארוך — נשמר בהערה");
      affiliation = null;
    }
    const { tags, rest } = splitTopics(cellOf(cells, m, "topics"));
    if (rest.length) notes.push(`נושאים: ${rest.join(", ")}`);
    const phone = normalizePhone(cellOf(cells, m, "phone"));
    if (phone.problem) warnings.push("הטלפון לא נשמר: לא נראה כמו מספר");
    const email = normalizeEmail(cellOf(cells, m, "email"));
    if (email.problem) warnings.push("המייל לא נשמר: לא נראה כמו כתובת");
    notes.push(...noteLines(labelledCells(cells, m, "status", names)), ...noteLines(labelledCells(cells, m, "note", names)));
    const note = notes.join("\n") || null;
    if (note && chars(note) > IMPORT_RULES.contact_notes) return skip(`ההערות ארוכות מ-${IMPORT_RULES.contact_notes} תווים`);
    return {
      row,
      skip: null,
      warnings,
      data: { title, name, key, gender, affiliation, topics: tags, phone: phone.value, phoneKey: phone.key, email: email.value, notes: note },
    };
  });
}

/** What import_lookup is asked: every pool speaker a row could complete, and every row's phone key. */
export function lookupFor(rows: { data: { key: string; phoneKey: string | null } | null }[], pool: readonly Speaker[]): { speakerIds: number[]; phoneKeys: string[] } {
  const ids = new Set<number>();
  const keys = new Set<string>();
  for (const r of rows) {
    if (!r.data) continue;
    for (const c of matchSpeaker(r.data.key, null, pool, new Map()).candidates) ids.add(c.id);
    if (r.data.phoneKey) keys.add(r.data.phoneKey);
  }
  return { speakerIds: [...ids].sort((a, b) => a - b), phoneKeys: [...keys].sort() };
}

export interface CandidatePreview extends CandidateRead {
  status: RowStatus;
  match: SpeakerMatch | null;
  /** «תואם»: the fields it would fill. */
  fills: string[];
}

export interface MatchContext {
  pool: readonly Speaker[];
  /** phone key → pool speakers (import_lookup). */
  phones: ReadonlyMap<string, readonly number[]>;
  /** pool speaker → which contact fields are filled (import_lookup). */
  flags: ReadonlyMap<number, ContactFlags>;
}

/** import_lookup's answer as the matching reads it. */
export function contextOf(pool: readonly Speaker[], lookup: { phones: { key: string; speaker_id: number }[]; contacts: ({ speaker_id: number } & ContactFlags)[] }): MatchContext {
  const phones = new Map<string, number[]>();
  for (const p of lookup.phones) phones.set(p.key, [...(phones.get(p.key) ?? []), p.speaker_id]);
  return { pool, phones, flags: new Map(lookup.contacts.map(({ speaker_id, ...f }) => [speaker_id, f])) };
}

export function previewCandidates(rows: CandidateRead[], ctx: MatchContext): CandidatePreview[] {
  return rows.map((r) => {
    if (!r.data) return { ...r, status: "skip" as const, match: null, fills: [] };
    const match = matchSpeaker(r.data.key, r.data.phoneKey, ctx.pool, ctx.phones);
    const target = match.status === "match" ? ctx.pool.find((s) => s.id === match.target) : undefined;
    return { ...r, status: match.status, match, fills: target ? fillPlan(target, ctx.flags.get(target.id), r.data) : [] };
  });
}

/** A row's commit line (null: left out). */
export function speakerRowOf(row: number, d: CandidateData, a: Choice): SpeakerRow | null {
  if (a.action === "skip") return null;
  return {
    row,
    action: a.action,
    speaker_id: a.action === "merge" ? a.target : null,
    title: d.title,
    name: d.name,
    gender: d.gender,
    affiliation: d.affiliation,
    topics: d.topics,
    phone: d.phone,
    email: d.email,
    notes: d.notes,
  };
}

/** The «עמום» rows still waiting for the admin's choice. */
export function undecided(rows: CandidatePreview[], choices: ReadonlyMap<number, Choice>): CandidatePreview[] {
  return rows.filter((r) => r.data && actionOf(r.status, r.match, choices.get(r.row)) == null);
}

/** The commit's payload — null while an «עמום» row waits for a choice. */
export function candidatesPayload(rows: CandidatePreview[], choices: ReadonlyMap<number, Choice>, source: string, titlesFrom: number | null): CandidatesPayload | null {
  if (undecided(rows, choices).length) return null;
  const out: SpeakerRow[] = [];
  for (const r of rows) {
    if (!r.data) continue;
    const a = actionOf(r.status, r.match, choices.get(r.row))!;
    const line = speakerRowOf(r.row, r.data, a);
    if (line) out.push(line);
  }
  return { source, titles_from: titlesFrom, rows: out };
}
