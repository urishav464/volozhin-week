// Markdown-lite: what the knowledge base's notes and the user guide
// (docs/GUIDE.he.md) are written in — headings (#, ##, ###), paragraphs (a
// blank line between them; a single line break stays a line break), bullet
// lists (- or * or •), numbered lists (1.) and **bold**. Nothing else is
// markup: an HTML tag, a link or an image is plain text. This parses into
// blocks of text pieces; src/screens/Markdown.tsx draws them as React text
// nodes, so no string ever becomes HTML.

/** A run of text, bold or not. */
export interface Piece {
  text: string;
  bold: boolean;
}

/** One line of a block: its pieces. */
export type Line = Piece[];

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; line: Line }
  | { kind: "paragraph"; lines: Line[] }
  | { kind: "bullets"; items: Line[] }
  | { kind: "numbers"; items: Line[] };

/** «a **b** c» → a, **b**, c. An unclosed ** stays as typed. */
export function parseInline(s: string): Line {
  const out: Line = [];
  const re = /\*\*(.+?)\*\*/g;
  let at = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > at) out.push({ text: s.slice(at, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    at = m.index! + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at), bold: false });
  return out;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/;

export function parseMarkdown(src: string | null | undefined): Block[] {
  const blocks: Block[] = [];
  let para: Line[] | null = null;
  let list: { kind: "bullets" | "numbers"; items: Line[] } | null = null;
  const flush = () => {
    if (para) blocks.push({ kind: "paragraph", lines: para });
    if (list) blocks.push(list);
    para = null;
    list = null;
  };
  for (const raw of (src ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") {
      flush();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, line: parseInline(h[2].trim()) });
      continue;
    }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBER.exec(line);
    if (b || n) {
      const kind = b ? "bullets" : "numbers";
      if (para || (list && list.kind !== kind)) flush();
      list ??= { kind, items: [] };
      list.items.push(parseInline((b ?? n)![1].trim()));
      continue;
    }
    if (list) {
      // a line under a list item, indented or not, continues that item
      const last = list.items[list.items.length - 1];
      last.push({ text: " ", bold: false }, ...parseInline(line.trim()));
      continue;
    }
    para ??= [];
    para.push(parseInline(line.trim()));
  }
  flush();
  return blocks;
}

/** The text alone (for a search, or a screen reader's summary). */
export function plainText(blocks: Block[]): string {
  const line = (l: Line) => l.map((p) => p.text).join("");
  return blocks
    .map((b) => (b.kind === "heading" ? line(b.line) : b.kind === "paragraph" ? b.lines.map(line).join("\n") : b.items.map(line).join("\n")))
    .join("\n\n");
}
