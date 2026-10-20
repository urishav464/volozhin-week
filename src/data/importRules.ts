// What the import's commit accepts, in the browser — the same cleaning, limits, order of checks and refusal codes
// as public.import_commit and its helpers in supabase/schema.sql «Import 5786», so the demo (src/data/engine.ts)
// refuses exactly what production refuses — tests/parity runs the same payloads through both.
import { nameKey } from "../domain/nameKey";
import type { ContactPref, Gender, PrintWhen, SourcesKind } from "../domain/types";
import { titleGender } from "../import/speakerName";
import { CommandError } from "./commands";
import type { ArchiveLessonRow, ImportKind, PrefsRow, SpeakerRow } from "./imports";
import { cleanBlock, cleanContactEmail, cleanLine, cleanPhone, cleanTopics, LIMITS, pickContactPref, pickGender, pickTitle } from "./speakerRules";
import { cleanAmount, pickPrintWhen, pickSourcesKind, STAGE_LIMITS } from "./stageRules";

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** Characters (code points), as the database counts them. */
export const IMPORT_RULES = {
  /** Rows in one commit (speakers + lessons, or prefs). */
  rows: 1_000,
  /** The payload, as JSON text — a guard, far above 139 candidates (the count is the real limit). */
  bytes: 1_000_000,
  source: 60,
  label: 60,
  lesson_title: 200,
  audience: 120,
  import_note: 1000,
  contact_notes: LIMITS.contact_notes,
  /** Rooms for parallel lessons: the default and «מקביל 2» … «מקביל 10». */
  rooms: 10,
} as const;

export const IMPORT_KINDS: readonly ImportKind[] = ["candidates", "tracking", "escorts"];

/** A room for parallel lessons, by its index (0 is the default room, named when the edition is made). */
export const parallelRoomName = (index: number) => `מקביל ${index + 1}`;
/** The archive's default room, as public.start_edition names a new edition's. */
export const ARCHIVE_ROOM = "בית מדרש";
/** An archive edition's last_day_until: Thursday ends at 19:00 (the column's default; last year's week too). */
export const ARCHIVE_LAST_DAY_UNTIL = 1140;

export interface CleanSpeakerRow {
  row: number;
  action: "new" | "merge";
  speaker_id: number | null;
  title: string | null;
  name: string;
  key: string;
  gender: Gender | null;
  affiliation: string | null;
  topics: string[];
  phone: string | null;
  email: string | null;
  notes: string | null;
}

/** app.import_speaker_row's checks, in its order — a refusal is the row's reason. */
export function cleanSpeakerRow(r: SpeakerRow, titles: readonly string[]): CleanSpeakerRow {
  if (typeof r !== "object" || r === null || (r.action !== "new" && r.action !== "merge")) fail("bad_value");
  const name = cleanLine(typeof r.name === "string" ? r.name : null, LIMITS.name);
  const key = nameKey(name);
  if (name == null || !key) fail("name_required");
  const title = pickTitle(r.title, titles);
  const gender = pickGender(r.gender);
  // never guessed: only the gender its title says (הרב / הרבנית)
  if (gender != null && gender !== titleGender(title)) fail("bad_value");
  return {
    row: r.row,
    action: r.action,
    speaker_id: r.action === "merge" ? (r.speaker_id ?? -1) : null,
    title,
    name: name!,
    key,
    gender,
    affiliation: cleanLine(r.affiliation, LIMITS.affiliation),
    topics: cleanTopics(r.topics),
    phone: cleanPhone(r.phone),
    email: cleanContactEmail(r.email),
    notes: cleanBlock(r.notes, IMPORT_RULES.contact_notes),
  };
}

export interface CleanLessonRow {
  row: number;
  day: number;
  start_min: number;
  end_min: number;
  room: number;
  title: string | null;
  category_id: number | null;
  audience: string | null;
  sources_kind: SourcesKind;
  print_when: PrintWhen;
  sources_note: string | null;
  pay_amount: number | null;
  import_note: string | null;
  speakers: number[];
}

/** The archive edition's own week: when it opened on Sunday (null: unknown) and when it ended on Thursday. */
export interface ArchiveWeek {
  first_day_from: number | null;
  last_day_until: number;
}

/**
 * app.import_lesson_row's checks, in its order. `categories`: the ids that exist; `speakers`: how many speaker rows;
 * `week`: the archive's own Sunday and Thursday — nothing on Thursday after it ended, nothing on Sunday before it opened.
 */
