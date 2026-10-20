// The demo's sample files, made in the browser when first opened — never a real
// source: a PDF of a few pages and a picture that say «מקור לדוגמה», and a Word
// file that says the same. The Hebrew is drawn on a canvas (pdf-lib cannot set
// Hebrew), as the reader does it.
import { documentSurface, FONT_STACK } from "../reader/render";

export type SampleKind = "pdf" | "png" | "docx";

export interface Sample {
  kind: SampleKind;
  title: string;
  pages: number;
  /** The sample PDF's page size in points — not A4, so the reader's re-framing shows. */
  size?: [number, number];
}

async function samplePicture(title: string, line: string, w: number, h: number): Promise<Uint8Array> {
  const s = documentSurface(w, h);
  const ctx = s.ctx;
  ctx.strokeStyle = "#8a93a8";
  ctx.lineWidth = Math.max(2, w / 300);
  ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
  ctx.fillStyle = "#1d2a44";
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.font = `700 ${Math.round(w / 14)}px ${FONT_STACK}`;
  ctx.fillText("מקור לדוגמה", w / 2, h * 0.3);
  ctx.font = `400 ${Math.round(w / 26)}px ${FONT_STACK}`;
  ctx.fillText(title, w / 2, h * 0.42);
  ctx.fillText(line, w / 2, h * 0.52);
  ctx.fillStyle = "#c9c2b4";
  for (let y = h * 0.62; y < h * 0.9; y += h / 22) ctx.fillRect(w * 0.12, y, w * 0.76, Math.max(1, h / 600));
  return s.toPng();
}

export async function makeSample(s: Sample): Promise<Blob> {
  if (s.kind === "png") return new Blob([(await samplePicture(s.title, "תמונה לדוגמה", 900, 1200)) as BlobPart], { type: "image/png" });
  if (s.kind === "docx") {
    const { Document, Packer, Paragraph, TextRun } = await import("docx");
    const doc = new Document({
      sections: [{ children: [new Paragraph({ bidirectional: true, children: [new TextRun({ text: `מקור לדוגמה (קובץ Word) — ${s.title}`, rightToLeft: true })] })] }],
    });
    return Packer.toBlob(doc);
  }
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const [w, h] = s.size ?? [420, 595];
  for (let i = 0; i < s.pages; i++) {
    const png = await doc.embedPng(await samplePicture(s.title, `עמוד ${i + 1} מתוך ${s.pages}`, Math.round(w * 2), Math.round(h * 2)));
    doc.addPage([w, h]).drawImage(png, { x: 0, y: 0, width: w, height: h });
  }
  return new Blob([(await doc.save()) as BlobPart], { type: "application/pdf" });
}
