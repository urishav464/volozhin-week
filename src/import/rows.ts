// A read table's rows as the kinds use them: the header row apart, each data row with the sheet's own row number
// (what the preview and a refusal name), and a mapped field's cells.
import { columnsOf, type Mapping } from "./fields";
import type { Grid } from "./table";

export interface DataRow {
  /** The row number in the table as read (1-based, the header row and the rows above it counted) — «שורה 7». */
  row: number;
  cells: string[];
}

/**
 * Which row holds the headers: its index in the table (0: the first), or null — none, every row is data. The rows
 * ABOVE it are left out (a title paragraph over a Word table, a merged title row in Excel); the row numbers stay the
 * table's own.
 */
export type HeaderAt = number | null;

export function dataRows(grid: Grid, headerRow: HeaderAt): DataRow[] {
  const from = headerRow == null ? 0 : headerRow + 1;
  return grid.slice(from).map((cells, i) => ({ row: i + from + 1, cells }));
}

/** Each column's name: its header, or «עמודה N». */
export function columnNames(grid: Grid, headerRow: HeaderAt): string[] {
  const width = grid[0]?.length ?? 0;
  const head = headerRow == null ? null : grid[headerRow];
  return Array.from({ length: width }, (_, i) => (head?.[i] ? head[i] : `עמודה ${i + 1}`));
}

/** The text of a single-column field ('' when unmapped). */
export function cellOf(cells: readonly string[], m: Mapping, key: string): string {
  const [i] = columnsOf(m, key);
  return i == null ? "" : (cells[i] ?? "");
}

/** A multi-column field's filled cells, each with its column's name. */
export function labelledCells(cells: readonly string[], m: Mapping, key: string, names: readonly string[]): { name: string; text: string }[] {
  return columnsOf(m, key).flatMap((i) => (cells[i] ? [{ name: names[i], text: cells[i] }] : []));
}

/** The sheet's notes as lines: «כותרת: ערך» (a value of several lines keeps them). */
export function noteLines(parts: { name: string; text: string }[]): string[] {
  return parts.map((p) => `${p.name}: ${p.text}`);
}
