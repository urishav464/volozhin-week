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

/** Only what a phone number is written with: digits, spaces, + ( ) . / · • ‧ _ and dashes. */
const PHONE_CHARS = /^\+?[0-9\s()./\u00b7\u2022\u2027_\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d-]+$/;

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

// ---- A phone or an e-mail inside text: ONE definition — the browser's (here) and the database's (app.contact_fold and
// app.has_contact in supabase/schema.sql, the import's backstop) are written the same and held equal by
// tests/sql/import.test.ts. The text is FOLDED first (foldContact ≡ app.contact_fold): the characters that show nothing
// are taken out (Unicode's format characters, NEL, U+180E) and every decimal digit of every script is written as its
// ASCII digit (٠١٢, ０１２ → 012) — a number shown on the screen is a number here. White space is written out
// (JavaScript's \s; PostgreSQL's [[:space:]] depends on the locale), and so are the dashes.
/** White space, as JavaScript's \s. */
export const CONTACT_WS = " \\t\\n\\r\\f\\v\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
/**
 * What shows nothing, taken out before a contact is looked for: Unicode's format characters (Cf, as of Unicode 16.0 —
 * the soft hyphen, zero widths, bidi controls, tags…), NEL (U+0085) and U+180E. Inclusive ranges of code points.
 */
export const FORMAT_RANGES: readonly (readonly [number, number])[] = [
  [0x85, 0x85], [0xad, 0xad], [0x600, 0x605], [0x61c, 0x61c], [0x6dd, 0x6dd], [0x70f, 0x70f], [0x890, 0x891], [0x8e2, 0x8e2], [0x180e, 0x180e],
  [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb], [0x110bd, 0x110bd], [0x110cd, 0x110cd],
  [0x13430, 0x1343f], [0x1bca0, 0x1bca3], [0x1d173, 0x1d17a], [0xe0001, 0xe0001], [0xe0020, 0xe007f],
];
/**
 * The «0» of every set of ten decimal digits beside ASCII's (Unicode's Nd, as of 16.0): Arabic-Indic ٠, Persian ۰,
 * fullwidth ０, the mathematical ones… — each folded to 0–9.
 */
