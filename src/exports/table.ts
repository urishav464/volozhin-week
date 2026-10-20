// What every export writes: a table of text cells, made in the browser from the
// loaded Week and handed to the CSV or the xlsx writer (src/exports/csv.ts,
// xlsx.ts). Pure, so a test can read every byte.

export interface Table {
  /** One sheet's name (xlsx) — 31 characters at most, no []:*?/\. */
  name: string;
  headers: string[];
  rows: string[][];
  /** Column widths in characters (xlsx). */
  widths?: number[];
  /** A row's background, RGB hex without '#' (xlsx), one per row; null = none. */
  fills?: (string | null)[];
  /** Printed landscape (xlsx page setup). */
  landscape?: boolean;
}

/**
 * The formula-injection guard (OWASP «CSV injection»): a cell that starts with
 * = + - @, a tab or a line break could be read as a formula by a spreadsheet,
 * so it gets a leading apostrophe — shown as text, never evaluated. Applied to
 * every cell of every CSV and xlsx this site writes.
 */
export function guardCell(v: string): string {
  return /^[=+\-@\t\r\n]/.test(v) ? `'${v}` : v;
}

/**
 * LEFT-TO-RIGHT MARK before a time range in a file's cell: a right-to-left cell
 * would otherwise lay «08:30–09:45» out as «09:45–08:30» (the dash between two
 * numbers takes the cell's direction). Invisible; the screens use <bdi> instead.
 */
export const LRM = "\u200E";
