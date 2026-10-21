// A table as the wizard reads it — rows of text cells, whatever it came from (a paste of Excel, Google Sheets, Google
// Docs or Word; an .xlsx; a .docx). Text only: a cell is never HTML, never a formula, never a number type.
import { IMPORT_LIMITS, tooBig } from "./limits";

export type Grid = string[][];

/** Where a table came from — said in the wizard («נקראו 12 שורות מ-Excel»). */
export type GridSource = "html" | "text" | "xlsx" | "docx" | "sample";

/** Bidi controls a copy carries along (Word, WhatsApp): never part of a value. */
const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;

/** One cell: bidi marks out, NBSP → space, CRLF → LF, spaces collapsed within each line, blank lines dropped, trimmed. */
export function cleanCell(s: string): string {
  return s
    .replace(BIDI, "")
    .replace(/ /g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Every cell cleaned; rows with nothing in them dropped, and columns empty in every row; every row as wide as the
 * widest. Refused (import_too_big) past the limits — a cell longer than IMPORT_LIMITS.cellChars too: a cell that
 * long is a document pasted into the wrong place, never one value. What is too long or too wide AS READ is refused
 * before a single cell is cleaned.
 */
export function cleanGrid(rows: readonly (readonly string[])[]): Grid {
  if (rows.length > IMPORT_LIMITS.rows * 4) tooBig(); // before any work: far past what blank rows could explain
  let raw = 0;
  for (const r of rows) {
    if (r.length > IMPORT_LIMITS.rowCells) tooBig();
    for (const c of r) {
      const n = c?.length ?? 0;
      if (n > IMPORT_LIMITS.rawCellChars) tooBig();
      raw += n;
    }
  }
  if (raw > IMPORT_LIMITS.gridChars) tooBig();
  const kept = rows.map((r) => r.map((c) => cleanCell(c ?? ""))).filter((r) => r.some((c) => c !== ""));
  const width = Math.max(0, ...kept.map((r) => r.length));
  const used = Array.from({ length: width }, (_, i) => kept.some((r) => (r[i] ?? "") !== ""));
  const out = kept.map((r) => used.flatMap((u, i) => (u ? [r[i] ?? ""] : [])));
  const cols = used.filter(Boolean).length;
  let cells = 0;
  for (const r of out) for (const c of r) if (c !== "") cells++;
  if (out.length > IMPORT_LIMITS.rows || cols > IMPORT_LIMITS.cols || cells > IMPORT_LIMITS.cells) tooBig();
  if (out.some((r) => r.some((c) => c.length > IMPORT_LIMITS.cellChars))) tooBig();
  return out;
}

/**
 * text/plain as Excel, Google Sheets and Word put a table on the clipboard: cells by tabs, rows by line breaks; a
 * cell holding a tab, a line break or a quote is wrapped in quotes, its quotes doubled. A quote that opens a cell
 * but never closes it is just a character: that line is read again without quoting.
 */
export function tsvGrid(text: string): Grid {
  if (text.length > IMPORT_LIMITS.textChars) tooBig();
  const src = text.replace(/\r\n?/g, "\n");
  const n = src.length;
  /** Where a plain cell starting at i ends: the next tab or line break. */
  const plainEnd = (i: number) => {
    let j = i;
    while (j < n && src[j] !== "\t" && src[j] !== "\n") j++;
    return j;
  };
  /** A quoted cell starting at i (its opening quote): its text and where it ends — or null when it never closes. */
  const quoted = (i: number): { value: string; next: number } | null => {
    let v = "";
    for (let j = i + 1; j < n; ) {
      if (src[j] !== '"') {
        v += src[j++];
        continue;
      }
      if (src[j + 1] === '"') {
        v += '"';
        j += 2;
        continue;
      }
      return j + 1 >= n || src[j + 1] === "\t" || src[j + 1] === "\n" ? { value: v, next: j + 1 } : null;
    }
    return null;
  };
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  for (;;) {
    const q = src[i] === '"' ? quoted(i) : null;
    const end = q ? q.next : plainEnd(i);
    row.push(q ? q.value : src.slice(i, end));
    i = end;
    if (i >= n) {
      rows.push(row);
      break;
    }
    i++; // the tab or the line break
    if (src[i - 1] === "\n") {
      rows.push(row);
      row = [];
      if (i >= n) break;
    } else if (i >= n) {
      row.push("");
      rows.push(row);
      break;
    }
  }
  return cleanGrid(rows);
}
