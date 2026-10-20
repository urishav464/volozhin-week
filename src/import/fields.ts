// What each kind of import reads, and which of last year's headers it recognizes by itself — only the headers
// DESIGN's appendix names («מה נלמד מהחומרים»): the tracking sheet's מרצה · שיעור ב · כותרת · מקורות (נשלח?) ·
// הסעה/תשלום · טלפון · «קיבל הודעת סיכום מ» · נושא, and the candidates' «טווח ימים» (a status, so a note). Every other
// column starts unread («לא לייבא») and the admin maps it; every default can be changed.

import type { ImportKind } from "../data/imports";

export type { ImportKind };

export interface FieldDef {
  key: string;
  label: string;
  /** Headers read as this field by default (compared by headerKey). */
  headers: readonly string[];
  /** More than one column may be read as it (their texts are joined, each with its header). */
  multi?: boolean;
}

export const FIELDS: Record<ImportKind, readonly FieldDef[]> = {
  candidates: [
    { key: "name", label: "שם המרצה (התואר מופרד ממנו)", headers: ["מרצה"] },
    { key: "title", label: "תואר", headers: [] },
    { key: "affiliation", label: "מוסד", headers: [] },
    { key: "topics", label: "נושאים", headers: [] },
    { key: "phone", label: "טלפון", headers: ["טלפון"] },
    { key: "email", label: "מייל", headers: [] },
    { key: "status", label: "מצב (נכנס להערה)", headers: ["טווח ימים"], multi: true },
    { key: "note", label: "הערה", headers: [], multi: true },
  ],
  tracking: [
    { key: "speaker", label: "מרצה", headers: ["מרצה"] },
    { key: "when", label: "יום ושעה", headers: ["שיעור ב"] },
    { key: "title", label: "כותרת", headers: ["כותרת"] },
    { key: "sources", label: "מקורות", headers: ["מקורות (נשלח?)"] },
    { key: "transport", label: "הסעה/תשלום", headers: ["הסעה/תשלום"] },
    { key: "phone", label: "טלפון", headers: ["טלפון"] },
    { key: "confirmFrom", label: "קיבל הודעת סיכום מ", headers: ["קיבל הודעת סיכום מ"] },
    { key: "topic", label: "נושא (לקטגוריה)", headers: ["נושא"] },
    { key: "note", label: "הערה", headers: [], multi: true },
  ],
  escorts: [
    { key: "speaker", label: "מרצה", headers: ["מרצה"] },
    { key: "phrases", label: "ניסוחים (רק אלה על ערוץ הקשר נשמרים)", headers: [], multi: true },
  ],
};

export const KIND_LABEL: Record<ImportKind, string> = {
  candidates: "המועמדים (רשימת המרצים מהסיעור)",
  tracking: "גיליון המעקב של אשתקד",
  escorts: "קובץ המלווים",
};

/** A header as compared: no spaces, punctuation, quotes or brackets; lower-case. */
export function headerKey(s: string): string {
  return s.replace(/[\s"'״׳()?:\-–_/.,]/g, "").toLowerCase();
}

/** column → field key (null: not read). */
export type Mapping = (string | null)[];

/** Does a row look like the header row: at least one of its cells is a header this kind knows. */
export function looksLikeHeader(kind: ImportKind, row: readonly string[]): boolean {
  const known = new Set(FIELDS[kind].flatMap((f) => f.headers.map(headerKey)));
  return row.some((c) => known.has(headerKey(c)));
}

/** How many of a table's first rows are looked at for its header row — a title above the table (a Word paragraph, a merged Excel row). */
export const HEADER_SEARCH = 5;

/** The header row the wizard proposes: the first of the table's first rows that looksLikeHeader — null when none does. */
export function findHeaderRow(kind: ImportKind, grid: readonly (readonly string[])[]): number | null {
  for (let i = 0; i < Math.min(HEADER_SEARCH, grid.length); i++) if (looksLikeHeader(kind, grid[i])) return i;
  return null;
}

/** The mapping the wizard starts with: each known header to its field (a single field only once, the first). */
export function defaultMapping(kind: ImportKind, header: readonly string[] | null, width: number): Mapping {
  const out: Mapping = Array.from({ length: width }, () => null);
  if (!header) return out;
  const taken = new Set<string>();
  header.forEach((h, i) => {
    const f = FIELDS[kind].find((x) => x.headers.some((k) => headerKey(k) === headerKey(h)));
    if (!f || (!f.multi && taken.has(f.key))) return;
    taken.add(f.key);
    out[i] = f.key;
  });
  return out;
}

/** Map column i to `key`; a single-column field leaves the column it was on. */
export function setMapping(kind: ImportKind, m: Mapping, i: number, key: string | null): Mapping {
  const f = FIELDS[kind].find((x) => x.key === key);
  return m.map((cur, j) => (j === i ? key : f && !f.multi && cur === key ? null : cur));
}

/** The columns read as a field. */
export const columnsOf = (m: Mapping, key: string) => m.flatMap((k, i) => (k === key ? [i] : []));
