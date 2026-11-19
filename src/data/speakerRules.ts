// What the speaker pool accepts, in the browser: the same cleaning, limits and
// refusal codes as the database's helpers (app.clean_line, app.clean_block,
// app.pick_title, app.clean_topics … in supabase/schema.sql), so the demo
// (src/data/engine.ts) refuses exactly what production refuses — tests/parity
// runs the same inputs through both.
import type { AvailabilityRange, SlotKind } from "../domain/availability";
import type { Day } from "../domain/time";
import type { ContactPref, EditionSettings, Gender } from "../domain/types";
import { hasContact } from "../import/phone";
import { CommandError } from "./commands";

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** Characters (code points), as the database counts them. */
export const LIMITS = {
  name: 120,
  disambiguator: 60,
  title: 40,
  affiliation: 120,
  bio_short: 400,
  /** v19: the guests' schedule's description. */
  public_bio: 600,
  topic: 40,
  topics: 10,
  /** a note on a status change or a hand-over */
  note: 200,
  vetted_note: 300,
  avail_note: 120,
  /** v18: how many time ranges one set_availability_ranges call takes. */
  avail_ranges: 40,
  phone: 40,
  email: 120,
  secretary_note: 300,
  contact_notes: 1000,
} as const;

/** The titles when the edition's settings list none (app.titles): the design's four and, v17, «עו״ד» and the two together. */
export const DEFAULT_TITLES: readonly string[] = ["ד״ר", "פרופ׳", "הרב", "הרבנית", "עו״ד", "הרב ד״ר", "הרבנית ד״ר"];

/** «ייתכן שזה…»: name keys at least this alike (pg_trgm similarity) — the design's «הצעה»; app.similar_threshold(). */
export const SIMILAR_THRESHOLD = 0.6;

export const CONTACT_PREFS: readonly ContactPref[] = ["phone", "whatsapp", "email", "secretary"];

const WS = /[ \t\n\r\f\v]+/g;
const EDGE_WS = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;
const chars = (s: string) => [...s].length;

/** One line: ASCII whitespace runs → one space, trimmed; empty → null; too long → bad_value. */
export function cleanLine(v: string | null | undefined, max: number): string | null {
  const s = (v ?? "").replace(WS, " ").replace(/^ | $/g, "");
  if (s === "") return null;
  if (chars(s) > max) fail("bad_value");
  return s;
}

/** Several lines: CRLF → LF, ASCII whitespace trimmed at both ends; empty → null; too long → bad_value. */
export function cleanBlock(v: string | null | undefined, max: number): string | null {
  const s = (v ?? "").replace(/\r\n/g, "\n").replace(EDGE_WS, "");
  if (s === "") return null;
  if (chars(s) > max) fail("bad_value");
  return s;
}

/** `->>`: a JSON value as text — a string as it is, a number or a boolean written out, an object as its JSON; null for null. */
export function asText(v: unknown): string | null {
  return v == null ? null : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
}

/**
 * v19 speakers.public_bio — what a guest reads (≤ 600, several lines): app.clean_block, then no phone or e-mail
 * (app.has_contact → contact_in_text: the contacts have their own fields, never shown to a guest).
 */
export function cleanPublicBio(v: unknown): string | null {
  const s = cleanBlock(asText(v), LIMITS.public_bio);
  if (s != null && hasContact(s)) fail("contact_in_text");
  return s;
}

export function titlesOf(settings: EditionSettings | null | undefined): readonly string[] {
  const t = Array.isArray(settings?.titles) ? settings.titles.filter((x): x is string => typeof x === "string") : [];
  return t.length ? t : DEFAULT_TITLES;
}

export function pickTitle(v: string | null | undefined, titles: readonly string[]): string | null {
  const t = cleanLine(v, LIMITS.title);
  if (t != null && !titles.includes(t)) fail("bad_value");
  return t;
}

/** m, f, or unknown — what someone chose, never a guess from the name. */
export function pickGender(v: string | null | undefined): Gender | null {
  if (v == null || v === "") return null;
  if (v !== "m" && v !== "f") fail("bad_value");
  return v as Gender;
}

export function pickContactPref(v: string | null | undefined): ContactPref | null {
  if (v == null || v === "") return null;
  if (!CONTACT_PREFS.includes(v as ContactPref)) fail("bad_value");
  return v as ContactPref;
}

/** Free tags: each one line ≤ 40, empty and repeated ones dropped (the first kept), at most 10. */
export function cleanTopics(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) fail("bad_value");
  const out: string[] = [];
  for (const x of v as string[]) {
    const t = cleanLine(x, LIMITS.topic);
    if (t != null && !out.includes(t)) out.push(t);
  }
  if (out.length > LIMITS.topics) fail("bad_value");
  return out;
}

/** A phone as typed (trimmed, one line); at least 6 digits, else bad_phone. */
export function cleanPhone(v: string | null | undefined): string | null {
  const p = cleanLine(v, LIMITS.phone);
  if (p != null && (p.match(/[0-9]/g) ?? []).length < 6) fail("bad_phone");
  return p;
}

/** An address with @ and a dot after it, else bad_contact_email. Kept as typed (not lower-cased). */
export function cleanContactEmail(v: string | null | undefined): string | null {
  const e = cleanLine(v, LIMITS.email);
  if (e != null && !/^[^ @]+@[^ @]+\.[^ @]+$/.test(e)) fail("bad_contact_email");
  return e;
}

/** app.json_int with a value required: a whole number in [lo, hi] — a string, a fraction, null or nothing is not one. */
const wholeIn = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

const RANGE_KEYS: readonly string[] = ["day", "start", "end", "kind"];

/** What set_availability_ranges works from once its input passed: the days ascending, the ranges as given, the rest. */
export interface CleanRanges {
  days: Day[];
  ranges: AvailabilityRange[];
  rest: SlotKind | null;
}

/**
 * public.set_availability_ranges' input, every fault `bad_value`: 1–5 distinct days 0–4; the ranges (none = []) a list
 * of at most 40 objects of exactly {day, start, end, kind} — a day of `days`, start and end whole minutes 0…1830 with
 * start < end, kind can | cannot; the rest null | can | cannot. A key whose value is undefined is an absent key (JSON
 * drops it).
 */
export function cleanAvailabilityRanges(days: unknown, ranges: unknown, rest: unknown): CleanRanges {
  if (!Array.isArray(days) || days.length < 1 || days.length > 5 || days.some((d) => !wholeIn(d, 0, 4)) || new Set(days).size !== days.length) fail("bad_value");
  const list = ranges ?? [];
  if (!Array.isArray(list) || list.length > LIMITS.avail_ranges) fail("bad_value");
  const out: AvailabilityRange[] = [];
  for (const x of list as unknown[]) {
    if (typeof x !== "object" || x === null || Array.isArray(x)) fail("bad_value");
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined);
    if (keys.length !== RANGE_KEYS.length || keys.some((k) => !RANGE_KEYS.includes(k))) fail("bad_value");
    const { day, start, end, kind } = o;
    if (!wholeIn(day, 0, 4) || !(days as number[]).includes(day)) fail("bad_value");
    if (!wholeIn(start, 0, 1830) || !wholeIn(end, 0, 1830) || start >= end) fail("bad_value");
    if (kind !== "can" && kind !== "cannot") fail("bad_value");
    out.push({ day: day as Day, start: start as number, end: end as number, kind: kind as SlotKind });
  }
  if (rest != null && rest !== "can" && rest !== "cannot") fail("bad_value");
  return { days: [...(days as Day[])].sort((a, b) => a - b), ranges: out, rest: (rest ?? null) as SlotKind | null };
}
