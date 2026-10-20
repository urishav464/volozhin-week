// A small .xlsx READER of our own (the site already writes xlsx with fflate — src/exports/xlsx.ts — and SheetJS is out
// of reach: DECISIONS שלב 0 §5). It reads what a table of names and times needs and nothing more: the workbook's
// sheets, shared strings (rich text too, never the phonetic runs), inline strings, numbers (a time or a date as Excel
// shows it, by the cell's number format), booleans — the first sheet or a chosen one. Formulas are never evaluated:
// the value Excel last saved is the cell. Merged cells: the top-left value is given to each row of the merge's first
// column (a day merged down its rows), as a pasted table's rowspan is. Hard limits: src/import/limits.ts.
import { badFile, IMPORT_LIMITS, readBudget, tooBig } from "./limits";
import { cleanGrid, type Grid } from "./table";
import { attr, local, xmlEvents } from "./xml";
import { type Budget, newBudget, readText, type ZipEntry, zipEntries } from "./zip";

export interface XlsxSheet {
  name: string;
  /** The part's path in the zip («xl/worksheets/sheet1.xml»). */
  path: string;
  hidden: boolean;
}

export interface XlsxBook {
  sheets: XlsxSheet[];
  /** One sheet as a grid (the first by default). */
  read(index?: number): Grid;
}

/** «A» → 0, «AB» → 27; null for anything else. */
export function columnIndex(letters: string): number | null {
  if (!/^[A-Z]{1,3}$/.test(letters)) return null;
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** «B12» → [row 11, col 1]. */
export function cellRef(ref: string): [number, number] | null {
  const m = /^([A-Z]{1,3})([0-9]{1,7})$/.exec(ref);
  if (!m) return null;
  const col = columnIndex(m[1]);
  const row = Number(m[2]) - 1;
  return col == null || row < 0 ? null : [row, col];
}

/** A relationship target as a path from the zip's root («worksheets/sheet1.xml» from «xl/»; «/xl/…» as it is). */
function resolve(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function rels(xml: string | null): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>();
  if (!xml) return out;
  for (const e of xmlEvents(xml)) {
    if (e.t === "open" && local(e.name) === "Relationship") out.set(e.attrs.Id ?? "", { type: e.attrs.Type ?? "", target: e.attrs.Target ?? "" });
  }
  return out;
}

/** Built-in number formats that show a date or a time (ECMA-376 §18.8.30). */
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
/** A format code that shows a date or time: d, m, y, h or s outside quotes, brackets' colours and escapes. */
function isDateCode(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, "");
  return /[dmyhs]/i.test(bare);
}

/** Each cell style's kind: a date/time format or not (xl/styles.xml cellXfs, by index). */
function dateStyles(xml: string | null): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  const out: boolean[] = [];
  let inXfs = false;
  for (const e of xmlEvents(xml)) {
    if (e.t === "open") {
      const n = local(e.name);
      if (n === "numFmt") custom.set(Number(e.attrs.numFmtId), e.attrs.formatCode ?? "");
      else if (n === "cellXfs") inXfs = true;
      else if (n === "xf" && inXfs) {
        const id = Number(e.attrs.numFmtId ?? 0);
        out.push(BUILTIN_DATE.has(id) || (custom.has(id) && isDateCode(custom.get(id)!)));
      }
    } else if (e.t === "close" && local(e.name) === "cellXfs") inXfs = false;
  }
  return out;
}

/** A number as text: an integer as it is, never «5.01E8»; a fraction without float noise. */
export function numberText(v: string): string {
  const x = Number(v);
  if (!Number.isFinite(x)) return v;
  if (Number.isInteger(x) && Math.abs(x) < 1e21) return BigInt(x).toString();
  return String(Number(x.toPrecision(15)));
}

