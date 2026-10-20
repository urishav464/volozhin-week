// A table pasted as text/html — what Excel, Google Sheets, Google Docs and Word put on the clipboard beside the
// plain text. It is parsed by the browser's DOMParser into an inert document (no script runs in it, nothing it names
// is fetched) and only the TEXT of its cells is read: the HTML is never inserted anywhere, never kept, never shown.
// The walk itself (gridFromNodes) takes any tree of the shape below, so its rules are unit tests without a browser.
import { IMPORT_LIMITS, tooBig } from "./limits";
import { cleanGrid, type Grid } from "./table";

/** The part of a DOM node the walk reads. */
export interface MiniNode {
  /** 1 element, 3 text, 4 CDATA, 8 comment, 9 document. */
  nodeType: number;
  /** An element's tag, upper-case as an HTML document gives it («TD», «O:P»). */
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<MiniNode>;
  getAttribute?(name: string): string | null;
}

/** Never text: what is not content (head, styles, scripts) and what a form shows instead of its content. */
const SKIP = new Set(["HEAD", "TITLE", "META", "LINK", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "OBJECT", "EMBED", "IFRAME", "SVG", "MATH", "SELECT", "TEXTAREA", "BUTTON", "IMG"]);
/** A line of its own. */
const BLOCK = new Set([
  "P", "DIV", "LI", "UL", "OL", "DL", "DT", "DD", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER", "FOOTER",
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "CAPTION", "HR",
]);
/** How many nodes one paste may have — a guard against a pathological tree, far above any real table. */
const MAX_NODES = 2_000_000;
/** rowspan/colspan as a browser clamps them (colspan ≤ 1000, rowspan ≤ 65534) — and then to the table's own limits. */
const span = (n: MiniNode, name: string, max: number) => {
  const v = Number.parseInt(n.getAttribute?.(name) ?? "1", 10);
  return Number.isFinite(v) && v > 1 ? Math.min(v, max) : 1;
};

const kids = (n: MiniNode) => Array.from(n.childNodes ?? []);
const isEl = (n: MiniNode, ...names: string[]) => n.nodeType === 1 && names.includes(n.nodeName.toUpperCase());

/**
 * The tables of a document as one grid, in document order — a table nested in a cell is that cell's text. With no
 * table at all, each line of the text is a row (cells by tabs), as a paste of paragraphs is read. A cell spanning rows
 * (rowspan: a day merged down its rows) gives its text to each of them; one spanning columns leaves the others empty.
 */
export function gridFromNodes(root: MiniNode): Grid {
  let visited = 0;
  const count = () => {
    if (++visited > MAX_NODES) tooBig();
  };

  /** The text of a node: line breaks for <br> and around blocks, nothing of what SKIP names. */
  const textOf = (n: MiniNode): string => {
    count();
    if (n.nodeType === 3 || n.nodeType === 4) return n.nodeValue ?? "";
    if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return ""; // comments, processing instructions
    const name = n.nodeType === 1 ? n.nodeName.toUpperCase() : "";
    if (SKIP.has(name)) return "";
    if (name === "BR") return "\n";
    const inner = kids(n).map(textOf).join("");
    if (name === "TD" || name === "TH") return `${inner}\t`;
    return BLOCK.has(name) ? `\n${inner}\n` : inner;
  };
  const cellText = (n: MiniNode) =>
    kids(n)
      .map(textOf)
      .join("")
      .replace(/\t/g, " ");

  const tables: MiniNode[] = [];
  const findTables = (n: MiniNode) => {
    count();
    if (n.nodeType === 1 && SKIP.has(n.nodeName.toUpperCase())) return;
    if (isEl(n, "TABLE")) {
      tables.push(n);
      return; // a table inside it is a cell's text
    }
    for (const c of kids(n)) findTables(c);
  };
  findTables(root);

  if (tables.length === 0) {
    return cleanGrid(
      textOf(root)
        .split("\n")
        .map((line) => line.split("\t")),
    );
  }

  const grid: string[][] = [];
  for (const t of tables) {
    const rows: MiniNode[] = [];
    const findRows = (n: MiniNode) => {
      for (const c of kids(n)) {
        if (isEl(c, "TR")) rows.push(c);
        else if (isEl(c, "THEAD", "TBODY", "TFOOT")) findRows(c);
      }
    };
    findRows(t);
    /** Cells carried down by a rowspan: column → its text and the rows still to fill. */
    const carry = new Map<number, { text: string; left: number }>();
    for (const tr of rows) {
      const row: string[] = [];
      let col = 0;
      const fillCarried = () => {
        for (let c = carry.get(col); c; c = carry.get(col)) {
          row[col] = c.text;
          if (--c.left === 0) carry.delete(col);
          col++;
        }
      };
      for (const cell of kids(tr)) {
        if (!isEl(cell, "TD", "TH")) continue;
        fillCarried();
        const text = cellText(cell);
        const cs = span(cell, "colspan", IMPORT_LIMITS.cols);
        const rs = span(cell, "rowspan", IMPORT_LIMITS.rows);
        for (let k = 0; k < cs; k++) {
          row[col + k] = k === 0 ? text : "";
          if (rs > 1) carry.set(col + k, { text: k === 0 ? text : "", left: rs - 1 });
        }
        col += cs;
        if (col > IMPORT_LIMITS.cols * 4) tooBig();
      }
      fillCarried();
      grid.push(Array.from({ length: row.length }, (_, i) => row[i] ?? ""));
      if (grid.length > IMPORT_LIMITS.rows * 4) tooBig();
    }
  }
  return cleanGrid(grid);
}

/** The browser's parser: an inert document — scripts do not run in it and nothing it names is loaded. */
function domParse(html: string): MiniNode {
  return new DOMParser().parseFromString(html, "text/html") as unknown as MiniNode;
}

/** A pasted text/html as a grid (refused past IMPORT_LIMITS.htmlChars before it is parsed at all). */
export function gridFromHtml(html: string, parse: (html: string) => MiniNode = domParse): Grid {
  if (html.length > IMPORT_LIMITS.htmlChars) tooBig();
  return gridFromNodes(parse(html));
}

/** Does this HTML hold a table? (A cheap look before parsing: a paste of plain paragraphs is read from text/plain.) */
export const hasTable = (html: string) => /<table[\s>]/i.test(html);
