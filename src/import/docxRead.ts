// A .docx as the wizard reads it (last year's escorts' file is a Word document): its paragraphs and its tables'
// cells, as text, in document order — a paragraph is a row (its tabs split it into cells, as a list typed with tabs
// is a table), a table row is a row. Nothing else: no headers or footers, no comments, no deleted text of tracked
// changes and no old place of a tracked move, a text box once (never its fallback copy). The same limits as an .xlsx
// (src/import/limits.ts), counted as it reads: a row's width, the nesting, the cells and the text.
import { badFile, IMPORT_LIMITS, readBudget, tooBig } from "./limits";
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
  /** Open tables: each with its current row, the current cell's text (and its length), the cell's span and vertical merge. */
  const tables: { row: string[] | null; prev: string[] | null; cell: string[] | null; len: number; span: number; vmerge: "restart" | "continue" | null }[] = [];
  let para: string[] | null = null; // a paragraph outside every table
  let paraDepth = 0; // a text box's paragraphs inside a paragraph are lines of it
  let inText = false;
  let skip = 0; // deleted text, a text box's fallback copy, fields' instructions
  let paraCells = 1; // a paragraph's cells so far (its tabs + 1)
  let paraLen = 0; // the length of the paragraph's current cell
  // counted as read: a row's width (gridSpan, tabs), the nesting, the cells, a cell's text and all the text — refused
  // the moment one passes its limit, never built first
  const budget = readBudget();
  // «tabs»: a paragraph's tab STOPS (<w:pPr><w:tabs><w:tab w:pos=…/>) — the same name as a tab typed in a run, never one;
  // «moveFrom»: a tracked move's old place (its text is ordinary runs, not delText) — the text is read where it moved to
  const SKIPPED = new Set(["delText", "Fallback", "instrText", "del", "tabs", "moveFrom"]);
  /** Text into the current table cell, else the current paragraph — counted as it comes. */
  const put = (s: string) => {
    budget.chars(s.length);
    const t = tables[tables.length - 1];
    if (t?.cell) {
      t.len += s.length;
      if (t.len > IMPORT_LIMITS.rawCellChars) tooBig();
      t.cell.push(s);
    } else if (para) {
      paraLen = s === "\t" ? 0 : paraLen + s.length;
      if (paraLen > IMPORT_LIMITS.rawCellChars) tooBig();
      para.push(s);
    }
  };
  // a self-closing skipped element (a moved paragraph's mark, <w:moveFrom/>; a deleted one's, <w:del/>) opens nothing:
  // its close — the one xmlEvents gives right after it — must not end an outer skip (a text box's fallback copy)
  let selfClosing = false;
  for (const e of xmlEvents(xml)) {
    if (e.t === "open") {
      const n = local(e.name);
      if (SKIPPED.has(n)) {
        if (e.self) selfClosing = true;
        else skip++;
        continue;
      }
      if (skip) continue;
      if (n === "tbl") {
        // a table inside a cell is that cell's text: the outer cell keeps collecting
        if (tables.length >= IMPORT_LIMITS.nesting) tooBig();
        tables.push({ row: null, prev: null, cell: null, len: 0, span: 1, vmerge: null });
      } else if (n === "tr" && tables.length) tables[tables.length - 1].row = [];
      else if (n === "tc" && tables.length) Object.assign(tables[tables.length - 1], { cell: [], len: 0, span: 1, vmerge: null });
      else if (n === "gridSpan" && tables.length) tables[tables.length - 1].span = Math.max(1, Math.min(Number(attr(e.attrs, "val") ?? 1) || 1, 60));
      else if (n === "vMerge" && tables.length) tables[tables.length - 1].vmerge = attr(e.attrs, "val") === "restart" ? "restart" : "continue";
      else if (n === "p") {
        if (!tables.length) {
          if (paraDepth++ === 0) {
            para = [];
            paraCells = 1;
            paraLen = 0;
          } else put("\n");
        } else if ((tables[tables.length - 1].cell?.length ?? 0) > 0) put("\n");
      } else if (n === "t") inText = true;
      else if (n === "tab") {
        // a paragraph's tab is a new cell: its width counted as it comes
        if (!tables.length && para && ++paraCells > IMPORT_LIMITS.rowCells) tooBig();
        put(tables.length ? " " : "\t");
      } else if (n === "br" || n === "cr") put("\n");
    } else if (e.t === "close") {
      const n = local(e.name);
      if (SKIPPED.has(n)) {
        if (selfClosing) selfClosing = false;
        else skip = Math.max(0, skip - 1);
        continue;
      }
      if (skip) continue;
      if (n === "t") inText = false;
      else if (n === "p" && !tables.length) {
        if (--paraDepth <= 0) {
          paraDepth = 0;
          if (para) rows.push(para.join("").split("\t"));
          para = null;
          if (rows.length > IMPORT_LIMITS.rows * 4) tooBig(); // millions of empty paragraphs: refused as they come
        }
      } else if (n === "tc" && tables.length) {
        const t = tables[tables.length - 1];
        if (t.row && t.cell) {
          let text = t.cell.join("");
          // a cell continuing a vertical merge: the text of the cell above it
          if (t.vmerge === "continue") text = t.prev?.[t.row.length] ?? "";
          if (t.row.length + t.span > IMPORT_LIMITS.rowCells) tooBig();
          budget.cell(text, t.span - 1, t.vmerge !== "continue"); // a merge's copy is new text; the rest was counted as read
          t.row.push(text, ...Array.from({ length: t.span - 1 }, () => ""));
        }
        t.cell = null;
      } else if (n === "tr" && tables.length) {
        const t = tables[tables.length - 1];
        if (t.row) {
          if (tables.length === 1) {
            rows.push(t.row);
            if (rows.length > IMPORT_LIMITS.rows * 4) tooBig();
          }
          // a nested table's rows are lines of the outer cell (their text was counted as read; the outer cell's length grows)
          else {
            const outer = tables[tables.length - 2];
            const line = t.row.join(" ");
            outer.len += line.length + 1;
            if (outer.len > IMPORT_LIMITS.rawCellChars) tooBig();
            outer.cell?.push("\n", line);
          }
          t.prev = t.row;
        }
        t.row = null;
      } else if (n === "tbl" && tables.length) tables.pop();
    } else if (inText && !skip) put(e.v);
  }
  return cleanGrid(rows);
}
