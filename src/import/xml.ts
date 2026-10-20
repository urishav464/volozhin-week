// A small XML tokenizer for the two parts the wizard reads from an Office file (SpreadsheetML's sheets and shared
// strings; WordprocessingML's document) — the browser's own XML parser would do, but this one runs the same in the
// unit tests, and it does less: no DTD at all (a part that declares one is refused — nothing to expand, no entity
// to blow up), the five predefined entities and character references only, names compared without their prefix.
import { badFile } from "./limits";

export type XmlEvent =
  | { t: "open"; name: string; attrs: Record<string, string>; self: boolean }
  | { t: "close"; name: string }
  | { t: "text"; v: string };

/** «w:t» → «t», «x:row» → «row»: Office files use whichever prefix they declare. */
export const local = (name: string) => name.slice(name.indexOf(":") + 1);

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Character and predefined entity references; any other «&name;» stays as it is. */
export function unescapeXml(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? m;
  });
}

const NAME = /^[A-Za-z_][\w.:-]*$/;
const ATTR = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** The events of an XML text, in order. A tag that never closes, or a DOCTYPE, is refused (import_bad_file). */
export function* xmlEvents(src: string): Generator<XmlEvent> {
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      const v = src.slice(i);
      if (v.trim()) yield { t: "text", v: unescapeXml(v) };
      return;
    }
    if (lt > i) yield { t: "text", v: unescapeXml(src.slice(i, lt)) };
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end < 0) badFile();
      i = end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      if (end < 0) badFile();
      yield { t: "text", v: src.slice(lt + 9, end) };
      i = end + 3;
      continue;
    }
    if (src.startsWith("<!", lt)) badFile(); // a DOCTYPE (an Office part never has one)
    if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      if (end < 0) badFile();
      i = end + 2;
      continue;
    }
    // a tag: up to its «>», outside quoted attribute values
    let j = lt + 1;
    let quote = "";
    while (j < n) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j++;
    }
    if (j >= n) badFile();
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === "/") {
      const closing = body.slice(1).trim();
      if (!NAME.test(closing)) badFile();
      yield { t: "close", name: closing };
      continue;
    }
    const self = body.endsWith("/");
    const inner = self ? body.slice(0, -1) : body;
    const sp = inner.search(/\s/);
    const name = sp < 0 ? inner : inner.slice(0, sp);
    if (!NAME.test(name)) badFile(); // «<row</worksheet>»: a tag cut short
    const attrs: Record<string, string> = {};
    if (sp >= 0) for (const m of inner.slice(sp).matchAll(ATTR)) attrs[m[1]] = unescapeXml(m[3] ?? m[4] ?? "");
    yield { t: "open", name, attrs, self };
    if (self) yield { t: "close", name };
  }
}

/** An attribute by its local name («r:id» answers «id»), the first one that has it. */
export function attr(attrs: Record<string, string>, localName: string): string | undefined {
  if (localName in attrs) return attrs[localName];
  for (const [k, v] of Object.entries(attrs)) if (local(k) === localName) return v;
  return undefined;
}
