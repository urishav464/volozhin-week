// The reader's pages, before anything is drawn (pure, unit-tested): the order —
// the cover, the table of contents, then each day's lessons and memorial
// slots in schedule order with a «סיכום יום» page closing the day — the page
// each entry starts on (so the table of contents can say it before the pages
// exist), the schedule cover's pages, and the A4 framing of a source page
// (scaled to fit, aspect kept, rotation honoured). No pdf-lib here: the reader
// screen's estimate counts with the same functions the build does.
import { DAY_NAMES, type Day, DAYS } from "../domain/time";
import type { ScheduleLine } from "./render";

/** A4 in PDF points (1/72 inch). */
export const A4 = { width: 595.28, height: 841.89 };
/** The page's margins and bands, in points: the running header on top, the page number below, the lesson's header strip under the running header. */
export const MARGIN = 28;
export const RUNNING_BAND = 22;
export const NUMBER_BAND = 22;
export const STRIP_HEIGHT = 46;
/** Lines of the table of contents per page; its first page loses two to the title. */
export const TOC_LINES_PER_PAGE = 34;
export const TOC_TITLE_LINES = 2;

export interface PlanEntry {
  /** The entry's index in the caller's list (its row of the manifest). */
  ref: number;
  day: Day;
  header: string;
  /** Each file's pages, in order — a file with 0 pages adds nothing. */
  filePages: number[];
}

export type PlannedPage =
  | { kind: "cover"; index: number }
  | { kind: "toc"; index: number }
  /** A page of an entry's file; `first`: the entry's first page (its header strip goes on it). */
  | { kind: "file"; ref: number; file: number; page: number; first: boolean }
  /** An entry with no pages of its own (a memorial slot before its materials): its header alone. */
  | { kind: "header"; ref: number }
  | { kind: "summary"; day: Day };

export type TocLine =
  | { kind: "day"; label: string; day: Day }
  | { kind: "entry"; label: string; ref: number; page: number }
  | { kind: "summary"; label: string; day: Day; page: number };

export interface ReaderPlan {
  pages: PlannedPage[];
  toc: TocLine[];
  /** TOC lines on each table-of-contents page. */
  tocPages: TocLine[][];
  coverPages: number;
}

/** «יום ראשון» — the table of contents' day line and the summary page's day. */
export const dayTitle = (day: Day) => `יום ${DAY_NAMES[day]}`;

/** How the table of contents' lines fall on pages: TOC_LINES_PER_PAGE each, the first page TOC_TITLE_LINES fewer (its title). */
export function paginateToc<T>(lines: T[]): T[][] {
  const out: T[][] = [];
  let i = 0;
  let room = TOC_LINES_PER_PAGE - TOC_TITLE_LINES;
  do {
    out.push(lines.slice(i, i + room));
    i += room;
    room = TOC_LINES_PER_PAGE;
  } while (i < lines.length);
  return out;
}

/**
 * The whole book: `coverPages` cover pages (the poster's, or the schedule made from the week), the table of
 * contents, then for each day of the week its entries in the order given (schedule order) and a «סיכום יום»
 * page. Page numbers count from the cover's first page as 1 — the number printed at the foot of each page.
 */
export function planReader(entries: PlanEntry[], coverPages: number): ReaderPlan {
  // the lines first (their count fixes how many pages the table of contents takes), page numbers after
  const skeleton: TocLine[] = [];
  for (const day of DAYS) {
    skeleton.push({ kind: "day", label: dayTitle(day), day });
    for (const e of entries.filter((x) => x.day === day)) skeleton.push({ kind: "entry", label: e.header, ref: e.ref, page: 0 });
    skeleton.push({ kind: "summary", label: `סיכום ${dayTitle(day)}`, day, page: 0 });
  }
  const tocCount = paginateToc(skeleton).length;
  const pages: PlannedPage[] = [];
  for (let i = 0; i < coverPages; i++) pages.push({ kind: "cover", index: i });
  for (let i = 0; i < tocCount; i++) pages.push({ kind: "toc", index: i });
  const startOf = new Map<number, number>();
  const summaryAt = new Map<Day, number>();
  for (const day of DAYS) {
    for (const e of entries.filter((x) => x.day === day)) {
      startOf.set(e.ref, pages.length + 1);
      let first = true;
      e.filePages.forEach((n, file) => {
        for (let page = 0; page < n; page++) {
          pages.push({ kind: "file", ref: e.ref, file, page, first });
          first = false;
        }
      });
      if (first) pages.push({ kind: "header", ref: e.ref });
    }
    summaryAt.set(day, pages.length + 1);
    pages.push({ kind: "summary", day });
  }
  const toc = skeleton.map((l): TocLine => (l.kind === "entry" ? { ...l, page: startOf.get(l.ref)! } : l.kind === "summary" ? { ...l, page: summaryAt.get(l.day)! } : l));
  return { pages, toc, tocPages: paginateToc(toc), coverPages };
}

