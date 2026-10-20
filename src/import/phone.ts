// Phones and e-mails in last year's files. A phone goes to speaker_contacts — never to a speaker's row, a lesson or
// a log — and «the same phone» is how a candidate is found in the pool when the name is spelled otherwise: by its
// comparison key, app.phone_key in supabase/schema.sql (tests/sql/import.test.ts holds the two equal). A phone or an
// e-mail inside free text that goes anywhere the team reads (a lesson's import note) is taken out (scrubContacts).
import { cleanCell } from "./table";

/**
 * A phone's comparison key: its digits; the country code (972, 00972) as a leading 0 — and a 0 written after it
 * dropped («+972 (0)5…»); a leading 0 Excel dropped from a number cell given back (8–9 digits, «הצעה»). Null under
 * 6 digits (bad_phone's rule): too short to say two are the same.
 */
export function phoneKey(p: string | null | undefined): string | null {
  let d = (p ?? "").replace(/[^0-9]/g, "");
  if (/^(00)?972/.test(d)) d = `0${d.replace(/^(00)?972/, "").replace(/^0/, "")}`;
  else if ((d.length === 8 || d.length === 9) && !d.startsWith("0")) d = `0${d}`;
  return d.length >= 6 ? d : null;
}

/** Only what a phone number is written with: digits, spaces, + ( ) . and dashes. */
const PHONE_CHARS = /^\+?[0-9\s().\-–־]+$/;

export interface CleanPhone {
  /** What is stored in speaker_contacts.phone (≤ 40), or null. */
  value: string | null;
  /** phoneKey — what «the same phone» compares. */
  key: string | null;
  /** The cell had something, but not a phone (fewer than 6 digits, or too long): it is not stored. */
  problem: boolean;
}

/**
 * A phone cell as it is stored: a plain number (only phone characters, at most 15 digits) as its key — 0 and digits,
 * no dashes («+» kept for a number outside Israel); a cell with words beside the number («בבית: …») as it was typed.
 */
export function normalizePhone(raw: string | null | undefined): CleanPhone {
  const t = cleanCell(raw ?? "").replace(/\n/g, " ");
  if (!t) return { value: null, key: null, problem: false };
  const key = phoneKey(t);
  if (!key) return { value: null, key: null, problem: true };
  const digits = t.replace(/[^0-9]/g, "");
  if (PHONE_CHARS.test(t) && digits.length <= 15) {
    const foreign = t.startsWith("+") && !/^(00)?972/.test(digits);
    return { value: foreign ? `+${digits}` : key, key, problem: false };
  }
  return [...t].length <= 40 ? { value: t, key, problem: false } : { value: null, key: null, problem: true };
}

/** An e-mail cell: «mailto:» and spaces out; stored when it has @ and a dot after it (bad_contact_email's rule). */
export function normalizeEmail(raw: string | null | undefined): { value: string | null; problem: boolean } {
  const t = cleanCell(raw ?? "").replace(/^mailto:/i, "").replace(/\s+/g, "");
  if (!t) return { value: null, problem: false };
  return /^[^ @]+@[^ @]+\.[^ @]+$/.test(t) && [...t].length <= 120 ? { value: t, problem: false } : { value: null, problem: true };
}

/** A run that reads as a phone: 7+ digits with the separators phones are written with. */
const PHONE_IN_TEXT = /\+?[0-9][0-9\s().\-–־]{5,}[0-9]/g;
const EMAIL_IN_TEXT = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;

/** Free text with every phone and e-mail in it replaced — what the team may read of last year's notes. */
export function scrubContacts(text: string): { text: string; scrubbed: boolean } {
  let scrubbed = false;
  const out = text
    .replace(EMAIL_IN_TEXT, () => {
      scrubbed = true;
      return "[מייל הוסר]";
    })
    .replace(PHONE_IN_TEXT, (m) => {
      if (m.replace(/[^0-9]/g, "").length < 7) return m;
      scrubbed = true;
      return "[טלפון הוסר]";
    });
  return { text: out, scrubbed };
}
