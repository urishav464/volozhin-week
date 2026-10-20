// The reader's Word skeleton (DESIGN «תוצרים» 5: שלד Word לעריכה אחידה): a
// .docx to paste the sources into, all of one shape — a table of contents
// field (Word fills it on open, right to left; the headings carry outline
// levels, so LibreOffice finds them too), then each day: a heading on a new
// page with its first lesson under it, every lesson marked «במקראה» as «מרצה –
// כותרת» on a page of its own (also those whose files have not come yet, or
// are Word: this is where they are pasted), every memorial slot, and a «סיכום
// יום» page of ruled lines. Right to left throughout (w:bidi by default, w:rtl),
// A4, the same alternating running headers as the PDF and a page number. Made in the browser with docx 9.8.1, downloaded —
// nothing is uploaded. No text of ours beyond the structure's own words.
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, TableOfContents, TextRun,
} from "docx";
import type { Day } from "../domain/time";
import { byDay, type Manifest, type ManifestRow } from "./model";
import { dayTitle } from "./layout";

/** In the skeleton: the lessons marked «במקראה» (whatever their files are) and the memorial slots. */
export function skeletonRows(m: Manifest): ManifestRow[] {
  return m.rows.filter((r) => r.kind === "memorial" || (r.lesson.in_reader && r.status !== "presentation_only" && r.status !== "no_sources"));
}

export interface SkeletonInput {
  manifest: Manifest;
  editionLabel: string;
  /** settings.reader_headers — [left, right]; absent: no running headers. */
  headers?: readonly [string, string];
}

const RULED_LINES = 22;
const FONT = "Arial";

const run = (text: string, opts: { bold?: boolean; size?: number } = {}) =>
  new TextRun({ text, rightToLeft: true, bold: opts.bold, size: opts.size, font: { ascii: FONT, hAnsi: FONT, cs: FONT }, sizeComplexScript: opts.size });

const para = (text: string, opts: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; pageBreakBefore?: boolean; bold?: boolean; size?: number; center?: boolean } = {}) =>
  new Paragraph({
    bidirectional: true,
    heading: opts.heading,
    pageBreakBefore: opts.pageBreakBefore,
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.START,
    children: text ? [run(text, { bold: opts.bold, size: opts.size })] : [],
  });

const headerOf = (text: string) => new Header({ children: [para(text, { center: true, size: 18 })] });

/** The skeleton's paragraphs, in order — exported for the tests (document.xml is checked too). */
export function skeletonParagraphs(input: SkeletonInput): { text: string; style: "title" | "h1" | "h2" | "line" | "blank"; pageBreak: boolean }[] {
  const out: { text: string; style: "title" | "h1" | "h2" | "line" | "blank"; pageBreak: boolean }[] = [];
  for (const { day, rows } of byDay(skeletonRows(input.manifest))) {
    // the day's heading opens a page, and its first entry shares it (never a day's name alone on a page)
    out.push({ text: dayTitle(day as Day), style: "h1", pageBreak: true });
    rows.forEach((r, i) => {
      out.push({ text: r.header, style: "h2", pageBreak: i > 0 });
      out.push({ text: "", style: "blank", pageBreak: false });
    });
    out.push({ text: `סיכום ${dayTitle(day as Day)}`, style: "h2", pageBreak: rows.length > 0 });
    for (let i = 0; i < RULED_LINES; i++) out.push({ text: "", style: "line", pageBreak: false });
  }
  return out;
}

export async function buildSkeleton(input: SkeletonInput): Promise<Uint8Array> {
  const children: (Paragraph | TableOfContents)[] = [
    para(`מקראה · ${input.editionLabel}`, { heading: HeadingLevel.TITLE, center: true }),
    para("תוכן העניינים", { bold: true, size: 28 }),
    new TableOfContents("תוכן העניינים", { hyperlink: true, headingStyleRange: "1-2" }),
  ];
  for (const p of skeletonParagraphs(input)) {
    if (p.style === "line") {
      // a bottom border AND a between one: Word and LibreOffice draw a run of paragraphs with the same borders as one
      // bordered block — a bottom border alone comes out once, under the last line (ECMA-376 §17.3.1.5, §17.3.1.7)
      const rule = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB", space: 1 };
      children.push(new Paragraph({ bidirectional: true, spacing: { after: 160 }, border: { bottom: rule, between: rule }, children: [] }));
    } else if (p.style === "blank") {
      children.push(para(""));
    } else {
      children.push(para(p.text, { heading: p.style === "h1" ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, pageBreakBefore: p.pageBreak }));
    }
  }
  const [left, right] = input.headers ?? ["", ""];
  const doc = new Document({
    creator: "volozhin-week",
    title: `מקראה ${input.editionLabel}`,
    features: { updateFields: true },
    evenAndOddHeaderAndFooters: true,
    styles: {
      default: {
        // every paragraph right to left by default — the TOC's own paragraphs (TOC 1, TOC 2, built on Normal) included;
        // docx 9.8.1 writes <w:bidi/> in pPrDefault but its type for the defaults leaves the option out
        document: { run: { font: FONT, rightToLeft: true }, paragraph: { bidirectional: true } as object },
        heading1: { paragraph: { outlineLevel: 0, keepNext: true } },
        heading2: { paragraph: { outlineLevel: 1 } },
      },
    },
    sections: [
      {
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, header: 567, footer: 567 } },
          titlePage: true,
        },
        headers: {
          first: new Header({ children: [para("")] }),
          // Word's «default» header is the odd pages'; in a book bound on the right the odd pages are the left ones
          default: headerOf(left?.trim() ?? ""),
          even: headerOf(right?.trim() ?? ""),
        },
        footers: {
          first: new Footer({ children: [para("")] }),
          default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }),
          even: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }),
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
