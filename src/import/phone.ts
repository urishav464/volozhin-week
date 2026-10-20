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
  // two numbers in one cell («050… / 052…», «…, …», «… או …»): kept as typed, compared by the first — never one key of both
  const parts = t.split(/\s*(?:[/,;]|\sאו\s)\s*/).filter((x) => phoneKey(x) != null);
  if (parts.length > 1) return [...t].length <= 40 ? { value: t, key: phoneKey(parts[0]), problem: false } : { value: null, key: null, problem: true };
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

// ---- A phone or an e-mail inside text: ONE definition — the browser's (here) and the database's (app.has_contact in
// supabase/schema.sql, the import's backstop) are written the same and held equal by tests/sql/import.test.ts. White
// space is written out (JavaScript's \s; PostgreSQL's [[:space:]] depends on the locale), and so are the marks a copy
// carries (bidi controls, zero widths) and the dashes: a bidi mark or a non-breaking hyphen between digits is a number's.
/** White space, as JavaScript's \s. */
export const CONTACT_WS = " \\t\\n\\r\\f\\v\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
/** Marks that show nothing: the soft hyphen, zero widths, bidi controls. */
export const CONTACT_MARKS = "\\u00ad\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069";
/** Dashes beside the ASCII one (which is written last in a class, as itself). */
const UDASH = "\\u05be\\u2010-\\u2015\\u2212\\ufe58\\ufe63\\uff0d";
/** A run that may be a phone: a digit (a «+» before it), 5+ of digits, spaces, marks, dashes, brackets and dots, a digit. */
export const PHONE_RUN = `\\+?[0-9][0-9${CONTACT_WS}${CONTACT_MARKS}${UDASH}().-]{5,}[0-9]`;
/** An e-mail: no space, @, <, >, ( or ) around one @, and a dot after it. */
export const EMAIL_RUN = `[^${CONTACT_WS}@<>()]+@[^${CONTACT_WS}@<>()]+\\.[^${CONTACT_WS}@<>()]+`;
/**
 * Digits that are no phone (the run without its marks): a date («12.3.2026», and an hour after it), a range of years
 * («1948-1967»), a range of times written with dots («8.30-10.00»).
 */
export const NOT_A_PHONE =
  `^(?:[0-9]{1,2}[./][0-9]{1,2}[./](?:[0-9]{2}|[0-9]{4})(?:[${CONTACT_WS}]+[0-9]{1,2})?` +
  `|(?:1[89]|20)[0-9]{2}[${CONTACT_WS}]*[${UDASH}-][${CONTACT_WS}]*(?:1[89]|20)[0-9]{2}` +
  `|[0-9]{1,2}[.:][0-9]{2}[${CONTACT_WS}]*[${UDASH}-][${CONTACT_WS}]*[0-9]{1,2}[.:][0-9]{2})$`;

const PHONE_G = new RegExp(PHONE_RUN, "g");
const EMAIL_1 = new RegExp(EMAIL_RUN);
const EMAIL_G = new RegExp(EMAIL_RUN, "g");
const NOT_PHONE = new RegExp(NOT_A_PHONE);
const MARKS_G = new RegExp(`[${CONTACT_MARKS}]`, "g");

/** A run of PHONE_RUN that is a phone: 7 digits or more, and no date or range. */
const phoneRun = (m: string) => m.replace(/[^0-9]/g, "").length >= 7 && !NOT_PHONE.test(m.replace(MARKS_G, ""));

/** Does the text hold a phone or an e-mail — app.has_contact, the commit's backstop («contact_in_text»). */
export function hasContact(text: string | null | undefined): boolean {
  const t = text ?? "";
  if (EMAIL_1.test(t)) return true;
  for (const m of t.matchAll(PHONE_G)) if (phoneRun(m[0])) return true;
  return false;
}

/** Free text with every phone and e-mail in it replaced — what the team may read of last year's notes. */
export function scrubContacts(text: string): { text: string; scrubbed: boolean } {
  let scrubbed = false;
  let out = text
    .replace(EMAIL_G, () => {
      scrubbed = true;
      return "[מייל הוסר]";
    })
    .replace(PHONE_G, (m) => {
      if (!phoneRun(m)) return m;
      scrubbed = true;
      return "[טלפון הוסר]";
    });
  // never left holding one (a replacement that brought two runs of digits together): the whole text goes
  if (hasContact(out)) out = "[הוסר טלפון או מייל]";
  return { text: out, scrubbed };
}

/** A label written before a contact («טל'», «טלפון:», «נייד», «מייל:», «email:») — taken out with it. */
const LABEL = /(?:(?<![A-Za-z\u05D0-\u05EA])[ובל]?(?:טלפון|נייד|פלאפון|סלולרי|מייל|אימייל|דוא["״׳']?ל)['׳.:]?|(?<![A-Za-z\u05D0-\u05EA])[ובל]?(?:טל|פל)['׳.:]|(?<![A-Za-z])(?:e-?mail|phone|mobile|mail|tel|mob)[.:])[ \t]*[:\-–]?[ \t]*$/i;
const SENT = "\u0001";
const SEP = "[ \\t,;/|·\\-–—]";

export interface Stripped {
  /** The text without them (and without the labels and brackets they had); its lines kept, an empty line dropped. */
  text: string;
  /** The phones taken out, as written. */
  phones: string[];
  /** The e-mails taken out (an address of the usual letters, when the run holds one; else the run as written). */
  emails: string[];
}

/**
 * A field that is not a contact field (a name, a title, an affiliation, a tag, a phrase): every phone and e-mail in it
 * taken OUT — the caller attaches one to the row's phone or e-mail when that is unambiguous, or drops it and says so.
 * What is left never holds one (hasContact): taken out again until it does not.
 */
export function stripContacts(text: string): Stripped {
  const phones: string[] = [];
  const emails: string[] = [];
  let out = text;
  for (let pass = 0; pass < 4 && hasContact(out); pass++) {
    let t = out
      .replace(EMAIL_G, (m) => {
        emails.push(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(m)?.[0] ?? m);
        return SENT;
      })
      .replace(PHONE_G, (m) => {
        if (!phoneRun(m)) return m;
        phones.push(m);
        return SENT;
      });
    // a label before it; two of them with only «או», «/», «,» between are one
    t = t
      .split(SENT)
      .map((part, i, all) => (i < all.length - 1 ? part.replace(LABEL, "") : part))
      .join(SENT)
      .replace(new RegExp(`${SENT}(?:${SEP}*(?:או|or)?${SEP}*${SENT})+`, "g"), SENT)
      // brackets holding only it
      .replace(new RegExp(`[(\\[{]${SEP}*${SENT}${SEP}*[)\\]}]`, "g"), SENT);
    out = t
      .split("\n")
      .map((line) =>
        line
          .replace(new RegExp(`${SEP}*${SENT}${SEP}*`, "g"), " ")
          .replace(/[ \t]+/g, " ")
          .replace(/^[\s,;:/|·\-–—]+|[\s,;:/|·\-–—]+$/g, ""),
      )
      .filter((line) => line !== "")
      .join("\n");
  }
  if (hasContact(out)) out = scrubContacts(out).text;
  return { text: out, phones, emails };
}
