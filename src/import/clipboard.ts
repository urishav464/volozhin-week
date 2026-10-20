// A paste into the wizard: the clipboard's text/html when it holds a table (Excel, Google Sheets, Google Docs and
// Word all put one there), else its text/plain read as tab-separated rows. Never inserted as HTML: the event's
// default is prevented, and only the cells' text is kept, in memory.
import { gridFromHtml, hasTable, type MiniNode } from "./html";
import type { Grid, GridSource } from "./table";
import { tsvGrid } from "./table";

/** What a ClipboardEvent's clipboardData gives (a test's synthetic paste gives the same). */
export interface ClipboardLike {
  getData(type: string): string;
}

export function gridFromClipboard(data: ClipboardLike, parse?: (html: string) => MiniNode): { grid: Grid; source: GridSource } {
  const html = data.getData("text/html") ?? "";
  if (html && hasTable(html)) {
    const grid = gridFromHtml(html, parse);
    if (grid.length) return { grid, source: "html" };
  }
  const text = data.getData("text/plain") ?? "";
  if (text.trim()) return { grid: tsvGrid(text), source: "text" };
  // HTML with no table and no plain text beside it: its lines
  return { grid: html ? gridFromHtml(html, parse) : [], source: "html" };
}
