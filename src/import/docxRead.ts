// A .docx as the wizard reads it (last year's escorts' file is a Word document): its paragraphs and its tables'
// cells, as text, in document order — a paragraph is a row (its tabs split it into cells, as a list typed with tabs
// is a table), a table row is a row. Nothing else: no headers or footers, no comments, no deleted text of tracked
// changes, a text box once (never its fallback copy). The same limits as an .xlsx (src/import/limits.ts).
import { badFile } from "./limits";
import { cleanGrid, type Grid } from "./table";
import { attr, local, xmlEvents } from "./xml";
import { newBudget, readText, zipEntries } from "./zip";

/** word/document.xml (or wherever the package's officeDocument relationship points) as a grid. */
export function readDocx(bytes: Uint8Array): Grid {
  const entries = zipEntries(bytes);
  const budget = newBudget();
  const relsXml = readText(bytes, entries, "_rels/.rels", budget);
  let path = "word/document.xml";
  if (relsXml) {
    for (const e of xmlEvents(relsXml)) {
      if (e.t === "open" && local(e.name) === "Relationship" && (e.attrs.Type ?? "").endsWith("/officeDocument")) {
        path = (e.attrs.Target ?? path).replace(/^\//, "");
      }
    }
  }
  const xml = readText(bytes, entries, path, budget);
  if (xml == null) return badFile();
  return documentGrid(xml);
}

/** The grid of a WordprocessingML document part (exported for the tests). */
export function documentGrid(xml: string): Grid {
  const rows: string[][] = [];
  /** Open tables: each with its current row, the current cell's text, the cell's span and vertical merge. */
  const tables: { row: string[] | null; prev: string[] | null; cell: string[] | null; span: number; vmerge: "restart" | "continue" | null }[] = [];
  let para: string[] | null = null; // a paragraph outside every table
  let paraDepth = 0; // a text box's paragraphs inside a paragraph are lines of it
  let inText = false;
  let skip = 0; // deleted text, a text box's fallback copy, fields' instructions
  const SKIPPED = new Set(["delText", "Fallback", "instrText", "del"]);
  const sink = () => tables[tables.length - 1]?.cell ?? para;
  for (const e of xmlEvents(xml)) {
    if (e.t === "open") {
      const n = local(e.name);
      if (SKIPPED.has(n)) {
        if (!e.self) skip++;
        continue;
      }
      if (skip) continue;
      if (n === "tbl") {
        // a table inside a cell is that cell's text: the outer cell keeps collecting
        tables.push({ row: null, prev: null, cell: null, span: 1, vmerge: null });
      } else if (n === "tr" && tables.length) tables[tables.length - 1].row = [];
      else if (n === "tc" && tables.length) Object.assign(tables[tables.length - 1], { cell: [], span: 1, vmerge: null });
      else if (n === "gridSpan" && tables.length) tables[tables.length - 1].span = Math.max(1, Math.min(Number(attr(e.attrs, "val") ?? 1) || 1, 60));
      else if (n === "vMerge" && tables.length) tables[tables.length - 1].vmerge = attr(e.attrs, "val") === "restart" ? "restart" : "continue";
      else if (n === "p") {
        if (!tables.length) {
          if (paraDepth++ === 0) para = [];
          else para?.push("\n");
        } else if ((tables[tables.length - 1].cell?.length ?? 0) > 0) tables[tables.length - 1].cell!.push("\n");
      } else if (n === "t") inText = true;
      else if (n === "tab") sink()?.push(tables.length ? " " : "\t");
      else if (n === "br" || n === "cr") sink()?.push("\n");
    } else if (e.t === "close") {
      const n = local(e.name);
      if (SKIPPED.has(n)) {
        skip = Math.max(0, skip - 1);
        continue;
      }
      if (skip) continue;
      if (n === "t") inText = false;
      else if (n === "p" && !tables.length) {
        if (--paraDepth <= 0) {
          paraDepth = 0;
          if (para) rows.push(para.join("").split("\t"));
          para = null;
        }
      } else if (n === "tc" && tables.length) {
        const t = tables[tables.length - 1];
        if (t.row && t.cell) {
          let text = t.cell.join("");
          // a cell continuing a vertical merge: the text of the cell above it
          if (t.vmerge === "continue") text = t.prev?.[t.row.length] ?? "";
          t.row.push(text, ...Array.from({ length: t.span - 1 }, () => ""));
        }
        t.cell = null;
      } else if (n === "tr" && tables.length) {
        const t = tables[tables.length - 1];
        if (t.row) {
          if (tables.length === 1) rows.push(t.row);
          // a nested table's rows are lines of the outer cell
          else tables[tables.length - 2].cell?.push("\n", t.row.join(" "));
          t.prev = t.row;
        }
        t.row = null;
      } else if (n === "tbl" && tables.length) tables.pop();
    } else if (inText && !skip) sink()?.push(e.v);
  }
  return cleanGrid(rows);
}
