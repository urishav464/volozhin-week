// The sources' files and the reader (milestone 5ב-1) in a real browser. Demo
// build: a synthetic PDF uploaded in the lesson panel, its pages counted and
// the lesson's sources turned on, then removed; the manifest «התקבל / חסר» at
// every width without sideways scroll; «בנה מקראה» on a desktop — the PDF the
// worker made, downloaded and read back with pdf-lib (its page count, the
// cover, the contents, each lesson's pages in schedule order, recognised by
// the size of the source page each embeds); a poster marked as the cover; the
// Word skeleton unzipped (the headings in order, right to left). Mock build:
// the upload goes to /storage/v1/object/sources/<edition>/<lesson>/<uuid>-<safe
// name> with the member's bearer, then register_source_file by its parameter
// names; a removal deletes the object first, then the row; the build asks for
// signed URLs (never a public one) and reads the files through them.
// Synthetic data only: every file is made here.
import { readFileSync } from "node:fs";
import { expect, type Download, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
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
    // not a type the bucket takes: refused before anything is sent
    await panel.locator("input[type=file]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(panel.getByRole("list", { name: "העלאות" }).getByRole("alert")).toContainText("אפשר להעלות רק PDF");
    // removal asks first
    await list.getByRole("button", { name: "הסרה" }).click();
    await panel.getByRole("button", { name: "כן, להסיר" }).click();
    await expect(toast(page, "הקובץ הוסר")).toBeVisible();
    await expect(panel.getByText("עוד לא הועלו קבצים לשיעור הזה.")).toBeVisible();
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
    if (info.project.name === "desktop") await expect(page.getByRole("button", { name: "בנה מקראה (PDF)" })).toBeVisible();
    else {
      await expect(page.getByRole("button", { name: "בנה מקראה (PDF)" })).toHaveCount(0);
      await expect(page.getByText("את המקראה בונים במחשב")).toBeVisible();
    }
    await noSidewaysScroll(page);
    // a row opens its lesson in the week, at «מקורות»
    await page.locator('[data-status="needs_pdf"]').getByRole("button").click();
    await expect(page.getByRole("dialog", { name: "שיעור סגור" })).toBeVisible();
    await expect(page.getByRole("group", { name: "קבצי המקורות" })).toContainText("מקורות לדוגמה.docx");
  });

  test("«בנה מקראה»: the downloaded PDF — cover, contents, each lesson's pages in schedule order, a «סיכום יום» per day", async ({ page }, info) => {
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

    const out = await downloaded(page, () => page.getByRole("button", { name: "בנה מקראה (PDF)" }).click());
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
    const out = await downloaded(page, () => page.getByRole("button", { name: "בנה מקראה (PDF)" }).click());
    const doc = await PDFDocument.load(out.bytes);
    expect(images(doc, 0)).toEqual(["img:1x1"]); // the poster, not the schedule page
    expect(images(doc, 1)).not.toContain("img:1x1"); // the contents follow
    // back to the schedule page
    await page.getByRole("radio", { name: "בלי פוסטר: עמוד לו״ז מהשבוע" }).check();
    await expect(toast(page, "השער: עמוד לו״ז מהשבוע")).toBeVisible();

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
    const out = await downloaded(page, () => page.getByRole("button", { name: "בנה מקראה (PDF)" }).click());
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
    await expect(page.getByRole("button", { name: "בנה מקראה (PDF)" })).toHaveCount(0);
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