/** The running header of a physical page (1-based): none on the cover; odd pages the left one, even pages the right one. */
export function runningHeader(page: number, coverPages: number, headers: readonly [string, string] | undefined): string | null {
  if (page <= coverPages || !headers) return null;
  const h = page % 2 === 1 ? headers[0] : headers[1];
  return h && h.trim() ? h.trim() : null;
}

/** Is a page number printed on this page? Every page but the cover's. */
export function numbered(page: number, coverPages: number): boolean {
  return page > coverPages;
}

/** The box a source page is drawn in: inside the margins and bands — less the header strip on an entry's first page. */
export function contentBox(first: boolean): { x: number; y: number; width: number; height: number } {
  const top = MARGIN + RUNNING_BAND + (first ? STRIP_HEIGHT : 0);
  const bottom = MARGIN + NUMBER_BAND;
  return { x: MARGIN, y: bottom, width: A4.width - 2 * MARGIN, height: A4.height - top - bottom };
}

export interface Framing {
  /** Where pdf-lib's drawPage / drawImage puts the source's own origin, and its scale. */
  x: number;
  y: number;
  scale: number;
  /** pdf-lib's rotate (counter-clockwise degrees): a page's /Rotate is clockwise, so it is drawn at minus that. */
  rotate: number;
  /** The drawn rectangle, for tests and for a frame line. */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Re-frame a source page of `width`×`height` (its own units, before its /Rotate of 0/90/180/270 clockwise) into
 * `box`: scaled to fit — up or down — keeping its aspect, centred, turned the way it is displayed.
 */
export function frame(width: number, height: number, rotation: number, box: { x: number; y: number; width: number; height: number }): Framing {
  const r = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  const turned = r === 90 || r === 270;
  const shownW = turned ? height : width;
  const shownH = turned ? width : height;
  const scale = Math.min(box.width / shownW, box.height / shownH);
  const w = shownW * scale;
  const h = shownH * scale;
  const bx = box.x + (box.width - w) / 2;
  const by = box.y + (box.height - h) / 2;
  // where the source's origin lands once it is rotated by -r (clockwise r) about it
  const origin =
    r === 0 ? { x: bx, y: by } : r === 90 ? { x: bx, y: by + h } : r === 180 ? { x: bx + w, y: by + h } : { x: bx + w, y: by };
  return { x: origin.x, y: origin.y, scale, rotate: -r === 0 ? 0 : -r, box: { x: bx, y: by, width: w, height: h } };
}

/** How many schedule lines fit one cover page made from the week (the rest go on the next). */
export const SCHEDULE_LINES_PER_PAGE = 44;
/** …fewer on its first page: the title. */
export const SCHEDULE_TITLE_LINES = 3;

/** The schedule cover's lines, page by page (a day's heading never alone at a page's foot). */
export function chunkSchedule(lines: ScheduleLine[], perPage = SCHEDULE_LINES_PER_PAGE): ScheduleLine[][] {
  const out: ScheduleLine[][] = [[]];
  for (let i = 0; i < lines.length; i++) {
    let cur = out[out.length - 1];
    const room = perPage - (out.length === 1 ? SCHEDULE_TITLE_LINES : 0) - cur.length; // the first page has the title
    if (room <= 0 || (lines[i].kind === "day" && room <= 1)) {
      cur = [];
      out.push(cur);
    }
    cur.push(lines[i]);
  }
  return out;
}

/** How many pages the schedule cover takes when no poster is marked — what the build draws (one, even for none). */
export const scheduleCoverPages = (lines: ScheduleLine[]) => chunkSchedule(lines).length;
