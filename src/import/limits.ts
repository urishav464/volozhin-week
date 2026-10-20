// The import wizard's hard limits (DECISIONS «ייבוא תשפ"ו»). Last year's files are small — the candidates' sheet
// is 139 rows, the tracking sheet ~60, the escorts' file ~70 — so every limit is far above them and far below what
// would freeze a phone: a file past one of them (a zip bomb, a sheet of a million styled rows, a pasted book) is
// refused at once with a Hebrew message, before anything of it is kept — and «at once» is meant: the readers count as
// they read (readBudget), so a small file that multiplies one long cell or a row's width is refused before the page
// spends seconds on it. Nothing raw is ever stored: the rows read live in the page's memory until the commit, and go
// away with it.
import { CommandError } from "../data/commands";

export const IMPORT_LIMITS = {
  /** An uploaded .xlsx / .docx, as it is on the disk. */
  fileBytes: 10 * 1024 * 1024,
  /** A pasted text/html (Word's clipboard HTML is verbose: styles on every cell). */
  htmlChars: 5_000_000,
  /** A pasted text/plain. */
  textChars: 2_000_000,
  /** Parts in a zip (an xlsx has ~10–30, a docx with pictures a few dozen). */
  zipEntries: 2_000,
  /**
   * One part, inflated — what a zip says of its size is not trusted: the inflate itself stops here. «הצעה»: a real
   * part is far below it (a 139-row sheet1.xml, a 70-row document.xml: well under 1MB), and a part this size of empty
   * elements is read in under a second (DECISIONS «ביקורת: ייבוא ואבן דרך 6», סבב שלישי).
   */
  entryBytes: 4 * 1024 * 1024,
  /** Every part read from one file, inflated, together («הצעה», as entryBytes). */
  totalBytes: 8 * 1024 * 1024,
  /** A table's rows, columns and filled cells after reading. */
  rows: 3_000,
  cols: 60,
  cells: 60_000,
  /** One cell's text. */
  cellChars: 5_000,
  /**
   * One cell AS READ, before its spaces and marks are cleaned (twice cellChars): past it the reader refuses at once —
   * before cleaning it, and before a merge, a rowspan or a shared string copies it into more cells.
   */
  rawCellChars: 10_000,
  /** All of a table's text together, as read — a cell a merge carries down counted in every row it fills. */
  gridChars: 5_000_000,
  /** A row's cells as read, before empty columns are dropped (a row past it is no table of names: refused as it comes). */
  rowCells: 240,
  /** Tables inside tables in a .docx (a real file nests two or three). */
  nesting: 32,
  /** An xlsx's shared strings. */
  sharedStrings: 200_000,
  /** The commit's rows (supabase/schema.sql «Import 5786» holds the same). */
  commitRows: 1_000,
} as const;

/**
 * What a reader takes in, counted AS IT READS — every cell (an empty one too: a spanned cell's blanks) and every
 * character — and refused the moment it passes a table's limits: a small file that multiplies one long cell, or a
 * row's width, never freezes the page first (DECISIONS «ביקורת: ייבוא ואבן דרך 6», סבב שני).
 */
export interface ReadBudget {
  /**
   * One cell placed: its text refused past rawCellChars, the cells past cells × 4 and the text past gridChars;
   * `blanks` empty cells beside it (a span); `counted`: its characters were already counted as they were read (chars).
   */
  cell(text: string, blanks?: number, counted?: boolean): void;
  /** Characters as they are read (a .docx's text, before its cell ends). */
  chars(n: number): void;
}

export function readBudget(): ReadBudget {
  let cells = 0;
  let chars = 0;
  return {
    cell(text, blanks = 0, counted = false) {
      if (text.length > IMPORT_LIMITS.rawCellChars) tooBig();
      if (!counted) chars += text.length;
      cells += 1 + blanks;
      if (cells > IMPORT_LIMITS.cells * 4 || chars > IMPORT_LIMITS.gridChars) tooBig();
    },
    chars(n) {
      chars += n;
      if (chars > IMPORT_LIMITS.gridChars) tooBig();
    },
  };
}

/** A file or a paste the wizard will not read — the code's Hebrew is in src/errors.ts. */
export const tooBig = (): never => {
  throw new CommandError("import_too_big");
};
export const badFile = (): never => {
  throw new CommandError("import_bad_file");
};
