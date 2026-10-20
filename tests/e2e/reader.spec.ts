// The sources' files and the reader (milestone 5ב-1) in a real browser. Demo
// build: a synthetic PDF uploaded in the lesson panel, its pages counted and
// the lesson's sources turned on, then removed; the manifest «התקבל / חסר» at
// every width without sideways scroll; «בניית המקראה (PDF)» on a desktop — the PDF the
// worker made, downloaded and read back with pdf-lib (its page count, the
// cover, the contents, each lesson's pages in schedule order, recognised by
// the size of the source page each embeds); a poster marked as the cover; the
// Word skeleton unzipped (the headings in order, right to left). Mock build:
// the upload goes to /storage/v1/object/sources/<edition>/<lesson>/<uuid>-<safe
// name> with the member's bearer, then register_source_file by its parameter
// names; a removal deletes the object first, then the row; the build asks for
// signed URLs (never a public one) and reads the files through them.
// A file the browser cannot read as the reader would (a .pdf that is no PDF, a
// PNG cut short) is kept and said so — «לא נקרא», «צריך קובץ אחר» — on its row,
// the lesson's stage and dot and the manifest alike, and never «התקבל»; a
// lesson with a PDF and a Word file is counted on the manifest as the panel
// counts it; a computer builds the reader at any width, a mouse is enough.
// Synthetic data only: every file is made here.
import { readFileSync } from "node:fs";
import { expect, type Download, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { strFromU8, unzipSync, zlibSync } from "fflate";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { demoWeek, seedDemoSources } from "../../src/data/demoWeek";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { readerManifest, readerRows } from "../../src/reader/model";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

async function pdf(sizes: [number, number][]): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (const s of sizes) d.addPage(s).drawRectangle({ x: 10, y: 10, width: 30, height: 30 });
  return Buffer.from(await d.save());
}
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
const BUILD = "בניית המקראה (PDF)";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Not a PDF at all, though named one (what a renamed file or a broken download leaves). */
const NOT_A_PDF = Buffer.from("%PDF-1.7\n% synthetic: not a real PDF, nothing follows\n", "latin1");

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  let c = 0xffffffff;
  for (const x of body) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}
/** A real 64×64 PNG — a gradient with stripes, so its image data is compressed — cut in the middle of that data. */
function cutPng(): Buffer {
  const w = 64;
  const raw = new Uint8Array((w * 3 + 1) * w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) raw.set([x * 4, y * 4, (x ^ y) & 4 ? 255 : 0], y * (w * 3 + 1) + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const idat = zlibSync(raw);
  const whole = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array())]);
  return whole.subarray(0, 8 + 25 + 8 + Math.floor(idat.length / 2));
}

/** Every part of the manifest's lines and totals: isolated right to left, and so resolved. */
async function partsRightToLeft(page: Page) {
  const parts = page.locator("[data-manifest-row] p bdi, [data-manifest-totals] bdi");
  expect(await parts.count()).toBeGreaterThan(0);
  const dirs = await parts.evaluateAll((els) => els.map((e) => `${e.getAttribute("dir")} ${getComputedStyle(e).direction} | ${e.textContent}`));
  expect(dirs.filter((d) => !d.startsWith("rtl rtl |"))).toEqual([]);
}

/** From the week to «מקראה», within the tab (a reload starts the demo over). */
async function toReader(page: Page) {
  await page.getByRole("navigation", { name: "אזורי המערכת" }).getByRole("link", { name: "תוצרים" }).click();
  await page.getByRole("navigation", { name: "תוצרים" }).getByRole("link", { name: "מקראה" }).click();
  await expect(page.getByRole("heading", { name: "מקראה", exact: true })).toBeVisible();
}

async function downloaded(page: Page, click: () => Promise<void>, timeout = 60_000): Promise<{ d: Download; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout }), click()]);
  return { d, bytes: readFileSync((await d.path())!) };
}