export const DIGIT_ZEROS: readonly number[] = [
  0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810,
  0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x104a0, 0x10d30,
  0x10d40, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0, 0x11650, 0x116c0, 0x116d0, 0x116da, 0x11730, 0x118e0, 0x11950, 0x11bf0,
  0x11c50, 0x11d50, 0x11da0, 0x11f50, 0x16130, 0x16a60, 0x16ac0, 0x16b50, 0x16d70, 0x1ccf0, 0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6, 0x1e140,
  0x1e2f0, 0x1e4f0, 0x1e5f1, 0x1e950, 0x1fbf0,
];
const pgHex = (cp: number) => (cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, "0")}` : `\\U${cp.toString(16).padStart(8, "0")}`);
/** FORMAT_RANGES as app.contact_fold writes them: a PostgreSQL bracket expression. */
export const PG_FORMAT_CLASS = `[${FORMAT_RANGES.map(([a, b]) => (a === b ? pgHex(a) : `${pgHex(a)}-${pgHex(b)}`)).join("")}]`;
/** DIGIT_ZEROS' digits as app.contact_fold writes them: translate()'s two strings (a U& literal, and 0–9 for each set). */
export const PG_DIGITS_FROM = `U&'${DIGIT_ZEROS.flatMap((z) => Array.from({ length: 10 }, (_, d) => z + d)).map((cp) => (cp <= 0xffff ? `\\${cp.toString(16).padStart(4, "0")}` : `\\+${cp.toString(16).padStart(6, "0")}`)).join("")}'`;
export const PG_DIGITS_TO = `'${"0123456789".repeat(DIGIT_ZEROS.length)}'`;

const DIGIT_OF = new Map<number, string>(DIGIT_ZEROS.flatMap((z) => Array.from({ length: 10 }, (_, d) => [z + d, String(d)] as [number, string])));
const isFormat = (cp: number) => FORMAT_RANGES.some(([a, b]) => cp >= a && cp <= b);

/** The text as a contact is looked for in it (app.contact_fold): what shows nothing out, every digit an ASCII one. */
export function foldContact(text: string | null | undefined): string {
  let out = "";
  for (const ch of text ?? "") {
    const cp = ch.codePointAt(0)!;
    if (isFormat(cp)) continue;
    out += DIGIT_OF.get(cp) ?? ch;
  }
  return out;
}

/** Dashes beside the ASCII one (which is written last in a class, as itself). */
const UDASH = "\\u05be\\u2010-\\u2015\\u2212\\ufe58\\ufe63\\uff0d";
/** What a phone's digits are written apart with: spaces, dashes, brackets, dots, «/», «·», «•», «‧», «_». */
const PHONE_SEPS = `${CONTACT_WS}${UDASH}()./\\u00b7\\u2022\\u2027_-`;
/**
 * A run that may be a phone: a digit (a «+» or a «(» before it), 5+ of digits and PHONE_SEPS — «:» and «,» only right
 * before a digit («000:000:0000», «000,0000000»; never a list's «, ») — and a digit. It never starts inside a number,
 * right after a time's «20:» or «8.», or at a time («20:00 (טל' …)»: the time stays, the run is the phone).
 */
export const PHONE_RUN = `(?:\\+|\\()?(?<![0-9])(?<![0-9][:.])(?![0-9]{1,2}[:.][0-9]{2}(?![0-9]))[0-9](?:[0-9${PHONE_SEPS}]|[:,](?=[0-9])){5,}[0-9]`;
const NOT_MAIL = `${CONTACT_WS}@\\uff20<>()`;
/**
 * An e-mail: no space, @, <, >, ( or ) around an @ (or «@@», or a fullwidth «＠») and a dot after it — or, in the usual
 * letters, with spaces around the @ and the dots («someone @ example .org»), its last part letters.
 */
export const EMAIL_RUN =
  `(?:[^${NOT_MAIL}]+[@\\uff20]+[^${NOT_MAIL}]+\\.[^${NOT_MAIL}]+` +
  `|[A-Za-z0-9._%+-]+[${CONTACT_WS}]*[@\\uff20](?:[${CONTACT_WS}]*[@\\uff20])*[${CONTACT_WS}]*[A-Za-z0-9-]+(?:[${CONTACT_WS}]*\\.[${CONTACT_WS}]*[A-Za-z0-9-]+)*[${CONTACT_WS}]*\\.[${CONTACT_WS}]*[A-Za-z]{2,})`;
const W = `[${CONTACT_WS}]`;
const YEAR = "(?:1[89]|20)[0-9]{2}";
const YY = "(?:[0-9]{2}|[0-9]{4})";
const DM = "[0-9]{1,2}[./][0-9]{1,2}";
/**
 * Digits that are no phone (a run, whole): a date («12.3.2026», and an hour after it: «20», «20:00»); a range of dates
 * whose year is written at its end («14.2-18.2.2027», «14.2.2027-18.2.2027»); years — a range or a chain, by dashes,
 * commas or slashes («1948-1967», «1948-1967-1973»); a range of times written with dots («8.30-10.00»); and chapters —
 * groups of one or two digits by dashes or commas, the first not 0 («1-2-3-4-5-6-7»).
 */
export const NOT_A_PHONE =
  `^(?:${DM}[./]${YY}(?:${W}+[0-9]{1,2}(?:[.:][0-9]{2})?)?` +
  `|${DM}(?:[./]${YY})?${W}*[${UDASH}-]${W}*${DM}[./]${YY}` +
  `|${YEAR}(?:${W}*[${UDASH},/-]${W}*${YEAR})+` +
  `|[0-9]{1,2}[.:][0-9]{2}${W}*[${UDASH}-]${W}*[0-9]{1,2}[.:][0-9]{2}` +
  `|[1-9][0-9]?(?:${W}*[${UDASH},-]${W}*[0-9]{1,2}){2,})$`;

const PHONE_G = new RegExp(PHONE_RUN, "g");
const EMAIL_1 = new RegExp(EMAIL_RUN);
const EMAIL_G = new RegExp(EMAIL_RUN, "g");
const NOT_PHONE = new RegExp(NOT_A_PHONE);

/** A run of PHONE_RUN that is a phone: 7 digits or more, and no date, range or chapters. */
const phoneRun = (m: string) => m.replace(/[^0-9]/g, "").length >= 7 && !NOT_PHONE.test(m);

/** Does the text hold a phone or an e-mail — app.has_contact, the commit's backstop («contact_in_text»). */
export function hasContact(text: string | null | undefined): boolean {
  const t = foldContact(text);
  if (EMAIL_1.test(t)) return true;
  for (const m of t.matchAll(PHONE_G)) if (phoneRun(m[0])) return true;
  return false;
}

const SENT_PHONE = "\u0001";
const SENT_MAIL = "\u0003";
/** A run that took a «(» with it (and not its «)»): the «)» after it goes too. */
const OPEN = "\u0002";
const unclosed = (m: string) => (m.match(/\(/g)?.length ?? 0) > (m.match(/\)/g)?.length ?? 0);

/**
 * The folded text with each e-mail and each phone in it as a sentinel — the brackets that held only it out with it
 * («(טל' …)» keeps no «(»). `found` hears each, as written.
 */
function markContacts(text: string, found: (kind: "phone" | "email", m: string) => void): string {
  return foldContact(text)
    .replace(EMAIL_G, (m) => {
      found("email", m);
      return SENT_MAIL;
    })
    .replace(PHONE_G, (m) => {
      if (!phoneRun(m)) return m;
      const open = m.startsWith("(") && unclosed(m);
      found("phone", open ? m.slice(1) : m);
      return SENT_PHONE + (open ? OPEN : "");
    })
    .replace(new RegExp(`([${SENT_PHONE}${SENT_MAIL}])${OPEN}[ \\t]*\\)`, "g"), "$1")
    .replace(new RegExp(OPEN, "g"), "");
}

/** Free text with every phone and e-mail in it replaced — what the team may read of last year's notes. */
export function scrubContacts(text: string): { text: string; scrubbed: boolean } {
  if (!hasContact(text)) return { text, scrubbed: false };
  let out = markContacts(text, () => {})
    // brackets holding only it
    .replace(new RegExp(`[(\\[{][ \\t]*([${SENT_PHONE}${SENT_MAIL}])[ \\t]*[)\\]}]`, "g"), "$1")
    .replace(new RegExp(SENT_MAIL, "g"), "[מייל הוסר]")
    .replace(new RegExp(SENT_PHONE, "g"), "[טלפון הוסר]");
  // never left holding one (a replacement that brought two runs of digits together): the whole text goes
  if (hasContact(out)) out = "[הוסר טלפון או מייל]";
  return { text: out, scrubbed: true };
}

/** A label written before a contact («טל'», «טלפון:», «נייד», «מייל:», «email:») — taken out with it. */
const LABEL = /(?:(?<![A-Za-z\u05D0-\u05EA])[ובל]?(?:טלפון|נייד|פלאפון|סלולרי|מייל|אימייל|דוא["״׳']?ל)['׳.:]?|(?<![A-Za-z\u05D0-\u05EA])[ובל]?(?:טל|פל)['׳.:]|(?<![A-Za-z])(?:e-?mail|phone|mobile|mail|tel|mob)[.:])[ \t]*[:\-–]?[ \t]*$/i;
const SEP = "[ \\t,;/|·\\-–—]";

export interface Stripped {
  /** The text without them (and without the labels and brackets they had); its lines kept, an empty line dropped. */
  text: string;
  /** The phones taken out, as written. */
  phones: string[];
  /** The e-mails taken out (an address of the usual letters, when the run holds one; else the run as written). */
  emails: string[];
}

/** An e-mail run as an address: spaces out, «@@» and «＠» as «@» — the usual letters, when it holds them. */
const addressOf = (m: string) => {
  const t = m.replace(new RegExp(W, "g"), "").replace(/[@\uff20]+/g, "@");
  return /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(t)?.[0] ?? t;
};

/**
 * A field that is not a contact field (a name, a title, an affiliation, a tag, a phrase): every phone and e-mail in it
 * taken OUT — the caller attaches one to the row's phone or e-mail when that is unambiguous, or drops it and says so.
 * What is left never holds one (hasContact): taken out again until it does not. A text that holds none is returned as
 * it is; one that holds one, folded (foldContact).
 */
export function stripContacts(text: string): Stripped {
  const phones: string[] = [];
  const emails: string[] = [];
  let out = text;
  for (let pass = 0; pass < 4 && hasContact(out); pass++) {
    const t = markContacts(out, (kind, m) => (kind === "phone" ? phones.push(m) : emails.push(addressOf(m)))).replace(new RegExp(SENT_MAIL, "g"), SENT_PHONE);
    out = t
      // a label before it; two of them with only «או», «/», «,» between are one
      .split(SENT_PHONE)
      .map((part, i, all) => (i < all.length - 1 ? part.replace(LABEL, "") : part))
      .join(SENT_PHONE)
      .replace(new RegExp(`${SENT_PHONE}(?:${SEP}*(?:או|or)?${SEP}*${SENT_PHONE})+`, "g"), SENT_PHONE)
      // brackets holding only it
      .replace(new RegExp(`[(\\[{]${SEP}*${SENT_PHONE}${SEP}*[)\\]}]`, "g"), SENT_PHONE)
      .split("\n")
      .map((line) =>
        line
          .replace(new RegExp(`${SEP}*${SENT_PHONE}${SEP}*`, "g"), " ")
          .replace(/[ \t]+/g, " ")
          .replace(/^[\s,;:/|·\-–—]+|[\s,;:/|·\-–—]+$/g, ""),
      )
      .filter((line) => line !== "")
      .join("\n");
  }
  if (hasContact(out)) out = scrubContacts(out).text;
  return { text: out, phones, emails };
}
