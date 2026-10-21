// (a) The candidates → the speaker pool. Each row: the title split from the name (the edition's titles), the name's
// key, the affiliation, the topics as tags (one line ≤ 40, at most 10 — the rest of the cell goes to the note, never
// cut), the phone and e-mail (to speaker_contacts only), and every status-like column («טווח ימים», «נסגר») and note
// column as a line of the note «כותרת: ערך» — no meaning invented for them. Gender only from הרב / הרבנית, as a
// «הצעה» the admin may turn off. Matching: src/import/match.ts. A phone or an e-mail anywhere else in the row is
// taken out (stripContacts): one in the name's cell becomes the row's phone or e-mail when that column is empty and
// it is the only one; every other is dropped, and the row says so — never kept in a name, a title, the affiliation, a
// tag or the note (supabase/schema.sql refuses one: «contact_in_text»). The name's cell is read as the tracking sheet
// reads a speaker's (DECISIONS «סבב רביעי», «סבב חמישי», «סבב שישי»): its first name is the row's candidate; any other
// — beside it («פלוני + פלמוני»), on a line under it, a bracket at the end of a name («הרב פלוני (ישיבת בדיקה)», «…
// (מלווה: …)»), or what follows «, », « - » or «והרב…» on its line — is an ExtraLine (src/import/lines.ts): another
// candidate (its name and title only, and its own brackets' affiliation), the row's affiliation, or left out — the read
// proposes only an institution's affiliation and an escort's «לא לייבא», and «ייבוא» waits for the rest. The name is
// matched to the pool without its brackets and tails. The admin's «עריכה» (src/import/edit.ts) replaces a row's
// name, title and affiliation as read — matched again, checked again.
import type { CandidatesPayload, ContactFlags, SpeakerRow } from "../data/imports";
import { IMPORT_RULES } from "../data/importRules";
import { LIMITS } from "../data/speakerRules";
import { nameKey } from "../domain/nameKey";
import type { Gender, Speaker } from "../domain/types";
import type { Mapping } from "./fields";
import { actionOf, ambiguousInSheet, type Choice, fillPlan, matchSpeaker, type Resolved, resolveChoice, type RowStatus, sheetMatches, type SpeakerMatch } from "./match";
import { normalizeEmail, normalizePhone, scrubContacts, stripContacts } from "./phone";
import { type SpeakerEdit, validEdit } from "./edit";
import { mentionsEscort, namedEscort } from "./escorts";
import { affiliationText, type ExtraLine, extraLine, type LineAs, lineContext, type LineKind, nameTails } from "./lines";
import { cellOf, columnNames, dataRows, labelledCells, noteLines } from "./rows";
import { pickTitleCell, splitSpeakers, splitTitle, titleGender } from "./speakerName";
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
  /** Its key — the row's number; another name of the row's cell, «row:index» (its ExtraLine's id). */
  ref: string;
  data: CandidateData | null;
  /** Why the row is «מדולג» (null: it was read). */
  skip: string | null;
  /** What the row will not keep, said beside it («הטלפון לא נשמר»). */
  warnings: string[];
  /** Its name, title and affiliation as they stand — what «עריכה» starts from (null: the row has no name to edit). */
  fields?: SpeakerEdit | null;
  /** The admin edited them («נערך ידנית»). */
  edited?: boolean;
  /** Its name still holds an escort's word (escortInName): said beside it in red, as in the tracking sheet. */
  nameWarning?: string | null;
}