/** Each page's embedded source page by its size («300x400»), an image by its pixels («img:1x1»), or «-». */
function sources(doc: PDFDocument): string[] {
  return doc.getPages().map((p) => {
    const xo = p.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xo) return "-";
    const found: string[] = [];
    for (const [, ref] of xo.entries()) {
      const s = doc.context.lookup(ref);
      if (!(s instanceof PDFRawStream)) continue;
      const kind = s.dict.get(PDFName.of("Subtype"))?.toString();
      if (kind === "/Form") {
        const bb = s.dict.lookup(PDFName.of("BBox"), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
        found.push(`${bb[2] - bb[0]}x${bb[3] - bb[1]}`);
      }
    }
    return found[0] ?? "-";
  });
}
function images(doc: PDFDocument, index: number): string[] {
  const xo = doc.getPage(index).node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const out: string[] = [];
  for (const [, ref] of xo?.entries() ?? []) {
    const s = doc.context.lookup(ref);
    if (s instanceof PDFRawStream && s.dict.get(PDFName.of("Subtype"))?.toString() === "/Image") {
      out.push(`img:${s.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber()}x${s.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber()}`);
    }
  }
  return out;
}

/** A closed lesson's panel: on a phone or a tablet, its day first. */
async function openLesson(page: Page, info: TestInfo, day: string, speaker: string): Promise<Locator> {
  if (info.project.name !== "desktop") await page.getByRole("tab", { name: day }).click();
  await page.locator("[data-lesson-id]").filter({ hasText: speaker }).first().click();
  const panel = page.getByRole("dialog", { name: "שיעור סגור" });
  await expect(panel).toBeVisible();
  return panel;
}

const stage = (panel: Locator, name: string) => panel.locator(`[data-stage-section="${name}"]`);

