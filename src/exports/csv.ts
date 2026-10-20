// CSV as Excel opens Hebrew correctly: UTF-8 with a byte-order mark, CRLF line
// ends (RFC 4180), commas, and a cell quoted (its quotes doubled) whenever it
// holds a comma, a quote or a line break. Every cell passes the formula guard.
import { guardCell, type Table } from "./table";

export const BOM = "﻿";

function field(v: string): string {
  const s = guardCell(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The whole file as text — the BOM first, CRLF after every record. */
export function toCsv(t: Pick<Table, "headers" | "rows">): string {
  return BOM + [t.headers, ...t.rows].map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}

/** The file's bytes (UTF-8, BOM included). */
export function csvBytes(t: Pick<Table, "headers" | "rows">): Uint8Array {
  return new TextEncoder().encode(toCsv(t));
}