export interface ReadOptions {
  /** The header row's index (null: none) — src/import/rows.ts HeaderAt. */
  headerRow: number | null;
  titles: readonly string[];
  /** «הצעה»: gender from the title הרב / הרבנית. */
  genderFromTitle: boolean;
  /** The escorts' names (a column the admin named, or found): a name of the cell that holds one is proposed «לא לייבא». */
  escorts?: readonly string[];
  /** The admin's choice for another name of a cell (ExtraLine.id → what it is). */
  lineAs?: ReadonlyMap<string, LineAs>;
  /** The admin's «עריכה» of a row (its ref → name, title, affiliation): replaces what was read. */
  edits?: ReadonlyMap<string, SpeakerEdit>;
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

/** The candidates' table: a row per candidate (and per other name of a cell the admin made one), and the cells' other names. */
export function readCandidateSheet(grid: Grid, m: Mapping, o: ReadOptions): { rows: CandidateRead[]; lines: ExtraLine[] } {
  const names = columnNames(grid, o.headerRow);
  const seen = new Map<string, number>();
  const lc = lineContext(o.escorts ?? [], o.titles);
  const lines: ExtraLine[] = [];
  const out: CandidateRead[] = [];
  for (const { row, cells } of dataRows(grid, o.headerRow)) {
    const warnings: string[] = [];
    const skip = (why: string): CandidateRead => ({ row, ref: String(row), data: null, skip: why, warnings });
    // the name's cell without a phone or an e-mail in it — one may be the row's (below); its names, line by line
    const inName = stripContacts(cellOf(cells, m, "name"));
    const parts = inName.text.split("\n").flatMap((line) => splitSpeakers(line));
    const raw = oneLine(parts[0] ?? "");
    if (!raw) {
      out.push(skip("אין שם"));
      continue;
    }
    // a bracket at the end of the name («הרב פלוני (ישיבת בדיקה)», «… (מלווה: …)») and what follows «, », « - » or
    // «והרב…» («הרב פלוני - ישיבת בדיקה»): lines of their own — the name is «פלוני»
    const { name: bare, brackets, tails } = nameTails(raw, o.titles);
    let { title, name } = splitTitle(bare, o.titles);
    const edit = validEdit(o.edits?.get(String(row)), o.titles);
    const notes: string[] = [];
    /** A field's text with every contact taken out — said once per field. */
    const clean = (text: string, field: string) => {
      const st = stripContacts(text);
      if (st.phones.length || st.emails.length) warnings.push(`הוסר טלפון או מייל מ«${field}» — לא נשמר`);
      return st.text;
    };
    const titleCell = oneLine(clean(cellOf(cells, m, "title"), "תואר"));
    if (titleCell && !title) {
      title = pickTitleCell(titleCell, o.titles);
      if (!title) {
        notes.push(`תואר: ${titleCell}`);
        warnings.push(`התואר «${titleCell}» לא ברשימת התארים — נשמר בהערה`);
      }
    }
    // the admin's «עריכה»: the name and the title as they wrote them (the affiliation below)
    if (edit) ({ title, name } = edit);
    const fields = (affiliation: string | null): SpeakerEdit => ({ title, name, affiliation });
    if (chars(name) > LIMITS.name) {
      out.push({ ...skip(`השם ארוך מ-${LIMITS.name} תווים`), fields: fields(null), edited: !!edit });
      continue;
    }
    const key = nameKey(name);
    if (!key) {
      out.push(skip("אין שם"));
      continue;
    }
    const first = seen.get(key);
    if (first != null) {
      out.push({ ...skip(`כפול בטבלה (כמו שורה ${first})`), fields: fields(edit?.affiliation ?? null), edited: !!edit });
      continue;
    }
    seen.set(key, row);
    const nameWarning = escortInName(name, lc.escorts.words);
    // the cell's other names and the name's brackets: each an ExtraLine — the admin's choice, or the read's «הצעה»
    const lineAff: string[] = [];
    const extras: { ref: string; raw: string }[] = [];
    const decide = (id: string, part: string, kind: LineKind) => {
      const l = extraLine(id, row, part, { key, name }, lc, o.lineAs, kind);
      lines.push(l);
      if (l.as === "affiliation") lineAff.push(affiliationText(part));
      else if (l.as === "speaker") extras.push({ ref: l.id, raw: affiliationText(part) });
    };
    [...brackets, ...tails].forEach((b, k) => decide(`${row}:1.${k + 1}`, b, k < brackets.length ? "bracket" : "tail"));
    // a name beside it on the first line («פלוני + פלמוני»), or a line under it
    const firstLine = inName.text.split("\n").map((line) => splitSpeakers(line).length)[0] ?? 1;
    parts.slice(1).forEach((part, k) => decide(`${row}:${k + 2}`, part, k + 1 < firstLine ? "beside" : "under"));
    const gender = o.genderFromTitle ? titleGender(title) : null;
    let affiliation: string | null = edit ? edit.affiliation : [oneLine(clean(cellOf(cells, m, "affiliation"), "מוסד")), ...lineAff].filter(Boolean).join(", ") || null;
    if (edit) clean(cellOf(cells, m, "affiliation"), "מוסד"); // a contact in the column is still said
    if (affiliation && chars(affiliation) > LIMITS.affiliation) {
      notes.push(`מוסד: ${affiliation}`);
      warnings.push("המוסד ארוך — נשמר בהערה");
      affiliation = null;
    }
    const { tags, rest } = splitTopics(clean(cellOf(cells, m, "topics"), "נושאים"));
    if (rest.length) notes.push(`נושאים: ${rest.join(", ")}`);
    let phone = normalizePhone(cellOf(cells, m, "phone"));
    if (phone.problem) warnings.push("הטלפון לא נשמר: לא נראה כמו מספר");
    let email = normalizeEmail(cellOf(cells, m, "email"));
    if (email.problem) warnings.push("המייל לא נשמר: לא נראה כמו כתובת");
    // a phone (an e-mail) in the name's cell: the row's, when its column is empty and it is the only one; else dropped
    const named = [...new Map(inName.phones.map((x) => normalizePhone(x)).filter((x) => x.value).map((x) => [x.key, x])).values()];
    if (named.length === 1 && !phone.value && !phone.problem) {
      phone = named[0];
      warnings.push("הטלפון שהיה בתא השם נשמר כטלפון של המרצה");
    } else if (named.some((x) => x.key !== phone.key) || inName.phones.length > named.length) warnings.push("הוסר טלפון מתא השם — לא נשמר");
    const mails = [...new Set(inName.emails.map((x) => normalizeEmail(x).value).filter((x): x is string => !!x))];
    if (mails.length === 1 && !email.value && !email.problem) {
      email = { value: mails[0], problem: false };
      warnings.push("המייל שהיה בתא השם נשמר כמייל של המרצה");
    } else if (mails.some((x) => x !== email.value) || inName.emails.length > mails.length) warnings.push("הוסר מייל מתא השם — לא נשמר");
    // the note's lines: a phone or an e-mail in them replaced (the note is the speaker's private note, never a contact)
    const lines2 = noteLines([...labelledCells(cells, m, "status", names), ...labelledCells(cells, m, "note", names)]);
    const sc = scrubContacts([...notes, ...lines2].join("\n"));
    if (sc.scrubbed) warnings.push("הוסר טלפון או מייל מההערה — לא נשמר");
    const note = sc.text.trim() || null;
    if (note && chars(note) > IMPORT_RULES.contact_notes) {
      out.push(skip(`ההערות ארוכות מ-${IMPORT_RULES.contact_notes} תווים`));
      continue;
    }
    out.push({
      row,
      ref: String(row),
      skip: null,
      warnings,
      nameWarning,
      fields: fields(affiliation),
      edited: !!edit,
      data: { title, name, key, gender, affiliation, topics: tags, phone: phone.value, phoneKey: phone.key, email: email.value, notes: note },
    });
    // another candidate from the cell: its name and title only — the row's other columns are the first's; a bracket at
    // the end of its name a line of its own (its affiliation, or left out — or another candidate)
    for (let e = 0; e < extras.length; e++) {
      const x = extras[e];
      const split = nameTails(oneLine(x.raw), o.titles);
      const xEdit = validEdit(o.edits?.get(x.ref), o.titles);
      const sub = xEdit ? { title: xEdit.title, name: xEdit.name } : splitTitle(split.name, o.titles);
      const k = nameKey(sub.name);
      const at = seen.get(k);
      const why = !k ? "אין שם" : chars(sub.name) > LIMITS.name ? `השם ארוך מ-${LIMITS.name} תווים` : at != null ? `כפול בטבלה (כמו שורה ${at})` : null;
      if (why) {
        out.push({ row, ref: x.ref, data: null, skip: why, warnings: [], fields: k ? { ...sub, affiliation: xEdit?.affiliation ?? null } : null, edited: !!xEdit });
        continue;
      }
      seen.set(k, row);
      const aff: string[] = [];
      [...split.brackets, ...split.tails].forEach((b, j) => {
        const l = extraLine(`${x.ref}.${j + 1}`, row, b, { key: k, name: sub.name }, lc, o.lineAs, j < split.brackets.length ? "bracket" : "tail");
        lines.push(l);
        if (l.as === "affiliation") aff.push(affiliationText(b));
        else if (l.as === "speaker") extras.push({ ref: l.id, raw: affiliationText(b) });
      });
      const joined = xEdit ? xEdit.affiliation : aff.join(", ") || null;
      const affiliation = joined && chars(joined) <= LIMITS.affiliation ? joined : null;
      out.push({
        row,
        ref: x.ref,
        skip: null,
        warnings: [
          aff.length ? "שם נוסף מתא השם — רק השם, התואר והשיוך שבסוגריים (שאר העמודות של השורה למרצה הראשון/ה)" : "שם נוסף מתא השם — רק השם והתואר (שאר העמודות של השורה למרצה הראשון/ה)",
          ...(joined && !affiliation ? [`השיוך המוסדי ארוך מ-${LIMITS.affiliation} תווים — לא נשמר`] : []),
        ],
        nameWarning: escortInName(sub.name, lc.escorts.words),
        fields: { ...sub, affiliation },
        edited: !!xEdit,
        data: { title: sub.title, name: sub.name, key: k, gender: o.genderFromTitle ? titleGender(sub.title) : null, affiliation, topics: [], phone: null, phoneKey: null, email: null, notes: null },
      });
    }
  }
  return { rows: out, lines };
}

/**
 * A name that still holds an escort's word, or a word about one, once its brackets and tails are apart («מרצה 12 בליווי
 * שירה»): said beside the card — «עריכה» corrects it (DECISIONS «סבב שישי»).
 */
export function escortInName(name: string, escorts: ReadonlySet<string>): string | null {
  const w = namedEscort(name, escorts);
  if (w) return `בשם יש מילה מעמודת המלווים («${w}») — אם היא לא חלק מהשם, מתקנים ב«עריכה»`;
  return mentionsEscort(name) ? "בשם יש מילה על מלווה או חניך/ה — אם היא לא חלק מהשם, מתקנים ב«עריכה»" : null;
}

/** The candidates' rows (readCandidateSheet's). */
export function readCandidates(grid: Grid, m: Mapping, o: ReadOptions): CandidateRead[] {
  return readCandidateSheet(grid, m, o).rows;
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
  const out = rows.map((r): CandidatePreview => {
    if (!r.data) return { ...r, status: "skip" as const, match: null, fills: [] };
    const match = matchSpeaker(r.data.key, r.data.phoneKey, ctx.pool, ctx.phones);
    const target = match.status === "match" ? ctx.pool.find((s) => s.id === match.target) : undefined;
    return { ...r, status: match.status, match, fills: target ? fillPlan(target, ctx.flags.get(target.id), r.data) : [] };
  });
  // the rows new to the pool, against the earlier ones of the table: the same phone, or a name 0.6 alike
  const fresh = out.filter((r) => r.status === "new" && r.data);
  const sheet = sheetMatches(fresh.map((r) => ({ ref: r.ref, key: r.data!.key, phoneKey: r.data!.phoneKey, label: `שורה ${r.row} · ${nameOf(r.data!)}` })));
  return out.map((r) => (sheet.has(r.ref) && r.match ? { ...r, status: "ambiguous" as const, match: ambiguousInSheet(r.match, sheet.get(r.ref)) } : r));
}

const nameOf = (d: CandidateData) => `${d.title ? `${d.title} ` : ""}${d.name}`;

/** Each row's action as the commit takes it, by its ref — «כמו שורה N» followed (null: undecided). */
export function resolvedRows(rows: CandidatePreview[], choices: ReadonlyMap<string, Choice>): Map<string, Resolved | null> {
  const by = new Map(rows.map((r) => [r.ref, r]));
  const own = (ref: string) => {
    const r = by.get(ref);
    return r && r.data ? actionOf(r.status, r.match, choices.get(ref)) : null;
  };
  return new Map(rows.filter((r) => r.data).map((r) => [r.ref, resolveChoice(r.ref, own)]));
}

/** A row's commit line (null: left out). «כמו שורה N»: a new row under row N's name (`as`) — the commit completes that speaker. */
export function speakerRowOf(row: number, d: CandidateData, a: Resolved, as: CandidateData | null = null): SpeakerRow | null {
  if (a.action === "skip") return null;
  return {
    row,
    action: a.action,
    speaker_id: a.action === "merge" ? a.target : null,
    title: d.title,
    name: as?.name ?? d.name,
    gender: d.gender,
    affiliation: d.affiliation,
    topics: d.topics,
    phone: d.phone,
    email: d.email,
    notes: d.notes,
  };
}

/** The «עמום» rows still waiting for the admin's choice — or whose «כמו שורה N» names a row left out. */
export function undecided(rows: CandidatePreview[], choices: ReadonlyMap<string, Choice>): CandidatePreview[] {
  const res = resolvedRows(rows, choices);
  return rows.filter((r) => r.data && res.get(r.ref) == null);
}

/** The commit's payload — null while an «עמום» row waits for a choice. */
export function candidatesPayload(rows: CandidatePreview[], choices: ReadonlyMap<string, Choice>, source: string, titlesFrom: number | null): CandidatesPayload | null {
  const res = resolvedRows(rows, choices);
  if (rows.some((r) => r.data && res.get(r.ref) == null)) return null;
  const by = new Map(rows.map((r) => [r.ref, r]));
  const out: SpeakerRow[] = [];
  for (const r of rows) {
    if (!r.data) continue;
    const a = res.get(r.ref)!;
    const line = speakerRowOf(r.row, r.data, a, a.action === "new" && a.as != null ? (by.get(a.as)?.data ?? null) : null);
    if (line) out.push(line);
  }
  return { source, titles_from: titlesFrom, rows: out };
}