/** A serial date/time as Excel shows it: «08:30» (a time only), «2026-03-15» (a date), or both. 1900 system. */
export function serialText(v: string): string {
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0 || x > 2958465) return numberText(v);
  const days = Math.floor(x);
  const minutes = Math.round((x - days) * 1440);
  const [dd, mm] = minutes === 1440 ? [days + 1, 0] : [days, minutes];
  const time = `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
  if (dd === 0) return time;
  // 25569 is 1970-01-01 in Excel's count (which has a 29 February 1900 that never was: dates before March 1900 are a day off — none here)
  const date = new Date((dd - 25569) * 86400000).toISOString().slice(0, 10);
  return mm === 0 ? date : `${date} ${time}`;
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  let cur: string[] | null = null;
  let inT = false;
  let skip = 0; // inside <rPh> (phonetic runs) — never the value
  for (const e of xmlEvents(xml)) {
    if (e.t === "open") {
      const n = local(e.name);
      if (n === "si") cur = [];
      else if (n === "rPh" || n === "phoneticPr") skip++;
      else if (n === "t" && !skip) inT = true;
    } else if (e.t === "close") {
      const n = local(e.name);
      if (n === "si" && cur) {
        out.push(cur.join(""));
        if (out.length > IMPORT_LIMITS.sharedStrings) tooBig();
        cur = null;
      } else if (n === "rPh" || n === "phoneticPr") skip = Math.max(0, skip - 1);
      else if (n === "t") inT = false;
    } else if (inT && cur && !skip) cur.push(e.v);
  }
  return out;
}

function readSheet(xml: string, shared: string[], dates: boolean[]): Grid {
  const cells = new Map<number, Map<number, string>>();
  const merges: [number, number, number, number][] = [];
  let filled = 0;
  let rowAt = -1;
  let colAt = -1;
  let cell: { r: number; c: number; type: string; style: number; v: string[]; is: string[] } | null = null;
  let inV = false;
  let inIs = false;
  let inT = false;
  let phonetic = 0; // inside <rPh>: a reading aid, never the value
  // every cell counted as it is put: one shared string (or a merge) given to many cells is refused at the first too
  // long, and at the total — never copied into thousands of cells first
  const budget = readBudget();
  const put = (r: number, c: number, text: string) => {
    if (text === "") return;
    if (r >= IMPORT_LIMITS.rows || c >= IMPORT_LIMITS.cols) tooBig();
    budget.cell(text);
    let row = cells.get(r);
    if (!row) cells.set(r, (row = new Map()));
    if (!row.has(c) && ++filled > IMPORT_LIMITS.cells) tooBig();
    row.set(c, text);
  };
  for (const e of xmlEvents(xml)) {
    if (e.t === "open") {
      const n = local(e.name);
      if (n === "row") {
        const r = Number(e.attrs.r);
        rowAt = Number.isInteger(r) && r > 0 ? r - 1 : rowAt + 1;
        colAt = -1;
      } else if (n === "c") {
        const ref = e.attrs.r ? cellRef(e.attrs.r) : null;
        const c = ref ? ref[1] : colAt + 1;
        colAt = c;
        cell = { r: ref ? ref[0] : Math.max(rowAt, 0), c, type: e.attrs.t ?? "n", style: Number(e.attrs.s ?? 0), v: [], is: [] };
      } else if (n === "v" && cell) inV = true;
      else if (n === "is" && cell) inIs = true;
      else if (n === "t" && inIs) inT = true;
      else if (n === "rPh") phonetic++;
      else if (n === "mergeCell" && e.attrs.ref) {
        const [a, b] = e.attrs.ref.split(":");
        const from = cellRef(a);
        const to = cellRef(b ?? a);
        if (from && to) merges.push([from[0], from[1], to[0], to[1]]);
        if (merges.length > IMPORT_LIMITS.cells) tooBig(); // a tiny file of a million merges: refused, not read
      }
    } else if (e.t === "close") {
      const n = local(e.name);
      if (n === "v") inV = false;
      else if (n === "t") inT = false;
      else if (n === "rPh") phonetic = Math.max(0, phonetic - 1);
      else if (n === "is") inIs = false;
      else if (n === "c" && cell) {
        const raw = cell.v.join("");
        let text: string;
        switch (cell.type) {
          case "s":
            text = shared[Number(raw)] ?? "";
            break;
          case "inlineStr":
            text = cell.is.join("");
            break;
          case "str":
          case "e":
          case "d":
            text = raw;
            break;
          case "b":
            text = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : raw;
            break;
          default:
            text = raw === "" ? "" : dates[cell.style] ? serialText(raw) : numberText(raw);
        }
        put(cell.r, cell.c, text);
        cell = null;
      }
    } else if (cell) {
      if (inV) cell.v.push(e.v);
      else if (inT && inIs && !phonetic) cell.is.push(e.v);
    }
  }
  // a merged cell's text down its rows — the work counted: past a table's cells, the file is refused
  let work = 0;
  for (const [r0, c0, r1] of merges) {
    const v = cells.get(r0)?.get(c0);
    if (v == null) continue;
    const last = Math.min(r1, IMPORT_LIMITS.rows - 1);
    work += Math.max(0, last - r0);
    if (work > IMPORT_LIMITS.cells) tooBig();
    for (let r = r0 + 1; r <= last; r++) if (!cells.get(r)?.get(c0)) put(r, c0, v);
  }
  const rows = Math.max(-1, ...cells.keys()) + 1;
  const cols = Math.max(-1, ...[...cells.values()].flatMap((m) => [...m.keys()])) + 1;
  const grid: string[][] = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cells.get(r)?.get(c) ?? ""));
  return cleanGrid(grid);
}

/** An .xlsx's sheets, read lazily. Refused: not a workbook, encrypted, past a limit. */
export function readXlsx(bytes: Uint8Array): XlsxBook {
  const entries: ZipEntry[] = zipEntries(bytes);
  const budget: Budget = newBudget();
  const text = (name: string) => readText(bytes, entries, name, budget);
  const rootRels = rels(text("_rels/.rels"));
  const officeDoc = [...rootRels.values()].find((r) => r.type.endsWith("/officeDocument"))?.target;
  const wbPath = officeDoc ? resolve("", officeDoc) : "xl/workbook.xml";
  const wb = text(wbPath);
  if (!wb) badFile();
  const base = wbPath.slice(0, wbPath.lastIndexOf("/") + 1);
  const wbRels = rels(text(`${base}_rels/${wbPath.slice(base.length)}.rels`));
  const sheets: XlsxSheet[] = [];
  for (const e of xmlEvents(wb!)) {
    if (e.t !== "open" || local(e.name) !== "sheet") continue;
    const rel = wbRels.get(attr(e.attrs, "id") ?? "");
    if (!rel || !rel.type.endsWith("/worksheet")) continue; // a chart sheet, a dialog sheet
    sheets.push({ name: e.attrs.name ?? `גיליון ${sheets.length + 1}`, path: resolve(base, rel.target), hidden: (e.attrs.state ?? "visible") !== "visible" });
  }
  if (sheets.length === 0) badFile();
  const ssRel = [...wbRels.values()].find((r) => r.type.endsWith("/sharedStrings"));
  const stRel = [...wbRels.values()].find((r) => r.type.endsWith("/styles"));
  let shared: string[] | null = null;
  let dates: boolean[] | null = null;
  const read = new Map<number, Grid>(); // a sheet is inflated once, whichever way the admin switches
  return {
    sheets,
    read(index = 0) {
      const done = read.get(index);
      if (done) return done;
      const s = sheets[index] ?? badFile();
      shared ??= sharedStrings(ssRel ? text(resolve(base, ssRel.target)) : null);
      dates ??= dateStyles(stRel ? text(resolve(base, stRel.target)) : null);
      const xml = text(s.path);
      if (xml == null) badFile();
      const grid = readSheet(xml!, shared, dates);
      read.set(index, grid);
      return grid;
    },
  };
}