test.describe("demo build", () => {
  test("a PDF uploaded in the lesson panel: its pages counted, the sources arrived, the lesson in the reader — and removed again", async ({ page }, info) => {
    await page.goto(demoUrl());
    const panel = await openLesson(page, info, "ראשון", "מרצה 05");
    await stage(panel, "sources").getByRole("button", { name: /^מקורות/ }).click();
    await expect(stage(panel, "sources")).toHaveAttribute("data-state", "open"); // «טרם התקבלו»
    await expect(panel.getByText("עוד לא הועלו קבצים לשיעור הזה.")).toBeVisible();
    await panel.locator("input[type=file]").setInputFiles({ name: "מקורות לשיעור.pdf", mimeType: "application/pdf", buffer: await pdf([[300, 400], [300, 400], [300, 400], [300, 400]]) });
    await expect(toast(page, "הקובץ הועלה")).toBeVisible();
    const list = panel.getByRole("list", { name: "קבצים שהועלו" });
    await expect(list.getByText("מקורות לשיעור.pdf")).toBeVisible();
    await expect(list.getByText("4 עמודים")).toBeVisible();
    await expect(stage(panel, "sources")).toHaveAttribute("data-state", "done"); // «דף מקורות»
    await expect(stage(panel, "reader")).toHaveAttribute("data-state", "done"); // «במקראה»
    await expect(stage(panel, "reader")).toContainText("במקראה");
    await noSidewaysScroll(page);
    // the keyboard's focus on the upload shows — on the label that looks like the button (the input is 1px, clipped)
    const pick = panel.locator("input[type=file]");
    await pick.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(pick).toBeFocused();
    const label = panel.locator(`label[for="${await pick.getAttribute("id")}"]`);
    expect(await label.evaluate((el) => `${getComputedStyle(el).outlineStyle} ${getComputedStyle(el).outlineWidth}`)).toBe("solid 2px");
    // dropping files is for a mouse: no hint where there is none
    if (info.project.name === "desktop") await expect(panel.getByText("או לגרור לכאן")).toBeVisible();
    else await expect(panel.getByText("או לגרור לכאן")).toBeHidden();
    // not a type the bucket takes: refused before anything is sent — the lesson's rule, never the poster's
    await panel.locator("input[type=file]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(panel.getByRole("list", { name: "העלאות" }).getByRole("alert")).toHaveText("אפשר להעלות רק PDF, ‏Word ‏(docx) או תמונה (PNG/JPG).");
    // removal asks first
    await list.getByRole("button", { name: "הסרה" }).click();
    await panel.getByRole("button", { name: "כן, להסיר" }).click();
    await expect(toast(page, "הקובץ הוסר")).toBeVisible();
    await expect(panel.getByText("עוד לא הועלו קבצים לשיעור הזה.")).toBeVisible();
  });

  // the second review's proof: «2 קבצים · 2 עמודים · ועוד קובץ Word אחד» for a PDF and a Word file — read as three,
  // while the lesson panel said one file in the reader
  test("a PDF and a Word file: the manifest counts what is in the reader, as the lesson panel does — then names the Word file", async ({ page }, info) => {
    await page.goto(demoUrl());
    const panel = await openLesson(page, info, "ראשון", "מרצה 05");
    await stage(panel, "sources").getByRole("button", { name: /^מקורות/ }).click();
    await panel.locator("input[type=file]").setInputFiles([
      { name: "מקורות.pdf", mimeType: "application/pdf", buffer: await pdf([[300, 400], [300, 400]]) },
      { name: "מקורות.docx", mimeType: DOCX_MIME, buffer: Buffer.from("PK synthetic, never opened") },
    ]);
    await expect(toast(page, "2 קבצים הועלו")).toBeVisible();
    await stage(panel, "reader").getByRole("button", { name: /^מקראה/ }).click();
    await expect(stage(panel, "reader")).toContainText("בתוך המקראה: קובץ אחד, 2 עמודים");
    await expect(stage(panel, "reader")).toContainText("ועוד קובץ Word אחד שלא נכנס — צריך PDF.");
    await page.getByRole("button", { name: "סגירה", exact: true }).first().click();
    await toReader(page);
    const row = page.locator("[data-manifest-row]").filter({ hasText: "מרצה 05" });
    await expect(row).toHaveAttribute("data-status", "included");
    await expect(row.locator("p")).toHaveText("דף מקורות · קובץ אחד · 2 עמודים · ועוד קובץ Word אחד שלא נכנס — צריך PDF");
    await partsRightToLeft(page);
    await noSidewaysScroll(page);
  });

  // the second review's proof: a .pdf that is no PDF was «PDF · לא נקרא» on its row, «התקבל» on the manifest and
  // counted in the panel's «בתוך המקראה»; a cut picture was «תמונה · עמוד אחד» and «התקבל» until the build
  test("a file the browser cannot read is kept, «לא נקרא — צריך קובץ אחר» — its row, the lesson's stage and dot and the manifest agree, never «התקבל»", async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.goto(demoUrl());
    const panel = await openLesson(page, info, "ראשון", "מרצה 05");
    await stage(panel, "sources").getByRole("button", { name: /^מקורות/ }).click();
    await panel.locator("input[type=file]").setInputFiles([
      { name: "קובץ פגום.pdf", mimeType: "application/pdf", buffer: NOT_A_PDF },
      { name: "צילום חתוך.png", mimeType: "image/png", buffer: cutPng() },
    ]);
    await expect(toast(page, "2 קבצים הועלו")).toBeVisible(); // kept: the team sees them, and removes or replaces them
    const list = panel.getByRole("list", { name: "קבצים שהועלו" });
    await expect(list.locator("[data-source-file]").filter({ hasText: "קובץ פגום.pdf" })).toContainText("PDF · לא נקרא — מוגן או פגום; צריך קובץ אחר");
    await expect(list.locator("[data-source-file]").filter({ hasText: "צילום חתוך.png" })).toContainText("תמונה · לא נקרא — פגום או בפורמט אחר; צריך קובץ אחר");
    await expect(stage(panel, "sources")).toHaveAttribute("data-state", "done"); // they arrived: «דף מקורות»
    await expect(stage(panel, "reader")).toHaveAttribute("data-state", "open");
    await expect(stage(panel, "reader")).toContainText("צריך קובץ אחר");
    await stage(panel, "reader").getByRole("button", { name: /^מקראה/ }).click();
    await expect(stage(panel, "reader")).toContainText("צריך קובץ אחר. מסומן למקראה, אבל הקבצים שהועלו לא נקראו");
    await expect(stage(panel, "reader")).not.toContainText("התקבל");
    // the card's dot says the same
    const dot = page.locator("[data-lesson-id]").filter({ hasText: "מרצה 05" }).first().locator('[data-stage="reader"]');
    await expect(dot).toHaveAttribute("title", "מקראה: צריך קובץ אחר");
    // a lesson already in the reader keeps its files in, and names the one it cannot read beside them
    await page.getByRole("button", { name: "סגירה", exact: true }).first().click();
    const opening = await openLesson(page, info, "ראשון", "מרצה 01");
    await stage(opening, "sources").getByRole("button", { name: /^מקורות/ }).click();
    await opening.locator("input[type=file]").setInputFiles({ name: "צילום חתוך.png", mimeType: "image/png", buffer: cutPng() });
    await expect(toast(page, "הקובץ הועלה")).toBeVisible();
    await expect(stage(opening, "reader")).toHaveAttribute("data-state", "done");
    await stage(opening, "reader").getByRole("button", { name: /^מקראה/ }).click();
    await expect(stage(opening, "reader")).toContainText("בתוך המקראה: 2 קבצים, 3 עמודים");
    await expect(stage(opening, "reader")).toContainText("ועוד קובץ אחד שלא נקרא — צריך קובץ אחר.");
    await page.getByRole("button", { name: "סגירה", exact: true }).first().click();

    await toReader(page);
    const unread = page.locator("[data-manifest-row]").filter({ hasText: "מרצה 05" });
    await expect(unread).toHaveAttribute("data-status", "unreadable");
    await expect(unread.locator("p")).toHaveText("דף מקורות · 2 קבצים לא נקראו — צריך קובץ אחר");
    await expect(unread).toContainText("צריך קובץ אחר");
    await expect(unread).not.toContainText("התקבל");
    const included = page.locator("[data-manifest-row]").filter({ hasText: "מרצה 01" });
    await expect(included).toHaveAttribute("data-status", "included");
    await expect(included.locator("p")).toContainText("2 קבצים · 3 עמודים · ועוד קובץ אחד שלא נקרא — צריך קובץ אחר");
    await expect(page.locator("[data-manifest-totals] bdi").filter({ hasText: "צריך קובץ אחר" })).toHaveText("1 צריך קובץ אחר");
    await partsRightToLeft(page);
    await noSidewaysScroll(page);
    if (info.project.name !== "desktop") return;
    // the build leaves it out and names it, under a heading that fits a picture as well as a PDF
    const out = await downloaded(page, () => page.getByRole("button", { name: BUILD }).click());
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(16); // the demo's 16: nothing of ours went in
    const left = page.locator("[data-reader-result]").getByRole("alert");
    await expect(left).toContainText("לא נכנסו (צריך להעלות קובץ אחר):");
    await expect(left.getByRole("listitem")).toHaveText(["צילום חתוך.png — הקובץ לא נקרא"]);
  });

  test("reopening a lesson keeps its files, «מהמרצה הקודם», out of the reader and for removal", async ({ page }, info) => {
    await page.goto(demoUrl());
    const panel = await openLesson(page, info, "שלישי", "מרצה 16");
    await panel.getByRole("button", { name: "פתיחה מחדש (חזרה לטיוטה)" }).click();
    await expect(panel.getByRole("group", { name: "אישור" })).toContainText("הקובץ שהועלה נשאר בלוח השיעור");
    await panel.getByRole("button", { name: "פתיחה מחדש ומחיקה" }).click();
    const draft = page.getByRole("dialog", { name: "משבצת בתהליך" });
    await expect(draft).toBeVisible();
    const previous = draft.getByRole("list", { name: "קבצים מהמרצה הקודם" });
    await expect(previous.getByText("צילום מקור לדוגמה.png")).toBeVisible();
    await noSidewaysScroll(page);
    // within the tab (a reload starts the demo over)
    await draft.getByRole("button", { name: "סגירה", exact: true }).click();
    await page.getByRole("navigation", { name: "אזורי המערכת" }).getByRole("link", { name: "תוצרים" }).click();
    await page.getByRole("navigation", { name: "תוצרים" }).getByRole("link", { name: "מקראה" }).click();
    await expect(page.getByRole("heading", { name: "קבצים בלי שיעור" })).toBeVisible();
    await expect(page.locator("[data-manifest-totals]")).toContainText("1 בתוך המקראה");
  });

  test("the manifest «התקבל / חסר», lesson by lesson in schedule order, at every width", async ({ page }, info) => {
    const week = demoWeek();
    seedDemoSources(week);
    const m = readerManifest(week);
    await page.goto(`${demoUrl()}/reader`);
    await expect(page.getByRole("heading", { name: "מקראה", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "תוצרים" }).getByRole("link", { name: "מקראה" })).toHaveAttribute("aria-current", "page");
    const rows = page.locator("[data-manifest-row]");
    await expect(rows).toHaveCount(m.rows.length);
    expect(await rows.evaluateAll((els) => els.map((e) => [Number(e.getAttribute("data-manifest-row")), e.getAttribute("data-status")]))).toEqual(m.rows.map((r) => [r.lesson.id, r.status]));
    await expect(page.locator('[data-status="needs_pdf"]')).toContainText("צריך PDF");
    await expect(page.locator('[data-status="presentation_only"]')).toContainText("מצגת בלבד — לא במקראה");
    await expect(page.locator('[data-status="no_sources"]')).toContainText("בלי מקורות");
    await expect(page.locator('[data-status="missing"]').first()).toContainText("חסר");
    await expect(page.locator("[data-manifest-totals]")).toContainText("2 בתוך המקראה");
    // each part of the totals isolated, so «PDF · 1» never reads as one left-to-right run
    await expect(page.locator("[data-manifest-totals] bdi").first()).toHaveText("2 בתוך המקראה");
    await expect(page.locator("[data-manifest-totals] bdi").filter({ hasText: "צריך PDF" })).toHaveText("1 צריך PDF");
    // the kind of sources, beside the files and the pages
    const included = m.rows.find((r) => r.status === "included")!;
    const kind = included.lesson.sources_note ? `דף מקורות: ${included.lesson.sources_note}` : "דף מקורות"; // and its note, when there is one
    await expect(page.locator(`[data-manifest-row="${included.lesson.id}"]`)).toContainText(`${kind} · 2 קבצים · ${included.pages} עמודים`);
    // the running headers laid out as the spread: the right (even) page's field first, on the right
    expect(await page.getByRole("form", { name: "כותרות רצות" }).locator("label").allTextContents()).toEqual(["עמוד ימני (זוגי)", "עמוד שמאלי (אי-זוגי)"]);
    // the headers are empty until typed — last year's are an example only
    await expect(page.getByLabel("עמוד שמאלי (אי-זוגי)")).toHaveValue("");
    await expect(page.getByText("«שבוע וולוז׳ין תשפ״ו 2026»")).toBeVisible();
    if (info.project.name === "desktop") await expect(page.getByRole("button", { name: BUILD })).toBeVisible();
    else {
      await expect(page.getByRole("button", { name: BUILD })).toHaveCount(0);
      await expect(page.getByText("את המקראה בונים במחשב: הקבצים גדולים, והבנייה כבדה לטלפון ולטאבלט.")).toBeVisible();
    }
    await noSidewaysScroll(page);
    // a row opens its lesson in the week, at «מקורות»
    await page.locator('[data-status="needs_pdf"]').getByRole("button").click();
    await expect(page.getByRole("dialog", { name: "שיעור סגור" })).toBeVisible();
    await expect(page.getByRole("group", { name: "קבצי המקורות" })).toContainText("מקורות לדוגמה.docx");
  });

  test("«בניית המקראה (PDF)»: the downloaded PDF — cover, contents, each lesson's pages in schedule order, a «סיכום יום» per day", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the reader is built on a computer");
    test.setTimeout(120_000);
    // a file of our own for Sunday 11:30 first: two 300×400 pages
    await page.goto(demoUrl());
    const panel = await openLesson(page, info, "ראשון", "מרצה 05");
    await stage(panel, "sources").getByRole("button", { name: /^מקורות/ }).click();
    await panel.locator("input[type=file]").setInputFiles({ name: "uploaded.pdf", mimeType: "application/pdf", buffer: await pdf([[300, 400], [300, 400]]) });
    await expect(toast(page, "הקובץ הועלה")).toBeVisible();
    await page.getByRole("button", { name: "סגירה", exact: true }).first().click();
    await page.getByRole("navigation", { name: "אזורי המערכת" }).getByRole("link", { name: "תוצרים" }).click();
    await page.getByRole("navigation", { name: "תוצרים" }).getByRole("link", { name: "מקראה" }).click();
    await page.getByLabel("עמוד שמאלי (אי-זוגי)").fill("כותרת שמאל לבדיקה");
    await page.getByLabel("עמוד ימני (זוגי)").fill("כותרת ימין לבדיקה");
    await page.getByRole("button", { name: "שמירת הכותרות" }).click();
    await expect(toast(page, "הכותרות נשמרו")).toBeVisible();

    const out = await downloaded(page, () => page.getByRole("button", { name: BUILD }).click());
    expect(out.d.suggestedFilename()).toMatch(/^volozhin-reader-edition-1-\d{4}-\d{2}-\d{2}\.pdf$/);
    const doc = await PDFDocument.load(out.bytes);
    // the schedule cover, the contents, Sunday: the opening's 3 pages, ours 2, the memorial slot, «סיכום יום»; …
    expect(sources(doc).slice(0, 9)).toEqual(["-", "-", "420x595", "420x595", "612x792", "300x400", "300x400", "-", "-"]);
    // 1 + 1 + (3 + 2 + 1 + 1) + (1 + 1) + (1 + 1 + 1) + (1 + 1) + (1 + 1) = 18
    expect(doc.getPageCount()).toBe(18);
    expect(doc.getPages().every((p) => Math.round(p.getWidth()) === 595 && Math.round(p.getHeight()) === 842)).toBe(true);
    await expect(page.locator("[data-reader-result]")).toContainText("18 עמודים");
    await expect(page.getByRole("progressbar", { name: "בניית המקראה" })).toHaveCount(0);
  });

  test("a poster marked as the cover opens the reader; the Word skeleton has the headings in order, right to left", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the reader is built on a computer");
    test.setTimeout(120_000);
    await page.goto(`${demoUrl()}/reader`);
    await page.locator('input[type=file][accept*=".png"]').last().setInputFiles({ name: "פוסטר.png", mimeType: "image/png", buffer: PIXEL });
    await expect(toast(page, "הפוסטר הועלה")).toBeVisible();
    await expect(page.getByRole("radio", { name: "השער: פוסטר.png" })).toBeChecked(); // the first poster is the cover
    const out = await downloaded(page, () => page.getByRole("button", { name: BUILD }).click());
    const doc = await PDFDocument.load(out.bytes);
    expect(images(doc, 0)).toEqual(["img:1x1"]); // the poster, not the schedule page
    expect(images(doc, 1)).not.toContain("img:1x1"); // the contents follow
    // back to the schedule page
    await page.getByRole("radio", { name: "בלי פוסטר: עמוד לו״ז מהשבוע" }).check();
    await expect(toast(page, "השער: עמוד לו״ז מהשבוע")).toBeVisible();
    // the poster's name is its radio's label: a tap on it chooses it, and the whole line is a 44px target
    const posters = page.getByRole("list", { name: "פוסטרים" });
    await posters.getByText("פוסטר.png").click();
    await expect(toast(page, "השער נבחר")).toBeVisible();
    await expect(page.getByRole("radio", { name: "השער: פוסטר.png" })).toBeChecked();
    expect((await posters.locator("label").first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // a poster is a PDF or a picture: the poster's own rule, never the lesson's
    await page.locator('input[type=file][accept*=".png"]').last().setInputFiles({ name: "פוסטר.docx", mimeType: DOCX_MIME, buffer: Buffer.from("PK synthetic") });
    await expect(page.getByRole("alert").filter({ hasText: "לשער" })).toHaveText(/^לשער אפשר להעלות רק PDF או תמונה \(PNG\/JPG\)\./);
    // a poster the browser cannot read is kept, and cannot be the cover
    await page.locator('input[type=file][accept*=".png"]').last().setInputFiles({ name: "פוסטר חתוך.png", mimeType: "image/png", buffer: cutPng() });
    await expect(toast(page, "הפוסטר הועלה")).toBeVisible();
    await expect(posters.locator("[data-source-file]").filter({ hasText: "פוסטר חתוך.png" })).toContainText("לא נקרא — פגום או בפורמט אחר; צריך קובץ אחר");
    await expect(page.getByRole("radio", { name: "השער: פוסטר חתוך.png" })).toBeDisabled();

    const word = await downloaded(page, () => page.getByRole("button", { name: "שלד Word" }).click());
    expect(word.d.suggestedFilename()).toMatch(/^volozhin-reader-skeleton-edition-1-.*\.docx$/);
    const zip = unzipSync(new Uint8Array(word.bytes));
    const xml = strFromU8(zip["word/document.xml"]);
    const texts = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((x) => x[1]);
    const week = demoWeek();
    seedDemoSources(week);
    const wanted = ["יום ראשון", readerManifest(week).rows[0].header, "סיכום יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "סיכום יום חמישי"];
    let from = 0;
    for (const t of wanted) {
      const i = texts.indexOf(t, from);
      expect(i, t).toBeGreaterThanOrEqual(0);
      from = i + 1;
    }
    expect(xml).toContain("<w:bidi/>");
    expect(xml).toMatch(/TOC \\h \\o/);
    expect(readerRows(readerManifest(week)).length).toBeGreaterThan(0);
  });
});

// the second review's proof: a computer's window narrower than 1024px (half a screen, a zoomed page) had no
// build, and told its user to build «במחשב»
test.describe("a computer's window narrower than 1024px, with a mouse", () => {
  test.use({ viewport: { width: 1000, height: 800 }, isMobile: false, hasTouch: false });
  test("builds the reader: the button, no notice, a PDF of the pages the estimate said", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one run: the window is set here");
    test.setTimeout(120_000);
    await page.goto(`${demoUrl()}/reader`);
    await expect(page.getByRole("button", { name: BUILD })).toBeVisible();
    await expect(page.getByText("את המקראה בונים במחשב")).toHaveCount(0);
    const estimate = Number(/בערך (\d+) עמודים/.exec((await page.getByText(/^בערך \d+ עמודים/).textContent())!)![1]);
    const out = await downloaded(page, () => page.getByRole("button", { name: BUILD }).click());
    expect(out.d.suggestedFilename()).toMatch(/\.pdf$/);
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(estimate);
    await noSidewaysScroll(page);
  });
});

