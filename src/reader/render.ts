// The reader's Hebrew text, as pictures: pdf-lib has no bidi and no shaping,
// so every line of Hebrew (the running headers, an entry's header, the table
// of contents, the schedule cover, a «סיכום יום» title) is drawn on a canvas —
// the browser lays out right-to-left text and joins its marks — and embedded
// in the PDF as a PNG. Digits alone (page numbers) are pdf-lib's own font.
// One implementation over any 2D canvas: an OffscreenCanvas in the reader's
// worker, a page canvas for the demo's sample files.
import { A4, MARGIN, type TocLine } from "./layout";

export interface Png {
  bytes: Uint8Array;
  /** Its size on the page, in points. */
  widthPt: number;
  heightPt: number;
}

export interface ScheduleLine {
  kind: "day" | "row";
  /** day: «יום ראשון · 15.2.2027»; row: the time. */
  text: string;
  speaker?: string;
  title?: string;
  memorial?: boolean;
}

/** What the PDF assembly asks of the text drawer (src/reader/assemble.ts). A test gives it a stub. */
export interface TextRenderer {
  runningHeader(text: string, widthPt: number): Promise<Png>;
  entryStrip(header: string, when: string, widthPt: number, heightPt: number): Promise<Png>;
  /** A whole A4 page of the table of contents. */
  tocPage(lines: TocLine[], title: string | null): Promise<Png>;
  /** A whole A4 page of the schedule made from the week (the cover when no poster is marked). */
  schedulePage(lines: ScheduleLine[], title: string | null): Promise<Png>;
  /** A «סיכום יום» page's title strip. */
  summaryTitle(text: string, widthPt: number): Promise<Png>;
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
export interface Surface {
  ctx: Ctx;
  toPng(): Promise<Uint8Array>;
}
/** A canvas of w×h pixels, white. */
export type MakeSurface = (w: number, h: number) => Surface;

/** The app's font first (src/index.css), then whatever Hebrew face the system has. */
export const FONT_STACK = '"Assistant", "Noto Sans Hebrew", "Arial Hebrew", Arial, "DejaVu Sans", sans-serif';
const INK = "#1d2a44";
const SOFT = "#4a5672";
const LINE = "#c9c2b4";

export const offscreenSurface: MakeSurface = (w, h) => {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  return { ctx, toPng: async () => new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer()) };
};

export const documentSurface: MakeSurface = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  return {
    ctx,
    toPng: () =>
      new Promise((resolve, reject) =>
        c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error("canvas"))), "image/png"),
      ),
  };
};

const font = (sizePx: number, bold = false) => `${bold ? "700" : "400"} ${sizePx}px ${FONT_STACK}`;

/** Greedy word wrap to `max` pixels; at most `lines` lines, the last one cut with «…». */
export function wrap(measure: (s: string) => number, text: string, max: number, lines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= max || !cur) cur = next;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  if (out.length <= lines) return out.map((l) => fit(measure, l, max));
  const kept = out.slice(0, lines);
  kept[lines - 1] = fit(measure, `${kept[lines - 1]} ${out.slice(lines).join(" ")}`, max);
  return kept;
}

