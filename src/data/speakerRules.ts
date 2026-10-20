// What the speaker pool accepts, in the browser: the same cleaning, limits and
// refusal codes as the database's helpers (app.clean_line, app.clean_block,
// app.pick_title, app.clean_topics … in supabase/schema.sql), so the demo
// (src/data/engine.ts) refuses exactly what production refuses — tests/parity
// runs the same inputs through both.
import type { ContactPref, EditionSettings, Gender } from "../domain/types";
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
  topic: 40,
  topics: 10,
  /** a note on a status change or a hand-over */
  note: 200,
  vetted_note: 300,
  avail_note: 120,
  phone: 40,
  email: 120,
  secretary_note: 300,
  contact_notes: 1000,
} as const;

/** The titles when the edition's settings list none (app.titles). */
export const DEFAULT_TITLES: readonly string[] = ["ד״ר", "פרופ׳", "הרב", "הרבנית"];

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