test.describe("mock build", () => {
  test("the wire: the upload to Storage with the member's token, register by name, removal in order, the build by signed URL", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    test.setTimeout(120_000);
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    const opening = week.lessons.find((l) => l.day === 0 && l.start_min === 510)!;
    const target = week.lessons.find((l) => l.day === 0 && l.start_min === 690)!;
    const existing = `7/${opening.id}/00000000-0000-4000-8000-000000000001-sample-1.pdf`;
    week.sourceFiles = [
      { id: 41, lesson_id: opening.id, cover: false, speaker_id: 1, storage_path: existing, display_name: "דף לדוגמה.pdf", mime: "application/pdf", size_bytes: 2000, page_count: 1, uploaded_by: 1, uploaded_at: "2026-11-01T10:00:00.000Z" },
    ];
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "admin@example.org", display_name: "מדריך/ה לדוגמה", global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("register_source_file", { id: 42, lesson_id: target.id, cover: false, speaker_id: 5, storage_path: "x", display_name: "מקורות.pdf", mime: "application/pdf", size_bytes: 1, page_count: 2, uploaded_by: 1, uploaded_at: "2026-11-02T10:00:00.000Z" });
    sb.answers.set("remove_source_file", null);
    sb.storageFiles.set(existing, await pdf([[200, 300]]));
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    const bearer = `Bearer ${session.access_token}`;

    await page.goto(mockUrl());
    const panel = await openLesson(page, info, "ראשון", "מרצה 05");
    await stage(panel, "sources").getByRole("button", { name: /^מקורות/ }).click();
    await panel.locator("input[type=file]").setInputFiles({ name: "מקורות.pdf", mimeType: "application/pdf", buffer: await pdf([[300, 400], [300, 400]]) });
    await expect(toast(page, "הקובץ הועלה")).toBeVisible();
    const up = sb.storage.find((c) => c.method === "POST" && c.path.startsWith("/storage/v1/object/sources/"))!;
    expect(up.path).toMatch(new RegExp(`^/storage/v1/object/sources/7/${target.id}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-file\\.pdf$`));
    expect([up.auth, up.contentType, up.apikey]).toEqual([bearer, "application/pdf", "sb_publishable_mock"]);
    expect(up.cacheControl).toBe("private, no-store"); // Storage serves the file back with it: no copy outlives a signed URL or a removal
    const path = up.path.slice("/storage/v1/object/sources/".length);
    expect(sb.rpc.get("register_source_file")).toEqual([{ p_edition: 7, p_lesson: target.id, p_path: path, p_display_name: "מקורות.pdf", p_pages: 2 }]);
    expect(sb.calls.filter((c) => c.path === "/rest/v1/rpc/register_source_file").every((c) => c.auth === bearer)).toBe(true);
    await page.getByRole("button", { name: "סגירה", exact: true }).first().click();

    // removal: the object first (the Storage API, with the member's token), then the row
    const opened = await openLesson(page, info, "ראשון", "מרצה 01");
    await stage(opened, "sources").getByRole("button", { name: /^מקורות/ }).click();
    await opened.getByRole("list", { name: "קבצים שהועלו" }).getByRole("button", { name: "הסרה" }).click();
    await opened.getByRole("button", { name: "כן, להסיר" }).click();
    await expect(toast(page, "הקובץ הוסר")).toBeVisible();
    const del = sb.storage.find((c) => c.method === "DELETE")!;
    expect([del.path, del.body, del.auth]).toEqual(["/storage/v1/object/sources", { prefixes: [existing] }, bearer]);
    expect(sb.rpc.get("remove_source_file")).toEqual([{ p_file: 41 }]);
    expect(sb.storage.indexOf(del)).toBeLessThan(sb.storage.length); // (order with the RPC: the RPC is called only after the delete answered)

    // the build: signed URLs for the files it needs, fetched through them — never a public URL
    await page.goto(`${mockUrl()}/reader`);
    const out = await downloaded(page, () => page.getByRole("button", { name: BUILD }).click());
    const sign = sb.storage.find((c) => c.method === "POST" && c.path === "/storage/v1/object/sign/sources")!;
    expect([sign.body, sign.auth]).toEqual([{ expiresIn: 600, paths: [existing] }, bearer]);
    expect(sb.storage.some((c) => c.method === "GET" && c.path === `/storage/v1/object/sign/sources/${existing}`)).toBe(true);
    expect(sb.storage.some((c) => c.path.includes("/object/public/"))).toBe(false);
    const doc = await PDFDocument.load(out.bytes);
    expect(sources(doc)).toContain("200x300");
  });

  test("logistics read the files (they print) but upload nothing and build no reader", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const week = demoWeek();
    seedDemoSources(week);
    week.edition.id = 7;
    week.edition.kind = "real";
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "l@example.org", display_name: "לוגיסטיקה לדוגמה", global_admin: false, memberships: [{ edition_id: 7, role: "logistics", member_id: 5 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    await sb.attach(page);
    sb.token = (await signIn(page, "l@example.org")).access_token;
    await page.goto(mockUrl());
    const panel = await openLesson(page, info, "ראשון", "מרצה 01");
    await stage(panel, "sources").getByRole("button", { name: /^מקורות/ }).click();
    const files = panel.getByRole("list", { name: "קבצים שהועלו" });
    await expect(files.getByText("דף מקורות לדוגמה.pdf")).toBeVisible();
    await expect(files.getByRole("button", { name: "פתיחה" }).first()).toBeVisible();
    await expect(files.getByRole("button", { name: "הסרה" })).toHaveCount(0);
    await expect(panel.locator("input[type=file]")).toHaveCount(0);
    await page.goto(`${mockUrl()}/reader`);
    await expect(page.getByText("את המקראה בונים צוות התוכן והמדריך/ה")).toBeVisible();
    await expect(page.getByRole("button", { name: BUILD })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "תוצרים" }).getByRole("link", { name: "מקראה" })).toHaveCount(0);
  });

  test("a refused upload says so and registers nothing", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "a@example.org", display_name: "חבר/ת צוות לדוגמה", global_admin: false, memberships: [{ edition_id: 7, role: "content", member_id: 2 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.uploadAnswer = { status: 400, body: { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" } };
    await sb.attach(page);
    const session = await signIn(page, "a@example.org");
    sb.token = session.access_token;
    await page.goto(mockUrl());
    const panel = await openLesson(page, info, "ראשון", "מרצה 05");
    await stage(panel, "sources").getByRole("button", { name: /^מקורות/ }).click();
    await panel.locator("input[type=file]").setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: await pdf([[100, 100]]) });
    await expect(panel.getByRole("list", { name: "העלאות" }).getByRole("alert")).toContainText("אין הרשאה להעלות לכאן");
    expect(sb.rpc.get("register_source_file")).toBeUndefined();
  });
});