export function cleanLessonRow(l: ArchiveLessonRow, categories: ReadonlySet<number>, speakers: number, week: ArchiveWeek): CleanLessonRow {
  const int = (v: unknown) => typeof v === "number" && Number.isInteger(v);
  if (!int(l.day) || !int(l.start_min) || !int(l.end_min) || l.day < 0 || l.day > 4 || l.start_min < 390 || l.end_min > 1830 || l.start_min >= l.end_min || l.start_min % 5 !== 0 || l.end_min % 5 !== 0) {
    fail("bad_shape");
  }
  if ((l.day === 4 && l.end_min > week.last_day_until) || (l.day === 0 && week.first_day_from != null && l.start_min < week.first_day_from)) fail("bad_shape");
  if (!int(l.room) || l.room < 0 || l.room >= IMPORT_RULES.rooms) fail("bad_value");
  const title = cleanLine(l.title, IMPORT_RULES.lesson_title);
  if (l.category_id != null && !categories.has(l.category_id)) fail("bad_value");
  const audience = cleanLine(l.audience, IMPORT_RULES.audience);
  const sources_kind = pickSourcesKind(l.sources_kind);
  const print_when = pickPrintWhen(l.print_when);
  const sources_note = cleanBlock(l.sources_note, STAGE_LIMITS.sources_note);
  const pay_amount = cleanAmount(l.pay_amount ?? null);
  const import_note = cleanBlock(l.import_note, IMPORT_RULES.import_note);
  const refs = Array.isArray(l.speakers) ? l.speakers : [];
  if (refs.length === 0 || refs.some((x) => !int(x) || x < 0 || x >= speakers) || new Set(refs).size !== refs.length) fail("bad_value");
  return { row: l.row, day: l.day, start_min: l.start_min, end_min: l.end_min, room: l.room, title, category_id: l.category_id ?? null, audience, sources_kind, print_when, sources_note, pay_amount, import_note, speakers: refs };
}

/** app.import_prefs_row's checks: a speaker that exists is checked by the caller (stale). */
export function cleanPrefsRow(p: PrefsRow): { row: number; speaker_id: number; contact_pref: ContactPref | null; secretary_note: string | null } {
  return { row: p.row, speaker_id: p.speaker_id, contact_pref: pickContactPref(p.contact_pref), secretary_note: cleanBlock(p.secretary_note, LIMITS.secretary_note) };
}

/**
 * An archive edition's label as the import compares — and stores — it (app.label_key): the Hebrew and typographic
 * quote marks as ASCII («תשפ״ו», «תשפ”ו» → «תשפ"ו», the form hebrewYearLabel writes), spaces single. A re-run typed
 * with the other quote mark replaces the same archive instead of making a second one.
 */
export function labelKey(v: string | null | undefined): string {
  return (v ?? "")
    .replace(/[״“”″]/g, '"')
    .replace(/[׳‘’]/g, "'")
    .replace(/[ \t\n\r\f\v]+/g, " ")
    .trim();
}

/** An archive's label: one line ≤ 60, required (label_required) — in its key's form (labelKey). */
export function cleanLabel(v: unknown): string {
  const l = cleanLine(typeof v === "string" ? v : null, IMPORT_RULES.label);
  if (l == null) fail("label_required");
  return labelKey(l);
}

/** The archive's opening Sunday: yyyy-mm-dd (bad_value), a Sunday (not_sunday) — or null. */
export function cleanArchiveDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) fail("bad_value");
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail("bad_value");
  if (d.getUTCDay() !== 0) fail("not_sunday");
  return v as string;
}

/** A new speaker's source label: one line ≤ 60, required. */
export function cleanSource(v: unknown): string {
  const s = cleanLine(typeof v === "string" ? v : null, IMPORT_RULES.source);
  if (s == null) fail("bad_value");
  return s!;
}

/**
 * A JSON value written as PostgreSQL writes a jsonb (`p_payload::text`): «, » between items and «: » after a key —
 * the text whose bytes import_commit counts. (jsonb also sorts an object's keys; the length is the same.)
 */
export function jsonbText(v: unknown): string {
  if (v === null || v === undefined || typeof v === "function" || typeof v === "symbol") return "null";
  if (typeof v === "number") return Number.isFinite(v) ? JSON.stringify(v) : "null";
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return `[${v.map(jsonbText).join(", ")}]`;
  const items = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && typeof x !== "function" && typeof x !== "symbol");
  return `{${items.map(([k, x]) => `${JSON.stringify(k)}: ${jsonbText(x)}`).join(", ")}}`;
}

/** The payload's size, as both sides count it: its rows — and, as a guard, the bytes of its jsonb text (import_too_big). */
export function checkPayloadSize(rows: number, payload: unknown): void {
  if (rows > IMPORT_RULES.rows || new TextEncoder().encode(jsonbText(payload)).length > IMPORT_RULES.bytes) fail("import_too_big");
}
