// A small xlsx writer: SpreadsheetML (ECMA-376) zipped with fflate — enough for
// the site's exports and nothing more (docs/DECISIONS.md, אבן דרך 4: no SheetJS
// from npm). Every sheet is right-to-left, its header row bold and frozen (and
// repeated on every printed page), its columns sized; a row may carry a fill
// (last year's stage colours). Cells are inline text — never a formula — and
// still pass the formula guard, so a copy pasted elsewhere stays text.
import { strToU8, zipSync } from "fflate";
import { guardCell, type Table } from "./table";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** What XML 1.0 forbids in text: C0 controls but tab and line breaks, U+FFFE/U+FFFF, lone surrogates — removed. */
export function stripXmlForbidden(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** XML 1.0 text: no character XML forbids, and the five escapes. */
export function xmlText(s: string): string {
  return escapeXml(stripXmlForbidden(s));
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * A sheet name Excel accepts: no []:*?/\, not beginning or ending with an apostrophe (an edition labelled
 * «מחזור ב'» — Excel would offer to repair the file), not empty, 31 characters at most, unique in the workbook.
 */
export function sheetName(name: string, taken: Set<string>): string {
  const edges = (s: string) => s.replace(/^[\s']+|[\s']+$/g, "");
  const base = edges([...edges(name.replace(/[[\]:*?/\\]/g, " "))].slice(0, 31).join("")) || "גיליון";
  let out = base;
  for (let i = 2; taken.has(out); i++) out = `${[...base].slice(0, 28).join("")} ${i}`;
  taken.add(out);
  return out;
}

function cell(ref: string, value: string, style: number): string {
  // what XML forbids goes first, then the guard: «\u0001=…» must not reach the sheet as «=…»
  const v = escapeXml(guardCell(stripXmlForbidden(value)));
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${v}</t></is></c>`;
}

const ALIGN = '<alignment wrapText="1" vertical="top" readingOrder="2"/>';

/** The styles: 0 default, 1 the bold header, 2 a plain body cell, 3… a body cell on each fill colour. */
function stylesXml(fills: string[]): string {
  const fillXml = fills.map((f) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${f}"/><bgColor indexed="64"/></patternFill></fill>`).join("");
  const fillXfs = fills.map((_, i) => `<xf numFmtId="0" fontId="0" fillId="${i + 2}" borderId="0" xfId="0" applyFill="1" applyAlignment="1">${ALIGN}</xf>`).join("");
  return (
    XML +
    `<styleSheet xmlns="${NS}">` +
    '<fonts count="2"><font><sz val="11"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="11"/><name val="Arial"/><family val="2"/></font></fonts>' +
    `<fills count="${2 + fills.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fillXml}</fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${3 + fills.length}">` +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">${ALIGN}</xf>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">${ALIGN}</xf>` +
    fillXfs +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>"
  );
}

function sheetXml(t: Table, fills: string[]): string {
  const cols = Math.max(1, t.headers.length);
  const last = `${columnName(cols - 1)}${t.rows.length + 1}`;
  const widths = t.headers.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${t.widths?.[i] ?? 16}" customWidth="1"/>`).join("");
  const header = `<row r="1">${t.headers.map((h, i) => cell(`${columnName(i)}1`, h, 1)).join("")}</row>`;
  const body = t.rows
    .map((r, ri) => {
      const fill = t.fills?.[ri];
      const style = fill ? 3 + fills.indexOf(fill) : 2;
      const n = ri + 2;
      return `<row r="${n}">${t.headers.map((_, ci) => cell(`${columnName(ci)}${n}`, r[ci] ?? "", style)).join("")}</row>`;
    })
    .join("");
  return (
    XML +
    `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
    // printed: every column on one page's width (as many pages down as it takes)
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    `<dimension ref="A1:${last}"/>` +
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${widths}</cols>` +
    `<sheetData>${header}${body}</sheetData>` +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    `<pageSetup paperSize="9" orientation="${t.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>` +
    "</worksheet>"
  );
}

/** The workbook's files, by path — what toXlsx zips (a test reads them unzipped). */
export function xlsxParts(sheets: Table[]): Record<string, string> {
  const fills = [...new Set(sheets.flatMap((t) => (t.fills ?? []).filter((f): f is string => !!f).map((f) => f.toUpperCase())))];
  const norm = sheets.map((t) => ({ ...t, fills: t.fills?.map((f) => (f ? f.toUpperCase() : null)) }));
  const taken = new Set<string>();
  const names = norm.map((t) => sheetName(t.name, taken));
  const parts: Record<string, string> = {
    "[Content_Types].xml":
      XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      "</Types>",
    "_rels/.rels":
      XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>",
    "xl/workbook.xml":
      XML +
      `<workbook xmlns="${NS}" xmlns:r="${NS_R}">` +
      `<sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      // the header row on every printed page
      `<definedNames>${names.map((n, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xmlText(`'${n.replace(/'/g, "''")}'!$1:$1`)}</definedName>`).join("")}</definedNames>` +
      "</workbook>",
    "xl/_rels/workbook.xml.rels":
      XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      "</Relationships>",
    "xl/styles.xml": stylesXml(fills),
  };
  norm.forEach((t, i) => (parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(t, fills)));
  return parts;
}

/** The .xlsx file's bytes. */
export function toXlsx(sheets: Table[], mtime: Date = new Date()): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [path, xml] of Object.entries(xlsxParts(sheets))) files[path] = strToU8(xml);
  return zipSync(files, { level: 6, mtime });
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