/** The line itself, or as much of it as fits with «…». */
export function fit(measure: (s: string) => number, text: string, max: number): string {
  if (measure(text) <= max) return text;
  let s = text;
  while (s.length > 1 && measure(`${s}…`) > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Right-to-left text at the right edge (x is the start: the right side), or centred. */
function rtl(ctx: Ctx, text: string, x: number, y: number, align: "start" | "center" = "start") {
  ctx.direction = "rtl";
  ctx.textAlign = align === "center" ? "center" : "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

function ltr(ctx: Ctx, text: string, x: number, y: number) {
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

/** The canvas implementation; `scale` pixels per point (3 for strips, 2 for whole pages keeps a page's PNG small). */
export function canvasRenderer(make: MakeSurface, scale = 3, pageScale = 2): TextRenderer {
  const strip = async (draw: (ctx: Ctx, w: number, h: number) => void, widthPt: number, heightPt: number, s = scale): Promise<Png> => {
    const w = Math.ceil(widthPt * s);
    const h = Math.ceil(heightPt * s);
    const { ctx, toPng } = make(w, h);
    draw(ctx, w, h);
    return { bytes: await toPng(), widthPt, heightPt };
  };
  return {
    runningHeader: (text, widthPt) =>
      strip((ctx, w, h) => {
        ctx.fillStyle = SOFT;
        ctx.font = font(8.5 * scale);
        rtl(ctx, fit((s) => ctx.measureText(s).width, text, w), w / 2, h * 0.72, "center");
      }, widthPt, 14),

    entryStrip: (header, when, widthPt, heightPt) =>
      strip((ctx, w, h) => {
        ctx.fillStyle = INK;
        ctx.font = font(14 * scale, true);
        const lines = wrap((s) => ctx.measureText(s).width, header, w, 2);
        const size = lines.length > 1 ? 12 : 14;
        ctx.font = font(size * scale, true);
        lines.forEach((l, i) => rtl(ctx, fit((s) => ctx.measureText(s).width, l, w), w, (size + 2 + i * (size + 3)) * scale));
        ctx.fillStyle = SOFT;
        ctx.font = font(8.5 * scale);
        rtl(ctx, when, w, h - 9 * scale);
        ctx.fillStyle = LINE;
        ctx.fillRect(0, h - 3 * scale, w, Math.max(1, scale * 0.8));
      }, widthPt, heightPt),

    tocPage: (lines, title) =>
      strip((ctx, w) => {
        const s = pageScale;
        const left = MARGIN * 2 * s;
        const right = w - MARGIN * 2 * s;
        let y = (MARGIN + 40) * s;
        if (title) {
          ctx.fillStyle = INK;
          ctx.font = font(20 * s, true);
          rtl(ctx, title, right, y);
          y += 34 * s;
        }
        const lineH = 20.5 * s;
        for (const l of lines) {
          if (l.kind === "day") {
            ctx.fillStyle = INK;
            ctx.font = font(12.5 * s, true);
            rtl(ctx, l.label, right, y + 3 * s);
          } else {
            const page = String(l.page);
            ctx.font = font(10.5 * s);
            const nw = ctx.measureText(page).width;
            ctx.fillStyle = l.kind === "summary" ? SOFT : INK;
            const label = fit((t) => ctx.measureText(t).width, l.label, right - left - nw - 28 * s);
            rtl(ctx, label, right - 10 * s, y);
            ltr(ctx, page, left, y);
            // dotted leader between the label and its page
            const lw = ctx.measureText(label).width;
            ctx.fillStyle = LINE;
            for (let x = left + nw + 6 * s; x < right - 10 * s - lw - 6 * s; x += 5 * s) ctx.fillRect(x, y - 1 * s, 1.2 * s, 1.2 * s);
          }
          y += lineH;
        }
      }, A4.width, A4.height, pageScale),

    schedulePage: (lines, title) =>
      strip((ctx, w) => {
        const s = pageScale;
        const left = MARGIN * 1.5 * s;
        const right = w - MARGIN * 1.5 * s;
        let y = (MARGIN + 30) * s;
        if (title) {
          ctx.fillStyle = INK;
          ctx.font = font(22 * s, true);
          rtl(ctx, title, w / 2, y, "center");
          y += 32 * s;
        }
        const lineH = 16.5 * s;
        const timeW = 78 * s;
        for (const l of lines) {
          if (l.kind === "day") {
            ctx.fillStyle = INK;
            ctx.font = font(12 * s, true);
            rtl(ctx, l.text, right, y + 4 * s);
          } else {
            if (l.memorial) {
              ctx.fillStyle = "#fef3c7";
              ctx.fillRect(left, y - 12 * s, right - left, 15.5 * s);
            }
            ctx.fillStyle = SOFT;
            ctx.font = font(9.5 * s);
            ltr(ctx, l.text, right - timeW + 4 * s, y); // the time, left to right, in its column on the right
            ctx.fillStyle = INK;
            const body = [l.speaker, l.title].filter(Boolean).join(" – ");
            rtl(ctx, fit((t) => ctx.measureText(t).width, body, right - timeW - left - 6 * s), right - timeW - 6 * s, y);
          }
          y += lineH;
        }
      }, A4.width, A4.height, pageScale),

    summaryTitle: (text, widthPt) =>
      strip((ctx, w, h) => {
        ctx.fillStyle = INK;
        ctx.font = font(18 * scale, true);
        rtl(ctx, text, w, h * 0.7);
      }, widthPt, 30),
  };
}
