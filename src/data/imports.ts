// The import of 5786 (תשפ"ו) — reached as `port.imports`, a global admin's only (DESIGN «ייבוא תשפ"ו»; DECISIONS
// «ייבוא תשפ"ו»). Two implementations, as everywhere: SupabaseImports (public.import_lookup and public.import_commit
// of supabase/schema.sql «Import 5786») and DemoImports (src/data/engine.ts, in memory); their semantics are
// docs/CONTRACT.md «The import of 5786», and tests/parity holds the two together.
//
// What travels: the rows the admin reviewed, cleaned, as one payload — never a raw file or a raw table (those stay in
// the page's memory and go with it). Phones and e-mails only to speaker_contacts. The lookup answers which pool
// speaker has a phone (by its comparison key) and which contact fields are filled — booleans, never a value.
import type { Day } from "../domain/time";
import type { ContactPref, Gender, PrintWhen, SourcesKind, Speaker } from "../domain/types";
import { CommandError } from "./commands";

/** The three kinds the wizard imports — and what the commit is called with. */
export type ImportKind = "candidates" | "tracking" | "escorts";

/** One speaker as the commit receives it: a new pool speaker, or one to complete — filling only what is empty. */
export interface SpeakerRow {
  /** The row of the sheet it came from (a refusal names it). */
  row: number;
  /**
   * «new»: unless the pool already has this name key — then it completes that one, never a second copy. A phone the
   * pool has is never a match by itself at the commit: the preview shows it, and the row travels as «merge».
   */
  action: "new" | "merge";
  /** The pool speaker to complete («merge»). */
  speaker_id: number | null;
  title: string | null;
  name: string;
  /** Only the gender the title says (הרב / הרבנית), or null — never guessed. */
  gender: Gender | null;
  affiliation: string | null;
  topics: string[];
  phone: string | null;
  email: string | null;
  /** speaker_contacts.notes — the sheet's notes and statuses («טווח ימים»), private like the contacts. */
  notes: string | null;
}

/** (a) The candidates → the pool. */
export interface CandidatesPayload {
  /** speakers.source of a new speaker — «brainstorm-5786» unless the admin typed another. */
  source: string;
  /** Whose settings.titles a title is checked against (null: the default four). */
  titles_from: number | null;
  rows: SpeakerRow[];
}

/** One lesson of last year's week, closed. */
export interface ArchiveLessonRow {
  row: number;
  day: Day;
  start_min: number;
  end_min: number;
  /** 0: the default room; 1…: «מקביל 2», «מקביל 3»… (the sheet does not say where — parallel lessons need rooms). */
  room: number;
  title: string | null;
  category_id: number | null;
  audience: string | null;
  sources_kind: SourcesKind;
  print_when: PrintWhen;
  sources_note: string | null;
  /** Only when the sheet's «הסעה/תשלום» was a plain number — else its words are in import_note. */
  pay_amount: number | null;
  /**
   * What the sheet said that has no field of its own (transport/payment words, who sent the summary message…) — no
   * phone, no e-mail. Kept apart from the lesson (lesson_import_notes), under the transport details' rule.
   */
  import_note: string | null;
  /** Indexes into the payload's `speakers`: the first leads, the rest co-teach. */
  speakers: number[];
}

/** (b) Last year's tracking sheet → an archive edition (replaced whole on a re-run with the same label). */
export interface ArchivePayload {
  label: string;
  /** yyyy-mm-dd, a Sunday — only when the admin entered one. */
  start_date: string | null;
  source: string;
  titles_from: number | null;
  speakers: SpeakerRow[];
  lessons: ArchiveLessonRow[];
}

/**
 * The channels the escorts' import offers — a fixed list: the pool's contact_pref, and «other» (none of them: the
 * admin's note says how; contact_pref is left as it is).
 */
export type ImportChannel = ContactPref | "other";

/**
 * (c) The escorts' file → how a speaker is reached: the channel the admin CHOSE from the list (the file's phrases only
 * suggest one), and a note the admin TYPED — nothing of the file's own text travels (DECISIONS «סבב רביעי»): the
 * commit refuses a row with any other key.
 */
export interface PrefsRow {
  row: number;
  speaker_id: number;
  channel: ImportChannel;
  /** speaker_contacts.secretary_note — the admin's own words, never the file's; null: none. */
  note: string | null;
}

export interface EscortsPayload {
  rows: PrefsRow[];
}

export type ImportCommit =
  | { kind: "candidates"; payload: CandidatesPayload }
  | { kind: "tracking"; payload: ArchivePayload }
  | { kind: "escorts"; payload: EscortsPayload };

export interface ImportResult {
  /** New pool speakers. */
  created: number;
  /** Rows that completed a pool speaker (a «new» row whose name or phone was there already counts here). */
  merged: number;
  /** Pool speakers whose own record got a field. */
  filled: number;
  /** Pool speakers that got a phone or an e-mail (the escorts' file: «איך פונים», the secretary note). */
  contacts: number;
  /** Pool speakers whose private note was filled (the sheet's notes and statuses). */
  notes: number;
  /** (b) The archive's lessons now, the ones a re-run replaced, and the edition. */
  lessons: number;
  replaced: number;
  edition_id: number | null;
  /** Each speaker row, as the commit resolved it. */
  speakers: { row: number; speaker_id: number; created: boolean }[];
}

/** Which contact fields a pool speaker already has (true: filled — the import leaves it). */
export interface ContactFlags {
  phone: boolean;
  email: boolean;
  secretary_note: boolean;
  notes: boolean;
}

/** public.import_lookup's answer. */
export interface ImportLookup {
  /** Pool speakers whose stored phone has one of the keys asked about. */
  phones: { key: string; speaker_id: number }[];
  /** The contact fields filled, for the speakers asked about and those the phones found. */
  contacts: ({ speaker_id: number } & ContactFlags)[];
}

export interface ImportPort {
  /** The whole pool (as load_week gives a speaker — never a contact), to match against. */
  pool(): Promise<Speaker[]>;
  /** A global admin: which speakers have these phones, and which of these speakers' contact fields are filled. */
  lookup(speakerIds: number[], phoneKeys: string[]): Promise<ImportLookup>;
  /** A global admin: one transaction — every row or none; a bad row refuses the whole import (ImportRowError). */
  commit(c: ImportCommit): Promise<ImportResult>;
}

/** A row the commit refused, and why (one of the contract's codes) — nothing was written. */
export class ImportRowError extends CommandError {
  constructor(
    readonly row: number,
    readonly reason: string,
  ) {
    super("import_bad_row");
  }
}

/** `import_bad_row`'s detail as the database sends it: «<row>:<reason>». */
export function rowErrorOf(detail: string | null | undefined): ImportRowError | null {
  const m = /^(-?[0-9]+):([a-z_]+)$/.exec(detail ?? "");
  return m ? new ImportRowError(Number(m[1]), m[2]) : null;
}
